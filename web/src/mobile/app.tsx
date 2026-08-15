import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type TouchEvent,
} from 'react';
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
  routeBase?: string;
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
  routeBase = '',
  topLevelNavigate = (url) => window.location.assign(url),
}: MobileAppProps) {
  const logicalPath = (path: string) => {
    if (!routeBase) return path;
    if (path === routeBase || path === `${routeBase}/`) return '/';
    return path.startsWith(`${routeBase}/`) ? path.slice(routeBase.length) : path;
  };
  const physicalURL = (url: string) => {
    const destination = new URL(url, window.location.origin);
    return `${routeBase}${destination.pathname}${destination.search}${destination.hash}`;
  };
  const [route, setRoute] = useState<RouteState>({
    path: logicalPath(initialPath),
    search: initialSearch,
  });
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [newTaskRequest, setNewTaskRequest] = useState(0);
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [recentsLoading, setRecentsLoading] = useState(false);
  const [recentsError, setRecentsError] = useState(false);
  const navigationSwipeStart = useRef<{
    identifier: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const syncRoute = () => {
      setRoute({ path: logicalPath(window.location.pathname), search: window.location.search });
    };
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, [routeBase]);

  const navigate = (url: string) => {
    const next = new URL(url, window.location.origin);
    window.history.pushState({}, '', physicalURL(url));
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

  const startNavigationSwipe = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches.length === 1 ? event.touches[0] : null;
    let gestureOwnedByContent = false;
    if (event.target instanceof Element) {
      gestureOwnedByContent = Boolean(
        event.target.closest(
          'a, button, input, textarea, select, summary, [contenteditable="true"], [role="button"], [role="dialog"], [role="link"], [role="slider"]',
        ),
      );
      for (
        let element: Element | null = event.target;
        element && element !== event.currentTarget;
        element = element.parentElement
      ) {
        const style = getComputedStyle(element);
        if (
          /^(auto|scroll|overlay)$/.test(style.overflowX) &&
          element.scrollWidth > element.clientWidth
        ) {
          gestureOwnedByContent = true;
          break;
        }
      }
    }
    navigationSwipeStart.current =
      !navigationOpen && touch && !gestureOwnedByContent
        ? { identifier: touch.identifier, x: touch.clientX, y: touch.clientY }
        : null;
  };

  const moveNavigationSwipe = (event: TouchEvent<HTMLDivElement>) => {
    const start = navigationSwipeStart.current;
    if (!start) return;
    const touch = Array.from(event.touches).find(
      (candidate) => candidate.identifier === start.identifier,
    );
    if (!touch) {
      navigationSwipeStart.current = null;
      return;
    }
    const deltaX = touch.clientX - start.x;
    const deltaY = Math.abs(touch.clientY - start.y);
    if ((deltaY > 12 && deltaY > Math.abs(deltaX)) || deltaX < -12) {
      navigationSwipeStart.current = null;
    }
  };

  const finishNavigationSwipe = (event: TouchEvent<HTMLDivElement>) => {
    const start = navigationSwipeStart.current;
    navigationSwipeStart.current = null;
    if (!start) return;
    const touch = Array.from(event.changedTouches).find(
      (candidate) => candidate.identifier === start.identifier,
    );
    if (!touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = Math.abs(touch.clientY - start.y);
    if (deltaX >= 56 && deltaX > deltaY * 1.25) setNavigationOpen(true);
  };

  const internalLink = (url: string, children: ReactNode, className?: string, key?: string) => (
    <a
      key={key}
      className={className}
      href={physicalURL(url)}
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
        navigate={navigate}
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
      <div
        className="mobile-app"
        onTouchStart={startNavigationSwipe}
        onTouchMove={moveNavigationSwipe}
        onTouchEnd={finishNavigationSwipe}
        onTouchCancel={() => {
          navigationSwipeStart.current = null;
        }}
      >
        {screen}
        {navigationOpen && (
          <MobileNavigationDrawer
            host={host}
            currentPath={route.path}
            currentSearch={route.search}
            routeBase={routeBase}
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
