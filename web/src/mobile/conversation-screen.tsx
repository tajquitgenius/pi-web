import { marked } from 'marked';
import {
  ArrowLeft,
  ChevronDown,
  FileSearch,
  ImagePlus,
  LoaderCircle,
  MoreHorizontal,
  Send,
  Square,
  Wrench,
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
import { readSessionBootstrap } from '../live-shared';
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
import { configureSessionMarkdown, safeMarkedParse } from '../session/render/markdown.js';
import { escapeHtml, formatToolCall } from '../session/render/session-format.js';
import { getPath, stitchOrphanRoots } from '../session/tree/session-tree.js';
import { getMobileCapability, type MobileCommand, type MobileFile } from './capabilities';
import { MobileConnectivityNotice, type MobileConnectionState } from './connectivity';
import { InspectorSheet } from './inspector-sheet';
import { ThreadActionsSheet } from './thread-actions-sheet';
import { useMobileDialog } from './dialog';
import { t } from '../shared/i18n.js';

const OLDER_ENTRY_PAGE = 100;
const INITIAL_RELOAD_GRACE_MS = 250;
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
  const name = call.name || t('conversation.tool');
  const output = toolResultText(result);
  const label = formatToolCall(name, call.arguments || {});
  const status = result
    ? result.message?.isError
      ? t('conversation.error')
      : t('conversation.done')
    : t('conversation.running');

  return (
    <section className={`mobile-tool-call${result?.message?.isError ? ' is-error' : ''}`}>
      <button
        type="button"
        className="mobile-disclosure-button"
        aria-expanded={expanded}
        aria-label={t('conversation.toolDetails', {
          action: expanded ? t('conversation.collapse') : t('conversation.expand'),
          name,
        })}
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
        aria-label={`${expanded ? t('conversation.collapse') : t('conversation.expand')} ${t('conversation.thinking').toLowerCase()}`}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>
          <strong>{t('conversation.thinking')}</strong>
          <small>
            {expanded ? t('conversation.hideReasoning') : t('conversation.showReasoning')}
          </small>
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
                alt={t('conversation.userAttachment')}
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
        <div className="mobile-message-role">{t('conversation.assistant')}</div>
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
          <p className="mobile-inline-error">{t('conversation.responseCancelled')}</p>
        )}
        {message.stopReason === 'error' && (
          <p className="mobile-inline-error">
            {message.errorMessage || t('conversation.responseFailed')}
          </p>
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
        {t('conversation.modelChanged', { model: `${entry.provider}/${entry.modelId}` })}
      </p>
    );
  }

  if (entry.type === 'thinking_level_change') {
    return (
      <p className="mobile-conversation-event">
        {t('conversation.thinkingChanged', { level: entry.thinkingLevel })}
      </p>
    );
  }

  if (entry.type === 'compaction') {
    return (
      <details className="mobile-conversation-note">
        <summary>{t('conversation.compacted')}</summary>
        <p>
          {entry.summary || `Compacted from ${(entry.tokensBefore || 0).toLocaleString()} tokens.`}
        </p>
      </details>
    );
  }

  if (entry.type === 'branch_summary' && entry.summary) {
    return (
      <section className="mobile-conversation-note">
        <strong>{t('conversation.branchSummary')}</strong>
        <MobileMarkdown text={entry.summary} />
      </section>
    );
  }

  if (entry.type === 'custom_message' && entry.display) {
    return (
      <section className="mobile-conversation-note">
        <strong>{entry.customType || t('conversation.update')}</strong>
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
  const dialogRef = useRef<HTMLElement | null>(null);
  useMobileDialog(dialogRef, onClose);

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
        if (active) setError(errorMessage(loadError, t('conversation.loadModelsFailed')));
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
      setError(errorMessage(saveError, t('conversation.updateRuntimeFailed')));
      setSaving(false);
    }
  };

  return (
    <div
      className="mobile-sheet-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="mobile-bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="runtime-sheet-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="mobile-eyebrow">{t('conversation.runtime')}</p>
            <h2 id="runtime-sheet-title">{t('conversation.modelAndThinking')}</h2>
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
          <label htmlFor="mobile-session-model">{t('conversation.providerModel')}</label>
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
          <label htmlFor="mobile-session-thinking">{t('conversation.thinkingLevel')}</label>
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
            {saving ? t('conversation.updating') : t('conversation.updateSession')}
          </button>
        </form>
      </section>
    </div>
  );
}

interface ToolsSheetProps {
  attachDisabled: boolean;
  onAttach: () => void;
  onInspector: () => void;
  onActions: () => void;
  onClose: () => void;
}

function ToolsSheet({
  attachDisabled,
  onAttach,
  onInspector,
  onActions,
  onClose,
}: ToolsSheetProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useMobileDialog(dialogRef, onClose);

  return (
    <div
      className="mobile-sheet-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="mobile-bottom-sheet mobile-tools-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-tools-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="mobile-eyebrow">{t('conversation.tools')}</p>
            <h2 id="mobile-tools-title">{t('conversation.tools')}</h2>
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
        <div className="mobile-tools-list">
          <button type="button" onClick={onAttach} disabled={attachDisabled}>
            <ImagePlus aria-hidden="true" size={19} />
            <span>{t('conversation.attachImages')}</span>
          </button>
          <button type="button" onClick={onInspector}>
            <FileSearch aria-hidden="true" size={19} />
            <span>{t('conversation.projectInspector')}</span>
          </button>
          <button type="button" onClick={onActions}>
            <MoreHorizontal aria-hidden="true" size={19} />
            <span>{t('conversation.threadActions')}</span>
          </button>
        </div>
      </section>
    </div>
  );
}

export function ConversationScreen({ client, sessionId, internalLink }: ConversationScreenProps) {
  const host = useMemo(() => client.getHostContext(), [client]);
  const bootstrapRef = useRef<ReturnType<typeof readSessionBootstrap> | undefined>(undefined);
  if (bootstrapRef.current === undefined) bootstrapRef.current = readSessionBootstrap();
  const bootstrap = bootstrapRef.current;
  const embeddedDetails = bootstrap?.id === sessionId ? bootstrap.data : null;
  const [details, setDetails] = useState<SessionDetails | null>(embeddedDetails);
  const detailsRef = useRef<SessionDetails | null>(embeddedDetails);
  const [workerStatus, setWorkerStatus] = useState<ChatWorkerStatus>({ state: 'idle' });
  const [preview, setPreview] = useState('');
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [palette, setPalette] = useState<'files' | 'commands' | null>(null);
  const [paletteFiles, setPaletteFiles] = useState<MobileFile[]>([]);
  const [paletteCommands, setPaletteCommands] = useState<MobileCommand[]>([]);
  const [paletteLoading, setPaletteLoading] = useState(false);
  const [paletteError, setPaletteError] = useState('');
  const [paletteRetry, setPaletteRetry] = useState(0);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(embeddedDetails === null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<MobileConnectionState>('connecting');
  const [composerError, setComposerError] = useState('');
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [toolsSheet, setToolsSheet] = useState<'menu' | 'inspector' | 'actions' | null>(null);
  const [runtimeProvider, setRuntimeProvider] = useState(embeddedDetails?.modelProvider || '');
  const [runtimeModel, setRuntimeModel] = useState(embeddedDetails?.model || '');
  const [runtimeThinking, setRuntimeThinking] = useState<ThinkingLevel>(
    embeddedDetails?.thinkingLevel || 'off',
  );
  const feedRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolsTriggerRef = useRef<HTMLButtonElement>(null);
  const didInitialScroll = useRef(false);
  const startupReloadRef = useRef(
    embeddedDetails === null
      ? null
      : { deadline: Date.now() + INITIAL_RELOAD_GRACE_MS, handled: false, opened: false },
  );
  const streamStateRef = useRef({ opened: false, reconnectPending: false });

  useEffect(() => {
    detailsRef.current = details;
  }, [details]);

  const refreshSession = useCallback(async () => {
    if (!sessionId) return;
    setConnection('connecting');
    setError('');
    const current = detailsRef.current;
    const result =
      current && current.from > 0
        ? await client.getSession(sessionId, {
            from: current.from,
            count: Math.max(current.total - current.from + 50, OLDER_ENTRY_PAGE),
          })
        : await client.getSession(sessionId, { paginate: true });
    setDetails(result);
    setConnection('connected');
    setRuntimeProvider(result.modelProvider || '');
    setRuntimeModel(result.model || '');
    if (result.thinkingLevel) setRuntimeThinking(result.thinkingLevel);
    setPendingPrompt('');
  }, [client, sessionId]);

  const retrySession = () => {
    void refreshSession().catch((refreshError) => {
      setConnection('offline');
      setError(errorMessage(refreshError, t('session.loadFailed')));
    });
  };

  useEffect(() => {
    if (!sessionId) {
      setError(t('session.missingId'));
      setLoading(false);
      return;
    }
    let active = true;
    const initial =
      bootstrap?.id === sessionId && bootstrap.data
        ? Promise.resolve(bootstrap.data)
        : client.getSession(sessionId, { paginate: true });
    initial
      .then((result) => {
        if (!active) return;
        setDetails(result);
        setConnection('connected');
        setRuntimeProvider(result.modelProvider || '');
        setRuntimeModel(result.model || '');
        if (result.thinkingLevel) setRuntimeThinking(result.thinkingLevel);
        document.title = `${result.name || sessionId} · ${host.instanceName} · pi-web`;
      })
      .catch((loadError) => {
        if (active) {
          setConnection('offline');
          setError(errorMessage(loadError, t('session.loadFailed')));
        }
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
      .catch((statusError) => {
        if (!active) return;
        setWorkerStatus({
          state: 'error',
          error: errorMessage(statusError, 'Pi worker status is unavailable.'),
        });
      });

    const subscription = client.subscribe(sessionId, {
      onEvent(name, payload) {
        if (!active) return;
        if (name === 'reload') {
          const startup = startupReloadRef.current;
          if (startup && !startup.handled && (!startup.opened || Date.now() < startup.deadline)) {
            startup.handled = true;
            setPreview('');
            return;
          }
          if (startup) startup.handled = true;
          void refreshSession().catch((refreshError) => {
            setConnection('reconnecting');
            setComposerError(errorMessage(refreshError, t('session.loadFailed')));
          });
          setPreview('');
        } else if (name === 'chat-preview') {
          const stream = payload as { content?: unknown; done?: unknown };
          setPreview(typeof stream.content === 'string' && !stream.done ? stream.content : '');
          if (stream.done) {
            setWorkerStatus((current) => ({ ...current, state: 'idle' }));
            void refreshSession().catch(() => {});
          }
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
      onOpen() {
        if (!active) return;
        const reopened = streamStateRef.current.opened && streamStateRef.current.reconnectPending;
        streamStateRef.current.opened = true;
        streamStateRef.current.reconnectPending = false;
        if (startupReloadRef.current) startupReloadRef.current.opened = true;
        setConnection('connected');
        if (reopened) {
          void refreshSession().catch((refreshError) => {
            setConnection('reconnecting');
            setComposerError(errorMessage(refreshError, t('session.loadFailed')));
          });
        }
      },
      onError() {
        if (!active) return;
        if (streamStateRef.current.opened) streamStateRef.current.reconnectPending = true;
        setConnection('reconnecting');
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

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [draft]);

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
      setComposerError(errorMessage(loadError, t('conversation.loadOlderFailed')));
    } finally {
      setLoadingOlder(false);
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if ((!message && attachments.length === 0) || sending) return;
    setSending(true);
    setComposerError('');
    setPendingPrompt(message);
    try {
      await client.sendChat(sessionId, { message, images: attachments });
      setDraft('');
      setAttachments([]);
      setWorkerStatus((current) => ({ ...current, state: 'running' }));
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
    } catch (sendError) {
      setPendingPrompt('');
      setComposerError(errorMessage(sendError, t('conversation.sendFailed')));
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
      setComposerError(errorMessage(cancelError, t('conversation.cancelFailed')));
    }
  };

  const addAttachments = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files || []).filter((file) =>
      file.type.startsWith('image/'),
    );
    setAttachments((current) => [...current, ...selected].slice(0, 6));
    event.currentTarget.value = '';
  };

  const listFiles = getMobileCapability(client, 'listFiles');
  const getCommands = getMobileCapability(client, 'getCommands');

  useEffect(() => {
    const token = draft.split(/\s/).at(-1) || '';
    const type = token.startsWith('@') ? 'files' : token.startsWith('/') ? 'commands' : null;
    if (!type || (type === 'files' && !listFiles) || (type === 'commands' && !getCommands)) {
      setPalette(null);
      setPaletteError('');
      return;
    }
    let active = true;
    setPalette(type);
    setPaletteError('');
    setPaletteLoading(true);
    const search = token.slice(1);
    const request =
      type === 'files'
        ? listFiles?.call(client, sessionId, search || undefined)
        : getCommands?.call(client, sessionId);
    Promise.resolve(request)
      .then((result) => {
        if (!active) return;
        if (type === 'files') {
          const values = (result as { files?: unknown } | undefined)?.files;
          setPaletteFiles(
            Array.isArray(values)
              ? values
                  .map((file): MobileFile | null => {
                    if (typeof file === 'string') return { path: file };
                    if (!file || typeof file !== 'object') return null;
                    const value = file as MobileFile;
                    return typeof value.path === 'string'
                      ? { ...value, kind: value.isDir ? 'directory' : value.kind }
                      : null;
                  })
                  .filter((file): file is MobileFile => file !== null)
              : [],
          );
        } else {
          const values = (result as { commands?: unknown } | undefined)?.commands;
          setPaletteCommands(
            Array.isArray(values)
              ? values
                  .map((command): MobileCommand | null => {
                    if (typeof command === 'string') return { name: command, command };
                    if (!command || typeof command !== 'object') return null;
                    const value = command as MobileCommand;
                    const name = value.name || value.command;
                    return name ? { ...value, name } : null;
                  })
                  .filter((command): command is MobileCommand => command !== null)
              : [],
          );
        }
      })
      .catch(() => {
        if (!active) return;
        setPaletteFiles([]);
        setPaletteCommands([]);
        setPaletteError(
          type === 'files'
            ? t('conversation.fileSuggestionsLoadFailed')
            : t('conversation.commandSuggestionsLoadFailed'),
        );
      })
      .finally(() => {
        if (active) setPaletteLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, draft, getCommands, listFiles, paletteRetry, sessionId]);

  const chatAvailable = details?.chatAvailable ?? false;
  const disabledReason = details?.chatDisabledReason || t('composer.disabledNotice');
  const cwd = typeof details?.header?.cwd === 'string' ? details.header.cwd : '';
  const project =
    cwd
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1) || host.instanceName;
  const runtimeProviderLabel =
    runtimeProvider ||
    workerStatus.modelProvider ||
    details?.modelProvider ||
    t('conversation.provider');
  const runtimeModelLabel =
    runtimeModel ||
    workerStatus.modelName ||
    workerStatus.model ||
    details?.model ||
    t('conversation.model');
  const runtimeStateLabel =
    workerStatus.state === 'running'
      ? t('conversation.runtimeWorking')
      : workerStatus.state === 'error'
        ? workerStatus.error
          ? t('conversation.runtimeUnavailable', { error: workerStatus.error })
          : t('conversation.runtimeUnavailableWithoutError')
        : t('conversation.runtimeReady');
  const closeToolSheet = () => {
    setToolsSheet(null);
    requestAnimationFrame(() => toolsTriggerRef.current?.focus());
  };

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
          <MobileConnectivityNotice state={connection} onRetry={retrySession} />
          <h1>{error || t('session.loadFailed')}</h1>
          {internalLink('/', t('session.backToSessions'), 'mobile-primary-link')}
        </div>
      </main>
    );
  }

  return (
    <main className="mobile-screen mobile-session-screen" data-mobile-route="session">
      <header className="mobile-conversation-header">
        <div className="mobile-conversation-header-main">
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
            <span className={`mobile-runtime-state is-${workerStatus.state}`} role="status">
              {runtimeStateLabel}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="mobile-runtime-picker"
          aria-label={t('conversation.openRuntime')}
          onClick={() => setRuntimeOpen(true)}
        >
          <span className="mobile-runtime-picker-model">
            {runtimeProviderLabel} · {runtimeModelLabel}
          </span>
          <span className="mobile-runtime-picker-thinking">{runtimeThinking}</span>
          <ChevronDown aria-hidden="true" size={17} />
        </button>
      </header>
      <MobileConnectivityNotice state={connection} onRetry={retrySession} />

      <div
        className="mobile-conversation-feed"
        ref={feedRef}
        aria-label={t('conversation.messages')}
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
            <p className="mobile-eyebrow">{t('conversation.newSession')}</p>
            <h2>{t('conversation.emptyTitle')}</h2>
            <p>{t('conversation.emptyHint', { project })}</p>
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
            <small>{t('conversation.sending')}</small>
          </article>
        )}
        {preview && (
          <article
            className="mobile-message mobile-assistant-message is-preview"
            aria-live="polite"
          >
            <div className="mobile-message-role">{t('conversation.assistantWorking')}</div>
            <p>{preview}</p>
          </article>
        )}
        <div ref={endRef} className="mobile-feed-end" />
      </div>

      <form className="mobile-composer" onSubmit={sendMessage}>
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
          <div className="mobile-attachment-strip" aria-label={t('conversation.imageAttachments')}>
            {attachments.map((file, index) => (
              <span key={`${file.name}:${file.size}:${index}`}>
                <ImagePlus aria-hidden="true" size={15} />
                <span>{file.name}</span>
                <button
                  type="button"
                  aria-label={t('conversation.removeAttachment', { name: file.name })}
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
        {palette && (
          <div
            className="mobile-composer-palette"
            role="listbox"
            aria-label={
              palette === 'files'
                ? t('conversation.fileSuggestions')
                : t('conversation.commandSuggestions')
            }
          >
            {paletteLoading && (
              <span className="mobile-palette-status">{t('conversation.loading')}</span>
            )}
            {!paletteLoading && paletteError && (
              <span className="mobile-palette-status" role="alert">
                {paletteError}
                <button type="button" onClick={() => setPaletteRetry((value) => value + 1)}>
                  {t('common.retry')}
                </button>
              </span>
            )}
            {!paletteLoading &&
              !paletteError &&
              palette === 'files' &&
              paletteFiles.length === 0 && (
                <span className="mobile-palette-status">{t('conversation.noFiles')}</span>
              )}
            {!paletteLoading &&
              !paletteError &&
              palette === 'commands' &&
              paletteCommands.length === 0 && (
                <span className="mobile-palette-status">{t('conversation.noCommands')}</span>
              )}
            {palette === 'files' &&
              paletteFiles.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  role="option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    const token = draft.split(/\s/).at(-1) || '';
                    setDraft(`${draft.slice(0, -token.length)}@${file.path} `);
                    setPalette(null);
                  }}
                >
                  <span>{file.path}</span>
                  <small>
                    {file.kind === 'directory' ? t('conversation.folder') : t('conversation.file')}
                  </small>
                </button>
              ))}
            {palette === 'commands' &&
              paletteCommands.map((command) => (
                <button
                  key={command.name}
                  type="button"
                  role="option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    const token = draft.split(/\s/).at(-1) || '';
                    setDraft(`${draft.slice(0, -token.length)}/${command.name} `);
                    setPalette(null);
                  }}
                >
                  <span>/{command.name}</span>
                  <small>
                    {command.description || command.source || t('conversation.piCommand')}
                  </small>
                </button>
              ))}
          </div>
        )}
        <div className="mobile-composer-chrome">
          <textarea
            ref={textareaRef}
            aria-label={t('conversation.message')}
            placeholder={chatAvailable ? t('composer.placeholder') : ''}
            value={draft}
            disabled={!chatAvailable}
            rows={1}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <input
            ref={fileInputRef}
            className="mobile-file-input"
            type="file"
            accept="image/*"
            multiple
            aria-label={t('conversation.chooseImageAttachments')}
            onChange={addAttachments}
          />
          <div className="mobile-composer-controls">
            <button
              ref={toolsTriggerRef}
              type="button"
              className="mobile-tools-trigger"
              aria-label={t('conversation.tools')}
              onClick={() => setToolsSheet('menu')}
            >
              <Wrench aria-hidden="true" size={18} />
              <span>{t('conversation.tools')}</span>
            </button>
            {workerStatus.state === 'running' && !draft.trim() && attachments.length === 0 ? (
              <button
                type="button"
                className="mobile-stop-button"
                aria-label={t('composer.stop')}
                disabled={!chatAvailable || sending}
                onClick={() => void cancel()}
              >
                <Square aria-hidden="true" size={16} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                className="mobile-send-button"
                aria-label={
                  workerStatus.state === 'running' ? t('composer.steer') : t('composer.send')
                }
                disabled={!chatAvailable || sending || (!draft.trim() && attachments.length === 0)}
              >
                <Send aria-hidden="true" size={18} />
              </button>
            )}
          </div>
        </div>
      </form>

      {toolsSheet === 'menu' && (
        <ToolsSheet
          attachDisabled={!chatAvailable}
          onAttach={() => {
            setToolsSheet(null);
            fileInputRef.current?.click();
          }}
          onInspector={() => setToolsSheet('inspector')}
          onActions={() => setToolsSheet('actions')}
          onClose={() => setToolsSheet(null)}
        />
      )}

      {toolsSheet === 'inspector' && (
        <InspectorSheet
          client={client}
          sessionId={sessionId}
          projectPath={cwd}
          model={runtimeModel || details.model}
          provider={runtimeProvider || details.modelProvider}
          thinking={runtimeThinking}
          entryCount={details.total}
          entries={details.entries}
          onClose={closeToolSheet}
        />
      )}

      {toolsSheet === 'actions' && (
        <ThreadActionsSheet
          client={client}
          sessionId={sessionId}
          sessionName={details.name || sessionId}
          leafEntryId={entries.at(-1)?.id}
          onClose={closeToolSheet}
          onRenamed={(name) => {
            setDetails((current) => (current ? { ...current, name } : current));
            closeToolSheet();
          }}
          onNavigate={(nextId) => {
            setToolsSheet(null);
            window.history.pushState({}, '', `/session?id=${encodeURIComponent(nextId)}`);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
        />
      )}

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
