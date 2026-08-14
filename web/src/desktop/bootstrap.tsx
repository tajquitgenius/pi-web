import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPiWebClient } from '../live-shared';
import { DesktopApp } from './DesktopApp';
import './desktop.css';

const target = document.getElementById('spa-root');
if (target) {
  createRoot(target).render(
    <StrictMode>
      <DesktopApp client={createPiWebClient()} />
    </StrictMode>,
  );
}
