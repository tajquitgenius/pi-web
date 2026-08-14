import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PairedDevice,
  PiWebClient,
  SSESubscriptionHandlers,
  SessionDetails,
  SessionSummary,
} from '../live-shared';
import { MobileApp } from './app';

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
  };
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mobile sessions home', () => {
  it('shows running sessions first and bounds the first render to 30 rows', async () => {
    const sessions = Array.from({ length: 35 }, (_, index) => sessionSummary(index));
    const subscribe = vi.fn((topic: string, handlers: SSESubscriptionHandlers) => {
      if (topic === '__all__') {
        handlers.onEvent('status-snapshot', {
          running: ['session-0.jsonl'],
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
    expect(rows[0]).toHaveTextContent('Session 0');
    expect(rows[0]).toHaveTextContent('running');
    expect(client.listSessions).toHaveBeenCalledWith({ limit: 120, offset: 0 });

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(document.querySelectorAll('.mobile-session-row')).toHaveLength(35);
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

  it('loads and submits explicit defaults from the full-screen New Task flow', async () => {
    const createSession = vi.fn().mockResolvedValue({ ok: true, id: 'created.jsonl' });
    const client = makeClient({ createSession });
    const user = userEvent.setup();
    render(<MobileApp client={client} path="/" search="" />);

    await user.click(screen.getByRole('button', { name: 'New task' }));
    const taskScreen = await screen.findByRole('region', { name: 'New task' });
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

    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith({
        path: '/work/new-project',
        modelProvider: 'openai-codex-secondary',
        modelId: 'gpt-5.6-sol',
        thinkingLevel: 'high',
      }),
    );
  });
});

describe('mobile pairing', () => {
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

  it('exposes bounded composer sizing hooks and labelled touch controls', async () => {
    render(<MobileApp client={makeClient()} path="/session" search="?id=one.jsonl" />);
    await screen.findByRole('textbox', { name: 'Message' });

    const composer = document.querySelector('.mobile-composer');
    expect(composer).toHaveAttribute('data-collapsed-height', '64');
    expect(composer).toHaveAttribute('data-expanded-height', '156');
    expect(document.querySelector('.mobile-composer-chrome')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach images' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /openai-codex-secondary · gpt-5\.6-sol · high.*Open settings/,
      }),
    ).toBeInTheDocument();
  });
});

describe('mobile settings', () => {
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

  it('labels primary icon controls and keeps peer hosts as top-level links', async () => {
    render(<MobileApp client={makeClient()} path="/" search="" />);
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    await userEvent.click(screen.getByLabelText('Current computer: Work Mac. Switch computer'));
    expect(screen.getByRole('link', { name: /Home Mac/ })).toHaveAttribute(
      'href',
      'https://home.example',
    );
  });
});
