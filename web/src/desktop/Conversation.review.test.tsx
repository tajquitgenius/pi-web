import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as liveShared from '../live-shared';
import type {
  PiModel,
  PiWebClient,
  SSESubscriptionHandlers,
  SessionDetails,
  SessionEntry,
} from '../live-shared';
import { SessionComposer, SessionPage, Transcript } from './Conversation';

const models: PiModel[] = [{ provider: 'openai', id: 'gpt-5', name: 'GPT 5' }];

function message(id: string, content: string, parentId?: string): SessionEntry {
  return {
    id,
    parentId,
    type: 'message',
    message: { role: 'user', content },
  };
}

function assistantMessage(
  id: string,
  content: unknown,
  timestamp = '2026-01-01T12:34:00Z',
): SessionEntry {
  return {
    id,
    parentId: null,
    timestamp,
    type: 'message',
    message: { role: 'assistant', content },
  };
}

function details(entries: SessionEntry[], overrides: Partial<SessionDetails> = {}): SessionDetails {
  return {
    header: { cwd: '/work/project' },
    entries,
    name: 'Review thread',
    total: entries.length,
    from: 0,
    chatAvailable: true,
    chatDisabledReason: '',
    model: 'gpt-5',
    modelProvider: 'openai',
    ...overrides,
  };
}

function makeClient(
  sessionDetails: SessionDetails,
  overrides: Partial<PiWebClient> = {},
): {
  client: PiWebClient;
  handlers: { current?: SSESubscriptionHandlers };
  getSession: ReturnType<typeof vi.fn>;
} {
  const handlers: { current?: SSESubscriptionHandlers } = {};
  const getSession = vi.fn(async () => sessionDetails);
  const client = {
    getSession,
    getWorkerStatus: vi.fn(async () => ({
      state: 'idle' as const,
      thinkingLevel: 'high' as const,
    })),
    sendChat: vi.fn(async () => ({ ok: true, status: 'queued' })),
    cancelChat: vi.fn(async () => ({ ok: true, status: 'cancelled' })),
    setModel: vi.fn(async () => ({ ok: true })),
    setThinkingLevel: vi.fn(async () => ({ ok: true, thinkingLevel: 'high' as const })),
    subscribe: vi.fn((_topic: string, nextHandlers: SSESubscriptionHandlers) => {
      handlers.current = nextHandlers;
      return { close: vi.fn() };
    }),
    ...overrides,
  } as unknown as PiWebClient;
  return { client, handlers, getSession };
}

function renderTranscript(entries: SessionEntry[], overrides: Partial<SessionDetails> = {}) {
  return render(<Transcript details={details(entries, overrides)} />);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('desktop transcript', () => {
  it('copies only the settled assistant response text from its metadata row', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderTranscript([
      assistantMessage('assistant', [
        { type: 'thinking', thinking: 'Private reasoning' },
        { type: 'text', text: 'First paragraph' },
        { type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: 'secret.txt' } },
        { type: 'text', text: 'Second paragraph' },
      ]),
    ]);

    const copyButton = screen.getByRole('button', { name: 'Copy response' });
    expect(
      copyButton.closest('.desktop-message-metadata')?.querySelector('time'),
    ).toHaveTextContent(/\S/);

    fireEvent.click(copyButton);

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('First paragraph\nSecond paragraph'),
    );
    expect(screen.getByRole('button', { name: 'Response copied' })).toBeInTheDocument();
  });

  it('does not offer copying for a streaming assistant preview', () => {
    render(<Transcript details={details([])} streamingText="Still arriving" />);

    expect(screen.getByText('Still arriving')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy response' })).toBeNull();
  });

  it('renders only the active root-to-leaf chain and omits inactive forks', () => {
    renderTranscript([
      message('root', 'root'),
      message('inactive', 'inactive fork', 'root'),
      message('inactive-leaf', 'inactive leaf', 'inactive'),
      message('active', 'active fork', 'root'),
      message('active-leaf', 'active leaf', 'active'),
    ]);

    expect(screen.getByText('root')).toBeInTheDocument();
    expect(screen.getByText('active fork')).toBeInTheDocument();
    expect(screen.getByText('active leaf')).toBeInTheDocument();
    expect(screen.queryByText('inactive fork')).toBeNull();
    expect(screen.queryByText('inactive leaf')).toBeNull();
  });

  it('keeps unparented legacy and paginated entries when their parents are unavailable', () => {
    renderTranscript(
      [
        message('legacy', 'legacy entry'),
        message('inactive', 'inactive fork', 'legacy'),
        message('active', 'active page entry', 'missing-parent'),
      ],
      { from: 12, total: 20 },
    );

    expect(screen.getByText('legacy entry')).toBeInTheDocument();
    expect(screen.getByText('active page entry')).toBeInTheDocument();
    expect(screen.queryByText('inactive fork')).toBeNull();
    expect(screen.queryByText('Session started')).toBeNull();
  });

  it('honors hidden custom messages, falls back to compaction tokens, and emits a real bash newline', () => {
    renderTranscript([
      {
        id: 'hidden',
        type: 'custom_message',
        customType: 'Internal update',
        display: false,
        content: 'must not appear',
      },
      {
        id: 'compaction',
        type: 'compaction',
        tokensBefore: 12345,
      },
      {
        id: 'bash',
        type: 'message',
        message: { role: 'bashExecution', command: 'printf hi', output: 'hi' },
      },
    ]);

    expect(screen.queryByText('must not appear')).toBeNull();
    expect(screen.getByText('Compacted from 12,345 tokens.')).toBeInTheDocument();
    const shell = screen.getByText('Shell activity').closest('details');
    expect(shell).not.toBeNull();
    expect(shell?.querySelector('pre')?.textContent).toContain('$ printf hi');
    expect(shell?.querySelector('pre')?.textContent).toContain('\nhi');
  });
});

describe('desktop composer', () => {
  const composerProps = {
    chatAvailable: true,
    chatDisabledReason: '',
    client: {} as PiWebClient,
    initialModel: 'gpt-5',
    initialProvider: 'openai',
    initialThinking: 'high' as const,
    models,
    onRunningChange: vi.fn(),
    onSent: vi.fn(),
    running: false,
    sessionId: 'review.jsonl',
  };

  it('fails closed until chat and the exact catalog model are available', () => {
    const sendChat = vi.fn();
    const { client } = makeClient(details([]), { sendChat });
    const { rerender } = render(<SessionComposer {...composerProps} client={client} models={[]} />);

    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(screen.getByRole('alert', { name: 'Chat unavailable' })).toHaveTextContent(
      'Open Pi and log in',
    );

    rerender(
      <SessionComposer
        {...composerProps}
        client={client}
        models={[{ provider: 'anthropic', id: 'claude-3' }]}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'selected model openai/gpt-5 is unavailable',
    );
    expect(sendChat).not.toHaveBeenCalled();
  });

  it('steers while running and keeps cancellation available', async () => {
    const sendChat = vi.fn(async () => ({ ok: true, status: 'queued' }));
    const cancelChat = vi.fn(async () => ({ ok: true, status: 'cancelled' }));
    const onRunningChange = vi.fn();
    const { client } = makeClient(details([]), { sendChat, cancelChat });
    render(
      <SessionComposer
        {...composerProps}
        client={client}
        onRunningChange={onRunningChange}
        running
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Please focus on this' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Steer' }));
    await waitFor(() =>
      expect(sendChat).toHaveBeenCalledWith('review.jsonl', {
        message: 'Please focus on this',
        images: [],
      }),
    );
    expect(screen.getByRole('button', { name: 'Cancel response' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel response' }));
    await waitFor(() => expect(cancelChat).toHaveBeenCalledWith('review.jsonl'));
    expect(onRunningChange).toHaveBeenCalledWith(false);
  });
});

describe('desktop session SSE recovery', () => {
  const pageProps = {
    detailsOpen: false,
    initialRunning: false,
    models,
    onDetailsToggle: vi.fn(),
    onPanelTabChange: vi.fn(),
    onPanelWidthChange: vi.fn(),
    panelTab: 'details' as const,
    panelWidth: 336,
    sessionId: 'review.jsonl',
  };

  it('does not refetch embedded data on the initial SSE open', async () => {
    const embedded = details([message('embedded', 'From the bootstrap')]);
    vi.spyOn(liveShared, 'readEmbeddedSession').mockReturnValue(embedded);
    const { client, handlers, getSession } = makeClient(embedded);
    render(<SessionPage {...pageProps} client={client} />);

    await waitFor(() => expect(client.getWorkerStatus).toHaveBeenCalled());
    act(() => handlers.current?.onOpen?.(new Event('open')));
    await act(async () => {
      await Promise.resolve();
    });
    act(() => handlers.current?.onEvent('reload', undefined));
    await act(async () => {
      await Promise.resolve();
    });

    expect(getSession).not.toHaveBeenCalled();
  });

  it('refetches on the first reload after the bootstrap grace window', async () => {
    const embedded = details([message('embedded', 'From the bootstrap')]);
    vi.spyOn(liveShared, 'readEmbeddedSession').mockReturnValue(embedded);
    const { client, handlers, getSession } = makeClient(embedded);
    render(<SessionPage {...pageProps} client={client} />);

    act(() => handlers.current?.onOpen?.(new Event('open')));
    await new Promise((resolve) => setTimeout(resolve, 300));
    act(() => handlers.current?.onEvent('reload', undefined));

    await waitFor(() =>
      expect(getSession).toHaveBeenCalledWith('review.jsonl', { paginate: true }),
    );
  });

  it('applies status snapshots and clears stale previews after a missed done event', async () => {
    const sessionDetails = details([]);
    const { client, handlers } = makeClient(sessionDetails);
    render(<SessionPage {...pageProps} client={client} />);
    await waitFor(() => expect(client.getSession).toHaveBeenCalled());

    act(() => {
      handlers.current?.onEvent('chat-preview', { content: 'still working', done: false });
    });
    expect(screen.getByText('still working')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();

    act(() => {
      handlers.current?.onEvent('status-snapshot', {
        running: [],
        statuses: { 'review.jsonl': { id: 'review.jsonl', running: false } },
      });
    });
    await waitFor(() => expect(screen.queryByText('still working')).toBeNull());
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('reconciles worker status on SSE errors and refreshes after reconnect opens', async () => {
    const sessionDetails = details([]);
    const getWorkerStatus = vi
      .fn()
      .mockResolvedValue({ state: 'idle' as const, thinkingLevel: 'high' as const });
    const { client, handlers, getSession } = makeClient(sessionDetails, { getWorkerStatus });
    render(<SessionPage {...pageProps} client={client} />);
    await waitFor(() => expect(getWorkerStatus).toHaveBeenCalled());
    act(() => handlers.current?.onOpen?.(new Event('open')));
    const beforeRecovery = getWorkerStatus.mock.calls.length;

    act(() => handlers.current?.onError?.(new Event('error')));
    await waitFor(() => expect(getWorkerStatus.mock.calls.length).toBeGreaterThan(beforeRecovery));

    const beforeOpen = getSession.mock.calls.length;
    act(() => handlers.current?.onOpen?.(new Event('open')));
    await waitFor(() => expect(getSession.mock.calls.length).toBeGreaterThan(beforeOpen));
  });

  it('bounds repeated worker reconciliation attempts', async () => {
    vi.useFakeTimers();
    const getWorkerStatus = vi
      .fn()
      .mockResolvedValue({ state: 'running' as const, thinkingLevel: 'high' as const });
    const { client, handlers } = makeClient(details([]), { getWorkerStatus });
    render(<SessionPage {...pageProps} client={client} />);
    await act(async () => {
      await Promise.resolve();
    });
    act(() => handlers.current?.onError?.(new Event('error')));
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(getWorkerStatus.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
