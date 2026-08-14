import {
  AlertCircle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  FileText,
  Folder,
  LoaderCircle,
  Paperclip,
  PanelRight,
  Send,
  Square,
  Wrench,
  X,
} from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { readEmbeddedSession } from '../live-shared';
import type {
  PiModel,
  PiWebClient,
  SessionDetails,
  SessionEntry,
  SessionSummary,
  ThinkingLevel,
} from '../live-shared';
import {
  modelsForProvider,
  modelLabel,
  projectLabel,
  THINKING_LEVELS,
  uniqueProviders,
} from './desktop-model';

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function contentBlocks(content: unknown): Record<string, unknown>[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content
    .map(recordValue)
    .filter((block): block is Record<string, unknown> => block !== null);
}

function contentText(content: unknown): string {
  return contentBlocks(content)
    .filter((block) => block.type === 'text')
    .map((block) => textValue(block.text))
    .join('\n');
}

function InlineText({ text }: { text: string }) {
  const pieces = text.split(/(`[^`\n]+`)/g);
  return (
    <>
      {pieces.map((piece, index) =>
        piece.startsWith('`') && piece.endsWith('`') ? (
          <code key={index}>{piece.slice(1, -1)}</code>
        ) : (
          <Fragment key={index}>{piece}</Fragment>
        ),
      )}
    </>
  );
}

function RichText({ text }: { text: string }) {
  const rendered: ReactNode[] = [];
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  const renderPlain = (plain: string, key: string) => {
    for (const [index, paragraph] of plain.split(/\n{2,}/).entries()) {
      if (!paragraph.trim()) continue;
      rendered.push(
        <p key={`${key}-${index}`}>
          <InlineText text={paragraph} />
        </p>,
      );
    }
  };
  while ((match = fence.exec(text))) {
    renderPlain(text.slice(cursor, match.index), `plain-${cursor}`);
    rendered.push(
      <pre key={`code-${match.index}`}>
        {match[1].trim() ? <span className="desktop-code-language">{match[1].trim()}</span> : null}
        <code>{match[2].replace(/\n$/, '')}</code>
      </pre>,
    );
    cursor = match.index + match[0].length;
  }
  renderPlain(text.slice(cursor), `plain-${cursor}`);
  return <div className="desktop-rich-text">{rendered}</div>;
}

function entryId(entry: SessionEntry, index: number): string {
  return textValue(entry.id) || `${textValue(entry.type)}-${index}`;
}

function imageSource(block: Record<string, unknown>): string {
  const data = textValue(block.data);
  if (!data) return '';
  return `data:${textValue(block.mimeType) || 'image/png'};base64,${data}`;
}

interface ToolCallViewProps {
  block: Record<string, unknown>;
  result?: Record<string, unknown>;
}

function ToolCallView({ block, result }: ToolCallViewProps) {
  const name = textValue(block.name) || 'tool';
  const args = recordValue(block.arguments) ?? {};
  const resultMessage = recordValue(result?.message);
  const resultText = contentText(resultMessage?.content);
  const failed = resultMessage?.isError === true;
  const context = textValue(args.file_path ?? args.path ?? args.command);

  return (
    <details className="desktop-tool-call" data-tool-call={name}>
      <summary>
        <span className={`desktop-tool-state ${failed ? 'failed' : result ? 'done' : 'pending'}`}>
          {failed ? (
            <AlertCircle aria-hidden="true" size={13} />
          ) : result ? (
            <CheckCircle2 aria-hidden="true" size={13} />
          ) : (
            <LoaderCircle aria-hidden="true" size={13} />
          )}
        </span>
        <Wrench aria-hidden="true" size={13} />
        <strong>{name}</strong>
        {context ? <span title={context}>{context}</span> : null}
        <ChevronRight aria-hidden="true" className="desktop-disclosure" size={13} />
      </summary>
      <div className="desktop-tool-body">
        {Object.keys(args).length ? <pre>{JSON.stringify(args, null, 2)}</pre> : null}
        {resultText ? (
          <div className={failed ? 'desktop-tool-error' : 'desktop-tool-output'}>
            <pre>{resultText}</pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

interface TranscriptProps {
  details: SessionDetails;
  streamingText?: string;
  optimisticPrompt?: string;
}

export function Transcript({
  details,
  optimisticPrompt = '',
  streamingText = '',
}: TranscriptProps) {
  const toolResults = useMemo(() => {
    const results = new Map<string, Record<string, unknown>>();
    for (const entry of details.entries) {
      if (entry.type !== 'message') continue;
      const message = recordValue(entry.message);
      if (message?.role === 'toolResult' && typeof message.toolCallId === 'string') {
        results.set(message.toolCallId, entry);
      }
    }
    return results;
  }, [details.entries]);

  return (
    <div aria-live="polite" className="desktop-transcript" data-testid="transcript">
      <div className="desktop-transcript-boundary">
        {details.from > 0 ? null : <div className="desktop-transcript-start">Session started</div>}
        {details.entries.map((entry, index) => {
          const type = textValue(entry.type);
          if (type === 'message') {
            const message = recordValue(entry.message);
            const role = textValue(message?.role);
            const blocks = contentBlocks(message?.content);
            if (role === 'toolResult') return null;
            if (role === 'user') {
              const text = contentText(message?.content);
              const images = blocks.filter((block) => block.type === 'image');
              return (
                <article
                  className="desktop-message desktop-user-message"
                  key={entryId(entry, index)}
                >
                  <div className="desktop-message-role">You</div>
                  <div className="desktop-user-bubble">
                    {images.length ? (
                      <div className="desktop-message-images">
                        {images.map((image, imageIndex) => (
                          <img alt="User attachment" key={imageIndex} src={imageSource(image)} />
                        ))}
                      </div>
                    ) : null}
                    {text ? <RichText text={text} /> : null}
                  </div>
                </article>
              );
            }
            if (role === 'assistant') {
              return (
                <article
                  className="desktop-message desktop-assistant-message"
                  key={entryId(entry, index)}
                >
                  <div className="desktop-assistant-glyph">
                    <Bot aria-hidden="true" size={15} />
                  </div>
                  <div className="desktop-assistant-content">
                    <div className="desktop-message-role">Assistant</div>
                    {blocks.map((block, blockIndex) => {
                      if (block.type === 'text' && textValue(block.text).trim()) {
                        return <RichText key={blockIndex} text={textValue(block.text)} />;
                      }
                      if (block.type === 'thinking' && textValue(block.thinking).trim()) {
                        return (
                          <details className="desktop-thinking-block" key={blockIndex}>
                            <summary>
                              <Brain aria-hidden="true" size={13} />
                              Thinking
                              <ChevronRight aria-hidden="true" size={12} />
                            </summary>
                            <p>{textValue(block.thinking)}</p>
                          </details>
                        );
                      }
                      if (block.type === 'toolCall') {
                        const callId = textValue(block.id);
                        return (
                          <ToolCallView
                            block={block}
                            key={callId || blockIndex}
                            result={toolResults.get(callId)}
                          />
                        );
                      }
                      return null;
                    })}
                    {message?.stopReason === 'aborted' ? (
                      <div className="desktop-turn-notice">Response cancelled</div>
                    ) : null}
                    {message?.stopReason === 'error' ? (
                      <div className="desktop-turn-notice error">
                        {textValue(message.errorMessage) || 'The response failed.'}
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            }
            if (role === 'bashExecution') {
              return (
                <details className="desktop-standalone-tool" key={entryId(entry, index)}>
                  <summary>
                    <Wrench aria-hidden="true" size={13} /> Shell activity
                  </summary>
                  <pre>
                    $ {textValue(message?.command)}\n{textValue(message?.output)}
                  </pre>
                </details>
              );
            }
            return null;
          }
          if (type === 'model_change' && entry.implicit !== true) {
            return (
              <div className="desktop-activity-row" key={entryId(entry, index)}>
                Model changed to {textValue(entry.provider)}/{textValue(entry.modelId)}
              </div>
            );
          }
          if (type === 'thinking_level_change' && entry.implicit !== true) {
            return (
              <div className="desktop-activity-row" key={entryId(entry, index)}>
                Thinking set to {textValue(entry.thinkingLevel ?? entry.level)}
              </div>
            );
          }
          if (type === 'compaction') {
            return (
              <details className="desktop-compaction" key={entryId(entry, index)}>
                <summary>Earlier context compacted</summary>
                <p>{textValue(entry.summary)}</p>
              </details>
            );
          }
          return null;
        })}
        {optimisticPrompt ? (
          <article className="desktop-message desktop-user-message desktop-optimistic-message">
            <div className="desktop-message-role">You · sending</div>
            <div className="desktop-user-bubble">
              <RichText text={optimisticPrompt} />
            </div>
          </article>
        ) : null}
        {streamingText ? (
          <article className="desktop-message desktop-assistant-message desktop-streaming-message">
            <div className="desktop-assistant-glyph">
              <Bot aria-hidden="true" size={15} />
            </div>
            <div className="desktop-assistant-content">
              <div className="desktop-message-role">Assistant · responding</div>
              <RichText text={streamingText} />
              <span className="desktop-stream-caret" />
            </div>
          </article>
        ) : null}
      </div>
    </div>
  );
}

interface SessionComposerProps {
  chatAvailable: boolean;
  chatDisabledReason: string;
  client: PiWebClient;
  initialModel: string;
  initialProvider: string;
  initialThinking: ThinkingLevel;
  models: PiModel[];
  onRunningChange: (running: boolean) => void;
  onSent: (message: string) => void;
  running: boolean;
  sessionId: string;
}

export function SessionComposer({
  chatAvailable,
  chatDisabledReason,
  client,
  initialModel,
  initialProvider,
  initialThinking,
  models,
  onRunningChange,
  onSent,
  running,
  sessionId,
}: SessionComposerProps) {
  const [message, setMessage] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState(initialModel);
  const [thinking, setThinking] = useState<ThinkingLevel>(initialThinking);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const settingsTask = useRef<Promise<unknown>>(Promise.resolve());
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => setProvider(initialProvider), [initialProvider]);
  useEffect(() => setModel(initialModel), [initialModel]);
  useEffect(() => setThinking(initialThinking), [initialThinking]);

  const providerModels = modelsForProvider(models, provider);
  const providers = uniqueProviders(models, provider);
  const queueSetting = (operation: () => Promise<unknown>) => {
    const task = settingsTask.current.catch(() => undefined).then(operation);
    settingsTask.current = task;
    task.catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Could not update session settings.');
    });
  };

  const changeProvider = (nextProvider: string) => {
    const nextModel = modelsForProvider(models, nextProvider)[0]?.id || model;
    setProvider(nextProvider);
    setModel(nextModel);
    setError('');
    queueSetting(() => client.setModel(sessionId, nextProvider, nextModel));
  };

  const changeModel = (nextModel: string) => {
    setModel(nextModel);
    setError('');
    queueSetting(() => client.setModel(sessionId, provider, nextModel));
  };

  const changeThinking = (level: ThinkingLevel) => {
    setThinking(level);
    setError('');
    queueSetting(() => client.setThinkingLevel(sessionId, level));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || busy || running || !chatAvailable) return;
    setBusy(true);
    setError('');
    try {
      await settingsTask.current;
      await client.sendChat(sessionId, { message: trimmed, images });
      setMessage('');
      setImages([]);
      onSent(trimmed);
      onRunningChange(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Message could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError('');
    try {
      await client.cancelChat(sessionId);
      onRunningChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not cancel this task.');
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div className="desktop-composer-dock">
      <form className="desktop-composer" onSubmit={(event) => void submit(event)}>
        {images.length ? (
          <div className="desktop-attachments">
            {images.map((image, index) => (
              <span key={`${image.name}-${index}`}>
                <FileText aria-hidden="true" size={12} />
                {image.name}
                <button
                  aria-label={`Remove ${image.name}`}
                  onClick={() =>
                    setImages((current) => current.filter((_, item) => item !== index))
                  }
                  type="button"
                >
                  <X aria-hidden="true" size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          aria-label="Message"
          disabled={!chatAvailable}
          onChange={(event) => setMessage(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            chatAvailable
              ? 'Ask pi to build, investigate, or change something…'
              : chatDisabledReason
          }
          rows={2}
          value={message}
        />
        <div className="desktop-composer-footer">
          <div className="desktop-composer-controls" aria-label="Session settings">
            <label>
              <span>Provider account</span>
              <select
                aria-label="Provider account"
                onChange={(event) => changeProvider(event.currentTarget.value)}
                value={provider}
              >
                {providers.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Model</span>
              <select
                aria-label="Model"
                onChange={(event) => changeModel(event.currentTarget.value)}
                value={model}
              >
                {providerModels.length ? (
                  providerModels.map((item) => (
                    <option key={item.id} value={item.id}>
                      {modelLabel(item)}
                    </option>
                  ))
                ) : (
                  <option value={model}>{model}</option>
                )}
              </select>
            </label>
            <label>
              <Brain aria-hidden="true" size={13} />
              <span>Thinking</span>
              <select
                aria-label="Thinking"
                onChange={(event) => changeThinking(event.currentTarget.value as ThinkingLevel)}
                value={thinking}
              >
                {THINKING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="desktop-composer-actions">
            <input
              accept="image/*"
              aria-label="Attach images"
              hidden
              multiple
              onChange={(event) => setImages(Array.from(event.currentTarget.files ?? []))}
              ref={fileInput}
              type="file"
            />
            <button
              aria-label="Attach images"
              className="desktop-icon-button"
              onClick={() => fileInput.current?.click()}
              title="Attach images"
              type="button"
            >
              <Paperclip aria-hidden="true" size={15} />
            </button>
            {running ? (
              <button
                aria-label="Cancel response"
                className="desktop-send-button cancel"
                disabled={busy}
                onClick={() => void cancel()}
                title="Cancel response"
                type="button"
              >
                <Square aria-hidden="true" fill="currentColor" size={12} />
              </button>
            ) : (
              <button
                aria-label="Send message"
                className="desktop-send-button"
                disabled={busy || !message.trim() || !chatAvailable}
                title="Send message"
                type="submit"
              >
                {busy ? (
                  <LoaderCircle aria-hidden="true" className="desktop-spin" size={15} />
                ) : (
                  <Send aria-hidden="true" size={15} />
                )}
              </button>
            )}
          </div>
        </div>
        {error ? <div className="desktop-composer-error">{error}</div> : null}
      </form>
    </div>
  );
}

interface SessionPageProps {
  client: PiWebClient;
  detailsOpen: boolean;
  initialRunning: boolean;
  models: PiModel[];
  onDetailsToggle: () => void;
  selectedSummary?: SessionSummary;
  sessionId: string;
}

export function SessionPage({
  client,
  detailsOpen,
  initialRunning,
  models,
  onDetailsToggle,
  selectedSummary,
  sessionId,
}: SessionPageProps) {
  const [details, setDetails] = useState<SessionDetails | null>(() =>
    readEmbeddedSession(sessionId),
  );
  const [loading, setLoading] = useState(!details);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(initialRunning);
  const [streamingText, setStreamingText] = useState('');
  const [optimisticPrompt, setOptimisticPrompt] = useState('');
  const [workerThinking, setWorkerThinking] = useState<ThinkingLevel>('high');
  const transcriptRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const nextDetails = await client.getSession(sessionId, { paginate: true });
      setDetails(nextDetails);
      setOptimisticPrompt('');
      setStreamingText('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load this session.');
    } finally {
      setLoading(false);
    }
  }, [client, sessionId]);

  useEffect(() => {
    const embedded = readEmbeddedSession(sessionId);
    if (embedded) {
      setDetails(embedded);
      setLoading(false);
    } else {
      setDetails(null);
      setLoading(true);
      void load();
    }
    setOptimisticPrompt('');
    setStreamingText('');
  }, [load, sessionId]);

  useEffect(() => {
    void client
      .getWorkerStatus(sessionId)
      .then((status) => {
        setRunning(status.state === 'running');
        if (status.thinkingLevel) setWorkerThinking(status.thinkingLevel);
      })
      .catch(() => undefined);
    const subscription = client.subscribe(sessionId, {
      onEvent: (name, payload) => {
        if (name === 'chat-preview') {
          const preview = recordValue(payload);
          setStreamingText(textValue(preview?.content));
          setRunning(preview?.done !== true);
          if (preview?.done === true) window.setTimeout(() => void load(), 80);
        } else if (name === 'reload') {
          void load();
        } else if (name === 'status-delta') {
          const status = recordValue(payload);
          if (status?.id === sessionId) setRunning(status.running === true);
        }
      },
    });
    return () => subscription.close();
  }, [client, load, sessionId]);

  useEffect(() => {
    if (details?.thinkingLevel) setWorkerThinking(details.thinkingLevel);
  }, [details?.thinkingLevel]);

  useEffect(() => {
    const pane = transcriptRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [details?.entries.length, optimisticPrompt, streamingText]);

  const loadEarlier = async () => {
    if (!details?.from) return;
    const count = Math.min(200, details.from);
    const from = details.from - count;
    const earlier = await client.getSession(sessionId, { from, count });
    setDetails((current) =>
      current ? { ...current, entries: [...earlier.entries, ...current.entries], from } : current,
    );
  };

  if (!sessionId) {
    return (
      <main className="desktop-main-pane" data-desktop-route="session">
        <div className="desktop-empty-state">
          <FileText aria-hidden="true" size={22} />
          <h1>No thread selected</h1>
          <p>Choose a thread from the sidebar or start a new task.</p>
        </div>
      </main>
    );
  }

  const projectPath = textValue(details?.header.cwd) || selectedSummary?.project || '';
  const title = details?.name || selectedSummary?.name || sessionId;
  const provider = details?.modelProvider || selectedSummary?.modelProvider || '';
  const model = details?.model || selectedSummary?.model || '';

  return (
    <>
      <main className="desktop-main-pane" data-desktop-route="session">
        <header className="desktop-session-header">
          <div className="desktop-session-title">
            <span>{projectLabel(projectPath || 'Workspace')}</span>
            <ChevronRight aria-hidden="true" size={13} />
            <strong>{title}</strong>
          </div>
          <div className="desktop-session-header-actions">
            <span className={`desktop-worker-status ${running ? 'running' : ''}`}>
              {running ? (
                <LoaderCircle aria-hidden="true" className="desktop-spin" size={13} />
              ) : (
                <Circle aria-hidden="true" size={10} />
              )}
              {running ? 'Running' : 'Ready'}
            </span>
            <button
              aria-label="Toggle session details"
              aria-pressed={detailsOpen}
              className="desktop-icon-button"
              onClick={onDetailsToggle}
              title="Session details"
              type="button"
            >
              <PanelRight aria-hidden="true" size={16} />
            </button>
          </div>
        </header>

        <div className="desktop-conversation-stage">
          <div
            className="desktop-transcript-scroll"
            data-testid="transcript-scroll-pane"
            ref={transcriptRef}
          >
            {loading ? (
              <div className="desktop-loading-state">
                <LoaderCircle aria-hidden="true" className="desktop-spin" size={18} /> Loading
                thread…
              </div>
            ) : error ? (
              <div className="desktop-error-state">
                <AlertCircle aria-hidden="true" size={18} />
                <span>{error}</span>
                <button onClick={() => void load()} type="button">
                  Try again
                </button>
              </div>
            ) : details ? (
              <>
                {details.from > 0 ? (
                  <button
                    className="desktop-load-earlier"
                    onClick={() => void loadEarlier()}
                    type="button"
                  >
                    Load earlier messages
                  </button>
                ) : null}
                <Transcript
                  details={details}
                  optimisticPrompt={optimisticPrompt}
                  streamingText={streamingText}
                />
              </>
            ) : null}
          </div>
          {details ? (
            <SessionComposer
              chatAvailable={details.chatAvailable}
              chatDisabledReason={details.chatDisabledReason}
              client={client}
              initialModel={model}
              initialProvider={provider}
              initialThinking={workerThinking}
              models={models}
              onRunningChange={setRunning}
              onSent={setOptimisticPrompt}
              running={running}
              sessionId={sessionId}
            />
          ) : null}
        </div>
      </main>

      {detailsOpen && details ? (
        <aside aria-label="Session details" className="desktop-details-panel">
          <header>
            <div>
              <span>Context</span>
              <strong>Session details</strong>
            </div>
            <button
              aria-label="Close session details"
              className="desktop-icon-button"
              onClick={onDetailsToggle}
              type="button"
            >
              <X aria-hidden="true" size={15} />
            </button>
          </header>
          <div className="desktop-details-scroll">
            <section className="desktop-detail-card">
              <h2>Workspace</h2>
              <div className="desktop-detail-path">
                <Folder aria-hidden="true" size={14} />
                <span>{projectPath || 'Unknown path'}</span>
              </div>
            </section>
            <section className="desktop-detail-card">
              <h2>Runtime</h2>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{running ? 'Running' : 'Idle'}</dd>
                </div>
                <div>
                  <dt>Provider</dt>
                  <dd>{provider || 'Unknown'}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{model || 'Unknown'}</dd>
                </div>
                <div>
                  <dt>Thinking</dt>
                  <dd>{workerThinking}</dd>
                </div>
              </dl>
            </section>
            <section className="desktop-detail-card">
              <h2>Thread</h2>
              <dl>
                <div>
                  <dt>Entries</dt>
                  <dd>{details.total}</dd>
                </div>
                <div>
                  <dt>Session ID</dt>
                  <dd title={sessionId}>{sessionId}</dd>
                </div>
              </dl>
            </section>
            <div className="desktop-details-note">
              <Clock3 aria-hidden="true" size={13} />
              Files and diffs appear here when supplied by the current session APIs.
            </div>
          </div>
        </aside>
      ) : null}
    </>
  );
}
