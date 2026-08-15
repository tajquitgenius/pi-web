import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatWorkerStatus, PiWebClient, SessionDetails } from '../live-shared';
import { ConversationScreen } from './conversation-screen';

const details: SessionDetails = {
  header: { cwd: '/work/pi-web' },
  entries: [],
  name: 'Mobile session',
  total: 0,
  from: 0,
  chatAvailable: true,
  chatDisabledReason: '',
  model: 'gpt-5.6-sol',
  modelProvider: 'openai-codex-secondary',
  thinkingLevel: 'high',
};

function makeClient(
  sessionDetails: SessionDetails = details,
  overrides: Partial<PiWebClient> = {},
): PiWebClient {
  const workerStatus: ChatWorkerStatus = { state: 'idle', thinkingLevel: 'high' };
  return {
    getSession: vi.fn().mockResolvedValue(sessionDetails),
    getWorkerStatus: vi.fn().mockResolvedValue(workerStatus),
    listModels: vi.fn().mockResolvedValue({
      models: [
        {
          provider: 'openai-codex-secondary',
          id: 'gpt-5.6-sol',
          name: 'GPT 5.6 Sol',
          reasoning: true,
        },
        {
          provider: 'anthropic',
          id: 'claude-sonnet',
          name: 'Claude Sonnet',
          reasoning: true,
        },
      ],
    }),
    sendChat: vi.fn().mockResolvedValue({ ok: true, status: 'queued' }),
    cancelChat: vi.fn().mockResolvedValue({ ok: true, status: 'cancelled' }),
    setModel: vi.fn().mockResolvedValue({ ok: true }),
    setThinkingLevel: vi.fn().mockResolvedValue({ ok: true, thinkingLevel: 'high' }),
    getHostContext: vi.fn().mockReturnValue({
      instanceName: 'Work Mac',
      currentUrl: 'https://work.example',
      peers: [],
    }),
    subscribe: vi.fn(() => ({ close: vi.fn() })),
    ...overrides,
  } as unknown as PiWebClient;
}

function renderConversation(client: PiWebClient) {
  return render(
    <ConversationScreen
      client={client}
      sessionId="session.jsonl"
      internalLink={(url, children, className) => (
        <a href={url} className={className}>
          {children}
        </a>
      )}
    />,
  );
}

beforeEach(() => {
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

describe('mobile conversation redesign', () => {
  it('has one Tools trigger and routes project inspector and thread actions from its sheet', async () => {
    const user = userEvent.setup();
    renderConversation(makeClient());
    await screen.findByRole('textbox', { name: 'Message' });

    expect(screen.getAllByRole('button', { name: 'Tools' })).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: 'Open files, diff, and details' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open thread actions' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tools' }));
    const tools = screen.getByRole('dialog', { name: 'Tools' });
    expect(within(tools).getByRole('button', { name: 'Attach images' })).toBeInTheDocument();

    await user.click(within(tools).getByRole('button', { name: 'Project inspector' }));
    expect(screen.queryByRole('dialog', { name: 'Tools' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Files, diff, and details' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Files, diff, and details' }),
      ).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Tools' }));
    await user.click(screen.getByRole('button', { name: 'Thread actions' }));
    expect(screen.queryByRole('dialog', { name: 'Tools' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Mobile session' })).toBeInTheDocument();
  });

  it('closes the Tools sheet before opening attachments', async () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click');
    const user = userEvent.setup();
    renderConversation(makeClient());
    await screen.findByRole('textbox', { name: 'Message' });

    await user.click(screen.getByRole('button', { name: 'Tools' }));
    await user.click(screen.getByRole('button', { name: 'Attach images' }));

    expect(screen.queryByRole('dialog', { name: 'Tools' })).not.toBeInTheDocument();
    expect(inputClick).toHaveBeenCalledOnce();
  });

  it('opens the model and thinking picker and restores focus on Escape', async () => {
    const user = userEvent.setup();
    renderConversation(makeClient());
    await screen.findByRole('textbox', { name: 'Message' });
    const picker = screen.getByRole('button', { name: 'Choose model and thinking level' });

    await user.click(picker);
    const runtime = await screen.findByRole('dialog', { name: 'Model and thinking' });
    expect(within(runtime).getByLabelText('Account / provider and model')).toHaveValue(
      'openai-codex-secondary/gpt-5.6-sol',
    );
    expect(within(runtime).getByLabelText('Thinking level')).toHaveValue('high');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Model and thinking' })).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(picker);

    await user.click(picker);
    const reopenedRuntime = await screen.findByRole('dialog', { name: 'Model and thinking' });
    fireEvent.click(reopenedRuntime.parentElement!);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Model and thinking' })).not.toBeInTheDocument(),
    );
  });

  it('shows a disabled reason once and leaves the composer placeholder empty', async () => {
    const readonlyDetails = {
      ...details,
      chatAvailable: false,
      chatDisabledReason: 'This thread is read-only.',
    };
    renderConversation(makeClient(readonlyDetails));
    await screen.findByRole('textbox', { name: 'Message' });

    expect(screen.getAllByText('This thread is read-only.')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('placeholder', '');
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  });
});
