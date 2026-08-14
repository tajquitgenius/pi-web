import { describe, expect, it, vi } from 'vitest';
import { readEmbeddedSession, readSurfaceOverride, writeSurfaceOverride } from './browser';
import { createPiWebClient, PiWebClientError } from './client';
import type { PiWebSSEEventName } from './contracts';

class FakeEventSource {
  static latest: FakeEventSource | undefined;

  readonly listeners = new Map<string, EventListener[]>();
  readonly url: string;
  onerror: ((this: EventSource, event: Event) => unknown) | null = null;
  onmessage: ((this: EventSource, event: MessageEvent) => unknown) | null = null;
  close = vi.fn();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.latest = this;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    const callback: EventListener =
      typeof listener === 'function' ? listener : (event) => listener.handleEvent(event);
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }

  emitMessage(data: string): void {
    this.onmessage?.call(this as unknown as EventSource, new MessageEvent('message', { data }));
  }

  emitNamed(name: string, data: string): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(new MessageEvent(name, { data }));
    }
  }
}

function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('PiWebClient', () => {
  it('sends explicit model and thinking defaults when creating a session', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, id: 'new.jsonl' }));
    const client = createPiWebClient({ fetchImpl });

    await client.createSession({
      path: '/work/project',
      modelProvider: 'anthropic',
      modelId: 'claude-sonnet',
      thinkingLevel: 'high',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/new-session',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          path: '/work/project',
          modelProvider: 'anthropic',
          modelId: 'claude-sonnet',
          thinkingLevel: 'high',
        }),
      }),
    );
  });

  it('normalizes the current Go session summary fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        sessions: [
          {
            ID: 'session.jsonl',
            SessionUUID: 'uuid',
            Project: '/work/project',
            Name: 'Foundation',
            MessageCount: 4,
            ChatAvailable: true,
          },
        ],
        total: 1,
      }),
    );
    const client = createPiWebClient({ fetchImpl });

    const result = await client.listSessions({ project: '/work/project', limit: 20 });

    expect(fetchImpl.mock.calls[0][0]).toBe('/api/sessions?limit=20&project=%2Fwork%2Fproject');
    expect(result.sessions[0]).toMatchObject({
      id: 'session.jsonl',
      sessionUUID: 'uuid',
      project: '/work/project',
      name: 'Foundation',
      messageCount: 4,
      chatAvailable: true,
    });
  });

  it('wraps the shared chat controls', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({ ok: true, status: 'queued' })));
    const client = createPiWebClient({ fetchImpl });

    await client.sendChat('session one.jsonl', { message: 'hello' });
    await client.cancelChat('session one.jsonl');
    await client.getWorkerStatus('session one.jsonl');
    await client.setModel('session one.jsonl', 'openai-codex-secondary', 'gpt-5.6-sol');
    await client.setThinkingLevel('session one.jsonl', 'high');

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      '/api/chat?id=session%20one.jsonl',
      '/api/chat/cancel?id=session%20one.jsonl',
      '/api/worker-status?id=session%20one.jsonl',
      '/api/set-model?id=session%20one.jsonl',
      '/api/set-thinking-level?id=session%20one.jsonl',
    ]);
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    );
  });

  it('reads host context from the server-owned bootstrap element', () => {
    const documentImpl = {
      getElementById: () => ({
        textContent: JSON.stringify({
          instanceName: 'Work',
          currentUrl: 'https://work.example',
          peers: [{ label: 'Personal', url: 'https://personal.example' }],
        }),
      }),
    } as unknown as Document;
    const client = createPiWebClient({ documentImpl });

    expect(client.getHostContext()).toEqual({
      instanceName: 'Work',
      currentUrl: 'https://work.example',
      peers: [{ label: 'Personal', url: 'https://personal.example' }],
    });
  });

  it('maps plain reload and new-session messages exactly once', () => {
    const events: Array<[PiWebSSEEventName, unknown]> = [];
    const client = createPiWebClient({
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });

    client.subscribe('__all__', {
      onEvent: (name, payload) => events.push([name, payload]),
    });
    const source = FakeEventSource.latest;
    expect(source?.url).toBe('/events?id=__all__');
    expect([...source!.listeners.keys()]).not.toContain('reload');
    expect([...source!.listeners.keys()]).not.toContain('new-session');

    source?.emitMessage('reload');
    source?.emitMessage('new-session');
    source?.emitMessage('{"not":"a server event"}');

    expect(events).toEqual([
      ['reload', undefined],
      ['new-session', undefined],
    ]);
  });

  it('maps every named server event once with parsed payloads', () => {
    const events: Array<[PiWebSSEEventName, unknown]> = [];
    const client = createPiWebClient({
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });

    client.subscribe('session.jsonl', {
      onEvent: (name, payload) => events.push([name, payload]),
    });
    const source = FakeEventSource.latest!;
    expect([...source.listeners.keys()]).toEqual([
      'chat-preview',
      'status-snapshot',
      'status-delta',
      'annotations',
      'queue',
      'btw-changed',
    ]);

    source.emitNamed('chat-preview', '{"content":"working","done":false}');
    source.emitNamed(
      'status-snapshot',
      '{"running":["session.jsonl"],"statuses":{"session.jsonl":{"id":"session.jsonl","running":true}}}',
    );
    source.emitNamed('status-delta', '{"id":"session.jsonl","running":false}');
    source.emitNamed('annotations', '{"type":"snapshot","annotations":[]}');
    source.emitNamed('queue', '{"sessionId":"session.jsonl"}');
    source.emitNamed('btw-changed', '{"sessionId":"scratch.jsonl"}');

    expect(events).toEqual([
      ['chat-preview', { content: 'working', done: false }],
      [
        'status-snapshot',
        {
          running: ['session.jsonl'],
          statuses: { 'session.jsonl': { id: 'session.jsonl', running: true } },
        },
      ],
      ['status-delta', { id: 'session.jsonl', running: false }],
      ['annotations', { type: 'snapshot', annotations: [] }],
      ['queue', { sessionId: 'session.jsonl' }],
      ['btw-changed', { sessionId: 'scratch.jsonl' }],
    ]);
  });

  it('uses the device-pairing backend routes', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'ABCD2345', expiresAt: '2026-01-01T00:05:00Z' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createPiWebClient({ fetchImpl });

    await client.createPairingCode();
    await client.revokePairedDevice('device/one');

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      '/api/pairing-codes',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      '/api/devices/device%2Fone',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('exposes Retry-After on API errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: 'too many pairing attempts' }, 429, { 'Retry-After': '60' }),
      );
    const client = createPiWebClient({ fetchImpl });

    await expect(client.submitPairing({ code: 'ABCD2345', label: 'Phone' })).rejects.toMatchObject({
      name: 'PiWebClientError',
      status: 429,
      retryAfter: '60',
    } satisfies Partial<PiWebClientError>);
  });

  it('shares bootstrap parsing and surface-cookie helpers', () => {
    const data = {
      header: {},
      entries: [],
      name: 'Embedded',
      total: 0,
      from: 0,
      chatAvailable: true,
      chatDisabledReason: '',
      model: 'gpt-5.6-sol',
      modelProvider: 'openai-codex-secondary',
    };
    const encoded = btoa(JSON.stringify({ id: 'session.jsonl', data }));
    const documentImpl = {
      cookie: 'pi-web-surface=desktop',
      getElementById: () => ({ textContent: encoded }),
    } as unknown as Document;

    expect(readEmbeddedSession('session.jsonl', { documentImpl })).toEqual(data);
    expect(readSurfaceOverride(documentImpl.cookie)).toBe('desktop');
    writeSurfaceOverride('mobile', documentImpl);
    expect(documentImpl.cookie).toContain('pi-web-surface=mobile');
  });
});
