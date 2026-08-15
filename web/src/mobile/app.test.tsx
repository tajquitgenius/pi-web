import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as liveShared from '../live-shared';
import { CUSTOM_LANGUAGES_KEY, LOCALE_KEY, resetI18n } from '../shared/i18n.js';
import type {
  PairedDevice,
  PiWebClient,
  SSESubscriptionHandlers,
  SessionDetails,
  SessionList,
  SessionSummary,
} from '../live-shared';
import { MobileApp } from './app';
import { SessionsScreen } from './sessions-screen';

const defaultSession: SessionDetails = {
  header: { cwd: '/work/pi-web' },
  entries: [],
  name: 'Mobile session',
  total: 0,
  from: 0,
  chatAvailable: true,
  chatDisabledReason: '',
  model: 'gpt-5.6-sol',
  modelProvider: 'openai-codex-secondary',
};

const pairedDevice: PairedDevice = {
  id: 'device-one',
  label: 'Personal phone',
  createdAt: '2026-08-01T00:00:00Z',
  lastUsedAt: '2026-08-14T00:00:00Z',
  expiresAt: '2026-11-01T00:00:00Z',
  revokedAt: null,
};

function makeClient(overrides: Partial<PiWebClient> = {}): PiWebClient {
  return {
    listSessions: vi.fn().mockResolvedValue({ sessions: [], total: 0 }),
    getSession: vi.fn().mockResolvedValue(defaultSession),
    createSession: vi.fn().mockResolvedValue({ ok: true, id: 'new-session.jsonl' }),
    getSessionDefaults: vi.fn().mockResolvedValue({
      modelProvider: 'openai-codex-secondary',
      modelId: 'gpt-5.6-sol',
      thinkingLevel: 'high',
    }),
    listModels: vi.fn().mockResolvedValue({
      models: [
        {
          provider: 'openai-codex-secondary',
          id: 'gpt-5.6-sol',
          name: 'GPT 5.6 Sol',
          reasoning: true,
        },
      ],
    }),
    sendChat: vi.fn().mockResolvedValue({ ok: true, status: 'queued' }),
    cancelChat: vi.fn().mockResolvedValue({ ok: true, status: 'cancelled' }),
    getWorkerStatus: vi.fn().mockResolvedValue({ state: 'idle', thinkingLevel: 'high' }),
    setModel: vi.fn().mockResolvedValue({ ok: true }),
    setThinkingLevel: vi
      .fn()
      .mockImplementation(async (_sessionId, level) => ({ ok: true, thinkingLevel: level })),
    getHostContext: vi.fn().mockReturnValue({
      instanceName: 'Work Mac',
      currentUrl: 'https://work.example',
      peers: [{ label: 'Home Mac', url: 'https://home.example' }],
    }),
    subscribe: vi.fn().mockReturnValue({ close: vi.fn() }),
    getPairingStatus: vi.fn().mockResolvedValue({ paired: true, local: false }),
    createPairingCode: vi.fn().mockResolvedValue({
      code: 'ABCD2345',
      expiresAt: '2026-08-14T12:05:00Z',
    }),
    submitPairing: vi.fn().mockResolvedValue({ paired: true, device: pairedDevice }),
    listPairedDevices: vi.fn().mockResolvedValue({ devices: [pairedDevice] }),
    revokePairedDevice: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as PiWebClient;
}

function sessionSummary(index: number): SessionSummary {
  return {
    id: `session-${index}.jsonl`,
    sessionUUID: `uuid-${index}`,
    filename: `session-${index}.jsonl`,
    project: index % 2 ? '/work/alpha' : '/work/beta',
    lastActivity: new Date(Date.UTC(2026, 7, 14, 12, index)).toISOString(),
    name: `Session ${index}`,
    messageCount: index,
    tokenTotal: 0,
    costTotal: 0,
    model: 'gpt-5.6-sol',
    modelProvider: 'openai-codex-secondary',
    chatAvailable: true,
    chatDisabledReason: '',
  };
}

function StatefulLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const [initialHref] = useState(href);
  return (
    <a href={initialHref} className={className}>
      {children}
    </a>
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '';
  document.getElementById('pi-session-bootstrap')?.remove();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(LOCALE_KEY);
  localStorage.removeItem(CUSTOM_LANGUAGES_KEY);
  resetI18n();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mobile sessions home', () => {
  it('renders redesigned navigation copy from a custom locale', async () => {
    localStorage.setItem(
      CUSTOM_LANGUAGES_KEY,
      JSON.stringify([
        {
          code: 'mobile-test',
          label: 'Mobile test',
          strings: {
            'index.mobileThreads': 'Conversaciones',
            'index.mobileNavigation': 'Navegación',
            'index.openNavigation': 'Abrir navegación',
            'index.homeViews': 'Vistas',
            'index.newTask': 'Nueva tarea',
          },
        },
      ]),
    );
    localStorage.setItem(LOCALE_KEY, 'mobile-test');
    resetI18n();
    const user = userEvent.setup();

    render(<MobileApp client={makeClient()} path="/" search="" />);

    expect(screen.getByRole('button', { name: 'Abrir navegación' })).toHaveTextContent(
      'Conversaciones',
    );
    expect(screen.getByRole('button', { name: 'Nueva tarea' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abrir navegación' }));
    expect(screen.getByRole('dialog', { name: 'Navegación' })).toBeInTheDocument();
  });

  it('shows an explicit reconnecting state when the Pi event stream drops', async () => {
    let streamHandlers: SSESubscriptionHandlers | undefined;
    const client = makeClient({
      listSessions: vi.fn().mockResolvedValue({ sessions: [sessionSummary(1)], total: 1 }),
      subscribe: vi.fn((_topic, handlers) => {
        streamHandlers = handlers;
        return { close: vi.fn() };
      }),
    });
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/" search="" />);

    await screen.findByText('Session 1');
    streamHandlers?.onError?.(new Event('error'));

    expect(await screen.findByRole('status', { name: 'Connection status' })).toHaveTextContent(
      'Reconnecting…',
    );
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry connection' }));
    expect(client.listSessions).toHaveBeenCalledTimes(2);

    streamHandlers?.onError?.(new Event('error'));
    expect(await screen.findByRole('status', { name: 'Connection status' })).toHaveTextContent(
      'Reconnecting…',
    );
    streamHandlers?.onOpen?.(new Event('open'));
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Connection status' })).not.toBeInTheDocument(),
    );
  });

  it('uses embedded session data once across StrictMode effect replay and reloads only from SSE', async () => {
    const readBootstrap = vi
      .spyOn(liveShared, 'readSessionBootstrap')
      .mockReturnValueOnce({ id: 'one.jsonl', data: defaultSession })
      .mockReturnValue(null);
    const getSession = vi.fn();
    let streamHandlers: SSESubscriptionHandlers | undefined;
    const client = makeClient({
      getSession,
      subscribe: vi.fn((_topic, handlers) => {
        streamHandlers = handlers;
        return { close: vi.fn() };
      }),
    });

    render(
      <StrictMode>
        <MobileApp client={client} path="/session" search="?id=one.jsonl" />
      </StrictMode>,
    );

    expect(await screen.findByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(readBootstrap).toHaveBeenCalledOnce();
    expect(getSession).not.toHaveBeenCalled();

    streamHandlers?.onEvent('reload', undefined);
    await Promise.resolve();
    expect(getSession).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 300));
    streamHandlers?.onEvent('reload', undefined);
    await waitFor(() => expect(getSession).toHaveBeenCalledWith('one.jsonl', { paginate: true }));
  });

  it('uses the DOM bootstrap synchronously before effects can fetch', async () => {
    const bootstrap = document.createElement('script');
    bootstrap.id = 'pi-session-bootstrap';
    bootstrap.type = 'application/json';
    bootstrap.textContent = btoa(JSON.stringify({ id: 'one.jsonl', data: defaultSession }));
    document.body.append(bootstrap);
    const getSession = vi.fn().mockResolvedValue(defaultSession);
    let streamHandlers: SSESubscriptionHandlers | undefined;
    const client = makeClient({
      getSession,
      subscribe: vi.fn((_topic, handlers) => {
        streamHandlers = handlers;
        return { close: vi.fn() };
      }),
    });

    render(<MobileApp client={client} path="/session" search="?id=one.jsonl" />);

    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(getSession).not.toHaveBeenCalled();
    streamHandlers?.onOpen?.(new Event('open'));
    await Promise.resolve();
    expect(getSession).not.toHaveBeenCalled();

    streamHandlers?.onEvent('reload', undefined);
    await Promise.resolve();
    expect(getSession).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 300));
    streamHandlers?.onEvent('reload', undefined);
    await waitFor(() => expect(getSession).toHaveBeenCalledWith('one.jsonl', { paginate: true }));
  });

  it('preserves session link identity when a reload inserts a newer session', async () => {
    const first = {
      ...sessionSummary(1),
      id: 'first.jsonl',
      filename: 'first.jsonl',
      name: 'Fix the failing unit test',
      lastActivity: '2026-08-14T12:01:00Z',
    };
    const second = {
      ...sessionSummary(2),
      id: 'second.jsonl',
      filename: 'second.jsonl',
      name: 'Other session',
      lastActivity: '2026-08-14T12:00:00Z',
    };
    const newest = {
      ...sessionSummary(3),
      id: 'newest.jsonl',
      filename: 'newest.jsonl',
      name: 'Newest session',
      lastActivity: '2026-08-14T12:02:00Z',
    };
    let streamHandlers: SSESubscriptionHandlers | undefined;
    const client = makeClient({
      listSessions: vi
        .fn()
        .mockResolvedValueOnce({ sessions: [first, second], total: 2 })
        .mockResolvedValueOnce({ sessions: [newest, first, second], total: 3 }),
      subscribe: vi.fn((_topic, handlers) => {
        streamHandlers = handlers;
        return { close: vi.fn() };
      }),
    });
    const internalLink = (url: string, children: ReactNode, className?: string, key?: string) => (
      <StatefulLink key={key} href={url} className={className}>
        {children}
      </StatefulLink>
    );

    render(<SessionsScreen client={client} navigate={vi.fn()} internalLink={internalLink} />);
    await screen.findByRole('link', { name: /Fix the failing unit test/ });
    expect(screen.getByRole('link', { name: /Fix the failing unit test/ })).toHaveAttribute(
      'href',
      '/session?id=first.jsonl',
    );

    streamHandlers?.onEvent('reload', undefined);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Fix the failing unit test/ })).toHaveAttribute(
        'href',
        '/session?id=first.jsonl',
      ),
    );
  });

  it('does not present a zero session count while the first load is pending', () => {
    const client = makeClient({
      listSessions: vi.fn(() => new Promise<SessionList>(() => undefined)),
    });

    render(<MobileApp client={client} path="/" search="" />);

    const heading = screen.getByRole('heading', { name: 'Recent sessions' });
    expect(heading.parentElement?.querySelector('span')).toBeNull();
    expect(screen.getByText('Loading sessions…')).toBeInTheDocument();
  });

  it('keeps activity order stable while showing running badges and bounding the first render', async () => {
    const sessions = Array.from({ length: 35 }, (_, index) => sessionSummary(index));
    const subscribe = vi.fn((topic: string, handlers: SSESubscriptionHandlers) => {
      if (topic === '__all__') {
        handlers.onEvent('status-snapshot', {
          running: ['session-34.jsonl'],
          statuses: {},
        });
      }
      return { close: vi.fn() };
    });
    const client = makeClient({
      listSessions: vi.fn().mockResolvedValue({ sessions, total: sessions.length }),
      subscribe,
    });

    render(<MobileApp client={client} path="/" search="" />);

    await waitFor(() => expect(document.querySelectorAll('.mobile-session-row')).toHaveLength(30));
    const rows = document.querySelectorAll('.mobile-session-row');
    expect(rows[0]).toHaveTextContent('Session 34');
    expect(rows[0]).toHaveTextContent('running');
    expect(client.listSessions).toHaveBeenCalledWith({ limit: 120, offset: 0 });

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(document.querySelectorAll('.mobile-session-row')).toHaveLength(35);
  });

  it('switches from project cards back to the filtered thread list', async () => {
    const client = makeClient({
      listSessions: vi.fn().mockResolvedValue({
        sessions: [sessionSummary(1), sessionSummary(2)],
        total: 2,
      }),
    });
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/" search="" />);
    await screen.findByText('Session 1');

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await user.click(screen.getByRole('button', { name: 'Projects' }));
    expect(screen.getByRole('region', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /alpha/ })).toHaveTextContent('1 thread');

    await user.click(screen.getByRole('button', { name: /alpha/ }));
    expect(screen.getByText('Session 1')).toBeInTheDocument();
    expect(screen.queryByText('Session 2')).not.toBeInTheDocument();
  });

  it('filters the bounded client-side session cache by search and project', async () => {
    const client = makeClient({
      listSessions: vi.fn().mockResolvedValue({
        sessions: [sessionSummary(1), sessionSummary(2)],
        total: 2,
      }),
    });
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/" search="" />);
    await screen.findByText('Session 1');

    await user.type(screen.getByRole('searchbox', { name: 'Search sessions' }), 'Session 2');
    expect(screen.queryByText('Session 1')).not.toBeInTheDocument();
    expect(screen.getByText('Session 2')).toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: 'Search sessions' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Filter by project' }),
      '/work/alpha',
    );
    expect(screen.getByText('Session 1')).toBeInTheDocument();
    expect(screen.queryByText('Session 2')).not.toBeInTheDocument();
  });

  it('blocks task creation and explains when this host has no authenticated model', async () => {
    const client = makeClient({
      getSessionDefaults: vi
        .fn()
        .mockRejectedValue(new Error('could not resolve session defaults')),
      listModels: vi.fn().mockResolvedValue({ models: [] }),
    });
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/" search="" />);

    await user.click(screen.getByRole('button', { name: 'New task' }));
    const taskScreen = await screen.findByRole('dialog', { name: 'New task' });
    expect(await within(taskScreen).findByRole('alert')).toHaveTextContent(
      'Open Pi on Work Mac and log in to a model provider',
    );
    expect(within(taskScreen).getByRole('button', { name: 'Create task' })).toBeDisabled();
    expect(within(taskScreen).queryByText('openai-codex-secondary')).not.toBeInTheDocument();
  });

  it('shows resolved defaults and lets the server apply them during New Task creation', async () => {
    const createSession = vi.fn().mockResolvedValue({ ok: true, id: 'created.jsonl' });
    const client = makeClient({ createSession });
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/" search="" />);

    await user.click(screen.getByRole('button', { name: 'New task' }));
    const taskScreen = await screen.findByRole('dialog', { name: 'New task' });
    await waitFor(() => expect(client.getSessionDefaults).toHaveBeenCalledOnce());
    expect(within(taskScreen).getByLabelText('New task destination')).toHaveTextContent('Work Mac');
    expect(within(taskScreen).getByLabelText('New task destination')).toHaveTextContent(
      'openai-codex-secondary',
    );
    expect(within(taskScreen).getByLabelText('New task destination')).toHaveTextContent(
      'gpt-5.6-sol',
    );
    expect(within(taskScreen).getByLabelText('New task destination')).toHaveTextContent('high');

    await user.type(within(taskScreen).getByLabelText('Destination folder'), '/work/new-project');
    await user.click(within(taskScreen).getByRole('button', { name: 'Create task' }));

    await waitFor(() => expect(createSession).toHaveBeenCalledWith({ path: '/work/new-project' }));
  });
});

describe('mobile pairing', () => {
  it('retries a failed pairing request with the validated form values', async () => {
    const submitPairing = vi
      .fn()
      .mockRejectedValueOnce(new Error('host unavailable'))
      .mockResolvedValueOnce({ paired: true, device: pairedDevice });
    const topLevelNavigate = vi.fn();
    const client = makeClient({ submitPairing });
    const user = userEvent.setup();
    render(
      <MobileApp client={client} path="/pairing" search="" topLevelNavigate={topLevelNavigate} />,
    );

    await user.type(screen.getByLabelText('8-character pairing code'), 'ABCD2345');
    await user.type(screen.getByLabelText('Device label'), '  Personal iPhone  ');
    await user.click(screen.getByRole('button', { name: 'Pair device' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('host unavailable');

    await user.click(screen.getByRole('button', { name: 'Retry connection' }));
    await waitFor(() => expect(submitPairing).toHaveBeenCalledTimes(2));
    expect(submitPairing).toHaveBeenNthCalledWith(2, {
      code: 'ABCD2345',
      label: 'Personal iPhone',
    });
    expect(topLevelNavigate).toHaveBeenCalledWith('/');
  });

  it('submits only the exact code and trimmed device label, then navigates at top level', async () => {
    const submitPairing = vi.fn().mockResolvedValue({ paired: true, device: pairedDevice });
    const topLevelNavigate = vi.fn();
    const client = makeClient({ submitPairing });
    const user = userEvent.setup();
    render(
      <MobileApp client={client} path="/pairing" search="" topLevelNavigate={topLevelNavigate} />,
    );

    await user.type(screen.getByLabelText('8-character pairing code'), '2345ABCD');
    await user.type(screen.getByLabelText('Device label'), '  Personal iPhone  ');
    await user.click(screen.getByRole('button', { name: 'Pair device' }));

    await waitFor(() =>
      expect(submitPairing).toHaveBeenCalledWith({
        code: '2345ABCD',
        label: 'Personal iPhone',
      }),
    );
    expect(topLevelNavigate).toHaveBeenCalledWith('/');
    expect(window.location.search).toBe('');
  });

  it('rejects anything other than an exact supported 8-character code', async () => {
    const submitPairing = vi.fn();
    const user = userEvent.setup();
    render(<MobileApp client={makeClient({ submitPairing })} path="/pairing" search="" />);

    await user.type(screen.getByLabelText('8-character pairing code'), '1234567');
    await user.type(screen.getByLabelText('Device label'), 'Phone');
    await user.click(screen.getByRole('button', { name: 'Pair device' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('exact 8-character code');
    expect(submitPairing).not.toHaveBeenCalled();
  });
});

describe('mobile conversation', () => {
  async function openConversationTool(
    user: ReturnType<typeof userEvent.setup>,
    name: 'Project inspector' | 'Thread actions',
  ) {
    await user.click(screen.getByRole('button', { name: 'Tools' }));
    await user.click(screen.getByRole('button', { name }));
  }

  it('steers an in-flight Pi response without disabling the composer', async () => {
    const sendChat = vi.fn().mockResolvedValue({ ok: true, status: 'queued' });
    const client = makeClient({
      sendChat,
      getWorkerStatus: vi.fn().mockResolvedValue({ state: 'running', thinkingLevel: 'high' }),
    });
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/session" search="?id=one.jsonl" />);

    const composer = await screen.findByRole('textbox', { name: 'Message' });
    expect(composer).toBeEnabled();
    await user.type(composer, 'Please focus on the failing assertion');
    await user.click(screen.getByRole('button', { name: 'Steer' }));

    await waitFor(() =>
      expect(sendChat).toHaveBeenCalledWith('one.jsonl', {
        message: 'Please focus on the failing assertion',
        images: [],
      }),
    );
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('refreshes a session after SSE auto-reconnect', async () => {
    let streamHandlers: SSESubscriptionHandlers | undefined;
    const getSession = vi.fn().mockResolvedValue(defaultSession);
    const client = makeClient({
      getSession,
      subscribe: vi.fn((_topic, handlers) => {
        streamHandlers = handlers;
        return { close: vi.fn() };
      }),
    });
    render(<MobileApp client={client} path="/session" search="?id=one.jsonl" />);
    await screen.findByRole('textbox', { name: 'Message' });
    streamHandlers?.onOpen?.(new Event('open'));
    const beforeReconnect = getSession.mock.calls.length;

    streamHandlers?.onError?.(new Event('error'));
    expect(await screen.findByRole('status', { name: 'Connection status' })).toHaveTextContent(
      'Reconnecting…',
    );
    streamHandlers?.onOpen?.(new Event('open'));
    await waitFor(() => expect(getSession.mock.calls.length).toBeGreaterThan(beforeReconnect));
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Connection status' })).not.toBeInTheDocument(),
    );
  });

  it('opens Pi-backed diff and details inspectors without direct transport calls', async () => {
    const client = makeClient() as PiWebClient & {
      getGitDiff: (sessionId: string) => Promise<{ branch: string; diff: string }>;
    };
    client.getGitDiff = vi.fn().mockResolvedValue({ branch: 'main', diff: '@@ -1 +1 @@' });
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/session" search="?id=one.jsonl" />);
    await screen.findByRole('textbox', { name: 'Message' });

    await openConversationTool(user, 'Project inspector');
    expect(screen.getByRole('dialog', { name: 'Files, diff, and details' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Diff' }));
    expect(await screen.findByText('@@ -1 +1 @@')).toBeInTheDocument();
  });

  it('keeps inspector dialogs focusable, semantic, and closable', async () => {
    const client = makeClient() as PiWebClient & {
      getGitDiff: (sessionId: string) => Promise<{ isRepo: boolean; diff: string }>;
    };
    client.getGitDiff = vi.fn().mockResolvedValue({ isRepo: false, diff: '' });
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/session" search="?id=one.jsonl" />);
    await screen.findByRole('textbox', { name: 'Message' });
    const openButton = screen.getByRole('button', { name: 'Tools' });

    await openConversationTool(user, 'Project inspector');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close inspector' }));
    expect(screen.getByRole('tablist', { name: 'Inspector sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Diff' }));
    expect(await screen.findByText('This project is not a Git repository.')).toBeInTheDocument();

    await user.click(document.querySelector('.mobile-sheet-backdrop') as HTMLElement);
    expect(
      screen.queryByRole('dialog', { name: 'Files, diff, and details' }),
    ).not.toBeInTheDocument();
    await openConversationTool(user, 'Project inspector');
    await user.click(screen.getByRole('tab', { name: 'Diff' }));
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Files, diff, and details' }),
      ).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(openButton);
  });

  it('reports a failed scratchpad mutation instead of claiming success', async () => {
    const saveScratchpad = vi.fn().mockResolvedValue({ ok: false });
    const client = makeClient() as PiWebClient & {
      getScratchpad: (projectPath: string) => Promise<{ content: string }>;
      saveScratchpad: (projectPath: string, content: string) => Promise<{ ok: boolean }>;
    };
    client.getScratchpad = vi.fn().mockResolvedValue({ content: '' });
    client.saveScratchpad = saveScratchpad;
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/session" search="?id=one.jsonl" />);
    await screen.findByRole('textbox', { name: 'Message' });
    await openConversationTool(user, 'Project inspector');
    await user.click(screen.getByRole('tab', { name: 'Scratchpad' }));
    await user.type(screen.getByRole('textbox', { name: 'Project scratchpad' }), 'note');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save the project scratchpad.',
    );
    expect(saveScratchpad).toHaveBeenCalledWith('/work/pi-web', 'note');
  });

  it('does not call getFile for directory rows in the files inspector', async () => {
    const getFile = vi.fn().mockResolvedValue({
      path: 'src/main.ts',
      kind: 'text',
      content: 'export const ready = true;',
    });
    const client = makeClient() as PiWebClient & {
      listFiles: (
        sessionId: string,
        query?: string,
      ) => Promise<{ files: { path: string; isDir: boolean }[] }>;
      getFile: (
        sessionId: string,
        path: string,
      ) => Promise<{ path: string; kind: 'text'; content: string }>;
    };
    client.listFiles = vi.fn().mockResolvedValue({
      files: [
        { path: 'src', isDir: true },
        { path: 'src/main.ts', isDir: false },
      ],
    });
    client.getFile = getFile;
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/session" search="?id=one.jsonl" />);
    await screen.findByRole('textbox', { name: 'Message' });
    await openConversationTool(user, 'Project inspector');
    await user.click(screen.getByRole('tab', { name: 'Files' }));
    expect(screen.getByLabelText('src directory')).not.toHaveAttribute('role', 'button');
    expect(getFile).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: /src\/main\.ts/ }));
    expect(getFile).toHaveBeenCalledWith('one.jsonl', 'src/main.ts');
  });

  it('shows command palette failures with a retry action', async () => {
    const getCommands = vi
      .fn()
      .mockRejectedValueOnce(new Error('commands unavailable'))
      .mockResolvedValueOnce({ commands: [{ name: 'review' }] });
    const client = makeClient() as PiWebClient & {
      getCommands: (sessionId: string) => Promise<{ commands: { name: string }[] }>;
    };
    client.getCommands = getCommands;
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/session" search="?id=one.jsonl" />);
    const composer = await screen.findByRole('textbox', { name: 'Message' });
    await user.type(composer, '/');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load Pi commands.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('option', { name: /review/ })).toBeInTheDocument();
    expect(getCommands).toHaveBeenCalledTimes(2);
  });

  it('reports unsuccessful rename, label, and copy actions', async () => {
    const renameSession = vi.fn().mockResolvedValue({ ok: false });
    const labelSession = vi.fn().mockResolvedValue({ ok: false });
    const client = makeClient({
      renameSession,
      labelSession,
      getSession: vi.fn().mockResolvedValue({
        ...defaultSession,
        entries: [
          {
            id: 'leaf-1',
            parentId: null,
            type: 'message',
            message: { role: 'user', content: 'Hi' },
          },
        ],
        total: 1,
      }),
    }) as PiWebClient & {
      renameSession: (sessionId: string, name: string) => Promise<{ ok: boolean }>;
      labelSession: (sessionId: string, entryId: string, label: string) => Promise<{ ok: boolean }>;
    };
    client.renameSession = renameSession;
    client.labelSession = labelSession;
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/session" search="?id=one.jsonl" />);
    await screen.findByRole('textbox', { name: 'Message' });
    await openConversationTool(user, 'Thread actions');
    await user.clear(screen.getByLabelText('Thread name'));
    await user.type(screen.getByLabelText('Thread name'), 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save thread name' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not rename this thread.');
    await user.type(screen.getByLabelText('Label latest entry'), 'review');
    await user.click(screen.getByRole('button', { name: 'Save entry label' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not label this entry.');
    await user.click(screen.getByRole('button', { name: 'Copy session ID' }));
    expect(await screen.findByRole('button', { name: 'Session ID copied' })).toBeInTheDocument();
  });

  it('binds Pi thread actions for rename and latest-entry labels', async () => {
    const client = makeClient({
      getSession: vi.fn().mockResolvedValue({
        ...defaultSession,
        entries: [
          {
            id: 'leaf-1',
            parentId: null,
            type: 'message',
            message: { role: 'user', content: 'Hi' },
          },
        ],
        total: 1,
      }),
    }) as PiWebClient & {
      renameSession: (sessionId: string, name: string) => Promise<{ ok: boolean }>;
      labelSession: (sessionId: string, entryId: string, label: string) => Promise<{ ok: boolean }>;
    };
    client.renameSession = vi.fn().mockResolvedValue({ ok: true });
    client.labelSession = vi.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/session" search="?id=one.jsonl" />);
    await screen.findByRole('textbox', { name: 'Message' });

    await openConversationTool(user, 'Thread actions');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Close thread actions' }),
    );
    await user.clear(screen.getByLabelText('Thread name'));
    await user.type(screen.getByLabelText('Thread name'), 'Renamed thread');
    await user.click(screen.getByRole('button', { name: 'Save thread name' }));
    await waitFor(() =>
      expect(client.renameSession).toHaveBeenCalledWith('one.jsonl', 'Renamed thread'),
    );
    expect(screen.queryByRole('dialog', { name: 'Renamed thread' })).not.toBeInTheDocument();

    await openConversationTool(user, 'Thread actions');
    await user.type(screen.getByLabelText('Label latest entry'), 'review');
    await user.click(screen.getByRole('button', { name: 'Save entry label' }));
    await waitFor(() =>
      expect(client.labelSession).toHaveBeenCalledWith('one.jsonl', 'leaf-1', 'review'),
    );
  });

  it('uses the canonical Pi command capability for slash suggestions', async () => {
    const client = makeClient() as PiWebClient & {
      getCommands: (sessionId: string) => Promise<{ commands: string[] }>;
    };
    client.getCommands = vi.fn().mockResolvedValue({ commands: ['review'] });
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/session" search="?id=one.jsonl" />);
    const composer = await screen.findByRole('textbox', { name: 'Message' });

    await user.type(composer, '/');
    const command = await screen.findByRole('option', { name: /review/ });
    await user.click(command);
    expect(composer).toHaveValue('/review ');
    expect(client.getCommands).toHaveBeenCalledWith('one.jsonl');
  });

  it('loads a Pi file preview from the files inspector', async () => {
    const client = makeClient() as PiWebClient & {
      listFiles: (
        sessionId: string,
        query?: string,
      ) => Promise<{ files: { path: string; isDir: boolean }[] }>;
      getFile: (
        sessionId: string,
        path: string,
      ) => Promise<{ path: string; kind: 'text'; content: string }>;
    };
    client.listFiles = vi
      .fn()
      .mockResolvedValue({ files: [{ path: 'src/main.ts', isDir: false }] });
    client.getFile = vi.fn().mockResolvedValue({
      path: 'src/main.ts',
      kind: 'text',
      content: 'export const ready = true;',
    });
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/session" search="?id=one.jsonl" />);
    await screen.findByRole('textbox', { name: 'Message' });

    await openConversationTool(user, 'Project inspector');
    await user.click(screen.getByRole('tab', { name: 'Files' }));
    await user.click(await screen.findByRole('button', { name: /src\/main\.ts/ }));
    expect(await screen.findByText('export const ready = true;')).toBeInTheDocument();
    expect(client.getFile).toHaveBeenCalledWith('one.jsonl', 'src/main.ts');
  });

  it('keeps tool output collapsed behind an accessible disclosure', async () => {
    const getSession = vi.fn().mockResolvedValue({
      ...defaultSession,
      entries: [
        {
          id: 'user-1',
          parentId: null,
          type: 'message',
          timestamp: '2026-08-14T12:00:00Z',
          message: { role: 'user', content: 'Inspect the file' },
        },
        {
          id: 'assistant-1',
          parentId: 'user-1',
          type: 'message',
          timestamp: '2026-08-14T12:00:01Z',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'I will inspect it.' },
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'read',
                arguments: { path: '/work/pi-web/main.ts' },
              },
            ],
          },
        },
        {
          id: 'result-1',
          parentId: 'assistant-1',
          type: 'message',
          timestamp: '2026-08-14T12:00:02Z',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            content: [{ type: 'text', text: 'secret tool output' }],
          },
        },
      ],
      total: 3,
    });
    const user = userEvent.setup();
    render(
      <MobileApp client={makeClient({ getSession })} path="/session" search="?id=one.jsonl" />,
    );

    const disclosure = await screen.findByRole('button', { name: 'Expand read tool details' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('secret tool output')).not.toBeInTheDocument();

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('secret tool output')).toBeInTheDocument();
  });

  it('uses a compact composer with runtime controls inside its one Tools entry', async () => {
    const user = userEvent.setup();
    render(<MobileApp client={makeClient()} path="/session" search="?id=one.jsonl" />);
    await screen.findByRole('textbox', { name: 'Message' });

    const composer = document.querySelector('.mobile-composer');
    expect(composer).not.toHaveAttribute('data-collapsed-height');
    expect(composer).not.toHaveAttribute('data-expanded-height');
    expect(document.querySelector('.mobile-composer-chrome')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Tools' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Choose model and thinking level' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tools' }));
    expect(screen.getByRole('button', { name: /Model.*gpt-5\.6-sol/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Thinking.*high/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach images' })).toBeInTheDocument();
  });
});

describe('mobile settings', () => {
  it('retries the failed pairing-status and device load', async () => {
    const getPairingStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error('host unavailable'))
      .mockResolvedValueOnce({ paired: true, local: true });
    const client = makeClient({
      getPairingStatus,
      listPairedDevices: vi.fn().mockResolvedValue({ devices: [pairedDevice] }),
    });
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/settings" search="" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('host unavailable');
    await user.click(screen.getByRole('button', { name: 'Retry connection' }));
    expect(await screen.findByText('Personal phone')).toBeInTheDocument();
    expect(getPairingStatus).toHaveBeenCalledTimes(2);
  });

  it('lists and revokes paired devices when the host grants local administration', async () => {
    const revokePairedDevice = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      getPairingStatus: vi.fn().mockResolvedValue({ paired: true, local: true }),
      listPairedDevices: vi.fn().mockResolvedValue({ devices: [pairedDevice] }),
      revokePairedDevice,
    });
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/settings" search="" />);

    expect(await screen.findByText('Personal phone')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create pairing code' }));
    await waitFor(() => expect(client.createPairingCode).toHaveBeenCalledOnce());
    expect(screen.getByRole('status', { name: 'One-time pairing code' })).toHaveTextContent(
      'ABCD2345',
    );

    await user.click(screen.getByRole('button', { name: 'Revoke Personal phone' }));

    await waitFor(() => expect(revokePairedDevice).toHaveBeenCalledWith('device-one'));
    expect(screen.queryByText('Personal phone')).not.toBeInTheDocument();
  });
});

describe('mobile routing and labels', () => {
  it.each([
    ['/', '', 'sessions'],
    ['/session', '?id=one.jsonl', 'session'],
    ['/settings', '', 'settings'],
    ['/pairing', '', 'pairing'],
  ])('renders %s as the %s mobile route', async (path, searchValue, route) => {
    const view = render(<MobileApp client={makeClient()} path={path} search={searchValue} />);
    await waitFor(() =>
      expect(view.container.querySelector(`[data-mobile-route="${route}"]`)).toBeInTheDocument(),
    );
  });

  it('opens from a rightward edge swipe and closes from a leftward swipe', () => {
    const view = render(<MobileApp client={makeClient()} path="/" search="" />);
    const app = view.container.querySelector('.mobile-app');
    expect(app).not.toBeNull();

    fireEvent.touchStart(app!, {
      touches: [{ identifier: 1, clientX: 20, clientY: 180 }],
    });
    fireEvent.touchEnd(app!, {
      changedTouches: [{ identifier: 1, clientX: 88, clientY: 185 }],
    });

    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    fireEvent.touchStart(drawer, {
      touches: [{ identifier: 2, clientX: 240, clientY: 180 }],
    });
    fireEvent.touchMove(drawer, {
      touches: [{ identifier: 2, clientX: 236, clientY: 225 }],
    });
    fireEvent.touchEnd(drawer, {
      changedTouches: [{ identifier: 2, clientX: 170, clientY: 184 }],
    });
    expect(drawer).toBeInTheDocument();

    fireEvent.touchStart(drawer, {
      touches: [{ identifier: 3, clientX: 240, clientY: 180 }],
    });
    fireEvent.touchEnd(drawer, {
      changedTouches: [{ identifier: 3, clientX: 170, clientY: 184 }],
    });

    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
  });

  it('does not open after off-edge, vertical-intent, or cancelled gestures', () => {
    const view = render(<MobileApp client={makeClient()} path="/" search="" />);
    const app = view.container.querySelector('.mobile-app');
    expect(app).not.toBeNull();

    fireEvent.touchStart(app!, {
      touches: [{ identifier: 1, clientX: 40, clientY: 180 }],
    });
    fireEvent.touchEnd(app!, {
      changedTouches: [{ identifier: 1, clientX: 110, clientY: 184 }],
    });
    fireEvent.touchStart(app!, {
      touches: [{ identifier: 2, clientX: 20, clientY: 180 }],
    });
    fireEvent.touchMove(app!, {
      touches: [{ identifier: 2, clientX: 24, clientY: 220 }],
    });
    fireEvent.touchEnd(app!, {
      changedTouches: [{ identifier: 2, clientX: 92, clientY: 184 }],
    });
    fireEvent.touchStart(app!, {
      touches: [{ identifier: 3, clientX: 20, clientY: 180 }],
    });
    fireEvent.touchCancel(app!);
    fireEvent.touchEnd(app!, {
      changedTouches: [{ identifier: 3, clientX: 92, clientY: 184 }],
    });

    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
  });

  it('loads Recents when the drawer opens from a direct conversation route', async () => {
    const recent = sessionSummary(8);
    const client = makeClient({
      listSessions: vi.fn().mockResolvedValue({ sessions: [recent], total: 1 }),
    });
    render(<MobileApp client={client} path="/session" search="?id=one.jsonl" />);
    await screen.findByRole('textbox', { name: 'Message' });

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    expect(await within(drawer).findByText('Session 8')).toBeVisible();
    expect(client.listSessions).toHaveBeenCalledWith({ limit: 12, offset: 0 });

    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    await waitFor(() => expect(client.listSessions).toHaveBeenCalledTimes(2));
  });

  it('keeps settings and independent peer hosts in the accessible navigation sheet', async () => {
    render(<MobileApp client={makeClient()} path="/" search="" />);
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    trigger.focus();
    await userEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: /Home Mac/ })).toHaveAttribute(
      'href',
      'https://home.example',
    );

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
