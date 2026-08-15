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
import { getMobileCapability, type MobileProject } from './capabilities';
import { MobileConnectivityNotice, type MobileConnectionState } from './connectivity';
import { t } from '../shared/i18n.js';

const INITIAL_ROW_LIMIT = 30;
const SESSION_CACHE_LIMIT = 120;
const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

interface SessionsScreenProps {
  client: PiWebClient;
  navigate: (url: string) => void;
  internalLink: (url: string, children: ReactNode, className?: string, key?: string) => ReactNode;
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

function HostSwitcher({
  host,
  connection,
}: {
  host: HostContext;
  connection: MobileConnectionState;
}) {
  return (
    <details className="mobile-host-switcher">
      <summary aria-label={t('host.switch', { host: host.instanceName })}>
        <Server aria-hidden="true" size={17} />
        <span>{host.instanceName}</span>
        <ChevronDown aria-hidden="true" size={15} />
      </summary>
      <div className="mobile-host-menu">
        <div className="mobile-host-current" aria-current="page">
          <span>
            {t('host.currentComputer')} · {connection === 'connected' ? 'Online' : 'Offline'}
          </span>
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
  const [recentLocations, setRecentLocations] = useState<string[]>([]);
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
        const available = result.models.some(
          (model) => model.provider === defaults.modelProvider && model.id === defaults.modelId,
        );
        if (!available) throw new Error('no authenticated model');
        setModels(result.models);
        setModelProvider(defaults.modelProvider);
        setModelId(defaults.modelId);
        setThinkingLevel(defaults.thinkingLevel);
      })
      .catch(() => {
        if (active) {
          setModels([]);
          setModelProvider('');
          setModelId('');
          setError(
            `Open Pi on ${host.instanceName} and log in to a model provider before starting a task.`,
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    const listRecentLocations = getMobileCapability(client, 'listRecentLocations');
    if (!listRecentLocations) return;
    let active = true;
    listRecentLocations
      .call(client)
      .then((result) => {
        if (active) setRecentLocations(result.locations || []);
      })
      .catch(() => {
        if (active) setRecentLocations([]);
      });
    return () => {
      active = false;
    };
  }, [client]);

  const selectedModelKey = modelProvider && modelId ? `${modelProvider}/${modelId}` : '';
  const modelOptions = useMemo(() => {
    if (models.some((model) => `${model.provider}/${model.id}` === selectedModelKey)) return models;
    if (!modelProvider || !modelId) return models;
    return [{ provider: modelProvider, id: modelId, name: modelId }, ...models];
  }, [modelId, modelProvider, models, selectedModelKey]);

  const runtimeReady =
    !loading &&
    !error &&
    models.some((model) => model.provider === modelProvider && model.id === modelId);

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
    <section
      className="mobile-stack-screen mobile-new-task mobile-task-sheet"
      role="dialog"
      aria-label="New task"
      aria-modal="true"
    >
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
                list={recentLocations.length ? 'mobile-recent-locations' : undefined}
                value={path}
                onChange={(event) => setPath(event.currentTarget.value)}
                disabled={loading || creating}
              />
              {recentLocations.length > 0 && (
                <datalist id="mobile-recent-locations">
                  {recentLocations.map((location) => (
                    <option key={location} value={location} />
                  ))}
                </datalist>
              )}
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
              {modelOptions.length ? (
                modelOptions.map((model) => (
                  <option
                    key={`${model.provider}/${model.id}`}
                    value={`${model.provider}/${model.id}`}
                  >
                    {model.provider} · {model.name || model.id}
                  </option>
                ))
              ) : (
                <option value="">{loading ? 'Loading…' : 'No authenticated models'}</option>
              )}
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
                <dd>{modelProvider || (loading ? 'Loading…' : 'Unavailable')}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{modelId || (loading ? 'Loading…' : 'Unavailable')}</dd>
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
            disabled={!runtimeReady || creating}
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
  const [connection, setConnection] = useState<MobileConnectionState>('connecting');
  const [registeredProjects, setRegisteredProjects] = useState<MobileProject[]>([]);
  const [showNewTask, setShowNewTask] = useState(false);
  const [homeView, setHomeView] = useState<'threads' | 'projects'>('threads');

  const loadSessions = useCallback(() => {
    setError('');
    setConnection('connecting');
    return client
      .listSessions({ limit: SESSION_CACHE_LIMIT, offset: 0 })
      .then((result) => {
        setSessions(result.sessions);
        setConnection('connected');
      })
      .catch((loadError) => {
        setConnection('offline');
        setError(errorMessage(loadError, 'Could not load sessions.'));
      })
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
      onOpen() {
        setConnection('connected');
      },
      onError() {
        setConnection('reconnecting');
      },
    });
    return () => subscription.close();
  }, [client, loadSessions]);

  useEffect(() => setVisibleLimit(INITIAL_ROW_LIMIT), [project, query]);

  useEffect(() => {
    const listProjects = getMobileCapability(client, 'listProjects');
    if (!listProjects) return;
    let active = true;
    listProjects
      .call(client)
      .then((result) => {
        if (active) setRegisteredProjects(result.projects || []);
      })
      .catch(() => {
        if (active) setRegisteredProjects([]);
      });
    return () => {
      active = false;
    };
  }, [client]);

  const projectPaths = useMemo(
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
  const projects = useMemo(() => {
    const grouped = new Map<string, SessionSummary[]>();
    for (const session of sessions) {
      const current = grouped.get(session.project) || [];
      current.push(session);
      grouped.set(session.project, current);
    }
    for (const registered of registeredProjects) {
      if (!grouped.has(registered.path)) grouped.set(registered.path, []);
    }
    return [...grouped.entries()]
      .map(([path, projectSessions]) => {
        const registered = registeredProjects.find((project) => project.path === path);
        return {
          path,
          label: registered?.label || registered?.name || projectLabel(path),
          sessions: projectSessions,
          running:
            projectSessions.filter((session) => runningIds.has(session.id)).length ||
            registered?.runningSessionIds?.length ||
            0,
        };
      })
      .sort((left, right) => {
        if (right.running !== left.running) return right.running - left.running;
        return left.path.localeCompare(right.path);
      });
  }, [registeredProjects, runningIds, sessions]);

  return (
    <main className="mobile-screen mobile-home" data-mobile-route="sessions">
      <header className="mobile-home-header">
        <div>
          <p className="mobile-eyebrow">Pi sessions</p>
          <HostSwitcher host={host} connection={connection} />
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

      <MobileConnectivityNotice state={connection} onRetry={() => void loadSessions()} />

      <nav className="mobile-home-tabs" aria-label="Home views">
        <button
          type="button"
          className={homeView === 'threads' ? 'is-selected' : ''}
          aria-selected={homeView === 'threads'}
          onClick={() => setHomeView('threads')}
        >
          Threads
        </button>
        <button
          type="button"
          className={homeView === 'projects' ? 'is-selected' : ''}
          aria-selected={homeView === 'projects'}
          onClick={() => setHomeView('projects')}
        >
          Projects
        </button>
      </nav>

      {homeView === 'threads' && (
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
              {projectPaths.map((projectPath) => (
                <option key={projectPath} value={projectPath}>
                  {projectLabel(projectPath)}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      {homeView === 'projects' ? (
        <section className="mobile-project-list" aria-label="Projects">
          <div className="mobile-list-heading">
            <h1>Projects</h1>
            <span>{projects.length}</span>
          </div>
          {projects.length === 0 ? (
            <div className="mobile-empty-state">
              <h2>No projects yet</h2>
              <p>Create a task to start a Pi project.</p>
            </div>
          ) : (
            <div className="mobile-project-cards">
              {projects.map((project) => (
                <button
                  key={project.path}
                  type="button"
                  className="mobile-project-card"
                  onClick={() => {
                    setProject(project.path);
                    setHomeView('threads');
                  }}
                >
                  <span className="mobile-project-card-copy">
                    <strong>{project.label}</strong>
                    <small>{project.path}</small>
                  </span>
                  <span className="mobile-project-card-meta">
                    {project.running > 0
                      ? `${project.running} running`
                      : `${project.sessions.length} ${project.sessions.length === 1 ? 'thread' : 'threads'}`}
                    <ChevronRight aria-hidden="true" size={18} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
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
                session.id,
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
      )}

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
