import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import type { PiWebClient, SessionSummary } from '../live-shared';
import { ConversationScreen } from './conversation-screen';
import { PairingScreen } from './pairing-screen';
import { SessionsScreen } from './sessions-screen';
import { SettingsScreen } from './settings-screen';
import {
  MobileNavigationDrawer,
  MobileNavigationProvider,
  type MobileNavigationContextValue,
} from './mobile-navigation-drawer';

export interface MobileAppProps {
  client: PiWebClient;
  path: string;
  search: string;
  topLevelNavigate?: (url: string) => void;
}

interface RouteState {
  path: string;
  search: string;
}

export function shouldHandleInternalNavigation(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function MobileApp({
  client,
  path: initialPath,
  search: initialSearch,
  topLevelNavigate = (url) => window.location.assign(url),
}: MobileAppProps) {
  const [route, setRoute] = useState<RouteState>({ path: initialPath, search: initialSearch });
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [newTaskRequest, setNewTaskRequest] = useState(0);
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [recentsLoading, setRecentsLoading] = useState(false);
  const [recentsError, setRecentsError] = useState(false);

  useEffect(() => {
    const syncRoute = () => {
      setRoute({ path: window.location.pathname, search: window.location.search });
    };
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  const navigate = (url: string) => {
    const next = new URL(url, window.location.href);
    window.history.pushState({}, '', `${next.pathname}${next.search}${next.hash}`);
    setRoute({ path: next.pathname, search: next.search });
  };

  const navigation = useMemo<MobileNavigationContextValue>(
    () => ({
      openDrawer: () => setNavigationOpen(true),
      closeDrawer: () => setNavigationOpen(false),
    }),
    [],
  );

  const requestNewTask = () => {
    navigate('/');
    setNewTaskRequest((current) => current + 1);
  };

  useEffect(() => {
    if (!navigationOpen || route.path === '/') return;
    let active = true;
    setRecentsLoading(true);
    setRecentsError(false);
    client
      .listSessions({ limit: 12, offset: 0 })
      .then((result) => {
        if (active) setRecentSessions(result.sessions);
      })
      .catch(() => {
        if (active) setRecentsError(true);
      })
      .finally(() => {
        if (active) setRecentsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, navigationOpen, route.path]);

  const internalLink = (url: string, children: ReactNode, className?: string, key?: string) => (
    <a
      key={key}
      className={className}
      href={url}
      onClick={(event) => {
        if (!shouldHandleInternalNavigation(event)) return;
        event.preventDefault();
        navigate(url);
      }}
    >
      {children}
    </a>
  );

  let screen: ReactNode;
  if (route.path === '/') {
    screen = (
      <SessionsScreen
        client={client}
        navigate={navigate}
        internalLink={internalLink}
        search={route.search}
        newTaskRequest={newTaskRequest}
        onOpenNavigation={navigation.openDrawer}
        onRecentSessionsChange={setRecentSessions}
      />
    );
  } else if (route.path === '/session') {
    const sessionId = new URLSearchParams(route.search).get('id') ?? '';
    screen = (
      <ConversationScreen
        key={sessionId}
        client={client}
        sessionId={sessionId}
        internalLink={internalLink}
      />
    );
  } else if (route.path === '/settings') {
    screen = (
      <SettingsScreen
        client={client}
        internalLink={internalLink}
        onOpenNavigation={navigation.openDrawer}
      />
    );
  } else if (route.path === '/pairing') {
    screen = (
      <PairingScreen
        client={client}
        topLevelNavigate={topLevelNavigate}
        onOpenNavigation={navigation.openDrawer}
      />
    );
  } else {
    screen = (
      <main className="mobile-screen mobile-centered-screen" data-mobile-route="not-found">
        <div className="mobile-empty-state">
          <p className="mobile-eyebrow">404</p>
          <h1>Page not found</h1>
          {internalLink('/', 'Return to sessions', 'mobile-primary-link')}
        </div>
      </main>
    );
  }

  const host = client.getHostContext();

  return (
    <MobileNavigationProvider value={navigation}>
      <div className="mobile-app">
        {screen}
        {navigationOpen && (
          <MobileNavigationDrawer
            host={host}
            currentPath={route.path}
            currentSearch={route.search}
            recentSessions={recentSessions}
            recentsLoading={recentsLoading}
            recentsError={recentsError}
            onNavigate={navigate}
            onNewTask={requestNewTask}
            onClose={navigation.closeDrawer}
          />
        )}
      </div>
    </MobileNavigationProvider>
  );
}
