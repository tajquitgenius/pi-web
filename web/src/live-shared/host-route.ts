export interface HostRoute {
  hostId: string;
  routeBase: string;
  transportBase: string;
}

const REMOTE_HOST_PATH = /^\/hosts\/([a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?)(?:\/|$)/;

export function resolveHostRoute(pathname: string): HostRoute {
  const match = REMOTE_HOST_PATH.exec(pathname);
  if (!match) return { hostId: 'main', routeBase: '', transportBase: '' };
  const hostId = match[1]!;
  return {
    hostId,
    routeBase: `/hosts/${hostId}`,
    transportBase: `/_host/${hostId}`,
  };
}
