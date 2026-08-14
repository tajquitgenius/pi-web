import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PiModel,
  PiWebClient,
  SSESubscriptionHandlers,
  SessionDetails,
  SessionSummary,
} from '../live-shared';
import { SessionComposer, Transcript } from './Conversation';
import { DesktopApp } from './DesktopApp';
import { groupSessions, SIDEBAR_COLLAPSED_KEY } from './desktop-model';

const models: PiModel[] = [
  { provider: 'openai-codex-secondary', id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' },
  { provider: 'anthropic', id: 'claude-sonnet', name: 'Claude Sonnet' },
  { provider: 'anthropic', id: 'claude-opus', name: 'Claude Opus' },
];

const emptyDetails: SessionDetails = {
  header: { cwd: '/work/project' },
  entries: [],
  name: 'Selected thread',
  total: 0,
  from: 0,
  chatAvailable: true,
  chatDisabledReason: '',
  model: 'gpt-5.6-sol',
  modelProvider: 'openai-codex-secondary',
};

function summary(id: string, name: string, project: string, lastActivity: string): SessionSummary {
  return {
    id,
    sessionUUID: `uuid-${id}`,
    filename: id,
    project,
    lastActivity,
    name,
    messageCount: 2,
    tokenTotal: 10,
    costTotal: 0,
    model: 'gpt-5.6-sol',
    modelProvider: 'openai-codex-secondary',
    chatAvailable: true,
    chatDisabledReason: '',
  };
}

function createClient(overrides: Partial<PiWebClient> = {}) {
  const handlers = new Map<string, SSESubscriptionHandlers>();
  const client: PiWebClient = {
    listSessions: vi.fn(async () => ({ sessions: [], total: 0 })),
    getSession: vi.fn(async () => emptyDetails),
    createSession: vi.fn(async () => ({ ok: true, id: 'created.jsonl' })),
    getSessionDefaults: vi.fn(async () => ({
      modelProvider: 'openai-codex-secondary',
      modelId: 'gpt-5.6-sol',
      thinkingLevel: 'high' as const,
    })),
    listModels: vi.fn(async () => ({ models })),
    sendChat: vi.fn(async () => ({ ok: true, status: 'queued' })),
    cancelChat: vi.fn(async () => ({ ok: true, status: 'cancelled' })),
    getWorkerStatus: vi.fn(async () => ({
      state: 'idle' as const,
      thinkingLevel: 'high' as const,
    })),
    setModel: vi.fn(async () => ({ ok: true })),
    setThinkingLevel: vi.fn(async (_sessionId, level) => ({ ok: true, thinkingLevel: level })),
    getHostContext: vi.fn(() => ({
      instanceName: 'Development Mac',
      currentUrl: 'http://localhost:31415',
      peers: [{ label: 'Build host', url: 'https://build.example' }],
    })),
    subscribe: vi.fn((topic, nextHandlers) => {
      handlers.set(topic, nextHandlers);
      return { close: vi.fn() };
    }),
    getPairingStatus: vi.fn(async () => ({ paired: false, local: false })),
    createPairingCode: vi.fn(async () => ({
      code: 'ABCD2345',
      expiresAt: '2026-01-01T00:05:00Z',
    })),
    submitPairing: vi.fn(async () => ({
      paired: true,
      device: {
        id: 'device-1',
        label: 'Work laptop',
        createdAt: '2026-01-01T00:00:00Z',
        lastUsedAt: '2026-01-01T00:00:00Z',
        expiresAt: '2026-04-01T00:00:00Z',
        revokedAt: null,
      },
    })),
    listPairedDevices: vi.fn(async () => ({ devices: [] })),
    revokePairedDevice: vi.fn(async () => undefined),
    ...overrides,
  };
  return { client, handlers };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: memoryStorage(),
  });
  document.body.innerHTML = '<div id="spa-root"></div>';
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('desktop-product');
  document.body.classList.remove('desktop-no-scroll');
  vi.restoreAllMocks();
});

describe('desktop product shell', () => {
  it('owns a fixed pane structure and installs no-body-scroll hooks', async () => {
    const { client } = createClient();
    render(<DesktopApp client={client} path="/" search="" />);

    expect(screen.getByTestId('desktop-product-shell')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Hosts and primary navigation' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Projects and threads' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('data-desktop-route', 'workspace');
    expect(screen.getByTestId('workspace-panes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Development Mac' })).toHaveAttribute(
      'href',
      'http://localhost:31415',
    );
    expect(screen.getByRole('link', { name: 'Build host' })).toHaveAttribute(
      'href',
      'https://build.example',
    );
    expect(document.documentElement).toHaveClass('desktop-product');
    expect(document.body).toHaveClass('desktop-no-scroll');

    await waitFor(() => expect(client.listSessions).toHaveBeenCalledWith({ limit: 500 }));
  });

  it('groups running threads and projects before newer idle work', () => {
    const running = summary('running', 'Running task', '/projects/alpha', '2026-01-01T00:00:00Z');
    const newer = summary('newer', 'Newer idle task', '/projects/alpha', '2026-03-01T00:00:00Z');
    const newestOther = summary(
      'newest-other',
      'Newest other task',
      '/projects/beta',
      '2026-04-01T00:00:00Z',
    );

    const groups = groupSessions([newestOther, newer, running], new Set(['running']));

    expect(groups.map((group) => group.project)).toEqual(['/projects/alpha', '/projects/beta']);
    expect(groups[0].sessions.map((session) => session.id)).toEqual(['running', 'newer']);
  });

  it('navigates between workspace routes without replacing the product shell', async () => {
    const { client } = createClient();
    const navigate = vi.fn();
    render(<DesktopApp client={client} navigateImpl={navigate} path="/" search="" />);

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));

    expect(navigate).toHaveBeenCalledWith('/settings');
    expect(await screen.findByRole('main')).toHaveAttribute('data-desktop-route', 'settings');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('creates a one-time pairing code from local settings', async () => {
    const { client } = createClient({
      getPairingStatus: vi.fn(async () => ({ paired: true, local: true })),
    });
    render(<DesktopApp client={client} path="/settings" search="" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create pairing code' }));

    await waitFor(() => expect(client.createPairingCode).toHaveBeenCalledOnce());
    expect(screen.getByRole('status', { name: 'One-time pairing code' })).toHaveTextContent(
      'ABCD2345',
    );
  });

  it('loads the selected thread from the session route query', async () => {
    const { client } = createClient();
    render(<DesktopApp client={client} path="/session" search="?id=selected.jsonl" />);

    expect(screen.getByRole('main')).toHaveAttribute('data-desktop-route', 'session');
    await waitFor(() =>
      expect(client.getSession).toHaveBeenCalledWith('selected.jsonl', { paginate: true }),
    );
    expect(await screen.findByText('Selected thread')).toBeInTheDocument();
  });

  it('restores the persisted sidebar state across mounts', () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
    const { client } = createClient();
    const first = render(<DesktopApp client={client} path="/" search="" />);

    expect(screen.getByTestId('desktop-product-shell')).toHaveAttribute(
      'data-sidebar-collapsed',
      'true',
    );
    expect(screen.queryByRole('complementary', { name: 'Projects and threads' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show projects and threads' }));
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('false');
    first.unmount();

    render(<DesktopApp client={client} path="/" search="" />);
    expect(screen.getByRole('complementary', { name: 'Projects and threads' })).toBeInTheDocument();
  });
});

describe('new task and session controls', () => {
  it('creates a session with the explicit provider, model, and thinking selection', async () => {
    const createSession = vi.fn(async () => ({ ok: true, id: 'new task.jsonl' }));
    const { client } = createClient({ createSession });
    const navigate = vi.fn();
    render(<DesktopApp client={client} navigateImpl={navigate} path="/" search="" />);

    await waitFor(() => expect(client.listModels).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Project path'), { target: { value: '/work/new' } });
    fireEvent.change(screen.getByLabelText('Provider account'), {
      target: { value: 'anthropic' },
    });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-opus' } });
    fireEvent.change(screen.getByLabelText('Thinking'), { target: { value: 'xhigh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start task' }));

    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith({
        path: '/work/new',
        modelProvider: 'anthropic',
        modelId: 'claude-opus',
        thinkingLevel: 'xhigh',
      }),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/session?id=new%20task.jsonl'));
  });

  it('applies model and thinking changes through the session client', async () => {
    const { client } = createClient();
    render(
      <SessionComposer
        chatAvailable
        chatDisabledReason=""
        client={client}
        initialModel="gpt-5.6-sol"
        initialProvider="openai-codex-secondary"
        initialThinking="high"
        models={models}
        onRunningChange={vi.fn()}
        onSent={vi.fn()}
        running={false}
        sessionId="selected.jsonl"
      />,
    );

    fireEvent.change(screen.getByLabelText('Provider account'), {
      target: { value: 'anthropic' },
    });
    await waitFor(() =>
      expect(client.setModel).toHaveBeenCalledWith('selected.jsonl', 'anthropic', 'claude-sonnet'),
    );
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-opus' } });
    fireEvent.change(screen.getByLabelText('Thinking'), { target: { value: 'low' } });

    await waitFor(() =>
      expect(client.setModel).toHaveBeenLastCalledWith(
        'selected.jsonl',
        'anthropic',
        'claude-opus',
      ),
    );
    await waitFor(() =>
      expect(client.setThinkingLevel).toHaveBeenCalledWith('selected.jsonl', 'low'),
    );
  });
});

describe('conversation and pairing', () => {
  it('keeps thinking and tool activity collapsed by default', () => {
    const details: SessionDetails = {
      ...emptyDetails,
      entries: [
        {
          id: 'assistant-1',
          type: 'message',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'Inspect the repository first.' },
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'read',
                arguments: { path: '/work/project/main.go' },
              },
            ],
          },
        },
      ],
      total: 1,
    };
    const { container } = render(<Transcript details={details} />);

    const tool = container.querySelector('details[data-tool-call="read"]');
    const thinking = container.querySelector('details.desktop-thinking-block');
    expect(tool).not.toHaveAttribute('open');
    expect(thinking).not.toHaveAttribute('open');
    expect(within(tool as HTMLElement).getByText('read')).toBeInTheDocument();
  });

  it('submits pairing code and device label in the body contract, then reveals navigation', async () => {
    const { client } = createClient();
    const navigate = vi.fn();
    render(<DesktopApp client={client} navigateImpl={navigate} path="/pairing" search="" />);

    await screen.findByRole('heading', { name: 'Pair with Development Mac' });
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'abcd2345' } });
    fireEvent.change(screen.getByLabelText('Device label'), { target: { value: 'Work laptop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair device' }));

    await waitFor(() =>
      expect(client.submitPairing).toHaveBeenCalledWith({
        code: 'ABCD2345',
        label: 'Work laptop',
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'This device is paired' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(window.location.search).not.toContain('ABCD2345');
  });

  it('reacts to a running status event in the accessible thread list', async () => {
    const sessions = [
      summary('older', 'Older running', '/project', '2026-01-01T00:00:00Z'),
      summary('newer', 'Newer idle', '/project', '2026-02-01T00:00:00Z'),
    ];
    const { client, handlers } = createClient({
      listSessions: vi.fn(async () => ({ sessions, total: sessions.length })),
    });
    const { container } = render(<DesktopApp client={client} path="/" search="" />);
    await screen.findByRole('link', { name: /Older running/ });

    act(() => {
      handlers.get('__all__')?.onEvent('status-snapshot', {
        running: ['older'],
        statuses: { older: { id: 'older', running: true } },
      });
    });

    const rows = [...container.querySelectorAll('.desktop-thread-row')];
    expect(rows.map((row) => row.querySelector('.desktop-thread-name')?.textContent)).toEqual([
      'Older running',
      'Newer idle',
    ]);
    expect(rows[0]).toHaveAttribute('data-running', 'true');
  });
});
