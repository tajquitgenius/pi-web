import type { SessionDetails } from './contracts';

export type SurfaceOverride = 'auto' | 'desktop' | 'mobile';

export interface SessionBootstrap {
  id: string;
  data: SessionDetails;
  scratchpad?: string;
}

export interface SessionBootstrapOptions {
  documentImpl?: Pick<Document, 'getElementById'>;
  atobImpl?: typeof atob;
  TextDecoderImpl?: typeof TextDecoder;
}

export function readSessionBootstrap({
  documentImpl = globalThis.document,
  atobImpl = globalThis.atob,
  TextDecoderImpl = globalThis.TextDecoder,
}: SessionBootstrapOptions = {}): SessionBootstrap | null {
  const encoded = documentImpl?.getElementById('pi-session-bootstrap')?.textContent?.trim();
  if (!encoded) return null;
  try {
    const bytes = Uint8Array.from(atobImpl(encoded), (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoderImpl().decode(bytes)) as Partial<SessionBootstrap>;
    if (
      typeof payload.id !== 'string' ||
      !payload.data ||
      typeof payload.data !== 'object' ||
      Array.isArray(payload.data)
    ) {
      return null;
    }
    return payload as SessionBootstrap;
  } catch {
    return null;
  }
}

export function readEmbeddedSession(
  sessionId: string,
  options?: SessionBootstrapOptions,
): SessionDetails | null {
  const bootstrap = readSessionBootstrap(options);
  return bootstrap?.id === sessionId ? bootstrap.data : null;
}

export function readSurfaceOverride(cookie: string): SurfaceOverride {
  const match = cookie.match(/(?:^|;\s*)pi-web-surface=(auto|desktop|mobile)(?:;|$)/);
  return (match?.[1] as SurfaceOverride | undefined) ?? 'auto';
}

export function writeSurfaceOverride(
  surface: SurfaceOverride,
  documentImpl: Pick<Document, 'cookie'> = document,
): void {
  documentImpl.cookie = `pi-web-surface=${surface}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
