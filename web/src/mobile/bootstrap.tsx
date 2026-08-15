import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPiWebClient, installReleaseRefresh, resolveHostRoute } from '../live-shared';
import { MobileApp } from './app';
import './mobile.css';
import './home-redesign.css';
import './conversation-redesign.css';
import './navigation-drawer.css';

installReleaseRefresh({
  runningBuild: document.querySelector<HTMLMetaElement>('meta[name="pi-web-build"]')?.content || '',
  product: 'mobile',
  layoutMetrics: () => {
    const viewport = window.visualViewport;
    const root = document.querySelector<HTMLElement>('.mobile-session-screen');
    const composer = document.querySelector<HTMLElement>('.mobile-composer');
    const chrome = document.querySelector<HTMLElement>('.mobile-composer-chrome');
    const rootRect = root?.getBoundingClientRect();
    const chromeRect = chrome?.getBoundingClientRect();
    return {
      screenHeight: window.screen.height,
      innerHeight: window.innerHeight,
      visualHeight: viewport?.height ?? window.innerHeight,
      visualTop: viewport?.offsetTop ?? 0,
      rootTop: rootRect?.top ?? 0,
      rootBottom: rootRect?.bottom ?? 0,
      composerTop: chromeRect?.top ?? 0,
      composerBottom: chromeRect?.bottom ?? 0,
      composerPaddingBottom: composer
        ? Number.parseFloat(getComputedStyle(composer).paddingBottom) || 0
        : 0,
    };
  },
});

const target = document.getElementById('spa-root');
const hostRoute = resolveHostRoute(window.location.pathname);
if (target) {
  createRoot(target).render(
    <StrictMode>
      <MobileApp
        client={createPiWebClient({
          basePath: hostRoute.transportBase,
          selectedHostId: hostRoute.hostId,
        })}
        path={window.location.pathname}
        search={window.location.search}
        routeBase={hostRoute.routeBase}
      />
    </StrictMode>,
  );
}
