import { afterEach, describe, expect, it, vi } from 'vitest';
import { installReleaseRefresh } from './release-refresh';

async function flushChecks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('foreground release refresh', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('reloads a resumed PWA when the no-store build fingerprint changes', async () => {
    const windowEvents = new EventTarget();
    const documentEvents = new EventTarget();
    const reload = vi.fn();
    const updateServiceWorker = vi.fn(() => new Promise<void>(() => undefined));
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ build: 'bbbbbbbbbbbbbbbb' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const uninstall = installReleaseRefresh({
      runningBuild: 'aaaaaaaaaaaaaaaa',
      product: 'mobile',
      displayMode: 'standalone',
      layoutMetrics: () => ({
        screenHeight: 874,
        innerHeight: 815,
        visualHeight: 815,
        visualTop: 0,
        rootTop: 0,
        rootBottom: 874,
        composerTop: 782,
        composerBottom: 840,
        composerPaddingBottom: 34,
      }),
      windowEvents,
      documentEvents,
      visibilityState: () => 'visible',
      fetchImpl,
      reload,
      updateServiceWorker,
      minimumIntervalMs: 0,
    });

    windowEvents.dispatchEvent(new Event('pageshow'));
    await flushChecks();

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      '/app-build.json',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/client-build-observation', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        'X-Pi-Web-Deployed-Build': 'bbbbbbbbbbbbbbbb',
        'X-Pi-Web-Display-Mode': 'standalone',
        'X-Pi-Web-Product': 'mobile',
        'X-Pi-Web-Running-Build': 'aaaaaaaaaaaaaaaa',
        'X-Pi-Web-Screen-Height': '874',
        'X-Pi-Web-Inner-Height': '815',
        'X-Pi-Web-Visual-Height': '815',
        'X-Pi-Web-Visual-Top': '0',
        'X-Pi-Web-Root-Top': '0',
        'X-Pi-Web-Root-Bottom': '874',
        'X-Pi-Web-Composer-Top': '782',
        'X-Pi-Web-Composer-Bottom': '840',
        'X-Pi-Web-Composer-Padding-Bottom': '34',
      },
    });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(updateServiceWorker).toHaveBeenCalledOnce();
    expect(updateServiceWorker.mock.invocationCallOrder[0]).toBeLessThan(
      reload.mock.invocationCallOrder[0]!,
    );
    uninstall();
  });

  it('keeps the current document when its build fingerprint is current', async () => {
    const windowEvents = new EventTarget();
    const reload = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ build: 'current-build' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    installReleaseRefresh({
      runningBuild: 'current-build',
      windowEvents,
      documentEvents: new EventTarget(),
      visibilityState: () => 'visible',
      fetchImpl,
      reload,
      minimumIntervalMs: 0,
    });

    windowEvents.dispatchEvent(new Event('pageshow'));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());

    expect(reload).not.toHaveBeenCalled();
  });

  it('checks a visible document when it regains focus', async () => {
    const windowEvents = new EventTarget();
    const reload = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ build: 'new-focus-build' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    installReleaseRefresh({
      runningBuild: 'old-focus-build',
      windowEvents,
      documentEvents: new EventTarget(),
      visibilityState: () => 'visible',
      fetchImpl,
      reload,
      updateServiceWorker: vi.fn().mockResolvedValue(undefined),
      minimumIntervalMs: 0,
    });

    windowEvents.dispatchEvent(new Event('focus'));

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('waits until a restored document is visible before checking its build', async () => {
    const windowEvents = new EventTarget();
    const documentEvents = new EventTarget();
    let visibility: DocumentVisibilityState = 'hidden';
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ build: 'new-build' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const reload = vi.fn();
    installReleaseRefresh({
      runningBuild: 'old-build',
      windowEvents,
      documentEvents,
      visibilityState: () => visibility,
      fetchImpl,
      reload,
      minimumIntervalMs: 0,
    });

    windowEvents.dispatchEvent(new Event('pageshow'));
    await flushChecks();
    expect(fetchImpl).not.toHaveBeenCalled();

    visibility = 'visible';
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('bounds reloads when the endpoint keeps advertising the same mismatched build', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const response = () =>
      Promise.resolve(
        new Response(JSON.stringify({ build: 'persistently-new' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const reload = vi.fn();
    const firstEvents = new EventTarget();
    const uninstall = installReleaseRefresh({
      runningBuild: 'persistently-old',
      windowEvents: firstEvents,
      documentEvents: new EventTarget(),
      visibilityState: () => 'visible',
      fetchImpl: vi.fn(response),
      reload,
      updateServiceWorker: vi.fn().mockResolvedValue(undefined),
      storage,
      minimumIntervalMs: 0,
    });
    firstEvents.dispatchEvent(new Event('pageshow'));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    uninstall();

    const secondEvents = new EventTarget();
    const secondFetch = vi.fn(response);
    installReleaseRefresh({
      runningBuild: 'persistently-old',
      windowEvents: secondEvents,
      documentEvents: new EventTarget(),
      visibilityState: () => 'visible',
      fetchImpl: secondFetch,
      reload,
      updateServiceWorker: vi.fn().mockResolvedValue(undefined),
      storage,
      minimumIntervalMs: 0,
    });
    secondEvents.dispatchEvent(new Event('pageshow'));
    await vi.waitFor(() => expect(secondFetch).toHaveBeenCalledOnce());

    expect(reload).toHaveBeenCalledOnce();
  });

  it('retries on a later lifecycle event after a build request times out', async () => {
    const windowEvents = new EventTarget();
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ build: 'current-build' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    installReleaseRefresh({
      runningBuild: 'current-build',
      windowEvents,
      documentEvents: new EventTarget(),
      visibilityState: () => 'visible',
      fetchImpl,
      reload: vi.fn(),
      minimumIntervalMs: 0,
      requestTimeoutMs: 5,
    });

    windowEvents.dispatchEvent(new Event('pageshow'));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    windowEvents.dispatchEvent(new Event('focus'));

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });
});
