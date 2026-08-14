const DEFAULT_INSTANCE_NAME = 'This computer';

export function readHostContext({ documentImpl = document } = {}) {
  const fallback = { instanceName: DEFAULT_INSTANCE_NAME, currentUrl: '', peers: [] };
  const el = documentImpl?.getElementById?.('pi-host-context');
  if (!el?.textContent) return fallback;

  try {
    const parsed = JSON.parse(el.textContent);
    const instanceName =
      typeof parsed?.instanceName === 'string' && parsed.instanceName.trim()
        ? parsed.instanceName.trim()
        : DEFAULT_INSTANCE_NAME;
    const currentUrl = typeof parsed?.currentUrl === 'string' ? parsed.currentUrl : '';
    const peers = Array.isArray(parsed?.peers)
      ? parsed.peers
          .filter(
            (peer) =>
              peer &&
              typeof peer.label === 'string' &&
              peer.label.trim() &&
              typeof peer.url === 'string' &&
              peer.url,
          )
          .map((peer) => ({ label: peer.label.trim(), url: peer.url }))
      : [];
    return { instanceName, currentUrl, peers };
  } catch {
    return fallback;
  }
}
