import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChatWorkerStatus,
  PiWebClient,
  SessionDetails,
  SSESubscriptionHandlers,
} from '../live-shared';
import { ConversationScreen } from './conversation-screen';
import { MobileNavigationProvider } from './mobile-navigation-drawer';

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
    <MobileNavigationProvider value={{ openDrawer: vi.fn(), closeDrawer: vi.fn() }}>
      <ConversationScreen
        client={client}
        sessionId="session.jsonl"
        internalLink={(url, children, className) => (
          <a href={url} className={className}>
            {children}
          </a>
        )}
      />
    </MobileNavigationProvider>,
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
  it('shows reconnect recovery without replacing the conversation', async () => {
    let handlers: SSESubscriptionHandlers | undefined;
    renderConversation(
      makeClient(details, {
        subscribe: vi.fn((_topic, nextHandlers) => {
          handlers = nextHandlers;
          return { close: vi.fn() };
        }),
      }),
    );
    await screen.findByRole('textbox', { name: 'Message' });

    act(() => {
      handlers?.onOpen?.(new Event('open'));
      handlers?.onError?.(new Event('error'));
    });

    expect(screen.getByRole('status', { name: 'Connection status' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeVisible();
  });

  it('keeps the thread name accessible without reserving a navigation header', async () => {
    const { container } = renderConversation(makeClient());
    await screen.findByRole('textbox', { name: 'Message' });

    expect(screen.getByRole('heading', { level: 1, name: 'Mobile session' })).toBeInTheDocument();
    expect(container.querySelector('.mobile-conversation-header')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Thread actions' })).toBeVisible();
  });

  it('keeps runtime controls in Tools and thread actions in the floating controls', async () => {
    const user = userEvent.setup();
    renderConversation(makeClient());
    await screen.findByRole('textbox', { name: 'Message' });

    expect(screen.getAllByRole('button', { name: 'Tools' })).toHaveLength(1);
    const threadActions = screen.getByRole('button', { name: 'Thread actions' });

    await user.click(screen.getByRole('button', { name: 'Tools' }));
    const tools = screen.getByRole('dialog', { name: 'Tools' });
    expect(within(tools).getByRole('button', { name: /Model.*gpt-5\.6-sol/i })).toBeVisible();
    expect(within(tools).getByRole('button', { name: /Thinking.*high/i })).toBeVisible();
    expect(within(tools).getByRole('button', { name: 'Attach images' })).toBeVisible();
    expect(within(tools).getByRole('button', { name: 'Project inspector' })).toBeVisible();
    expect(within(tools).queryByRole('button', { name: 'Thread actions' })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await user.click(threadActions);
    expect(screen.getByRole('dialog', { name: 'Mobile session' })).toBeVisible();
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

  it('opens the model and thinking picker from Tools', async () => {
    const user = userEvent.setup();
    renderConversation(makeClient());
    await screen.findByRole('textbox', { name: 'Message' });
    await user.click(screen.getByRole('button', { name: 'Tools' }));
    const picker = screen.getByRole('button', { name: /Model.*gpt-5\.6-sol/i });

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
    expect(document.activeElement).not.toHaveAttribute('aria-label', 'Message');
  });

  it('keeps the true conversation leaf when a parent arrives later in a partial snapshot', async () => {
    const partialDetails = {
      ...details,
      entries: [
        {
          id: 'assistant-child',
          parentId: 'user-parent',
          type: 'message',
          message: { role: 'assistant', content: 'Child answer stays visible' },
        },
        {
          id: 'user-parent',
          parentId: null,
          type: 'message',
          message: { role: 'user', content: 'Parent prompt' },
        },
      ],
    };
    renderConversation(makeClient(partialDetails));

    expect(await screen.findByText('Child answer stays visible')).toBeVisible();
  });

  it('renders streamed assistant Markdown before the final session reload', async () => {
    let onEvent: ((name: string, payload: unknown) => void) | undefined;
    const client = makeClient(details, {
      subscribe: vi.fn((_topic, handlers) => {
        onEvent = handlers.onEvent as (name: string, payload: unknown) => void;
        handlers.onOpen?.(new Event('open'));
        return { close: vi.fn() };
      }),
    });
    renderConversation(client);
    await screen.findByRole('textbox', { name: 'Message' });

    act(() => onEvent?.('chat-preview', { content: '## Live heading\n\n- first\n- second' }));

    expect(screen.getByRole('heading', { name: 'Live heading', level: 2 })).toBeVisible();
    expect(screen.getByText('first')).toBeVisible();
  });

  it('keeps a completed preview until a new matching assistant entry arrives', async () => {
    let onEvent: ((name: string, payload: unknown) => void) | undefined;
    const repeatedDetails = {
      ...details,
      entries: [
        {
          id: 'assistant-old',
          parentId: null,
          type: 'message',
          message: { role: 'assistant', content: 'Done' },
        },
      ],
    };
    const completedDetails = {
      ...repeatedDetails,
      entries: [
        ...repeatedDetails.entries,
        {
          id: 'assistant-new',
          parentId: 'assistant-old',
          type: 'message',
          message: { role: 'assistant', content: 'Done' },
        },
      ],
    };
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(repeatedDetails)
      .mockResolvedValueOnce(repeatedDetails)
      .mockResolvedValueOnce(completedDetails);
    renderConversation(
      makeClient(repeatedDetails, {
        getSession,
        subscribe: vi.fn((_topic, handlers) => {
          onEvent = handlers.onEvent as (name: string, payload: unknown) => void;
          handlers.onOpen?.(new Event('open'));
          return { close: vi.fn() };
        }),
      }),
    );
    await screen.findByRole('textbox', { name: 'Message' });

    act(() => onEvent?.('chat-preview', { content: 'Done', done: true }));
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
    expect(document.querySelector('.mobile-message.is-preview')).toHaveTextContent('Done');

    act(() => onEvent?.('chat-preview', { content: 'Done', done: true }));
    await waitFor(() => expect(document.querySelector('.mobile-message.is-preview')).toBeNull());
    expect(screen.getAllByText('Done')).toHaveLength(2);
  });

  it('ignores an older session refresh that resolves after a newer one', async () => {
    let onEvent: ((name: string, payload: unknown) => void) | undefined;
    let resolveOld!: (value: SessionDetails) => void;
    let resolveNew!: (value: SessionDetails) => void;
    const oldRefresh = new Promise<SessionDetails>((resolve) => {
      resolveOld = resolve;
    });
    const newRefresh = new Promise<SessionDetails>((resolve) => {
      resolveNew = resolve;
    });
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(details)
      .mockReturnValueOnce(oldRefresh)
      .mockReturnValueOnce(newRefresh);
    const client = makeClient(details, {
      getSession,
      subscribe: vi.fn((_topic, handlers) => {
        onEvent = handlers.onEvent as (name: string, payload: unknown) => void;
        handlers.onOpen?.(new Event('open'));
        return { close: vi.fn() };
      }),
    });
    renderConversation(client);
    await screen.findByRole('textbox', { name: 'Message' });

    act(() => onEvent?.('reload', undefined));
    act(() => onEvent?.('chat-preview', { content: 'Newest response', done: true }));
    const newest = {
      ...details,
      entries: [
        {
          id: 'assistant-new',
          parentId: null,
          type: 'message',
          message: { role: 'assistant', content: 'Newest response' },
        },
      ],
    };
    await act(async () => resolveNew(newest));
    expect(await screen.findByText('Newest response')).toBeVisible();

    await act(async () => resolveOld(details));
    await waitFor(() => expect(screen.getByText('Newest response')).toBeVisible());
  });

  it('updates one stable tool row from running to done and bounds long details', async () => {
    let onEvent: ((name: string, payload: unknown) => void) | undefined;
    const runningDetails = {
      ...details,
      entries: [
        {
          id: 'assistant-tool',
          parentId: null,
          type: 'message',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'read-call',
                name: 'read',
                arguments: { path: `/tmp/${'very-long-directory/'.repeat(20)}file.ts` },
              },
            ],
          },
        },
      ],
    };
    const completedDetails = {
      ...runningDetails,
      entries: [
        ...runningDetails.entries,
        {
          id: 'read-result',
          parentId: 'assistant-tool',
          type: 'message',
          message: {
            role: 'toolResult',
            toolCallId: 'read-call',
            toolName: 'read',
            content: [{ type: 'text', text: 'result '.repeat(400) }],
          },
        },
      ],
    };
    const client = makeClient(runningDetails, {
      getSession: vi.fn().mockResolvedValueOnce(runningDetails).mockResolvedValue(completedDetails),
      subscribe: vi.fn((_topic, handlers) => {
        onEvent = handlers.onEvent as (name: string, payload: unknown) => void;
        handlers.onOpen?.(new Event('open'));
        return { close: vi.fn() };
      }),
    });
    renderConversation(client);

    const toolRow = await screen.findByRole('button', { name: /Expand read tool details/i });
    expect(toolRow).toHaveTextContent('Running');
    act(() => onEvent?.('reload', undefined));
    await waitFor(() => expect(toolRow).toHaveTextContent('Done'));
    expect(screen.getAllByRole('button', { name: /read tool details/i })).toHaveLength(1);

    await userEvent.click(toolRow);
    const detailsPanel = document.querySelector('.mobile-tool-details');
    expect(detailsPanel).toBeInTheDocument();
    expect(detailsPanel).toHaveTextContent('result result');
  });

  it('renders long Markdown tables and code in overflow-safe containers', async () => {
    const longToken = 'x'.repeat(300);
    renderConversation(
      makeClient({
        ...details,
        entries: [
          {
            id: 'assistant-markdown',
            parentId: null,
            type: 'message',
            message: {
              role: 'assistant',
              content: `| Key | Value |\n| --- | --- |\n| long | ${longToken} |\n\n\`\`\`ts\nconst token = '${longToken}'\n\`\`\``,
            },
          },
        ],
      }),
    );
    await screen.findByRole('textbox', { name: 'Message' });

    expect(document.querySelector('.mobile-markdown table')).toBeInTheDocument();
    expect(document.querySelector('.mobile-markdown pre code')).toHaveTextContent('const token');
  });

  it('ignores an older refresh rejection after a newer refresh succeeds', async () => {
    let onEvent: ((name: string, payload: unknown) => void) | undefined;
    let rejectOld!: (error: Error) => void;
    let resolveNew!: (value: SessionDetails) => void;
    const oldRefresh = new Promise<SessionDetails>((_resolve, reject) => {
      rejectOld = reject;
    });
    const newRefresh = new Promise<SessionDetails>((resolve) => {
      resolveNew = resolve;
    });
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(details)
      .mockReturnValueOnce(oldRefresh)
      .mockReturnValueOnce(newRefresh);
    renderConversation(
      makeClient(details, {
        getSession,
        subscribe: vi.fn((_topic, handlers) => {
          onEvent = handlers.onEvent as (name: string, payload: unknown) => void;
          handlers.onOpen?.(new Event('open'));
          return { close: vi.fn() };
        }),
      }),
    );
    await screen.findByRole('textbox', { name: 'Message' });

    act(() => onEvent?.('reload', undefined));
    act(() => onEvent?.('chat-preview', { content: 'Newest survives', done: true }));
    await act(async () =>
      resolveNew({
        ...details,
        entries: [
          {
            id: 'assistant-new',
            parentId: null,
            type: 'message',
            message: { role: 'assistant', content: 'Newest survives' },
          },
        ],
      }),
    );
    await act(async () => rejectOld(new Error('stale request failed')));

    expect(await screen.findByText('Newest survives')).toBeVisible();
    expect(screen.queryByText('stale request failed')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeVisible();
  });

  it('shows an explicit jump-to-latest control when the reader scrolls away', async () => {
    const user = userEvent.setup();
    renderConversation(makeClient());
    await screen.findByRole('textbox', { name: 'Message' });
    const feed = screen.getByLabelText('Conversation messages');
    Object.defineProperties(feed, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });

    fireEvent.scroll(feed);
    const jump = screen.getByRole('button', { name: 'Jump to latest' });
    expect(jump).toBeVisible();

    await user.click(jump);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument();
  });

  it('repins the latest message when the floating composer grows', async () => {
    let resize: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    renderConversation(makeClient());
    await screen.findByRole('textbox', { name: 'Message' });
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    act(() => resize?.([], {} as ResizeObserver));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'end' });
  });

  it('resets the keyboard baseline after an unfocused viewport resize', async () => {
    const visualViewport = new EventTarget() as VisualViewport;
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 800 },
      offsetTop: { configurable: true, value: 0 },
    });
    vi.stubGlobal('visualViewport', visualViewport);
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
      writable: true,
    });
    renderConversation(makeClient());
    await screen.findByRole('textbox', { name: 'Message' });
    const screenRoot = screen.getByRole('main');

    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 600 });
    act(() => window.dispatchEvent(new Event('resize')));
    expect(screenRoot).toHaveAttribute('data-keyboard-open', 'false');

    screen.getByRole('textbox', { name: 'Message' }).focus();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 350 });
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 350 });
    act(() => visualViewport.dispatchEvent(new Event('resize')));
    await waitFor(() => expect(screenRoot).toHaveAttribute('data-keyboard-open', 'true'));
  });

  it('accepts a small standalone resize when no keyboard cycle preceded it', async () => {
    const visualViewport = new EventTarget() as VisualViewport;
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 800 },
      offsetTop: { configurable: true, value: 0 },
    });
    vi.stubGlobal('visualViewport', visualViewport);
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('iPhone');
    vi.spyOn(window.screen, 'height', 'get').mockReturnValue(800);
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
      writable: true,
    });

    renderConversation(makeClient());
    await screen.findByRole('textbox', { name: 'Message' });
    const screenRoot = screen.getByRole('main');

    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 741 });
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 741 });
    act(() => window.dispatchEvent(new Event('resize')));

    expect(screenRoot).toHaveAttribute('data-keyboard-open', 'false');
    expect(screenRoot.style.getPropertyValue('--mobile-viewport-height')).toBe('741px');
  });

  it('detects the iOS keyboard when both layout and visual viewports shrink', async () => {
    const visualViewport = new EventTarget() as VisualViewport;
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 800 },
      offsetTop: { configurable: true, value: 0 },
    });
    vi.stubGlobal('visualViewport', visualViewport);
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
      writable: true,
    });

    renderConversation(makeClient());
    const message = await screen.findByRole('textbox', { name: 'Message' });
    const screenRoot = screen.getByRole('main');
    message.focus();
    expect(screenRoot).toHaveAttribute('data-keyboard-open', 'false');

    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 400,
      writable: true,
    });
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 400 },
      offsetTop: { configurable: true, value: 0 },
    });
    act(() => visualViewport.dispatchEvent(new Event('resize')));

    await waitFor(() => expect(screenRoot).toHaveAttribute('data-keyboard-open', 'true'));
    expect(screenRoot.style.getPropertyValue('--mobile-viewport-height')).toBe('400px');
    expect(screenRoot.style.getPropertyValue('--mobile-viewport-top')).toBe('0px');
    expect(screen.getByRole('button', { name: 'Send' })).toBeVisible();
    expect(message).toHaveFocus();

    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
      writable: true,
    });
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 800 });
    act(() => visualViewport.dispatchEvent(new Event('resize')));
    await waitFor(() => expect(screenRoot).toHaveAttribute('data-keyboard-open', 'false'));
  });

  it('restores the iPhone screen anchor when the app launches with a poisoned viewport', async () => {
    const visualViewport = new EventTarget() as VisualViewport;
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 741 },
      offsetTop: { configurable: true, value: 0 },
    });
    vi.stubGlobal('visualViewport', visualViewport);
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('iPhone');
    vi.spyOn(window.screen, 'height', 'get').mockReturnValue(800);
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 741,
      writable: true,
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('mobile-session-screen')) {
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
        Object.defineProperty(visualViewport, 'height', { configurable: true, value: 800 });
      }
      return 0;
    });

    renderConversation(makeClient());
    await screen.findByRole('textbox', { name: 'Message' });
    const screenRoot = screen.getByRole('main');

    expect(screenRoot).toHaveAttribute('data-keyboard-open', 'false');
    expect(screenRoot.style.getPropertyValue('--mobile-viewport-height')).toBe('800px');
    expect(screenRoot.style.getPropertyValue('--mobile-viewport-top')).toBe('0px');
    await waitFor(() => expect(window.innerHeight).toBe(800));
  });

  it('cancels a pending viewport heal when the composer regains focus', async () => {
    const visualViewport = new EventTarget() as VisualViewport;
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 741 },
      offsetTop: { configurable: true, value: 0 },
    });
    vi.stubGlobal('visualViewport', visualViewport);
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('iPhone');
    vi.spyOn(window.screen, 'height', 'get').mockReturnValue(800);
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 741,
      writable: true,
    });
    const viewportRead = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(0);

    renderConversation(makeClient());
    const message = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.focus(message);
    await new Promise((resolve) => window.setTimeout(resolve, 180));

    expect(viewportRead).not.toHaveBeenCalled();
  });

  it('keeps the full-height composer anchor through the iOS dismissal shrink', async () => {
    const visualViewport = new EventTarget() as VisualViewport;
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 800 },
      offsetTop: { configurable: true, value: 0 },
    });
    vi.stubGlobal('visualViewport', visualViewport);
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
      writable: true,
    });

    renderConversation(makeClient());
    const message = await screen.findByRole('textbox', { name: 'Message' });
    const screenRoot = screen.getByRole('main');
    expect(screenRoot.style.getPropertyValue('--mobile-viewport-height')).toBe('800px');
    message.focus();

    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 });
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 400 });
    act(() => visualViewport.dispatchEvent(new Event('resize')));
    await waitFor(() => expect(screenRoot).toHaveAttribute('data-keyboard-open', 'true'));
    expect(screenRoot.style.getPropertyValue('--mobile-viewport-height')).toBe('400px');

    message.blur();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 741 });
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 741 });
    act(() => visualViewport.dispatchEvent(new Event('resize')));

    await waitFor(() => expect(screenRoot).toHaveAttribute('data-keyboard-open', 'false'));
    expect(screenRoot.style.getPropertyValue('--mobile-viewport-height')).toBe('800px');
    expect(screenRoot.style.getPropertyValue('--mobile-viewport-top')).toBe('0px');

    message.focus();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 });
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 400 });
    act(() => visualViewport.dispatchEvent(new Event('resize')));

    await waitFor(() => expect(screenRoot).toHaveAttribute('data-keyboard-open', 'true'));
    expect(screenRoot.style.getPropertyValue('--mobile-viewport-height')).toBe('459px');
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
