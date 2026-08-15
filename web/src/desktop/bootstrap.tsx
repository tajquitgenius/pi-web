import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPiWebClient, installReleaseRefresh } from '../live-shared';
import { DesktopApp } from './DesktopApp';
import './desktop.css';

installReleaseRefresh({
  runningBuild: document.querySelector<HTMLMetaElement>('meta[name="pi-web-build"]')?.content || '',
  product: 'desktop',
});

const target = document.getElementById('spa-root');
if (target) {
  createRoot(target).render(
    <StrictMode>
      <DesktopApp client={createPiWebClient()} />
    </StrictMode>,
  );
}
