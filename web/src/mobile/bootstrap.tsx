import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPiWebClient } from '../live-shared';
import { MobileApp } from './app';
import './mobile.css';
import './home-redesign.css';
import './conversation-redesign.css';

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
