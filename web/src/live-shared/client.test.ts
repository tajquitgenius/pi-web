import { describe, expect, it, vi } from 'vitest';
import { createPiWebClient } from './client';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
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

  it('uses the device-pairing backend routes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createPiWebClient({ fetchImpl });

    await client.revokePairedDevice('device/one');

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/devices/device%2Fone',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
