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
import { NewTaskPage } from './NewTask';
import { normalizeDiff } from './desktop-capabilities';
import {
  DETAILS_OPEN_KEY,
  groupSessions,
  RIGHT_PANEL_WIDTH_KEY,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_WIDTH_KEY,
} from './desktop-model';

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

function asyncStub<Method extends (...args: never[]) => Promise<unknown>>() {
  return vi.fn((...args: Parameters<Method>) => {
    void args;
    return Promise.resolve(undefined) as ReturnType<Method>;
  });
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
    getPiSession: asyncStub<NonNullable<PiWebClient['getPiSession']>>(),
    listProjects: asyncStub<PiWebClient['listProjects']>(),
    updateProject: asyncStub<PiWebClient['updateProject']>(),
    listRecentLocations: asyncStub<PiWebClient['listRecentLocations']>(),
    listFiles: asyncStub<PiWebClient['listFiles']>(),
    getFile: asyncStub<PiWebClient['getFile']>(),
    getCommands: asyncStub<PiWebClient['getCommands']>(),
    forkSession: asyncStub<PiWebClient['forkSession']>(),
    cloneSession: asyncStub<PiWebClient['cloneSession']>(),
    renameSession: asyncStub<PiWebClient['renameSession']>(),
    labelSession: asyncStub<PiWebClient['labelSession']>(),
    getGitInfo: asyncStub<PiWebClient['getGitInfo']>(),
    getGitDiff: asyncStub<PiWebClient['getGitDiff']>(),
    renameGitBranch: asyncStub<PiWebClient['renameGitBranch']>(),
    listReviewComments: asyncStub<PiWebClient['listReviewComments']>(),
    saveReviewComment: asyncStub<PiWebClient['saveReviewComment']>(),
    deleteReviewComment: asyncStub<PiWebClient['deleteReviewComment']>(),
    listAnnotations: asyncStub<PiWebClient['listAnnotations']>(),
    saveAnnotation: asyncStub<PiWebClient['saveAnnotation']>(),
    deleteAnnotation: asyncStub<PiWebClient['deleteAnnotation']>(),
    getScratchpad: asyncStub<PiWebClient['getScratchpad']>(),
    saveScratchpad: asyncStub<PiWebClient['saveScratchpad']>(),
    getQueue: asyncStub<PiWebClient['getQueue']>(),
    addQueueItem: asyncStub<PiWebClient['addQueueItem']>(),
    removeQueueItem: asyncStub<PiWebClient['removeQueueItem']>(),
    setQueuePaused: asyncStub<PiWebClient['setQueuePaused']>(),
    getSettings: asyncStub<PiWebClient['getSettings']>(),
    saveSettings: asyncStub<PiWebClient['saveSettings']>(),
    getBtw: asyncStub<PiWebClient['getBtw']>(),
    createBtw: asyncStub<PiWebClient['createBtw']>(),
    listSchedules: asyncStub<PiWebClient['listSchedules']>(),
    createSchedule: asyncStub<PiWebClient['createSchedule']>(),
    getSchedule: asyncStub<PiWebClient['getSchedule']>(),
    updateSchedule: asyncStub<PiWebClient['updateSchedule']>(),
    deleteSchedule: asyncStub<PiWebClient['deleteSchedule']>(),
    runSchedule: asyncStub<PiWebClient['runSchedule']>(),
    listScheduleRuns: asyncStub<PiWebClient['listScheduleRuns']>(),
    getMetrics: asyncStub<PiWebClient['getMetrics']>(),
    getVersion: asyncStub<PiWebClient['getVersion']>(),
    checkForUpdate: asyncStub<PiWebClient['checkForUpdate']>(),
    installUpdate: asyncStub<PiWebClient['installUpdate']>(),
    restartServer: asyncStub<PiWebClient['restartServer']>(),
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
  it('opens a T3-style command palette and filters navigation actions', async () => {
    const { client } = createClient();
    const navigate = vi.fn();
    render(<DesktopApp client={client} navigateImpl={navigate} path="/" search="" />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(palette).toBeInTheDocument();
    fireEvent.change(within(palette).getByRole('textbox', { name: 'Search commands' }), {
      target: { value: 'settings' },
    });
    expect(within(palette).getByRole('option', { name: /Settings/ })).toBeInTheDocument();
    expect(within(palette).queryByRole('option', { name: /New task/ })).toBeNull();

    fireEvent.click(within(palette).getByRole('option', { name: /Settings/ }));
    expect(navigate).toHaveBeenCalledWith('/settings');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('traps palette focus, restores its opener, and toggles with Ctrl-K while open', async () => {
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.textContent = 'Open palette';
    document.body.append(opener);
    opener.focus();
    const { client } = createClient();
    render(<DesktopApp client={client} path="/" search="" />);
    opener.focus();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    const input = within(palette).getByRole('textbox', { name: 'Search commands' });
    const options = within(palette).getAllByRole('option');
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(options.at(-1)).toHaveFocus();
    fireEvent.keyDown(options.at(-1) as HTMLElement, { key: 'Tab' });
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    expect(opener).toHaveFocus();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('shows a filtered shortcut reference instead of closing the palette', async () => {
    const { client } = createClient();
    render(<DesktopApp client={client} path="/" search="" />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    fireEvent.click(within(palette).getByRole('option', { name: /keyboard shortcuts/i }));

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    expect(within(palette).getByText('Keyboard shortcuts')).toBeInTheDocument();
    expect(within(palette).getAllByRole('option')).toHaveLength(3);
    expect(within(palette).getByRole('option', { name: /Toggle sidebar/ })).toHaveTextContent(
      'Ctrl B',
    );
  });

  it('loads Pi slash commands into the palette and sends one through PiWebClient', async () => {
    const getCommands = vi.fn(async () => ({
      commands: [
        { name: 'skill:memory', description: 'Recall saved project memory', source: 'skill' },
      ],
      workerReady: true,
    }));
    const sendChat = vi.fn(async () => ({ ok: true, status: 'queued' }));
    const { client } = createClient();
    Object.assign(client, { getCommands, sendChat });
    render(<DesktopApp client={client} path="/session" search="?id=selected.jsonl" />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    await waitFor(() => expect(getCommands).toHaveBeenCalledWith('selected.jsonl', true));
    fireEvent.change(within(palette).getByRole('textbox', { name: 'Search commands' }), {
      target: { value: 'skill:memory' },
    });
    fireEvent.click(within(palette).getByRole('option', { name: /Recall saved project memory/ }));

    expect(sendChat).toHaveBeenCalledWith('selected.jsonl', { message: '/skill:memory' });
  });

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
    expect(screen.getByText('Development Mac')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
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

  it('toggles the sidebar and command palette with keyboard shortcuts', async () => {
    const { client } = createClient();
    render(<DesktopApp client={client} path="/" search="" />);

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(screen.getByTestId('desktop-product-shell')).toHaveAttribute(
      'data-sidebar-collapsed',
      'true',
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('keeps a mobile sidebar backdrop and a reopen control in the shell structure', () => {
    const { client } = createClient();
    render(<DesktopApp client={client} path="/" search="" />);

    expect(screen.getByTestId('mobile-sidebar-backdrop')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mobile-sidebar-backdrop'));
    expect(screen.getByRole('button', { name: 'Reopen sidebar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen sidebar' }));
    expect(screen.getByTestId('mobile-sidebar-backdrop')).toBeInTheDocument();
  });

  it('opens the context panel with Ctrl-Shift-P', async () => {
    const { client } = createClient();
    render(<DesktopApp client={client} path="/session" search="?id=selected.jsonl" />);
    await screen.findByText('Selected thread');

    fireEvent.keyDown(window, { key: 'p', ctrlKey: true, shiftKey: true });
    expect(
      screen.getByRole('complementary', { name: 'Session context panel' }),
    ).toBeInTheDocument();
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

  it('runs thread rename, label, fork, clone, and copy actions through PiWebClient', async () => {
    const thread = summary('thread.jsonl', 'Review task', '/work/project', '2026-01-01T00:00:00Z');
    const listSessions = vi.fn(async () => ({ sessions: [thread], total: 1 }));
    const getSession = vi.fn(async () => ({
      ...emptyDetails,
      entries: [{ id: 'leaf-1', type: 'message', message: { role: 'user', content: 'Hi' } }],
    }));
    const renameSession = vi.fn(async () => ({ ok: true, name: 'Renamed task' }));
    const labelSession = vi.fn(async () => ({ ok: true, entryId: 'leaf-1', label: 'review' }));
    const forkSession = vi.fn(async () => ({ ok: true, id: 'forked.jsonl' }));
    const cloneSession = vi.fn(async () => ({ ok: true, id: 'cloned.jsonl' }));
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const navigate = vi.fn();
    const { client } = createClient();
    Object.assign(client, {
      getSession,
      listSessions,
      renameSession,
      labelSession,
      forkSession,
      cloneSession,
    });
    render(<DesktopApp client={client} navigateImpl={navigate} path="/" search="" />);

    await screen.findByRole('link', { name: /Review task/ });
    fireEvent.click(screen.getByRole('button', { name: 'Thread actions' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Thread name' }), {
      target: { value: 'Renamed task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save thread name' }));
    await waitFor(() => expect(renameSession).toHaveBeenCalledWith('thread.jsonl', 'Renamed task'));
    expect(await screen.findByRole('status')).toHaveTextContent('Thread renamed.');

    fireEvent.change(screen.getByRole('textbox', { name: 'Entry label' }), {
      target: { value: 'review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save entry label' }));
    await waitFor(() =>
      expect(labelSession).toHaveBeenCalledWith('thread.jsonl', 'leaf-1', 'review'),
    );

    fireEvent.click(screen.getByRole('menuitem', { name: /Fork from latest entry/ }));
    await waitFor(() => expect(forkSession).toHaveBeenCalledWith('thread.jsonl', 'leaf-1'));
    expect(navigate).toHaveBeenCalledWith('/session?id=forked.jsonl');

    fireEvent.click(screen.getByRole('button', { name: 'Thread actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Clone this thread/ }));
    await waitFor(() => expect(cloneSession).toHaveBeenCalledWith('thread.jsonl'));
    expect(navigate).toHaveBeenCalledWith('/session?id=cloned.jsonl');

    fireEvent.click(screen.getByRole('button', { name: 'Thread actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy session ID' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('thread.jsonl'));
    expect(await screen.findByText('Session ID copied')).toBeInTheDocument();
  });

  it('keeps thread action context out of the model control accessible name', async () => {
    const thread = summary('thread.jsonl', 'pi model', '/work/project', '2026-01-01T00:00:00Z');
    const { client } = createClient({
      listSessions: vi.fn(async () => ({ sessions: [thread], total: 1 })),
    });
    render(<DesktopApp client={client} path="/" search="" />);

    await screen.findByRole('link', { name: /pi model/ });
    expect(screen.getAllByLabelText('Model')).toHaveLength(1);
    const actions = screen.getByRole('button', { name: 'Thread actions' });
    expect(actions).toHaveAttribute('aria-describedby');
    expect(screen.getByText('Actions for pi model')).toHaveClass('sr-only');
  });

  it('reports failed thread actions instead of pretending they succeeded', async () => {
    const thread = summary('thread.jsonl', 'Review task', '/work/project', '2026-01-01T00:00:00Z');
    const { client } = createClient();
    Object.assign(client, {
      listSessions: vi.fn(async () => ({ sessions: [thread], total: 1 })),
      renameSession: vi.fn(async () => ({ ok: false, name: '' })),
    });
    render(<DesktopApp client={client} path="/" search="" />);

    await screen.findByRole('link', { name: /Review task/ });
    fireEvent.click(screen.getByRole('button', { name: 'Thread actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save thread name' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not rename this thread.');
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
  it('preserves a user-entered project path when sessions arrive later', () => {
    const { client } = createClient();
    const navigate = vi.fn();
    const { rerender } = render(
      <NewTaskPage
        client={client}
        models={models}
        modelsLoading={false}
        navigate={navigate}
        sessions={[]}
      />,
    );

    fireEvent.change(screen.getByLabelText('Project path'), {
      target: { value: '/typed/project' },
    });
    rerender(
      <NewTaskPage
        client={client}
        models={models}
        modelsLoading={false}
        navigate={navigate}
        sessions={[summary('recent', 'Recent task', '/recent/project', '2026-04-01T00:00:00Z')]}
      />,
    );

    expect(screen.getByLabelText('Project path')).toHaveValue('/typed/project');
  });

  it('defaults an untouched project path to the most recent session', () => {
    const { client } = createClient();
    const navigate = vi.fn();
    const { rerender } = render(
      <NewTaskPage
        client={client}
        models={models}
        modelsLoading={false}
        navigate={navigate}
        sessions={[]}
      />,
    );

    rerender(
      <NewTaskPage
        client={client}
        models={models}
        modelsLoading={false}
        navigate={navigate}
        sessions={[summary('recent', 'Recent task', '/recent/project', '2026-04-01T00:00:00Z')]}
      />,
    );

    expect(screen.getByLabelText('Project path')).toHaveValue('/recent/project');
  });

  it('blocks task creation and explains when this host has no authenticated model', async () => {
    const { client } = createClient({
      getSessionDefaults: vi.fn(async () => {
        throw new Error('could not resolve session defaults');
      }),
      listModels: vi.fn(async () => ({ models: [] })),
    });
    render(<DesktopApp client={client} path="/" search="" />);

    expect(screen.getByLabelText('Provider account')).toHaveValue('');
    expect(screen.queryByText('openai-codex-secondary')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Project path'), { target: { value: '/work/new' } });

    expect(
      await screen.findByRole('alert', { name: 'Model provider unavailable' }),
    ).toHaveTextContent('Open Pi on Development Mac and log in to a model provider');
    expect(screen.getByRole('button', { name: 'Start task' })).toBeDisabled();
  });

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
  it('loads files, diff, and scratchpad in the resizable session panel', async () => {
    const capabilities = {
      listFiles: vi.fn(async () => ({ files: ['src/App.tsx', 'README.md'] })),
      getFile: vi.fn(async () => ({
        path: 'src/App.tsx',
        kind: 'text' as const,
        content: 'export const app = true;',
        size: 24,
        modifiedAt: '2026-01-01T00:00:00Z',
        revision: 'rev-1',
      })),
      getGitDiff: vi.fn(async () => ({ branch: 'main', diff: '+++ b/src/App.tsx\n+changed' })),
      getScratchpad: vi.fn(async () => ({ content: 'Keep the UI compact.' })),
      saveScratchpad: vi.fn(async () => ({ ok: true })),
    };
    const { client } = createClient();
    Object.assign(client, capabilities);
    render(<DesktopApp client={client} path="/session" search="?id=selected.jsonl" />);

    await screen.findByText('Selected thread');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle session details' }));
    expect(
      screen.getByRole('complementary', { name: 'Session context panel' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(await screen.findByText('src/App.tsx')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'src/App.tsx' }));
    expect(await screen.findByText('export const app = true;')).toBeInTheDocument();
    expect(capabilities.getFile).toHaveBeenCalledWith('selected.jsonl', 'src/App.tsx');
    expect(capabilities.listFiles).toHaveBeenCalledWith('selected.jsonl');

    fireEvent.click(screen.getByRole('tab', { name: 'Diff' }));
    expect(await screen.findByText(/\+changed/)).toBeInTheDocument();
    expect(capabilities.getGitDiff).toHaveBeenCalledWith('selected.jsonl');

    fireEvent.click(screen.getByRole('tab', { name: 'Scratchpad' }));
    expect(await screen.findByDisplayValue('Keep the UI compact.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Scratchpad' }), {
      target: { value: 'Updated note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save scratchpad' }));
    await waitFor(() =>
      expect(capabilities.saveScratchpad).toHaveBeenCalledWith('/work/project', 'Updated note'),
    );
  });

  it('does not preview directories and refreshes active panel data on reload', async () => {
    const listFiles = vi.fn(async () => ({
      files: [
        { path: 'src', isDir: true, isDirectory: true },
        { path: 'README.md', isDir: false },
      ],
    }));
    const getFile = vi.fn(async () => ({
      path: 'README.md',
      kind: 'text' as const,
      content: 'readme',
      size: 6,
      modifiedAt: '',
      revision: 'rev-1',
    }));
    const getGitDiff = vi.fn(async () => ({ isRepo: true, branch: 'main', diff: 'diff' }));
    const { client, handlers } = createClient();
    Object.assign(client, { listFiles, getFile, getGitDiff });
    render(<DesktopApp client={client} path="/session" search="?id=selected.jsonl" />);
    await screen.findByText('Selected thread');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle session details' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findByText('src/');
    fireEvent.click(screen.getByRole('button', { name: 'src/' }));
    expect(await screen.findByText('Directories cannot be previewed.')).toBeInTheDocument();
    expect(getFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Diff' }));
    await screen.findByText('diff');
    const callsBeforeReload = getGitDiff.mock.calls.length;
    act(() => handlers.get('selected.jsonl')?.onEvent('reload', undefined));
    await waitFor(() => expect(getGitDiff.mock.calls.length).toBeGreaterThan(callsBeforeReload));
  });

  it('supports keyboard resizing with complete separator ARIA and persistence', async () => {
    const { client } = createClient();
    render(<DesktopApp client={client} path="/session" search="?id=selected.jsonl" />);
    await screen.findByText('Selected thread');

    const sidebarResizer = screen.getByRole('separator', { name: 'Resize thread sidebar' });
    expect(sidebarResizer).toHaveAttribute('aria-orientation', 'vertical');
    fireEvent.keyDown(sidebarResizer, { key: 'End' });
    expect(sidebarResizer).toHaveAttribute('aria-valuenow', '440');
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe('440');
    fireEvent.keyDown(sidebarResizer, { key: 'ArrowLeft' });
    expect(sidebarResizer).toHaveAttribute('aria-valuenow', '424');

    fireEvent.click(screen.getByRole('button', { name: 'Toggle session details' }));
    const panelResizer = screen.getByRole('separator', { name: 'Resize session panel' });
    expect(panelResizer).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(panelResizer, { key: 'End' });
    expect(panelResizer).toHaveAttribute('aria-valuenow', '280');
    expect(localStorage.getItem(RIGHT_PANEL_WIDTH_KEY)).toBe('280');
    fireEvent.keyDown(panelResizer, { key: 'ArrowLeft' });
    expect(panelResizer).toHaveAttribute('aria-valuenow', '296');
  });

  it('distinguishes a non-repository from a clean Git working tree', async () => {
    expect(normalizeDiff({ isRepo: false, diff: '' }).isRepo).toBe(false);

    const getGitDiff = vi.fn(async () => ({ isRepo: false, diff: '' }));
    const { client } = createClient({ getGitDiff });
    const firstRender = render(
      <DesktopApp client={client} path="/session" search="?id=selected.jsonl" />,
    );
    await screen.findByText('Selected thread');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle session details' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Diff' }));
    expect(await screen.findByText('This project is not a Git repository.')).toBeInTheDocument();
    expect(screen.queryByText('Working tree is clean.')).toBeNull();

    firstRender.unmount();
    localStorage.removeItem(DETAILS_OPEN_KEY);
    const cleanClient = createClient({
      getGitDiff: vi.fn(async () => ({ isRepo: true, diff: '' })),
    }).client;
    render(<DesktopApp client={cleanClient} path="/session" search="?id=selected.jsonl" />);
    await screen.findByText('Selected thread');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle session details' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Diff' }));
    expect(await screen.findByText('Working tree is clean.')).toBeInTheDocument();
    expect(screen.queryByText('This project is not a Git repository.')).toBeNull();
  });

  it('renders Pi timeline events for custom updates, branch summaries, and labels', () => {
    const details: SessionDetails = {
      ...emptyDetails,
      entries: [
        {
          id: 'custom-1',
          type: 'custom_message',
          customType: 'checklist',
          content: [{ type: 'text', text: 'Repository checked.' }],
        },
        { id: 'branch-1', type: 'branch_summary', summary: 'Continue from the stable branch.' },
        { id: 'label-1', type: 'label', label: 'Ready for review' },
      ],
      total: 3,
    };
    render(<Transcript details={details} />);

    expect(screen.getByText('checklist')).toBeInTheDocument();
    expect(screen.getByText('Repository checked.')).toBeInTheDocument();
    expect(screen.getByText('Branch summary')).toBeInTheDocument();
    expect(screen.getByText('Continue from the stable branch.')).toBeInTheDocument();
    expect(screen.getByText('Ready for review')).toBeInTheDocument();
  });

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
