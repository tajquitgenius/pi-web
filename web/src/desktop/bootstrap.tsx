import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPiWebClient, type PiWebClient } from '../live-shared';

interface DesktopAppProps {
  client: PiWebClient;
  path: string;
  search: string;
}

function DesktopApp({ client, path, search }: DesktopAppProps) {
  const host = client.getHostContext();
  if (path === '/') {
    return (
      <main data-desktop-route="sessions">
        <h1>Desktop sessions</h1>
        <p>{host.instanceName}</p>
      </main>
    );
  }
  if (path === '/session') {
    const sessionId = new URLSearchParams(search).get('id') ?? '';
    return (
      <main data-desktop-route="session">
        <h1>Desktop session</h1>
        <p>{sessionId || 'No session selected'}</p>
      </main>
    );
  }
  if (path === '/settings') {
    return (
      <main data-desktop-route="settings">
        <h1>Desktop settings</h1>
        <p>{host.instanceName}</p>
      </main>
    );
  }
  return (
    <main data-desktop-route="not-found">
      <h1>Not found</h1>
    </main>
  );
}

const target = document.getElementById('spa-root');
if (target) {
  createRoot(target).render(
    <StrictMode>
      <DesktopApp
        client={createPiWebClient()}
        path={window.location.pathname}
        search={window.location.search}
      />
    </StrictMode>,
  );
}
