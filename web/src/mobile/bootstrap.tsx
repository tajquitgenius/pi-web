import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPiWebClient, installReleaseRefresh } from '../live-shared';
import { MobileApp } from './app';
import './mobile.css';
import './home-redesign.css';
import './conversation-redesign.css';
import './navigation-drawer.css';

installReleaseRefresh({
  runningBuild: document.querySelector<HTMLMetaElement>('meta[name="pi-web-build"]')?.content || '',
  product: 'mobile',
});

const target = document.getElementById('spa-root');
if (target) {
  createRoot(target).render(
    <StrictMode>
      <MobileApp
        client={createPiWebClient()}
        path={window.location.pathname}
        search={window.location.search}
      />
    </StrictMode>,
  );
}
