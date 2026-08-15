import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PiWebClient } from '../live-shared';
import { SessionsScreen } from './sessions-screen';

function makeClient(overrides: Record<string, unknown> = {}): PiWebClient {
  return {
    listSessions: vi.fn().mockResolvedValue({ sessions: [], total: 0 }),
    subscribe: vi.fn().mockReturnValue({ close: vi.fn() }),
    getHostContext: vi.fn().mockReturnValue({
      instanceName: 'Work Mac',
      currentUrl: 'https://work.example',
      peers: [],
    }),
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
    createSession: vi.fn().mockResolvedValue({ ok: true, id: 'created.jsonl' }),
    ...overrides,
  } as unknown as PiWebClient;
}

function renderHome(client: PiWebClient) {
  render(
    <SessionsScreen
      client={client}
      navigate={vi.fn()}
      internalLink={(url, children, className) => (
        <a href={url} className={className}>
          {children}
        </a>
      )}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('mobile home stability', () => {
  it('ignores a stale session list response after an SSE refresh', async () => {
    const first = deferred<{ sessions: Array<Record<string, unknown>>; total: number }>();
    const second = deferred<{ sessions: Array<Record<string, unknown>>; total: number }>();
    let onEvent: ((name: string, payload: unknown) => void) | undefined;
    const client = makeClient({
      listSessions: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
      subscribe: vi.fn((_topic, handlers) => {
        onEvent = handlers.onEvent as (name: string, payload: unknown) => void;
        return { close: vi.fn() };
      }),
    });
    renderHome(client);

    act(() => onEvent?.('reload', undefined));
    second.resolve({
      sessions: [
        {
          id: 'new.jsonl',
          name: 'Newest session',
          project: '/work/new',
          lastActivity: '2026-08-15T12:00:01Z',
          model: 'gpt-5.6-sol',
          modelProvider: 'openai-codex-secondary',
        },
      ],
      total: 1,
    });
    expect(await screen.findByText('Newest session')).toBeVisible();

    first.resolve({
      sessions: [
        {
          id: 'old.jsonl',
          name: 'Stale session',
          project: '/work/old',
          lastActivity: '2026-08-15T12:00:00Z',
          model: 'gpt-5.6-sol',
          modelProvider: 'openai-codex-secondary',
        },
      ],
      total: 1,
    });
    await waitFor(() => expect(screen.getByText('Newest session')).toBeVisible());
    expect(screen.queryByText('Stale session')).not.toBeInTheDocument();
  });

  it('changes running badges without reordering recents', async () => {
    let onEvent: ((name: string, payload: unknown) => void) | undefined;
    const client = makeClient({
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: 'new.jsonl',
            name: 'Newest session',
            project: '/work/new',
            lastActivity: '2026-08-15T12:00:01Z',
          },
          {
            id: 'old.jsonl',
            name: 'Older session',
            project: '/work/old',
            lastActivity: '2026-08-15T12:00:00Z',
          },
        ],
        total: 2,
      }),
      subscribe: vi.fn((_topic, handlers) => {
        onEvent = handlers.onEvent as (name: string, payload: unknown) => void;
        return { close: vi.fn() };
      }),
    });
    renderHome(client);
    await screen.findByText('Newest session');
    const rowNames = () =>
      Array.from(document.querySelectorAll('.mobile-session-row strong')).map(
        (node) => node.textContent,
      );
    expect(rowNames()).toEqual(['Newest session', 'Older session']);

    act(() => onEvent?.('status-delta', { id: 'old.jsonl', running: true }));
    expect(rowNames()).toEqual(['Newest session', 'Older session']);
    expect(screen.getByText('Older session').closest('.mobile-session-row')).toHaveClass(
      'is-running',
    );
  });
});

describe('mobile New Task', () => {
  it('preselects the most recent project and makes recent choices tappable', async () => {
    const client = makeClient({
      listRecentLocations: vi
        .fn()
        .mockResolvedValue({ locations: ['/work/latest', '/work/older'] }),
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ path: '/work/registered', label: 'Registered project' }],
      }),
    });
    const user = userEvent.setup();
    renderHome(client);

    await user.click(screen.getByRole('button', { name: 'New task' }));
    const taskScreen = await screen.findByRole('dialog', { name: 'New task' });
    const pathInput = within(taskScreen).getByLabelText('Destination folder');

    await waitFor(() => expect(pathInput).toHaveValue('/work/latest'));
    expect(client.listProjects).toHaveBeenCalledOnce();
    expect(
      within(taskScreen).getByRole('button', { name: /latest.*\/work\/latest/i }),
    ).toBeInTheDocument();
    expect(
      within(taskScreen).getByRole('button', { name: /registered project.*\/work\/registered/i }),
    ).toBeInTheDocument();

    await user.click(within(taskScreen).getByRole('button', { name: /older.*\/work\/older/i }));
    expect(pathInput).toHaveValue('/work/older');
    expect(within(taskScreen).getByRole('button', { name: 'Custom path' })).toBeInTheDocument();
  });

  it('keeps the custom path editable while runtime defaults load independently', async () => {
    const defaults = deferred<{
      modelProvider: string;
      modelId: string;
      thinkingLevel: 'high';
    }>();
    const client = makeClient({
      getSessionDefaults: vi.fn().mockReturnValue(defaults.promise),
      listModels: vi.fn().mockResolvedValue({ models: [] }),
    });
    const user = userEvent.setup();
    renderHome(client);

    await user.click(screen.getByRole('button', { name: 'New task' }));
    const taskScreen = await screen.findByRole('dialog', { name: 'New task' });
    const pathInput = within(taskScreen).getByLabelText('Destination folder');

    expect(pathInput).not.toBeDisabled();
    await user.type(pathInput, '/work/while-loading');
    expect(pathInput).toHaveValue('/work/while-loading');

    defaults.resolve({
      modelProvider: 'openai-codex-secondary',
      modelId: 'gpt-5.6-sol',
      thinkingLevel: 'high',
    });
    await waitFor(() => expect(client.getSessionDefaults).toHaveBeenCalledOnce());
  });

  it('fails closed without authenticated defaults while keeping the path editable', async () => {
    const client = makeClient({
      getSessionDefaults: vi.fn().mockRejectedValue(new Error('no authenticated default')),
    });
    const user = userEvent.setup();
    renderHome(client);

    await user.click(screen.getByRole('button', { name: 'New task' }));
    const taskScreen = await screen.findByRole('dialog', { name: 'New task' });
    expect(await within(taskScreen).findByRole('alert')).toHaveTextContent(
      'Open Pi on Work Mac and log in to a model provider',
    );
    expect(within(taskScreen).getByRole('button', { name: 'Create task' })).toBeDisabled();
    expect(within(taskScreen).getByLabelText('Destination folder')).not.toBeDisabled();
    expect(within(taskScreen).queryByText('openai-codex-secondary')).not.toBeInTheDocument();
  });

  it('offers an authenticated alternative when the cached default is unavailable', async () => {
    const client = makeClient({
      listModels: vi.fn().mockResolvedValue({
        models: [
          {
            provider: 'other-provider',
            id: 'other-model',
            name: 'Other model',
            reasoning: true,
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderHome(client);

    await user.click(screen.getByRole('button', { name: 'New task' }));
    const taskScreen = await screen.findByRole('dialog', { name: 'New task' });
    expect(client.listModels).not.toHaveBeenCalled();
    const runtimeSummary = await within(taskScreen).findByRole('button', {
      name: /Runtime.*openai-codex-secondary.*gpt-5\.6-sol/i,
    });
    await user.click(runtimeSummary);
    const modelSelect = await within(taskScreen).findByLabelText('Provider and model');
    await waitFor(() => expect(modelSelect).toHaveValue('other-provider/other-model'));
    expect(within(taskScreen).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(taskScreen).getByRole('button', { name: 'Create task' })).toBeEnabled();
    expect(within(taskScreen).getByText(/other-provider.*Other model/i)).toBeInTheDocument();
  });

  it('keeps runtime compact behind an optional settings disclosure', async () => {
    const client = makeClient();
    const user = userEvent.setup();
    renderHome(client);

    await user.click(screen.getByRole('button', { name: 'New task' }));
    const taskScreen = await screen.findByRole('dialog', { name: 'New task' });
    expect(client.listModels).not.toHaveBeenCalled();

    expect(within(taskScreen).queryByText('Ready to create')).not.toBeInTheDocument();
    expect(within(taskScreen).queryByLabelText('Provider and model')).not.toBeInTheDocument();
    const runtimeSummary = within(taskScreen).getByRole('button', {
      name: /Runtime.*openai-codex-secondary.*gpt-5\.6-sol/i,
    });
    expect(runtimeSummary).toHaveAttribute('aria-expanded', 'false');

    await user.click(runtimeSummary);
    await waitFor(() => expect(client.listModels).toHaveBeenCalledOnce());
    expect(within(taskScreen).getByLabelText('Provider and model')).toBeInTheDocument();
    expect(within(taskScreen).getByLabelText('Thinking level')).toHaveValue('high');
    await user.click(runtimeSummary);
    expect(within(taskScreen).queryByLabelText('Provider and model')).not.toBeInTheDocument();
  });

  it('keeps the path editable after validation failure so it can be corrected', async () => {
    const client = makeClient();
    const user = userEvent.setup();
    renderHome(client);

    await user.click(screen.getByRole('button', { name: 'New task' }));
    const taskScreen = await screen.findByRole('dialog', { name: 'New task' });
    const pathInput = within(taskScreen).getByLabelText('Destination folder');
    await user.click(within(taskScreen).getByRole('button', { name: 'Create task' }));

    expect(await within(taskScreen).findByRole('alert')).toHaveTextContent('Please enter a path');
    expect(pathInput).not.toBeDisabled();
    await user.type(pathInput, '/work/corrected');
    expect(pathInput).toHaveValue('/work/corrected');
    expect(within(taskScreen).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('restores editing after a server failure without losing the custom path', async () => {
    const createSession = vi.fn().mockRejectedValue(new Error('destination is unavailable'));
    const client = makeClient({ createSession });
    const user = userEvent.setup();
    renderHome(client);

    await user.click(screen.getByRole('button', { name: 'New task' }));
    const taskScreen = await screen.findByRole('dialog', { name: 'New task' });
    const pathInput = within(taskScreen).getByLabelText('Destination folder');
    await user.type(pathInput, '/work/retry');
    await user.click(within(taskScreen).getByRole('button', { name: 'Create task' }));

    expect(await within(taskScreen).findByRole('alert')).toHaveTextContent(
      'destination is unavailable',
    );
    expect(pathInput).toHaveValue('/work/retry');
    expect(pathInput).not.toBeDisabled();
    expect(within(taskScreen).getByRole('button', { name: 'Create task' })).not.toBeDisabled();
    expect(createSession).toHaveBeenCalledWith({ path: '/work/retry' });
  });
});
