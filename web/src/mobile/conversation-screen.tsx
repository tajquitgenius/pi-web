import { marked } from 'marked';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Brain,
  ChevronDown,
  FileSearch,
  ImagePlus,
  LoaderCircle,
  MoreHorizontal,
  Plus,
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
import { MobileNavigationTrigger } from './mobile-navigation-drawer';
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
  const parentIds = new Set<string>();
  for (const entry of stitched) {
    if (entry.id) byId.set(entry.id, entry);
  }
  for (const entry of stitched) {
    if (entry.parentId && byId.has(entry.parentId)) parentIds.add(entry.parentId);
  }
  let leafId = '';
  for (let index = stitched.length - 1; index >= 0; index -= 1) {
    const entry = stitched[index];
    if (
      entry?.id &&
      entry.type !== 'session' &&
      entry.type !== 'label' &&
      !parentIds.has(entry.id)
    ) {
      leafId = entry.id;
      break;
    }
  }
  return leafId ? (getPath(leafId, byId) as MobileSessionEntry[]) : [];
}

function assistantEntryIDs(details: SessionDetails | null): Set<string> {
  const ids = new Set<string>();
  for (const entry of details?.entries || []) {
    const mobileEntry = entry as MobileSessionEntry;
    if (mobileEntry.message?.role === 'assistant' && mobileEntry.id) ids.add(mobileEntry.id);
  }
  return ids;
}

function containsNewAssistantText(
  details: SessionDetails,
  text: string,
  previousAssistantIDs: Set<string> | null,
): boolean {
  if (!text || !previousAssistantIDs) return false;
  return details.entries.some((entry) => {
    const mobileEntry = entry as MobileSessionEntry;
    return (
      mobileEntry.message?.role === 'assistant' &&
      (!mobileEntry.id || !previousAssistantIDs.has(mobileEntry.id)) &&
      textContent(mobileEntry.message.content).includes(text)
    );
  });
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
        </span>
        <small>{status}</small>
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
        </span>
        <small>
          {expanded ? t('conversation.hideReasoning') : t('conversation.showReasoning')}
        </small>
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
  model: string;
  thinking: ThinkingLevel;
  onRuntime: () => void;
  onAttach: () => void;
  onInspector: () => void;
  onClose: () => void;
}

function ToolsSheet({
  attachDisabled,
  model,
  thinking,
  onRuntime,
  onAttach,
  onInspector,
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
          <button type="button" aria-label={`Model ${model}`} onClick={onRuntime}>
            <Bot aria-hidden="true" size={19} />
            <span>
              <strong>{t('conversation.model')}</strong>
              <small>{model}</small>
            </span>
          </button>
          <button type="button" aria-label={`Thinking ${thinking}`} onClick={onRuntime}>
            <Brain aria-hidden="true" size={19} />
            <span>
              <strong>{t('conversation.thinking')}</strong>
              <small>{thinking}</small>
            </span>
          </button>
          <button type="button" onClick={onAttach} disabled={attachDisabled}>
            <ImagePlus aria-hidden="true" size={19} />
            <span>{t('conversation.attachImages')}</span>
          </button>
          <button type="button" onClick={onInspector}>
            <FileSearch aria-hidden="true" size={19} />
            <span>{t('conversation.projectInspector')}</span>
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
  const previewRef = useRef('');
  const previewBaselineRef = useRef<Set<string> | null>(null);
  const keyboardViewportBaselineRef = useRef(0);
  const keyboardViewportDeficitRef = useRef(0);
  const keyboardScreenSeedHeightRef = useRef(0);
  const keyboardWasOpenRef = useRef(false);
  const refreshGenerationRef = useRef(0);
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
  const [followingLatest, setFollowingLatest] = useState(true);
  const followingLatestRef = useRef(true);
  const [composerError, setComposerError] = useState('');
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [toolsSheet, setToolsSheet] = useState<'menu' | 'inspector' | 'actions' | null>(null);
  const [runtimeProvider, setRuntimeProvider] = useState(embeddedDetails?.modelProvider || '');
  const [runtimeModel, setRuntimeModel] = useState(embeddedDetails?.model || '');
  const [runtimeThinking, setRuntimeThinking] = useState<ThinkingLevel>(
    embeddedDetails?.thinkingLevel || 'off',
  );
  const screenRef = useRef<HTMLElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
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

  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  useEffect(() => {
    followingLatestRef.current = followingLatest;
  }, [followingLatest]);

  const refreshSession = useCallback(async () => {
    if (!sessionId) return;
    const generation = ++refreshGenerationRef.current;
    if (!detailsRef.current) setConnection('connecting');
    setError('');
    try {
      const current = detailsRef.current;
      const result =
        current && current.from > 0
          ? await client.getSession(sessionId, {
              from: current.from,
              count: Math.max(current.total - current.from + 50, OLDER_ENTRY_PAGE),
            })
          : await client.getSession(sessionId, { paginate: true });
      if (generation !== refreshGenerationRef.current) return;
      detailsRef.current = result;
      setDetails(result);
      setLoading(false);
      setConnection('connected');
      setRuntimeProvider(result.modelProvider || '');
      setRuntimeModel(result.model || '');
      if (result.thinkingLevel) setRuntimeThinking(result.thinkingLevel);
      if (containsNewAssistantText(result, previewRef.current, previewBaselineRef.current)) {
        previewRef.current = '';
        previewBaselineRef.current = null;
        setPreview('');
      }
      setPendingPrompt('');
    } catch (refreshError) {
      if (generation !== refreshGenerationRef.current) return;
      setLoading(false);
      throw refreshError;
    }
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
    const generation = ++refreshGenerationRef.current;
    const initial =
      bootstrap?.id === sessionId && bootstrap.data
        ? Promise.resolve(bootstrap.data)
        : client.getSession(sessionId, { paginate: true });
    initial
      .then((result) => {
        if (!active || generation !== refreshGenerationRef.current) return;
        detailsRef.current = result;
        setDetails(result);
        setConnection('connected');
        setRuntimeProvider(result.modelProvider || '');
        setRuntimeModel(result.model || '');
        if (result.thinkingLevel) setRuntimeThinking(result.thinkingLevel);
        document.title = result.name || sessionId;
      })
      .catch((loadError) => {
        if (active && generation === refreshGenerationRef.current) {
          setConnection('offline');
          setError(errorMessage(loadError, t('session.loadFailed')));
        }
      })
      .finally(() => {
        if (active && generation === refreshGenerationRef.current) setLoading(false);
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
            return;
          }
          if (startup) startup.handled = true;
          void refreshSession().catch((refreshError) => {
            setConnection('reconnecting');
            setComposerError(errorMessage(refreshError, t('session.loadFailed')));
          });
        } else if (name === 'chat-preview') {
          const stream = payload as { content?: unknown; done?: unknown };
          if (typeof stream.content === 'string' && stream.content) {
            if (!previewRef.current) {
              previewBaselineRef.current = assistantEntryIDs(detailsRef.current);
            }
            previewRef.current = stream.content;
            setPreview(stream.content);
          }
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
    document.documentElement.classList.add('mobile-conversation-flow');
    return () => document.documentElement.classList.remove('mobile-conversation-flow');
  }, []);

  useLayoutEffect(() => {
    const root = screenRef.current;
    const viewport = window.visualViewport;
    if (!root || !viewport) return;
    let orientationResetTimer: number | undefined;
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const standaloneIPhone = standalone && /iPhone|iPod/.test(navigator.userAgent);
    const resetDocumentScroll = () => {
      if (standaloneIPhone && (window.scrollX !== 0 || window.scrollY !== 0)) {
        window.scrollTo(0, 0);
      }
    };
    const update = () => {
      resetDocumentScroll();
      const visibleBottom = viewport.height + viewport.offsetTop;
      const currentViewportHeight = Math.max(window.innerHeight, visibleBottom);
      const composerFocused = document.activeElement === textareaRef.current;
      const screenDeficit = window.screen.height - currentViewportHeight;
      const hasHealthyScreenReference =
        standaloneIPhone && screenDeficit >= 0 && screenDeficit <= 120;
      if (keyboardViewportBaselineRef.current === 0) {
        keyboardViewportBaselineRef.current = hasHealthyScreenReference
          ? window.screen.height
          : currentViewportHeight;
        keyboardScreenSeedHeightRef.current =
          hasHealthyScreenReference && screenDeficit > 0 ? currentViewportHeight : 0;
      }
      let baseline = keyboardViewportBaselineRef.current;
      const keyboardOpen = composerFocused && baseline - visibleBottom > 120;
      const usingInitialScreenSeed =
        keyboardScreenSeedHeightRef.current > 0 &&
        Math.abs(keyboardScreenSeedHeightRef.current - currentViewportHeight) < 1;
      if (keyboardOpen) {
        keyboardWasOpenRef.current = true;
      } else {
        const closedDeficit = baseline - currentViewportHeight;
        if (currentViewportHeight >= baseline) {
          keyboardViewportBaselineRef.current = currentViewportHeight;
          keyboardViewportDeficitRef.current = 0;
          keyboardScreenSeedHeightRef.current = 0;
          keyboardWasOpenRef.current = false;
        } else if (
          standalone &&
          (keyboardWasOpenRef.current || usingInitialScreenSeed) &&
          closedDeficit > 0 &&
          closedDeficit <= 120
        ) {
          keyboardViewportDeficitRef.current = closedDeficit;
          keyboardWasOpenRef.current = false;
        } else if (!composerFocused && !keyboardWasOpenRef.current) {
          keyboardViewportBaselineRef.current = currentViewportHeight;
          keyboardViewportDeficitRef.current = 0;
          keyboardScreenSeedHeightRef.current = 0;
        }
        baseline = keyboardViewportBaselineRef.current;
      }
      const stickyDeficit = standalone ? keyboardViewportDeficitRef.current : 0;
      const viewportHeight = standalone
        ? keyboardOpen
          ? viewport.height + stickyDeficit
          : baseline
        : viewport.height;
      const viewportTop = standalone && !keyboardOpen ? 0 : viewport.offsetTop;
      root.style.setProperty('--mobile-viewport-height', `${viewportHeight}px`);
      document.documentElement.style.setProperty('--mobile-viewport-height', `${viewportHeight}px`);
      root.style.setProperty('--mobile-viewport-top', `${viewportTop}px`);
      root.dataset.keyboardOpen = keyboardOpen ? 'true' : 'false';
      if (followingLatestRef.current) {
        requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
      }
    };
    const resetForOrientation = () => {
      window.clearTimeout(orientationResetTimer);
      orientationResetTimer = window.setTimeout(() => {
        keyboardViewportBaselineRef.current = 0;
        keyboardViewportDeficitRef.current = 0;
        keyboardScreenSeedHeightRef.current = 0;
        keyboardWasOpenRef.current = false;
        update();
      }, 250);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', resetDocumentScroll, { passive: true });
    document.addEventListener('focusin', resetDocumentScroll);
    window.addEventListener('orientationchange', resetForOrientation);
    return () => {
      window.clearTimeout(orientationResetTimer);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', resetDocumentScroll);
      document.removeEventListener('focusin', resetDocumentScroll);
      window.removeEventListener('orientationchange', resetForOrientation);
      document.documentElement.style.removeProperty('--mobile-viewport-height');
    };
  }, [loading]);

  useLayoutEffect(() => {
    const root = screenRef.current;
    const composer = composerRef.current;
    if (!root || !composer) return;
    const update = () => {
      root.style.setProperty(
        '--mobile-composer-height',
        `${composer.getBoundingClientRect().height}px`,
      );
      if (followingLatestRef.current) {
        requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
      }
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(composer);
    return () => observer.disconnect();
  }, [loading]);

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

  useLayoutEffect(() => {
    if (!followingLatestRef.current) return;
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
  }, [attachments.length, details?.entries, draft, preview]);

  const updateFollowingState = () => {
    const feed = feedRef.current;
    if (!feed) return;
    const atLatest = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    followingLatestRef.current = atLatest;
    setFollowingLatest(atLatest);
  };

  const jumpToLatest = () => {
    followingLatestRef.current = true;
    setFollowingLatest(true);
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
  };

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
  const runtimeModelLabel =
    runtimeModel ||
    workerStatus.modelName ||
    workerStatus.model ||
    details?.model ||
    t('conversation.model');
  const closeToolSheet = () => setToolsSheet(null);
  const dismissKeyboard = () => textareaRef.current?.blur();

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
    <main
      ref={screenRef}
      className="mobile-screen mobile-session-screen"
      data-mobile-route="session"
    >
      <h1 className="mobile-visually-hidden">{details.name || sessionId}</h1>
      <div className="mobile-conversation-floating-controls" onPointerDown={dismissKeyboard}>
        <MobileNavigationTrigger className="mobile-conversation-floating-button" />
        <button
          type="button"
          className="mobile-conversation-floating-button"
          aria-label={t('conversation.threadActions')}
          onClick={() => {
            dismissKeyboard();
            setToolsSheet('actions');
          }}
        >
          <MoreHorizontal aria-hidden="true" size={21} />
        </button>
      </div>
      <MobileConnectivityNotice state={connection} onRetry={retrySession} />

      <div
        className="mobile-conversation-feed"
        ref={feedRef}
        aria-label={t('conversation.messages')}
        tabIndex={0}
        onScroll={updateFollowingState}
        onPointerDown={() => {
          if (document.activeElement === textareaRef.current) dismissKeyboard();
        }}
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
            <MobileMarkdown text={preview} />
          </article>
        )}
        <div ref={endRef} className="mobile-feed-end" />
      </div>

      {!followingLatest && (
        <button
          type="button"
          className="mobile-jump-latest"
          aria-label={t('conversation.jumpToLatest')}
          onClick={jumpToLatest}
        >
          <ArrowDown aria-hidden="true" size={20} />
        </button>
      )}

      <form ref={composerRef} className="mobile-composer" onSubmit={sendMessage}>
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
              onClick={() => {
                dismissKeyboard();
                setToolsSheet('menu');
              }}
            >
              <Plus aria-hidden="true" size={22} />
              <span className="mobile-visually-hidden">{t('conversation.tools')}</span>
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
                <ArrowUp aria-hidden="true" size={19} />
              </button>
            )}
          </div>
        </div>
      </form>

      {toolsSheet === 'menu' && (
        <ToolsSheet
          attachDisabled={!chatAvailable}
          model={runtimeModelLabel}
          thinking={runtimeThinking}
          onRuntime={() => {
            setToolsSheet(null);
            setRuntimeOpen(true);
          }}
          onAttach={() => {
            setToolsSheet(null);
            fileInputRef.current?.click();
          }}
          onInspector={() => setToolsSheet('inspector')}
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
