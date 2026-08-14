import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPiWebClient, type PiWebClient } from '../live-shared';

interface MobileAppProps {
  client: PiWebClient;
  path: string;
  search: string;
}

function MobileApp({ client, path, search }: MobileAppProps) {
  const host = client.getHostContext();
  if (path === '/') {
    return (
      <main data-mobile-route="sessions">
        <h1>Mobile sessions</h1>
        <p>{host.instanceName}</p>
      </main>
    );
  }
  if (path === '/session') {
    const sessionId = new URLSearchParams(search).get('id') ?? '';
    return (
      <main data-mobile-route="session">
        <h1>Mobile session</h1>
        <p>{sessionId || 'No session selected'}</p>
      </main>
    );
  }
  if (path === '/settings') {
    return (
      <main data-mobile-route="settings">
        <h1>Mobile settings</h1>
        <p>{host.instanceName}</p>
      </main>
    );
  }
  return (
    <main data-mobile-route="not-found">
      <h1>Not found</h1>
    </main>
  );
}

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
