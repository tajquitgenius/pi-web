import { marked } from 'marked';
import {
  ArrowLeft,
  ChevronDown,
  ImagePlus,
  LoaderCircle,
  Send,
  Settings2,
  Square,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import type {
  ChatWorkerStatus,
  PiModel,
  PiWebClient,
  SessionDetails,
  SessionEntry,
  SessionStatus,
  StatusSnapshot,
  ThinkingLevel,
} from '../live-shared';
import { readSessionBootstrap } from '../routes/session-page-data.js';
import { configureSessionMarkdown, safeMarkedParse } from '../session/render/markdown.js';
import { escapeHtml, formatToolCall } from '../session/render/session-format.js';
import { getPath, stitchOrphanRoots } from '../session/tree/session-tree.js';
import { t } from '../shared/i18n.js';

const OLDER_ENTRY_PAGE = 100;
const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

configureSessionMarkdown({ marked, hljs: null, escapeHtml });

interface ConversationScreenProps {
  client: PiWebClient;
  sessionId: string;
  internalLink: (url: string, children: ReactNode, className?: string) => ReactNode;
}

interface MessageBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  data?: string;
  mimeType?: string;
}

interface EntryMessage {
  role?: string;
  content?: string | MessageBlock[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  stopReason?: string;
  errorMessage?: string;
  command?: string;
  output?: string;
  exitCode?: number | null;
  cancelled?: boolean;
}

interface MobileSessionEntry extends SessionEntry {
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  type?: string;
  message?: EntryMessage;
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
  implicit?: boolean;
  summary?: string;
  tokensBefore?: number;
  customType?: string;
  content?: unknown;
  display?: boolean;
}

interface SessionBootstrap {
  id?: string;
  data?: SessionDetails;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function contentBlocks(content: EntryMessage['content']): MessageBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
}

function textContent(content: EntryMessage['content']): string {
  return contentBlocks(content)
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');
}

function MobileMarkdown({ text }: { text: string }) {
  return (
    <div
      className="mobile-markdown"
      dangerouslySetInnerHTML={{ __html: safeMarkedParse(text, { marked }) as string }}
    />
  );
}

function entryTimestamp(timestamp?: string): string {
  if (!timestamp) return '';
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(parsed);
}

function activeConversationEntries(entries: SessionEntry[]): MobileSessionEntry[] {
  const stitched = stitchOrphanRoots(entries) as MobileSessionEntry[];
  const byId = new Map<string, MobileSessionEntry>();
  for (const entry of stitched) {
    if (entry.id) byId.set(entry.id, entry);
  }
  let leafId = '';
  for (let index = stitched.length - 1; index >= 0; index -= 1) {
    const entry = stitched[index];
    if (entry?.id && entry.type !== 'session' && entry.type !== 'label') {
      leafId = entry.id;
      break;
    }
  }
  return leafId ? (getPath(leafId, byId) as MobileSessionEntry[]) : [];
}

function toolResultText(result?: MobileSessionEntry): string {
  if (!result?.message) return '';
  const content = result.message.content;
  if (typeof content === 'string') return content;
  return contentBlocks(content)
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');
}

function ToolDisclosure({ call, result }: { call: MessageBlock; result?: MobileSessionEntry }) {
  const [expanded, setExpanded] = useState(false);
  const name = call.name || 'tool';
  const output = toolResultText(result);
  const label = formatToolCall(name, call.arguments || {});
  const status = result ? (result.message?.isError ? 'Error' : 'Done') : 'Running';

  return (
    <section className={`mobile-tool-call${result?.message?.isError ? ' is-error' : ''}`}>
      <button
        type="button"
        className="mobile-disclosure-button"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name} tool details`}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>
          <strong>{label}</strong>
          <small>{status}</small>
        </span>
        <ChevronDown aria-hidden="true" size={17} />
      </button>
      {expanded && (
        <div className="mobile-tool-details">
          <pre>{JSON.stringify(call.arguments || {}, null, 2)}</pre>
          {output && <pre className="mobile-tool-output">{output}</pre>}
        </div>
      )}
    </section>
  );
}

function ThinkingDisclosure({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="mobile-thinking-block">
      <button
        type="button"
        className="mobile-disclosure-button"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} assistant thinking`}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>
          <strong>Thinking</strong>
          <small>{expanded ? 'Hide reasoning' : 'Show reasoning'}</small>
        </span>
        <ChevronDown aria-hidden="true" size={17} />
      </button>
      {expanded && <p>{text}</p>}
    </section>
  );
}

function ConversationEntry({
  entry,
  toolResults,
}: {
  entry: MobileSessionEntry;
  toolResults: Map<string, MobileSessionEntry>;
}) {
  const message = entry.message;
  const timestamp = entryTimestamp(entry.timestamp);
  if (entry.type === 'message' && message?.role === 'user') {
    const blocks = contentBlocks(message.content);
    const text = textContent(message.content);
    const images = blocks.filter((block) => block.type === 'image' && block.data);
    return (
      <article className="mobile-message mobile-user-message" data-message-role="user">
        {images.length > 0 && (
          <div className="mobile-message-images">
            {images.map((image, index) => (
              <img
                key={`${entry.id || 'user'}:${index}`}
                src={`data:${image.mimeType || 'image/png'};base64,${image.data}`}
                alt="User attachment"
              />
            ))}
          </div>
        )}
        {text && <MobileMarkdown text={text} />}
        {timestamp && <time>{timestamp}</time>}
      </article>
    );
  }

  if (entry.type === 'message' && message?.role === 'assistant') {
    const blocks = contentBlocks(message.content);
    return (
      <article className="mobile-message mobile-assistant-message" data-message-role="assistant">
        <div className="mobile-message-role">Assistant</div>
        {blocks.map((block, index) => {
          if (block.type === 'text' && block.text?.trim()) {
            return (
              <MobileMarkdown key={`${entry.id || 'assistant'}:text:${index}`} text={block.text} />
            );
          }
          if (block.type === 'thinking' && block.thinking?.trim()) {
            return (
              <ThinkingDisclosure
                key={`${entry.id || 'assistant'}:thinking:${index}`}
                text={block.thinking}
              />
            );
          }
          if (block.type === 'toolCall') {
            return (
              <ToolDisclosure
                key={block.id || `${entry.id || 'assistant'}:tool:${index}`}
                call={block}
                result={block.id ? toolResults.get(block.id) : undefined}
              />
            );
          }
          return null;
        })}
        {message.stopReason === 'aborted' && (
          <p className="mobile-inline-error">Response cancelled.</p>
        )}
        {message.stopReason === 'error' && (
          <p className="mobile-inline-error">{message.errorMessage || 'The response failed.'}</p>
        )}
        {timestamp && <time>{timestamp}</time>}
      </article>
    );
  }

  if (entry.type === 'message' && message?.role === 'bashExecution') {
    return (
      <ToolDisclosure
        call={{ type: 'toolCall', name: 'bash', arguments: { command: message.command || '' } }}
        result={{
          ...entry,
          message: {
            role: 'toolResult',
            isError: message.cancelled || (message.exitCode != null && message.exitCode !== 0),
            content: [{ type: 'text', text: message.output || '' }],
          },
        }}
      />
    );
  }

  if (entry.type === 'model_change' && !entry.implicit) {
    return (
      <p className="mobile-conversation-event">
        Model changed to {entry.provider}/{entry.modelId}
      </p>
    );
  }

  if (entry.type === 'thinking_level_change') {
    return <p className="mobile-conversation-event">Thinking changed to {entry.thinkingLevel}</p>;
  }

  if (entry.type === 'compaction') {
    return (
      <details className="mobile-conversation-note">
        <summary>Earlier context compacted</summary>
        <p>
          {entry.summary || `Compacted from ${(entry.tokensBefore || 0).toLocaleString()} tokens.`}
        </p>
      </details>
    );
  }

  if (entry.type === 'branch_summary' && entry.summary) {
    return (
      <section className="mobile-conversation-note">
        <strong>Branch summary</strong>
        <MobileMarkdown text={entry.summary} />
      </section>
    );
  }

  if (entry.type === 'custom_message' && entry.display) {
    return (
      <section className="mobile-conversation-note">
        <strong>{entry.customType || 'Update'}</strong>
        <MobileMarkdown
          text={typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content)}
        />
      </section>
    );
  }

  return null;
}

interface RuntimeSheetProps {
  client: PiWebClient;
  sessionId: string;
  currentProvider: string;
  currentModel: string;
  currentThinking: ThinkingLevel;
  onClose: () => void;
  onSaved: (provider: string, model: string, thinking: ThinkingLevel) => void;
}

function RuntimeSheet({
  client,
  sessionId,
  currentProvider,
  currentModel,
  currentThinking,
  onClose,
  onSaved,
}: RuntimeSheetProps) {
  const [models, setModels] = useState<PiModel[]>([]);
  const [provider, setProvider] = useState(currentProvider);
  const [model, setModel] = useState(currentModel);
  const [thinking, setThinking] = useState(currentThinking);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    client
      .listModels()
      .then((result) => {
        if (!active) return;
        setModels(result.models);
        if ((!provider || !model) && result.models[0]) {
          setProvider(result.models[0].provider);
          setModel(result.models[0].id);
        }
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError, 'Could not load models.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client]);

  const selectedKey = `${provider}/${model}`;
  const options = useMemo(() => {
    if (models.some((item) => `${item.provider}/${item.id}` === selectedKey)) return models;
    if (!provider || !model) return models;
    return [{ provider, id: model, name: model }, ...models];
  }, [model, models, provider, selectedKey]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!provider || !model) return;
    setSaving(true);
    setError('');
    try {
      if (provider !== currentProvider || model !== currentModel) {
        await client.setModel(sessionId, provider, model);
      }
      if (thinking !== currentThinking) await client.setThinkingLevel(sessionId, thinking);
      onSaved(provider, model, thinking);
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError, 'Could not update session settings.'));
      setSaving(false);
    }
  };

  return (
    <div className="mobile-sheet-backdrop" role="presentation">
      <section
        className="mobile-bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="runtime-sheet-title"
      >
        <header>
          <div>
            <p className="mobile-eyebrow">Session runtime</p>
            <h2 id="runtime-sheet-title">Model and thinking</h2>
          </div>
          <button
            type="button"
            className="mobile-icon-button"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <form onSubmit={save}>
          <label htmlFor="mobile-session-model">Account / provider and model</label>
          <select
            id="mobile-session-model"
            value={selectedKey}
            disabled={loading || saving}
            onChange={(event) => {
              const selected = models.find(
                (item) => `${item.provider}/${item.id}` === event.currentTarget.value,
              );
              if (!selected) return;
              setProvider(selected.provider);
              setModel(selected.id);
            }}
          >
            {options.map((item) => (
              <option key={`${item.provider}/${item.id}`} value={`${item.provider}/${item.id}`}>
                {item.provider} · {item.name || item.id}
              </option>
            ))}
          </select>
          <label htmlFor="mobile-session-thinking">Thinking level</label>
          <select
            id="mobile-session-thinking"
            value={thinking}
            disabled={loading || saving}
            onChange={(event) => setThinking(event.currentTarget.value as ThinkingLevel)}
          >
            {THINKING_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
          {error && (
            <p className="mobile-form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="mobile-primary-button mobile-wide-button"
            type="submit"
            disabled={loading || saving}
          >
            {saving ? 'Updating…' : 'Update session'}
          </button>
        </form>
      </section>
    </div>
  );
}

export function ConversationScreen({ client, sessionId, internalLink }: ConversationScreenProps) {
  const host = useMemo(() => client.getHostContext(), [client]);
  const [details, setDetails] = useState<SessionDetails | null>(null);
  const detailsRef = useRef<SessionDetails | null>(null);
  const [workerStatus, setWorkerStatus] = useState<ChatWorkerStatus>({ state: 'idle' });
  const [preview, setPreview] = useState('');
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const [composerError, setComposerError] = useState('');
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [runtimeProvider, setRuntimeProvider] = useState('');
  const [runtimeModel, setRuntimeModel] = useState('');
  const [runtimeThinking, setRuntimeThinking] = useState<ThinkingLevel>('off');
  const feedRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const didInitialScroll = useRef(false);

  useEffect(() => {
    detailsRef.current = details;
  }, [details]);

  const refreshSession = useCallback(async () => {
    if (!sessionId) return;
    const current = detailsRef.current;
    const result =
      current && current.from > 0
        ? await client.getSession(sessionId, {
            from: current.from,
            count: Math.max(current.total - current.from + 50, OLDER_ENTRY_PAGE),
          })
        : await client.getSession(sessionId, { paginate: true });
    setDetails(result);
    setRuntimeProvider(result.modelProvider || '');
    setRuntimeModel(result.model || '');
    setPendingPrompt('');
  }, [client, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setError(t('session.missingId'));
      setLoading(false);
      return;
    }
    let active = true;
    const bootstrap = readSessionBootstrap() as SessionBootstrap | null;
    const initial =
      bootstrap?.id === sessionId && bootstrap.data
        ? Promise.resolve(bootstrap.data)
        : client.getSession(sessionId, { paginate: true });
    initial
      .then((result) => {
        if (!active) return;
        setDetails(result);
        setRuntimeProvider(result.modelProvider || '');
        setRuntimeModel(result.model || '');
        document.title = `${result.name || sessionId} · ${host.instanceName} · pi-web`;
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError, t('session.loadFailed')));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    void client
      .getWorkerStatus(sessionId)
      .then((status) => {
        if (!active) return;
        setWorkerStatus(status);
        if (status.modelProvider) setRuntimeProvider(status.modelProvider);
        if (status.model) setRuntimeModel(status.model);
        if (status.thinkingLevel) setRuntimeThinking(status.thinkingLevel);
      })
      .catch(() => {});

    const subscription = client.subscribe(sessionId, {
      onEvent(name, payload) {
        if (!active) return;
        if (name === 'reload') {
          void refreshSession().catch((refreshError) =>
            setComposerError(errorMessage(refreshError, t('session.loadFailed'))),
          );
          setPreview('');
        } else if (name === 'chat-preview') {
          const stream = payload as { content?: unknown; done?: unknown };
          setPreview(typeof stream.content === 'string' && !stream.done ? stream.content : '');
          if (stream.done) void refreshSession().catch(() => {});
        } else if (name === 'status-snapshot') {
          const snapshot = payload as StatusSnapshot;
          setWorkerStatus((current) => ({
            ...current,
            state: snapshot.running.includes(sessionId) ? 'running' : 'idle',
          }));
        } else if (name === 'status-delta') {
          const status = payload as SessionStatus;
          if (status.id !== sessionId) return;
          setWorkerStatus((current) => ({
            ...current,
            state: status.running ? 'running' : 'idle',
            model: status.model || current.model,
            modelName: status.modelName || current.modelName,
            modelProvider: status.modelProvider || current.modelProvider,
          }));
          if (status.modelProvider) setRuntimeProvider(status.modelProvider);
          if (status.model) setRuntimeModel(status.model);
        }
      },
    });

    return () => {
      active = false;
      subscription.close();
    };
  }, [client, host.instanceName, refreshSession, sessionId]);

  const entries = useMemo(
    () => activeConversationEntries(details?.entries || []),
    [details?.entries],
  );
  const toolResults = useMemo(() => {
    const results = new Map<string, MobileSessionEntry>();
    for (const entry of details?.entries || []) {
      const mobileEntry = entry as MobileSessionEntry;
      if (
        mobileEntry.type === 'message' &&
        mobileEntry.message?.role === 'toolResult' &&
        mobileEntry.message.toolCallId
      ) {
        results.set(mobileEntry.message.toolCallId, mobileEntry);
      }
    }
    return results;
  }, [details?.entries]);

  useLayoutEffect(() => {
    if (!details || didInitialScroll.current) return;
    didInitialScroll.current = true;
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
  }, [details]);

  useEffect(() => {
    if (!preview) return;
    const feed = feedRef.current;
    if (!feed) return;
    const distance = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    if (distance < 160)
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
  }, [preview]);

  const loadOlder = async () => {
    if (!details || details.from <= 0 || loadingOlder) return;
    const feed = feedRef.current;
    const previousHeight = feed?.scrollHeight || 0;
    const start = Math.max(0, details.from - OLDER_ENTRY_PAGE);
    setLoadingOlder(true);
    try {
      const older = await client.getSession(sessionId, {
        from: start,
        count: details.from - start,
      });
      setDetails((current) =>
        current
          ? {
              ...current,
              entries: [...older.entries, ...current.entries],
              from: older.from,
              total: Math.max(current.total, older.total),
            }
          : current,
      );
      requestAnimationFrame(() => {
        if (feed) feed.scrollTop += feed.scrollHeight - previousHeight;
      });
    } catch (loadError) {
      setComposerError(errorMessage(loadError, 'Could not load older messages.'));
    } finally {
      setLoadingOlder(false);
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if ((!message && attachments.length === 0) || sending || workerStatus.state === 'running')
      return;
    setSending(true);
    setComposerError('');
    setPendingPrompt(message);
    try {
      await client.sendChat(sessionId, { message, images: attachments });
      setDraft('');
      setAttachments([]);
      setWorkerStatus((current) => ({ ...current, state: 'running' }));
      setFocused(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
    } catch (sendError) {
      setPendingPrompt('');
      setComposerError(errorMessage(sendError, 'Could not send message.'));
    } finally {
      setSending(false);
    }
  };

  const cancel = async () => {
    setComposerError('');
    try {
      await client.cancelChat(sessionId);
      setWorkerStatus((current) => ({ ...current, state: 'idle' }));
      setPreview('');
    } catch (cancelError) {
      setComposerError(errorMessage(cancelError, 'Could not cancel the response.'));
    }
  };

  const addAttachments = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files || []).filter((file) =>
      file.type.startsWith('image/'),
    );
    setAttachments((current) => [...current, ...selected].slice(0, 6));
    event.currentTarget.value = '';
  };

  const expandedComposer =
    focused || draft.includes('\n') || draft.length > 80 || attachments.length > 0;
  const chatAvailable = details?.chatAvailable ?? false;
  const disabledReason = details?.chatDisabledReason || t('composer.disabledNotice');
  const cwd = typeof details?.header?.cwd === 'string' ? details.header.cwd : '';
  const project =
    cwd
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1) || host.instanceName;
  const runtimeLabel =
    runtimeModel || workerStatus.modelName || workerStatus.model || details?.model || 'Model';

  if (loading) {
    return (
      <main className="mobile-screen mobile-centered-screen" data-mobile-route="session">
        <p role="status" className="mobile-loading-state">
          <LoaderCircle aria-hidden="true" size={20} />
          {t('session.loading')}
        </p>
      </main>
    );
  }

  if (error || !details) {
    return (
      <main className="mobile-screen mobile-centered-screen" data-mobile-route="session">
        <div className="mobile-empty-state" role="alert">
          <h1>{error || t('session.loadFailed')}</h1>
          {internalLink('/', t('session.backToSessions'), 'mobile-primary-link')}
        </div>
      </main>
    );
  }

  return (
    <main className="mobile-screen mobile-session-screen" data-mobile-route="session">
      <header className="mobile-conversation-header">
        {internalLink(
          '/',
          <>
            <ArrowLeft aria-hidden="true" size={21} />
            <span className="mobile-visually-hidden">{t('session.backToSessions')}</span>
          </>,
          'mobile-icon-button',
        )}
        <div className="mobile-conversation-title">
          <h1>{details.name || sessionId}</h1>
          <p>
            {project} · {host.instanceName}
          </p>
        </div>
        <button
          type="button"
          className="mobile-icon-button"
          aria-label="Session model and thinking settings"
          onClick={() => setRuntimeOpen(true)}
        >
          <Settings2 aria-hidden="true" size={20} />
        </button>
      </header>

      <div
        className="mobile-conversation-feed"
        ref={feedRef}
        aria-label="Conversation messages"
        tabIndex={0}
      >
        {details.from > 0 && (
          <button
            type="button"
            className="mobile-load-older"
            onClick={() => void loadOlder()}
            disabled={loadingOlder}
          >
            {loadingOlder ? 'Loading older messages…' : 'Load older messages'}
          </button>
        )}
        {entries.length === 0 && !pendingPrompt && (
          <div className="mobile-empty-conversation">
            <p className="mobile-eyebrow">New session</p>
            <h2>What should pi work on?</h2>
            <p>Send a task below to begin in {project}.</p>
          </div>
        )}
        {entries.map((entry, index) => (
          <ConversationEntry
            key={entry.id || `entry:${index}`}
            entry={entry}
            toolResults={toolResults}
          />
        ))}
        {pendingPrompt && (
          <article
            className="mobile-message mobile-user-message is-pending"
            data-message-role="user"
          >
            <p>
              {pendingPrompt ||
                `${attachments.length} image attachment${attachments.length === 1 ? '' : 's'}`}
            </p>
            <small>Sending</small>
          </article>
        )}
        {preview && (
          <article
            className="mobile-message mobile-assistant-message is-preview"
            aria-live="polite"
          >
            <div className="mobile-message-role">Assistant · working</div>
            <p>{preview}</p>
          </article>
        )}
        <div ref={endRef} className="mobile-feed-end" />
      </div>

      <form
        className={`mobile-composer${expandedComposer ? ' is-expanded' : ''}`}
        data-collapsed-height="64"
        data-expanded-height="156"
        onSubmit={sendMessage}
      >
        {composerError && (
          <p className="mobile-composer-error" role="alert">
            {composerError}
          </p>
        )}
        {!chatAvailable && (
          <p className="mobile-readonly-reason" role="status">
            {disabledReason}
          </p>
        )}
        {attachments.length > 0 && (
          <div className="mobile-attachment-strip" aria-label="Image attachments">
            {attachments.map((file, index) => (
              <span key={`${file.name}:${file.size}:${index}`}>
                <ImagePlus aria-hidden="true" size={15} />
                <span>{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <X aria-hidden="true" size={15} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mobile-composer-chrome">
          <textarea
            aria-label="Message"
            placeholder={chatAvailable ? t('composer.placeholder') : disabledReason}
            value={draft}
            disabled={!chatAvailable || workerStatus.state === 'running'}
            rows={1}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <div className="mobile-composer-controls">
            <div className="mobile-composer-context">
              <button
                type="button"
                className="mobile-composer-icon"
                aria-label="Attach images"
                disabled={!chatAvailable || workerStatus.state === 'running'}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus aria-hidden="true" size={19} />
              </button>
              <input
                ref={fileInputRef}
                className="mobile-file-input"
                type="file"
                accept="image/*"
                multiple
                aria-label="Choose image attachments"
                onChange={addAttachments}
              />
              <button
                type="button"
                className="mobile-runtime-pill"
                aria-label={`Model ${runtimeLabel}. Open model and thinking settings`}
                onClick={() => setRuntimeOpen(true)}
              >
                <span className={`mobile-status-dot is-${workerStatus.state}`} />
                <span>{runtimeLabel}</span>
                <ChevronDown aria-hidden="true" size={14} />
              </button>
            </div>
            {workerStatus.state === 'running' ? (
              <button
                type="button"
                className="mobile-cancel-button"
                aria-label={t('composer.cancelRunning')}
                onClick={() => void cancel()}
              >
                <Square aria-hidden="true" size={16} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                className="mobile-send-button"
                aria-label={t('composer.send')}
                disabled={!chatAvailable || sending || (!draft.trim() && attachments.length === 0)}
              >
                <Send aria-hidden="true" size={18} />
              </button>
            )}
          </div>
        </div>
      </form>

      {runtimeOpen && (
        <RuntimeSheet
          client={client}
          sessionId={sessionId}
          currentProvider={runtimeProvider || details.modelProvider}
          currentModel={runtimeModel || details.model}
          currentThinking={runtimeThinking}
          onClose={() => setRuntimeOpen(false)}
          onSaved={(provider, model, thinking) => {
            setRuntimeProvider(provider);
            setRuntimeModel(model);
            setRuntimeThinking(thinking);
          }}
        />
      )}
    </main>
  );
}
