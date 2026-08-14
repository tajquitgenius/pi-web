import { ArrowRight, Brain, Folder, LoaderCircle, Paperclip, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type {
  PiModel,
  PiWebClient,
  SessionDefaults,
  SessionSummary,
  ThinkingLevel,
} from '../live-shared';
import {
  DEFAULT_SESSION_SETTINGS,
  modelsForProvider,
  modelLabel,
  THINKING_LEVELS,
  uniqueProviders,
} from './desktop-model';

interface NewTaskPageProps {
  client: PiWebClient;
  models: PiModel[];
  navigate: (destination: string) => void;
  sessions: SessionSummary[];
}

export function NewTaskPage({ client, models, navigate, sessions }: NewTaskPageProps) {
  const [path, setPath] = useState('');
  const [prompt, setPrompt] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [settings, setSettings] = useState<SessionDefaults>(DEFAULT_SESSION_SETTINGS);
  const [settingsResolved, setSettingsResolved] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const pathInitialized = useRef(false);
  const settingsTouched = useRef(false);

  useEffect(() => {
    let active = true;
    void client
      .getSessionDefaults()
      .then((defaults) => {
        if (active && !settingsTouched.current) setSettings(defaults);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setSettingsResolved(true);
      });
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    if (!pathInitialized.current && sessions[0]?.project) {
      pathInitialized.current = true;
      setPath(sessions[0].project);
    }
  }, [sessions]);

  const providers = useMemo(
    () => uniqueProviders(models, settings.modelProvider),
    [models, settings.modelProvider],
  );
  const providerModels = useMemo(
    () => modelsForProvider(models, settings.modelProvider),
    [models, settings.modelProvider],
  );

  const changeProvider = (provider: string) => {
    settingsTouched.current = true;
    const modelId = modelsForProvider(models, provider)[0]?.id || settings.modelId;
    setSettings((current) => ({ ...current, modelProvider: provider, modelId }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const resolvedPath = path.trim();
    if (!resolvedPath || creating) return;
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
        <span className="desktop-resolved-badge" data-resolved={settingsResolved || undefined}>
          {settingsResolved ? 'Defaults resolved' : 'Resolving defaults…'}
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
              onChange={(event) => setPath(event.currentTarget.value)}
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
                  onChange={(event) => changeProvider(event.currentTarget.value)}
                  value={settings.modelProvider}
                >
                  {providers.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Model</span>
                <select
                  aria-label="Model"
                  onChange={(event) => {
                    settingsTouched.current = true;
                    const modelId = event.currentTarget.value;
                    setSettings((current) => ({ ...current, modelId }));
                  }}
                  value={settings.modelId}
                >
                  {providerModels.length ? (
                    providerModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {modelLabel(model)}
                      </option>
                    ))
                  ) : (
                    <option value={settings.modelId}>{settings.modelId}</option>
                  )}
                </select>
              </label>
              <label>
                <Brain aria-hidden="true" size={13} />
                <span>Thinking</span>
                <select
                  aria-label="Thinking"
                  onChange={(event) => {
                    settingsTouched.current = true;
                    const thinkingLevel = event.currentTarget.value as ThinkingLevel;
                    setSettings((current) => ({ ...current, thinkingLevel }));
                  }}
                  value={settings.thinkingLevel}
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
                disabled={creating || !path.trim()}
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
              {settings.modelProvider} / {settings.modelId} · {settings.thinkingLevel}
            </span>
          </div>
          {error ? <div className="desktop-composer-error">{error}</div> : null}
        </form>
      </div>
    </main>
  );
}
