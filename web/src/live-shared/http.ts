export type FetchLike = typeof fetch;

export interface PiWebHttp {
  request<Response>(path: string, init?: RequestInit): Promise<Response>;
  postJSON<Response>(path: string, body: unknown): Promise<Response>;
}

export class PiWebClientError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;

  constructor(status: number, message: string, retryAfter: string | null = null) {
    super(message);
    this.name = 'PiWebClientError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function createPiWebHttp(fetchImpl: FetchLike = globalThis.fetch, basePath = ''): PiWebHttp {
  async function request<Response>(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetchImpl(`${basePath}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...init?.headers,
      },
    });
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const payload = (await response.json()) as { error?: unknown };
        if (typeof payload.error === 'string' && payload.error) message = payload.error;
      } catch {
        // Keep the status-based message for non-JSON errors.
      }
      throw new PiWebClientError(response.status, message, response.headers.get('Retry-After'));
    }
    if (response.status === 204) return undefined as Response;
    return (await response.json()) as Response;
  }

  return {
    request,
    postJSON<Response>(path: string, body: unknown): Promise<Response> {
      return request<Response>(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
  };
}
