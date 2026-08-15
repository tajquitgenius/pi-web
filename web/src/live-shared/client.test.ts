import { describe, expect, it, vi } from 'vitest';
import { parsePiSessionSummary } from '../live-domain';
import { readEmbeddedSession, readSurfaceOverride, writeSurfaceOverride } from './browser';
import { createPiWebClient, PiWebClientError } from './client';
import type { PiWebSSEEventName } from './contracts';

class FakeEventSource {
  static latest: FakeEventSource | undefined;

  readonly listeners = new Map<string, EventListener[]>();
  readonly url: string;
  onerror: ((this: EventSource, event: Event) => unknown) | null = null;
  onopen: ((this: EventSource, event: Event) => unknown) | null = null;
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

  emitOpen(): void {
    this.onopen?.call(this as unknown as EventSource, new Event('open'));
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

  it('drops null and primitive session summaries from the session list', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ sessions: [null, 'bad', { ID: 'valid.jsonl' }], total: 3 }),
      );
    const client = createPiWebClient({ fetchImpl });

    const result = await client.listSessions();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.id).toBe('valid.jsonl');

    const nullPayloadClient = createPiWebClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(null)),
    });
    await expect(nullPayloadClient.listSessions()).resolves.toMatchObject({
      sessions: [],
      total: 0,
    });
  });

  it('defaults malformed session summaries to unavailable chat', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ sessions: [{ ID: 'session.jsonl' }], total: 1 }));
    const client = createPiWebClient({ fetchImpl });

    const result = await client.listSessions();

    expect(result.sessions[0]?.chatAvailable).toBe(false);
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

  it('forwards EventSource open events to subscribers', () => {
    const onOpen = vi.fn();
    const client = createPiWebClient({
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });

    client.subscribe('__all__', {
      onEvent: () => {},
      onOpen,
    });
    FakeEventSource.latest?.emitOpen();

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('drops malformed named event payloads before notifying subscribers', () => {
    const events: Array<[PiWebSSEEventName, unknown]> = [];
    const client = createPiWebClient({
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });
    client.subscribe('session.jsonl', {
      onEvent: (name, payload) => events.push([name, payload]),
    });
    const source = FakeEventSource.latest!;

    source.emitNamed('chat-preview', '{"content":"working","done":"no"}');
    source.emitNamed('status-snapshot', '{"running":"session.jsonl","statuses":{}}');
    source.emitNamed('status-delta', '{"id":"session.jsonl","running":"yes"}');
    source.emitNamed('annotations', 'null');
    source.emitNamed('queue', '{"sessionId":42}');
    source.emitNamed('btw-changed', '{"sessionId":42}');

    expect(events).toEqual([]);
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

  it('normalizes malformed model lists to valid provider/id pairs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        models: [
          { provider: 'openai', id: 'gpt-5' },
          { provider: ' ', id: 'missing-provider' },
          { provider: 'anthropic', id: '' },
          null,
          'not a model',
        ],
      }),
    );
    const client = createPiWebClient({ fetchImpl });

    await expect(client.listModels()).resolves.toEqual({
      models: [{ provider: 'openai', id: 'gpt-5' }],
    });

    const nullPayloadClient = createPiWebClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(null)),
    });
    await expect(nullPayloadClient.listModels()).resolves.toEqual({ models: [] });
  });

  it('guards live-domain session summaries and defaults chat to unavailable', () => {
    expect(parsePiSessionSummary(null).chat).toEqual({ available: false, reason: '' });
    expect(parsePiSessionSummary({ id: 'session.jsonl' }).chat).toEqual({
      available: false,
      reason: '',
    });
  });

  it('keeps mutation transport contracts encoded for special-character resources', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({})));
    const client = createPiWebClient({ fetchImpl });
    const session = 'session & one.jsonl';
    const parent = 'parent/one.jsonl';
    const schedule = 'schedule / one';

    await client.listReviewComments(session);
    await client.saveReviewComment(session, {
      file: 'src/a b.ts',
      startLine: 1,
      endLine: 2,
      body: 'review',
    });
    await client.deleteReviewComment(session, 'comment/1');
    await client.listAnnotations(session);
    await client.saveAnnotation(session, { anchorId: 'entry/1', startOffset: 0, endOffset: 2 });
    await client.deleteAnnotation(session, 'annotation/1');
    await client.addQueueItem(session, { message: 'steer' });
    await client.removeQueueItem(session, 3);
    await client.setQueuePaused(session, true);
    await client.getSettings();
    await client.saveSettings({ theme: 'dark' });
    await client.getBtw(parent);
    await client.createBtw({ path: '/work/a b', parent });
    await client.listSchedules();
    await client.createSchedule({ name: 'nightly', instructions: 'run tests' });
    await client.getSchedule(schedule);
    await client.updateSchedule(schedule, { name: 'updated', instructions: 'run lint' });
    await client.deleteSchedule(schedule);
    await client.runSchedule(schedule);
    await client.listScheduleRuns(schedule);
    await client.updateProject({ path: '/work/a b', action: 'enable' });
    await client.forkSession(session, 'entry/1');
    await client.cloneSession(session, 'leaf/1');
    await client.renameSession(session, 'Renamed');
    await client.labelSession(session, 'entry/1', 'review');

    const urls = fetchImpl.mock.calls.map(([url]) => url);
    expect(urls).toEqual([
      '/api/diff/reviews?session=session+%26+one.jsonl',
      '/api/diff/reviews?session=session+%26+one.jsonl',
      '/api/diff/reviews?session=session+%26+one.jsonl&id=comment%2F1',
      '/api/annotations?session=session+%26+one.jsonl',
      '/api/annotations?session=session+%26+one.jsonl',
      '/api/annotations?session=session+%26+one.jsonl&id=annotation%2F1',
      '/api/chat/queue?id=session+%26+one.jsonl',
      '/api/chat/queue?id=session+%26+one.jsonl&position=3',
      '/api/chat/queue?id=session+%26+one.jsonl',
      '/api/settings',
      '/api/settings',
      '/api/btw?parent=parent%2Fone.jsonl',
      '/api/btw/new',
      '/api/schedules',
      '/api/schedules',
      '/api/schedule?id=schedule+%2F+one',
      '/api/schedule?id=schedule+%2F+one',
      '/api/schedule?id=schedule+%2F+one',
      '/api/schedule/run?id=schedule+%2F+one',
      '/api/schedule/runs?id=schedule+%2F+one',
      '/api/projects',
      '/api/fork-session?id=session%20%26%20one.jsonl',
      '/api/clone-session?id=session%20%26%20one.jsonl',
      '/api/rename-session?id=session%20%26%20one.jsonl',
      '/api/label-session?id=session%20%26%20one.jsonl',
    ]);
    expect(fetchImpl.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ file: 'src/a b.ts', startLine: 1, endLine: 2, body: 'review' }),
      }),
    );
    expect(fetchImpl.mock.calls[7]?.[1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
    expect(fetchImpl.mock.calls[8]?.[1]).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ paused: true }),
      }),
    );
    expect(fetchImpl.mock.calls[16]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'updated', instructions: 'run lint' }),
      }),
    );
    expect(fetchImpl.mock.calls[2]?.[1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
    expect(fetchImpl.mock.calls[4]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ anchorId: 'entry/1', startOffset: 0, endOffset: 2 }),
      }),
    );
    expect(fetchImpl.mock.calls[5]?.[1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
    expect(fetchImpl.mock.calls[6]?.[1]).toEqual(
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ message: 'steer' }) }),
    );
    expect(fetchImpl.mock.calls[10]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ settings: { theme: 'dark' } }),
      }),
    );
    expect(fetchImpl.mock.calls[12]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/work/a b', parent }),
      }),
    );
    expect(fetchImpl.mock.calls[14]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'nightly', instructions: 'run tests' }),
      }),
    );
    expect(fetchImpl.mock.calls[17]?.[1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
    expect(fetchImpl.mock.calls[18]?.[1]).toEqual(expect.objectContaining({ method: 'POST' }));
    expect(fetchImpl.mock.calls[20]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/work/a b', action: 'enable' }),
      }),
    );
    expect(fetchImpl.mock.calls[21]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ entryId: 'entry/1' }),
      }),
    );
    expect(fetchImpl.mock.calls[22]?.[1]).toEqual(
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ leafId: 'leaf/1' }) }),
    );
    expect(fetchImpl.mock.calls[23]?.[1]).toEqual(
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Renamed' }) }),
    );
    expect(fetchImpl.mock.calls[24]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ entryId: 'entry/1', label: 'review' }),
      }),
    );
  });

  it('exposes the shared project, file, command, diff, and scratchpad names', async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          files: [],
          commands: [],
          workerReady: true,
          isRepo: true,
          diff: '',
          content: '',
        }),
      ),
    );
    const client = createPiWebClient({ fetchImpl });

    await client.listFiles('session one.jsonl', '@src/');
    await client.getCommands('session one.jsonl');
    await client.getGitDiff('session one.jsonl');
    await client.getScratchpad('/work/project');
    await client.saveScratchpad('/work/project', 'notes');

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      '/api/files?id=session%20one.jsonl&q=%40src%2F',
      '/api/commands?id=session%20one.jsonl',
      '/api/git/diff?id=session%20one.jsonl',
      '/api/scratchpad?project=%2Fwork%2Fproject',
      '/api/scratchpad',
    ]);
  });

  it('loads a typed file preview from the session workspace', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        path: 'src/main.ts',
        kind: 'text',
        content: 'export const answer = 42;\n',
        size: 27,
        modifiedAt: '2026-08-14T12:00:00Z',
        revision: 'sha256:abc',
      }),
    );
    const client = createPiWebClient({ fetchImpl });

    await expect(client.getFile('session one.jsonl', 'src/main.ts')).resolves.toEqual({
      path: 'src/main.ts',
      kind: 'text',
      content: 'export const answer = 42;\n',
      size: 27,
      modifiedAt: '2026-08-14T12:00:00Z',
      revision: 'sha256:abc',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/file?id=session%20one.jsonl&path=src%2Fmain.ts',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
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
