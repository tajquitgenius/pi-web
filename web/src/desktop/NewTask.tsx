import { ArrowRight, Brain, Folder, LoaderCircle, Paperclip, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type {
  PiModel,
  PiWebClient,
  SessionDefaults,
  SessionSummary,
  ThinkingLevel,
} from '../live-shared';
import { modelsForProvider, modelLabel, THINKING_LEVELS, uniqueProviders } from './desktop-model';

interface NewTaskPageProps {
  client: PiWebClient;
  models: PiModel[];
  modelsLoading: boolean;
  navigate: (destination: string) => void;
  sessions: SessionSummary[];
}

export function NewTaskPage({
  client,
  models,
  modelsLoading,
  navigate,
  sessions,
}: NewTaskPageProps) {
  const [path, setPath] = useState('');
  const [prompt, setPrompt] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [settings, setSettings] = useState<SessionDefaults | null>(null);
  const [settingsResolved, setSettingsResolved] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const pathInitialized = useRef(false);
  const settingsTouched = useRef(false);
  const host = useMemo(() => client.getHostContext(), [client]);

  useEffect(() => {
    let active = true;
    void client
      .getSessionDefaults()
      .then((defaults) => {
        if (active && !settingsTouched.current) setSettings(defaults);
      })
      .catch(() => {
        if (active) {
          setSettings(null);
          setSettingsError(
            `Open Pi on ${host.instanceName} and log in to a model provider before starting a task.`,
          );
        }
      })
      .finally(() => {
        if (active) setSettingsResolved(true);
      });
    return () => {
      active = false;
    };
  }, [client, host.instanceName]);

  useEffect(() => {
    if (!pathInitialized.current && sessions[0]?.project) {
      pathInitialized.current = true;
      setPath(sessions[0].project);
    }
  }, [sessions]);

  const selectedProvider = settings?.modelProvider ?? '';
  const selectedModel = settings?.modelId ?? '';
  const providers = useMemo(
    () => uniqueProviders(models, selectedProvider),
    [models, selectedProvider],
  );
  const providerModels = useMemo(
    () => modelsForProvider(models, selectedProvider),
    [models, selectedProvider],
  );
  const runtimeReady =
    settingsResolved &&
    !modelsLoading &&
    !settingsError &&
    !!settings &&
    models.some(
      (model) => model.provider === settings.modelProvider && model.id === settings.modelId,
    );
  const runtimeLoading = !settingsResolved || modelsLoading;
  const runtimeError =
    settingsError ||
    (!runtimeLoading && !runtimeReady
      ? `Open Pi on ${host.instanceName} and log in to a model provider before starting a task.`
      : '');

  const changeProvider = (provider: string) => {
    if (!settings) return;
    settingsTouched.current = true;
    const modelId = modelsForProvider(models, provider)[0]?.id || settings.modelId;
    setSettings((current) =>
      current ? { ...current, modelProvider: provider, modelId } : current,
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const resolvedPath = path.trim();
    if (!resolvedPath || creating || !runtimeReady || !settings) return;
    setCreating(true);
    setError('');
    try {
      const result = await client.createSession({
        path: resolvedPath,
        modelProvider: settings.modelProvider,
        modelId: settings.modelId,
        thinkingLevel: settings.thinkingLevel,
      });
      const message = prompt.trim();
      if (message) await client.sendChat(result.id, { message, images });
      navigate(`/session?id=${encodeURIComponent(result.id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create this task.');
    } finally {
      setCreating(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <main className="desktop-main-pane" data-desktop-route="workspace">
      <header className="desktop-session-header desktop-workspace-header">
        <div className="desktop-session-title">
          <span>Workspace</span>
          <strong>New task</strong>
        </div>
        <span className="desktop-resolved-badge" data-resolved={runtimeReady || undefined}>
          {runtimeLoading
            ? 'Resolving runtime…'
            : runtimeReady
              ? 'Runtime ready'
              : 'Runtime unavailable'}
        </span>
      </header>
      <div className="desktop-new-task-stage">
        <div className="desktop-new-task-intro">
          <div className="desktop-new-task-icon">
            <Sparkles aria-hidden="true" size={19} />
          </div>
          <h1>What should pi work on?</h1>
          <p>
            Start in a project, choose the exact runtime, and describe the outcome. The task stays
            in this workspace from its first turn.
          </p>
        </div>

        <form className="desktop-new-task-composer" onSubmit={(event) => void submit(event)}>
          <label className="desktop-project-path-field">
            <Folder aria-hidden="true" size={14} />
            <span>Project path</span>
            <input
              aria-label="Project path"
              onChange={(event) => {
                pathInitialized.current = true;
                setPath(event.currentTarget.value);
              }}
              placeholder="/path/to/project"
              required
              spellCheck={false}
              value={path}
            />
          </label>
          {images.length ? (
            <div className="desktop-attachments">
              {images.map((image, index) => (
                <span key={`${image.name}-${index}`}>
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
            aria-label="Task description"
            autoFocus
            onChange={(event) => setPrompt(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the task. Add constraints, context, or the result you want…"
            rows={5}
            value={prompt}
          />
          <div className="desktop-new-task-footer">
            <div className="desktop-composer-controls" aria-label="New task settings">
              <label>
                <span>Provider account</span>
                <select
                  aria-label="Provider account"
                  disabled={!runtimeReady}
                  onChange={(event) => changeProvider(event.currentTarget.value)}
                  value={selectedProvider}
                >
                  {providers.length ? (
                    providers.map((provider) => (
                      <option key={provider} value={provider}>
                        {provider}
                      </option>
                    ))
                  ) : (
                    <option value="">{runtimeLoading ? 'Loading…' : 'Unavailable'}</option>
                  )}
                </select>
              </label>
              <label>
                <span>Model</span>
                <select
                  aria-label="Model"
                  disabled={!runtimeReady}
                  onChange={(event) => {
                    settingsTouched.current = true;
                    const modelId = event.currentTarget.value;
                    setSettings((current) => (current ? { ...current, modelId } : current));
                  }}
                  value={selectedModel}
                >
                  {providerModels.length ? (
                    providerModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {modelLabel(model)}
                      </option>
                    ))
                  ) : (
                    <option value={selectedModel}>
                      {runtimeLoading ? 'Loading…' : 'Unavailable'}
                    </option>
                  )}
                </select>
              </label>
              <label>
                <Brain aria-hidden="true" size={13} />
                <span>Thinking</span>
                <select
                  aria-label="Thinking"
                  disabled={!runtimeReady}
                  onChange={(event) => {
                    settingsTouched.current = true;
                    const thinkingLevel = event.currentTarget.value as ThinkingLevel;
                    setSettings((current) => (current ? { ...current, thinkingLevel } : current));
                  }}
                  value={settings?.thinkingLevel ?? 'off'}
                >
                  {THINKING_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="desktop-new-task-actions">
              <label className="desktop-icon-button" title="Attach images">
                <Paperclip aria-hidden="true" size={15} />
                <span className="sr-only">Attach images</span>
                <input
                  accept="image/*"
                  aria-label="Attach images"
                  hidden
                  multiple
                  onChange={(event) => setImages(Array.from(event.currentTarget.files ?? []))}
                  type="file"
                />
              </label>
              <button
                className="desktop-create-button"
                disabled={creating || !path.trim() || !runtimeReady}
                type="submit"
              >
                {creating ? (
                  <LoaderCircle aria-hidden="true" className="desktop-spin" size={14} />
                ) : (
                  <ArrowRight aria-hidden="true" size={14} />
                )}
                {creating ? 'Starting…' : 'Start task'}
              </button>
            </div>
          </div>
          <div className="desktop-new-task-hint">
            <span>Ctrl Enter to start</span>
            <span>
              {runtimeReady && settings
                ? `${settings.modelProvider} / ${settings.modelId} · ${settings.thinkingLevel}`
                : runtimeLoading
                  ? 'Loading model runtime…'
                  : 'Model runtime unavailable'}
            </span>
          </div>
          {runtimeError ? (
            <div
              aria-label="Model provider unavailable"
              className="desktop-composer-error"
              role="alert"
            >
              {runtimeError}
            </div>
          ) : null}
          {error ? <div className="desktop-composer-error">{error}</div> : null}
        </form>
      </div>
    </main>
  );
}
