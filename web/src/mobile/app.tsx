import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import type { PiWebClient } from '../live-shared';
import { ConversationScreen } from './conversation-screen';
import { PairingScreen } from './pairing-screen';
import { SessionsScreen } from './sessions-screen';
import { SettingsScreen } from './settings-screen';

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

  const internalLink = (url: string, children: ReactNode, className?: string) => (
    <a
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
    screen = <SessionsScreen client={client} navigate={navigate} internalLink={internalLink} />;
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
    screen = <SettingsScreen client={client} internalLink={internalLink} />;
  } else if (route.path === '/pairing') {
    screen = <PairingScreen client={client} topLevelNavigate={topLevelNavigate} />;
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

  return <div className="mobile-app">{screen}</div>;
}
