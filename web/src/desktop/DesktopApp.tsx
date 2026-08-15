import { AlertCircle, Home, PanelLeftOpen, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  isPhoneViewport,
  writeSurfaceOverride,
  type PiModel,
  type PiWebClient,
  type SessionStatus,
  type SessionSummary,
  type StatusSnapshot,
} from '../live-shared';
import { t } from '../shared/i18n.js';
import { CommandPalette } from './CommandPalette';
import { SessionPage } from './Conversation';
import {
  DETAILS_OPEN_KEY,
  RIGHT_PANEL_TAB_KEY,
  RIGHT_PANEL_WIDTH_KEY,
  readStoredBoolean,
  readStoredPanelTab,
  readStoredWidth,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_WIDTH_KEY,
} from './desktop-model';
import type { RightPanelTab } from './RightPanel';
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
  routeBase?: string;
}

function destinationLocation(destination: string): RouteLocation {
  const url = new URL(destination, window.location.origin);
  return { path: url.pathname, search: url.search };
}

function ReturnToMobileControl() {
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return (
    <a
      aria-label={t('settings.returnToMobile')}
      className="desktop-return-to-mobile"
      href={currentPath}
      onClick={() => writeSurfaceOverride('mobile')}
      title={t('settings.returnToMobile')}
    >
      <Smartphone aria-hidden="true" size={16} />
      <span>{t('settings.returnToMobile')}</span>
    </a>
  );
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
  routeBase,
}: {
  client: PiWebClient;
  navigate: (destination: string) => void;
  route: RouteLocation;
  routeBase: string;
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
  const [panelTab, setPanelTab] = useState<RightPanelTab>(() => readStoredPanelTab(localStorage));
  const [panelWidth, setPanelWidth] = useState(() =>
    readStoredWidth(localStorage, 336, 280, 520, RIGHT_PANEL_WIDTH_KEY),
  );
  const [paletteOpen, setPaletteOpen] = useState(false);

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
      if (event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((current) => !current);
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
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
      } else if (event.key.toLocaleLowerCase() === 'p' && event.shiftKey) {
        event.preventDefault();
        setDetailsOpen((current) => {
          const next = !current;
          try {
            localStorage.setItem(DETAILS_OPEN_KEY, String(next));
          } catch {}
          return next;
        });
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
  const changePanelTab = (tab: RightPanelTab) => {
    setPanelTab(tab);
    setDetailsOpen(true);
    try {
      localStorage.setItem(RIGHT_PANEL_TAB_KEY, tab);
      localStorage.setItem(DETAILS_OPEN_KEY, 'true');
    } catch {}
  };
  const changePanelWidth = (width: number) => {
    setPanelWidth(width);
    try {
      localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(width));
    } catch {}
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
        onPanelTabChange={changePanelTab}
        onPanelWidthChange={changePanelWidth}
        panelTab={panelTab}
        panelWidth={panelWidth}
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
        routeBase={routeBase}
        sidebarCollapsed={sidebarCollapsed}
      />
      <ProjectSidebar
        activeSessionId={activeSessionId}
        client={client}
        collapsed={sidebarCollapsed}
        host={host}
        loading={sessionsLoading}
        navigate={navigate}
        onRefresh={loadSessions}
        onToggle={toggleSidebar}
        onWidthChange={changeSidebarWidth}
        runningSessionIds={runningSessionIds}
        routeBase={routeBase}
        sessions={sessions}
        width={sidebarWidth}
      />
      {!sidebarCollapsed ? (
        <div
          aria-hidden="true"
          className="desktop-mobile-sidebar-backdrop"
          data-testid="mobile-sidebar-backdrop"
          onClick={toggleSidebar}
          role="presentation"
        />
      ) : (
        <button
          aria-label="Reopen sidebar"
          className="desktop-mobile-sidebar-reopen"
          onClick={toggleSidebar}
          title="Show projects and threads"
          type="button"
        >
          <PanelLeftOpen aria-hidden="true" size={16} />
        </button>
      )}
      <div className="desktop-workspace-panes" data-testid="workspace-panes">
        {content}
      </div>
      {sessionsError ? <div className="desktop-global-error">{sessionsError}</div> : null}
      {paletteOpen ? (
        <CommandPalette
          activeSessionId={activeSessionId}
          client={client}
          navigate={navigate}
          onClose={() => setPaletteOpen(false)}
          onToggleDetails={toggleDetails}
          onToggleSidebar={toggleSidebar}
          sessions={sessions}
        />
      ) : null}
    </div>
  );
}

export function DesktopApp({
  client,
  navigateImpl,
  path,
  search,
  routeBase = '',
}: DesktopAppProps) {
  const logicalPath = useCallback(
    (pathname: string) => {
      if (!routeBase) return pathname;
      if (pathname === routeBase || pathname === `${routeBase}/`) return '/';
      return pathname.startsWith(`${routeBase}/`) ? pathname.slice(routeBase.length) : pathname;
    },
    [routeBase],
  );
  const [route, setRoute] = useState<RouteLocation>(() => ({
    path: logicalPath(path ?? window.location.pathname),
    search: search ?? window.location.search,
  }));
  const [phoneViewport, setPhoneViewport] = useState(() => isPhoneViewport(window));

  useEffect(() => {
    document.documentElement.classList.add('desktop-product');
    document.body.classList.add('desktop-no-scroll');
    return () => {
      document.documentElement.classList.remove('desktop-product');
      document.body.classList.remove('desktop-no-scroll');
    };
  }, []);

  useEffect(() => {
    if (path !== undefined) setRoute({ path: logicalPath(path), search: search ?? '' });
  }, [logicalPath, path, search]);

  useEffect(() => {
    if (path !== undefined) return;
    const handlePopState = () =>
      setRoute({ path: logicalPath(window.location.pathname), search: window.location.search });
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [logicalPath, path]);

  const navigate = useCallback(
    (destination: string) => {
      const next = destinationLocation(destination);
      if (navigateImpl) navigateImpl(destination);
      else window.history.pushState({}, '', `${routeBase}${destination}`);
      setRoute(next);
    },
    [navigateImpl, routeBase],
  );

  useEffect(() => {
    const handleResize = () => setPhoneViewport(isPhoneViewport(window));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const host = client.getHostContext();
  if (route.path === '/pairing') {
    return (
      <>
        {phoneViewport ? <ReturnToMobileControl /> : null}
        <PairingPage client={client} host={host} navigate={navigate} />
      </>
    );
  }
  return (
    <>
      {phoneViewport ? <ReturnToMobileControl /> : null}
      <WorkspaceProduct client={client} navigate={navigate} route={route} routeBase={routeBase} />
    </>
  );
}
