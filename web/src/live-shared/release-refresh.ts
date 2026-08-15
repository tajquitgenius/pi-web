export interface ReleaseRefreshOptions {
  runningBuild: string;
  windowEvents?: EventTarget;
  documentEvents?: EventTarget;
  visibilityState?: () => DocumentVisibilityState;
  fetchImpl?: typeof fetch;
  reload?: () => void;
  updateServiceWorker?: () => Promise<void>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  now?: () => number;
  minimumIntervalMs?: number;
  requestTimeoutMs?: number;
}

interface AppBuildResponse {
  build?: unknown;
}

const RELOAD_TARGET_KEY = 'pi-web-release-reload-target';

async function updateRegisteredWorker(): Promise<void> {
  if (!('serviceWorker' in globalThis.navigator)) return;
  const registration = await globalThis.navigator.serviceWorker.getRegistration();
  await registration?.update();
}

export function installReleaseRefresh({
  runningBuild,
  windowEvents = globalThis.window,
  documentEvents = globalThis.document,
  visibilityState = () => globalThis.document.visibilityState,
  fetchImpl = globalThis.fetch,
  reload = () => globalThis.location.reload(),
  updateServiceWorker = updateRegisteredWorker,
  storage,
  now = Date.now,
  minimumIntervalMs = 1_000,
  requestTimeoutMs = 8_000,
}: ReleaseRefreshOptions): () => void {
  if (!runningBuild) return () => {};
  const reloadStorage = (() => {
    if (storage) return storage;
    try {
      return globalThis.sessionStorage;
    } catch {
      return undefined;
    }
  })();
  const storedTarget = () => {
    try {
      return reloadStorage?.getItem(RELOAD_TARGET_KEY) || '';
    } catch {
      return '';
    }
  };
  const rememberTarget = (build: string) => {
    try {
      reloadStorage?.setItem(RELOAD_TARGET_KEY, build);
    } catch {
      // Reload still works when storage is unavailable.
    }
  };
  const clearTarget = () => {
    try {
      reloadStorage?.removeItem(RELOAD_TARGET_KEY);
    } catch {
      // Nothing to clear when storage is unavailable.
    }
  };
  let disposed = false;
  let checking = false;
  let lastCheck = Number.NEGATIVE_INFINITY;
  let activeController: AbortController | null = null;

  const check = () => {
    if (disposed || checking || visibilityState() !== 'visible') return;
    const checkedAt = now();
    if (checkedAt - lastCheck < minimumIntervalMs) return;
    lastCheck = checkedAt;
    checking = true;
    const controller = new AbortController();
    activeController = controller;
    const timeout = globalThis.setTimeout(() => {
      controller.abort();
      if (activeController === controller) {
        activeController = null;
        checking = false;
      }
    }, requestTimeoutMs);
    void fetchImpl('/app-build.json', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as AppBuildResponse;
        if (typeof payload.build !== 'string' || !payload.build) return;
        if (payload.build === runningBuild) {
          clearTarget();
          return;
        }
        if (storedTarget() === payload.build) return;
        rememberTarget(payload.build);
        try {
          void updateServiceWorker().catch(() => {});
        } catch {
          // A network shell reload still updates the app when worker refresh fails.
        }
        reload();
      })
      .catch(() => {})
      .finally(() => {
        globalThis.clearTimeout(timeout);
        if (activeController === controller) {
          activeController = null;
          checking = false;
        }
      });
  };

  const onVisibilityChange = () => check();
  windowEvents.addEventListener('pageshow', check);
  windowEvents.addEventListener('focus', check);
  documentEvents.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    disposed = true;
    activeController?.abort();
    windowEvents.removeEventListener('pageshow', check);
    windowEvents.removeEventListener('focus', check);
    documentEvents.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
