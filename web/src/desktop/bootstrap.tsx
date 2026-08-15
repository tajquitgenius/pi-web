import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPiWebClient, installReleaseRefresh, resolveHostRoute } from '../live-shared';
import { DesktopApp } from './DesktopApp';
import './desktop.css';

installReleaseRefresh({
  runningBuild: document.querySelector<HTMLMetaElement>('meta[name="pi-web-build"]')?.content || '',
  product: 'desktop',
});

const target = document.getElementById('spa-root');
const hostRoute = resolveHostRoute(window.location.pathname);
if (target) {
  createRoot(target).render(
    <StrictMode>
      <DesktopApp
        client={createPiWebClient({
          basePath: hostRoute.transportBase,
          selectedHostId: hostRoute.hostId,
        })}
        routeBase={hostRoute.routeBase}
      />
    </StrictMode>,
  );
}
