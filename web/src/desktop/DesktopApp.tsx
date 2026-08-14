import { AlertCircle, Home } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type {
  PiModel,
  PiWebClient,
  SessionStatus,
  SessionSummary,
  StatusSnapshot,
} from '../live-shared';
import { SessionPage } from './Conversation';
import {
  DETAILS_OPEN_KEY,
  readStoredBoolean,
  readStoredWidth,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_WIDTH_KEY,
} from './desktop-model';
import { NewTaskPage } from './NewTask';
import { PairingPage } from './Pairing';
import { SettingsPage } from './Settings';
import { HostRail, ProjectSidebar } from './Sidebar';

interface RouteLocation {
  path: string;
  search: string;
}

export interface DesktopAppProps {
  client: PiWebClient;
  navigateImpl?: (destination: string) => void;
  path?: string;
  search?: string;
}

function destinationLocation(destination: string): RouteLocation {
  const url = new URL(destination, window.location.origin);
  return { path: url.pathname, search: url.search };
}

function runningFromSnapshot(snapshot: StatusSnapshot): Set<string> {
  return new Set([
    ...snapshot.running,
    ...Object.values(snapshot.statuses)
      .filter((status) => status.running)
      .map((status) => status.id),
  ]);
}

function WorkspaceProduct({
  client,
  navigate,
  route,
}: {
  client: PiWebClient;
  navigate: (destination: string) => void;
  route: RouteLocation;
}) {
  const host = client.getHostContext();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState('');
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(new Set());
  const [models, setModels] = useState<PiModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readStoredBoolean(localStorage, SIDEBAR_COLLAPSED_KEY, false),
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredWidth(localStorage));
  const [detailsOpen, setDetailsOpen] = useState(() =>
    readStoredBoolean(localStorage, DETAILS_OPEN_KEY, false),
  );

  const activeSessionId =
    route.path === '/session' ? (new URLSearchParams(route.search).get('id') ?? '') : '';

  const loadSessions = useCallback(async () => {
    setSessionsError('');
    try {
      const result = await client.listSessions({ limit: 500 });
      setSessions(result.sessions);
    } catch (reason) {
      setSessionsError(reason instanceof Error ? reason.message : 'Could not load threads.');
    } finally {
      setSessionsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadSessions();
    void client
      .listModels()
      .then((result) => setModels(result.models))
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false));
    const subscription = client.subscribe('__all__', {
      onEvent: (name, payload) => {
        if (name === 'status-snapshot') {
          setRunningSessionIds(runningFromSnapshot(payload as StatusSnapshot));
        } else if (name === 'status-delta') {
          const status = payload as SessionStatus;
          setRunningSessionIds((current) => {
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key.toLocaleLowerCase() === 'b') {
        event.preventDefault();
        setSidebarCollapsed((current) => {
          const next = !current;
          try {
            localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
          } catch {}
          return next;
        });
      } else if (event.key.toLocaleLowerCase() === 't') {
        event.preventDefault();
        navigate('/');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {}
      return next;
    });
  };
  const changeSidebarWidth = (width: number) => {
    setSidebarWidth(width);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    } catch {}
  };
  const toggleDetails = () => {
    setDetailsOpen((current) => {
      const next = !current;
      try {
        localStorage.setItem(DETAILS_OPEN_KEY, String(next));
      } catch {}
      return next;
    });
  };

  const selectedSummary = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions],
  );
  const shellStyle = { '--desktop-sidebar-width': `${sidebarWidth}px` } as CSSProperties;

  let content: React.ReactNode;
  if (route.path === '/') {
    content = (
      <NewTaskPage
        client={client}
        models={models}
        modelsLoading={modelsLoading}
        navigate={navigate}
        sessions={sessions}
      />
    );
  } else if (route.path === '/session') {
    content = (
      <SessionPage
        client={client}
        detailsOpen={detailsOpen}
        initialRunning={runningSessionIds.has(activeSessionId)}
        key={activeSessionId}
        models={models}
        onDetailsToggle={toggleDetails}
        selectedSummary={selectedSummary}
        sessionId={activeSessionId}
      />
    );
  } else if (route.path === '/settings') {
    content = <SettingsPage client={client} host={host} />;
  } else {
    content = (
      <main className="desktop-main-pane" data-desktop-route="not-found">
        <div className="desktop-empty-state">
          <AlertCircle aria-hidden="true" size={22} />
          <h1>Page not found</h1>
          <p>This route is not part of the desktop product.</p>
          <button className="desktop-secondary-button" onClick={() => navigate('/')} type="button">
            <Home aria-hidden="true" size={14} /> Return to workspace
          </button>
        </div>
      </main>
    );
  }

  return (
    <div
      className="desktop-product-shell"
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-testid="desktop-product-shell"
      style={shellStyle}
    >
      <HostRail
        host={host}
        navigate={navigate}
        onToggleSidebar={toggleSidebar}
        path={route.path}
        sidebarCollapsed={sidebarCollapsed}
      />
      <ProjectSidebar
        activeSessionId={activeSessionId}
        collapsed={sidebarCollapsed}
        host={host}
        loading={sessionsLoading}
        navigate={navigate}
        onToggle={toggleSidebar}
        onWidthChange={changeSidebarWidth}
        runningSessionIds={runningSessionIds}
        sessions={sessions}
        width={sidebarWidth}
      />
      <div className="desktop-workspace-panes" data-testid="workspace-panes">
        {content}
      </div>
      {sessionsError ? <div className="desktop-global-error">{sessionsError}</div> : null}
    </div>
  );
}

export function DesktopApp({ client, navigateImpl, path, search }: DesktopAppProps) {
  const [route, setRoute] = useState<RouteLocation>(() => ({
    path: path ?? window.location.pathname,
    search: search ?? window.location.search,
  }));

  useEffect(() => {
    document.documentElement.classList.add('desktop-product');
    document.body.classList.add('desktop-no-scroll');
    return () => {
      document.documentElement.classList.remove('desktop-product');
      document.body.classList.remove('desktop-no-scroll');
    };
  }, []);

  useEffect(() => {
    if (path !== undefined) setRoute({ path, search: search ?? '' });
  }, [path, search]);

  useEffect(() => {
    if (path !== undefined) return;
    const handlePopState = () =>
      setRoute({ path: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [path]);

  const navigate = useCallback(
    (destination: string) => {
      const next = destinationLocation(destination);
      if (navigateImpl) navigateImpl(destination);
      else window.history.pushState({}, '', destination);
      setRoute(next);
    },
    [navigateImpl],
  );

  const host = client.getHostContext();
  if (route.path === '/pairing') {
    return <PairingPage client={client} host={host} navigate={navigate} />;
  }
  return <WorkspaceProduct client={client} navigate={navigate} route={route} />;
}
