import {
  ChevronDown,
  ChevronRight,
  Circle,
  Folder,
  Plus,
  Search,
  Server,
  Settings,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type {
  HostContext,
  PiModel,
  PiWebClient,
  SessionStatus,
  SessionSummary,
  StatusSnapshot,
  ThinkingLevel,
} from '../live-shared';
import { t } from '../shared/i18n.js';

const INITIAL_ROW_LIMIT = 30;
const SESSION_CACHE_LIMIT = 120;
const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

interface SessionsScreenProps {
  client: PiWebClient;
  navigate: (url: string) => void;
  internalLink: (url: string, children: ReactNode, className?: string) => ReactNode;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function projectLabel(path: string): string {
  const parts = path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .filter(Boolean);
  return parts.at(-1) || path || t('index.unknownProject');
}

function formatActivity(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return 'Now';
  if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp);
}

function matchesSession(session: SessionSummary, query: string, project: string): boolean {
  if (project && session.project !== project) return false;
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [session.name, session.project, session.model, session.modelProvider]
    .join(' ')
    .toLocaleLowerCase()
    .includes(normalized);
}

function HostSwitcher({ host }: { host: HostContext }) {
  return (
    <details className="mobile-host-switcher">
      <summary aria-label={t('host.switch', { host: host.instanceName })}>
        <Server aria-hidden="true" size={17} />
        <span>{host.instanceName}</span>
        <ChevronDown aria-hidden="true" size={15} />
      </summary>
      <div className="mobile-host-menu">
        <div className="mobile-host-current" aria-current="page">
          <span>{t('host.currentComputer')}</span>
          <strong>{host.instanceName}</strong>
        </div>
        {host.peers.length > 0 && <p>{t('host.otherComputers')}</p>}
        {host.peers.map((peer) => (
          <a key={`${peer.url}:${peer.label}`} href={peer.url}>
            <span>{peer.label}</span>
            <ChevronRight aria-hidden="true" size={17} />
          </a>
        ))}
      </div>
    </details>
  );
}

interface NewTaskScreenProps {
  client: PiWebClient;
  host: HostContext;
  onClose: () => void;
  onCreated: (sessionId: string) => void;
}

function NewTaskScreen({ client, host, onClose, onCreated }: NewTaskScreenProps) {
  const [path, setPath] = useState('');
  const [models, setModels] = useState<PiModel[]>([]);
  const [modelProvider, setModelProvider] = useState('');
  const [modelId, setModelId] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('off');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([client.getSessionDefaults(), client.listModels()])
      .then(([defaults, result]) => {
        if (!active) return;
        setModels(result.models);
        setModelProvider(defaults.modelProvider);
        setModelId(defaults.modelId);
        setThinkingLevel(defaults.thinkingLevel);
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError, 'Could not load session settings.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client]);

  const selectedModelKey = `${modelProvider}/${modelId}`;
  const modelOptions = useMemo(() => {
    if (models.some((model) => `${model.provider}/${model.id}` === selectedModelKey)) return models;
    if (!modelProvider || !modelId) return models;
    return [{ provider: modelProvider, id: modelId, name: modelId }, ...models];
  }, [modelId, modelProvider, models, selectedModelKey]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const destination = path.trim();
    if (!destination) {
      setError(t('index.enterPath'));
      return;
    }
    if (!modelProvider || !modelId) {
      setError('Choose a provider and model.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const result = await client.createSession({
        path: destination,
        modelProvider,
        modelId,
        thinkingLevel,
      });
      if (!result.ok || !result.id) throw new Error(t('index.failedCreateSession'));
      onCreated(result.id);
    } catch (createError) {
      setError(errorMessage(createError, t('index.failedCreateSession')));
      setCreating(false);
    }
  };

  return (
    <section className="mobile-stack-screen mobile-new-task" aria-label="New task">
      <header className="mobile-nav-header">
        <button
          type="button"
          className="mobile-icon-button"
          aria-label={t('common.close')}
          onClick={onClose}
        >
          <X aria-hidden="true" size={21} />
        </button>
        <div>
          <p className="mobile-eyebrow">{host.instanceName}</p>
          <h1>New Task</h1>
        </div>
        <div className="mobile-header-spacer" />
      </header>

      <form className="mobile-new-task-form" onSubmit={submit}>
        <div className="mobile-form-scroll">
          <section className="mobile-form-section">
            <label htmlFor="mobile-task-path">Destination folder</label>
            <div className="mobile-input-with-icon">
              <Folder aria-hidden="true" size={18} />
              <input
                id="mobile-task-path"
                name="path"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder={t('index.sessionPathPlaceholder')}
                value={path}
                onChange={(event) => setPath(event.currentTarget.value)}
                disabled={loading || creating}
              />
            </div>
            <p>The new session starts on {host.instanceName}.</p>
          </section>

          <section className="mobile-form-section" aria-labelledby="mobile-task-runtime-heading">
            <div className="mobile-section-heading">
              <div>
                <p className="mobile-eyebrow">Runtime</p>
                <h2 id="mobile-task-runtime-heading">Task settings</h2>
              </div>
              {loading && <span role="status">Loading…</span>}
            </div>
            <label htmlFor="mobile-task-model">Provider and model</label>
            <select
              id="mobile-task-model"
              aria-label="Provider and model"
              value={selectedModelKey}
              disabled={loading || creating}
              onChange={(event) => {
                const selected = models.find(
                  (model) => `${model.provider}/${model.id}` === event.currentTarget.value,
                );
                if (!selected) return;
                setModelProvider(selected.provider);
                setModelId(selected.id);
              }}
            >
              {modelOptions.map((model) => (
                <option
                  key={`${model.provider}/${model.id}`}
                  value={`${model.provider}/${model.id}`}
                >
                  {model.provider} · {model.name || model.id}
                </option>
              ))}
            </select>

            <label htmlFor="mobile-task-thinking">Thinking</label>
            <select
              id="mobile-task-thinking"
              aria-label="Thinking level"
              value={thinkingLevel}
              disabled={loading || creating}
              onChange={(event) => setThinkingLevel(event.currentTarget.value as ThinkingLevel)}
            >
              {THINKING_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </section>

          <section className="mobile-destination-card" aria-label="New task destination">
            <p className="mobile-eyebrow">Ready to create</p>
            <dl>
              <div>
                <dt>Host</dt>
                <dd>{host.instanceName}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{modelProvider || 'Loading…'}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{modelId || 'Loading…'}</dd>
              </div>
              <div>
                <dt>Thinking</dt>
                <dd>{thinkingLevel}</dd>
              </div>
            </dl>
          </section>

          {error && (
            <p className="mobile-form-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="mobile-form-footer">
          <button
            className="mobile-primary-button mobile-wide-button"
            type="submit"
            disabled={loading || creating || !modelProvider || !modelId}
          >
            <Plus aria-hidden="true" size={19} />
            {creating ? 'Creating task…' : 'Create task'}
          </button>
        </footer>
      </form>
    </section>
  );
}

export function SessionsScreen({ client, navigate, internalLink }: SessionsScreenProps) {
  const host = useMemo(() => client.getHostContext(), [client]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [runningIds, setRunningIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_ROW_LIMIT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNewTask, setShowNewTask] = useState(false);

  const loadSessions = useCallback(() => {
    setError('');
    return client
      .listSessions({ limit: SESSION_CACHE_LIMIT, offset: 0 })
      .then((result) => setSessions(result.sessions))
      .catch((loadError) => setError(errorMessage(loadError, 'Could not load sessions.')))
      .finally(() => setLoading(false));
  }, [client]);

  useEffect(() => {
    void loadSessions();
    const subscription = client.subscribe('__all__', {
      onEvent(name, payload) {
        if (name === 'status-snapshot') {
          const snapshot = payload as StatusSnapshot;
          setRunningIds(new Set(snapshot.running));
        } else if (name === 'status-delta') {
          const status = payload as SessionStatus;
          setRunningIds((current) => {
            const next = new Set(current);
            if (status.running) next.add(status.id);
            else next.delete(status.id);
            return next;
          });
        } else if (name === 'new-session' || name === 'reload') {
          void loadSessions();
        }
      },
    });
    return () => subscription.close();
  }, [client, loadSessions]);

  useEffect(() => setVisibleLimit(INITIAL_ROW_LIMIT), [project, query]);

  const projects = useMemo(
    () => Array.from(new Set(sessions.map((session) => session.project).filter(Boolean))).sort(),
    [sessions],
  );
  const orderedSessions = useMemo(
    () =>
      sessions
        .filter((session) => matchesSession(session, query, project))
        .sort((left, right) => {
          const runningDelta = Number(runningIds.has(right.id)) - Number(runningIds.has(left.id));
          if (runningDelta) return runningDelta;
          return Date.parse(right.lastActivity) - Date.parse(left.lastActivity);
        }),
    [project, query, runningIds, sessions],
  );
  const visibleSessions = orderedSessions.slice(0, visibleLimit);

  return (
    <main className="mobile-screen mobile-home" data-mobile-route="sessions">
      <header className="mobile-home-header">
        <div>
          <p className="mobile-eyebrow">Pi sessions</p>
          <HostSwitcher host={host} />
        </div>
        <div className="mobile-header-actions">
          {internalLink(
            '/settings',
            <>
              <Settings aria-hidden="true" size={20} />
              <span className="mobile-visually-hidden">{t('settings.title')}</span>
            </>,
            'mobile-icon-button',
          )}
          <button
            type="button"
            className="mobile-primary-icon-button"
            aria-label="New task"
            onClick={() => setShowNewTask(true)}
          >
            <Plus aria-hidden="true" size={21} />
          </button>
        </div>
      </header>

      <section className="mobile-session-controls" aria-label="Filter sessions">
        <label className="mobile-search-field">
          <Search aria-hidden="true" size={17} />
          <span className="mobile-visually-hidden">Search sessions</span>
          <input
            type="search"
            placeholder={t('index.searchSessions')}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label className="mobile-project-filter">
          <span className="mobile-visually-hidden">Filter by project</span>
          <select value={project} onChange={(event) => setProject(event.currentTarget.value)}>
            <option value="">All projects</option>
            {projects.map((projectPath) => (
              <option key={projectPath} value={projectPath}>
                {projectLabel(projectPath)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="mobile-session-list" aria-label="Sessions">
        <div className="mobile-list-heading">
          <h1>{runningIds.size > 0 ? t('index.runningNow') : t('index.recentSessions')}</h1>
          <span>{orderedSessions.length}</span>
        </div>
        {loading && (
          <p className="mobile-list-status" role="status">
            {t('index.loadingSessions')}
          </p>
        )}
        {error && (
          <div className="mobile-list-status" role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="mobile-secondary-button"
              onClick={() => void loadSessions()}
            >
              {t('common.retry')}
            </button>
          </div>
        )}
        {!loading && !error && visibleSessions.length === 0 && (
          <div className="mobile-empty-state">
            <h2>{query || project ? 'No matching sessions' : t('index.noSessionsYet')}</h2>
            <p>
              {query || project ? 'Try another search or project.' : t('index.noSessionsYetHint')}
            </p>
          </div>
        )}
        <div className="mobile-session-rows">
          {visibleSessions.map((session) => {
            const running = runningIds.has(session.id);
            const url = `/session?id=${encodeURIComponent(session.id)}`;
            return internalLink(
              url,
              <>
                <span className={`mobile-session-indicator${running ? ' is-running' : ''}`}>
                  <Circle aria-hidden="true" size={10} fill="currentColor" />
                </span>
                <span className="mobile-session-copy">
                  <strong>{session.name || t('index.untitledSession')}</strong>
                  <span>
                    {projectLabel(session.project)}
                    {session.model ? ` · ${session.model}` : ''}
                  </span>
                </span>
                <span className="mobile-session-meta">
                  {running ? t('index.running') : formatActivity(session.lastActivity)}
                </span>
                <ChevronRight aria-hidden="true" size={18} />
              </>,
              `mobile-session-row${running ? ' is-running' : ''}`,
            );
          })}
        </div>
        {visibleLimit < orderedSessions.length && (
          <button
            type="button"
            className="mobile-load-more"
            onClick={() => setVisibleLimit((current) => current + INITIAL_ROW_LIMIT)}
          >
            {t('index.loadMore')}
          </button>
        )}
      </section>

      {showNewTask && (
        <NewTaskScreen
          client={client}
          host={host}
          onClose={() => setShowNewTask(false)}
          onCreated={(id) => navigate(`/session?id=${encodeURIComponent(id)}`)}
        />
      )}
    </main>
  );
}

export const mobileSessionsTestHooks = {
  initialRowLimit: INITIAL_ROW_LIMIT,
  sessionCacheLimit: SESSION_CACHE_LIMIT,
};
