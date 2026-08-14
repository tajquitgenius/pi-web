import {
  ExternalLink,
  HardDrive,
  Laptop,
  LoaderCircle,
  Monitor,
  Network,
  RefreshCw,
  Server,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { HostContext, PairedDevice, PiWebClient } from '../live-shared';
import { currentSurfaceOverride } from './desktop-model';

interface SettingsPageProps {
  client: PiWebClient;
  host: HostContext;
}

function formatDeviceDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Unknown';
}

export function SettingsPage({ client, host }: SettingsPageProps) {
  const [surface, setSurface] = useState(() => currentSurfaceOverride(document.cookie));
  const [surfaceSaved, setSurfaceSaved] = useState(false);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState('');
  const [revoking, setRevoking] = useState('');

  const loadDevices = () => {
    setDevicesLoading(true);
    setDevicesError('');
    void client
      .listPairedDevices()
      .then((result) => setDevices(result.devices))
      .catch((reason: unknown) => {
        setDevicesError(
          reason instanceof Error
            ? reason.message
            : 'Paired devices can only be managed on the local host.',
        );
      })
      .finally(() => setDevicesLoading(false));
  };

  useEffect(loadDevices, [client]);

  const saveSurface = () => {
    document.cookie = `pi-web-surface=${surface}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setSurfaceSaved(true);
  };

  const revoke = async (deviceId: string) => {
    setRevoking(deviceId);
    setDevicesError('');
    try {
      await client.revokePairedDevice(deviceId);
      setDevices((current) => current.filter((device) => device.id !== deviceId));
    } catch (reason) {
      setDevicesError(reason instanceof Error ? reason.message : 'Could not revoke this device.');
    } finally {
      setRevoking('');
    }
  };

  return (
    <main className="desktop-main-pane desktop-settings-page" data-desktop-route="settings">
      <header className="desktop-session-header">
        <div className="desktop-session-title">
          <span>pi-web</span>
          <strong>Settings</strong>
        </div>
      </header>
      <div className="desktop-settings-scroll" data-testid="settings-scroll-pane">
        <div className="desktop-settings-boundary">
          <div className="desktop-settings-heading">
            <h1>Settings</h1>
            <p>Choose this browser’s product surface and manage access to the current host.</p>
          </div>

          <section className="desktop-settings-section">
            <div className="desktop-settings-section-copy">
              <Monitor aria-hidden="true" size={17} />
              <div>
                <h2>Product surface</h2>
                <p>
                  The override is stored for this browser and takes effect on the next page load.
                </p>
              </div>
            </div>
            <div className="desktop-setting-card desktop-surface-options">
              <label data-selected={surface === 'auto' || undefined}>
                <input
                  checked={surface === 'auto'}
                  name="surface"
                  onChange={() => {
                    setSurface('auto');
                    setSurfaceSaved(false);
                  }}
                  type="radio"
                />
                <span className="desktop-setting-icon">
                  <Laptop aria-hidden="true" size={16} />
                </span>
                <span>
                  <strong>Automatic</strong>
                  <small>Use the browser and device type</small>
                </span>
              </label>
              <label data-selected={surface === 'desktop' || undefined}>
                <input
                  checked={surface === 'desktop'}
                  name="surface"
                  onChange={() => {
                    setSurface('desktop');
                    setSurfaceSaved(false);
                  }}
                  type="radio"
                />
                <span className="desktop-setting-icon">
                  <Monitor aria-hidden="true" size={16} />
                </span>
                <span>
                  <strong>Desktop</strong>
                  <small>Always use the multi-pane workspace</small>
                </span>
              </label>
              <label data-selected={surface === 'mobile' || undefined}>
                <input
                  checked={surface === 'mobile'}
                  name="surface"
                  onChange={() => {
                    setSurface('mobile');
                    setSurfaceSaved(false);
                  }}
                  type="radio"
                />
                <span className="desktop-setting-icon">
                  <Smartphone aria-hidden="true" size={16} />
                </span>
                <span>
                  <strong>Mobile</strong>
                  <small>Always use the touch-first product</small>
                </span>
              </label>
              <div className="desktop-setting-actions">
                <button className="desktop-secondary-button" onClick={saveSurface} type="button">
                  {surfaceSaved ? 'Saved' : 'Save override'}
                </button>
              </div>
            </div>
          </section>

          <section className="desktop-settings-section">
            <div className="desktop-settings-section-copy">
              <Network aria-hidden="true" size={17} />
              <div>
                <h2>Host context</h2>
                <p>Every request stays bound to the environment shown here.</p>
              </div>
            </div>
            <div className="desktop-setting-card desktop-host-context-card">
              <div className="desktop-current-host">
                <span className="desktop-setting-icon">
                  <Server aria-hidden="true" size={16} />
                </span>
                <div>
                  <strong>{host.instanceName}</strong>
                  <span>{host.currentUrl || window.location.origin}</span>
                </div>
                <span className="desktop-current-chip">Current</span>
              </div>
              {host.peers.length ? (
                <div className="desktop-peer-list">
                  {host.peers.map((peer) => (
                    <a href={peer.url} key={`${peer.url}:${peer.label}`}>
                      <Server aria-hidden="true" size={14} />
                      <span>{peer.label}</span>
                      <ExternalLink aria-hidden="true" size={12} />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="desktop-setting-empty">No other hosts are advertised.</p>
              )}
            </div>
          </section>

          <section className="desktop-settings-section">
            <div className="desktop-settings-section-copy">
              <HardDrive aria-hidden="true" size={17} />
              <div>
                <h2>Paired devices</h2>
                <p>Device administration is available only from the local computer.</p>
              </div>
            </div>
            <div className="desktop-setting-card desktop-devices-card">
              <div className="desktop-device-toolbar">
                <span>{devices.length} active devices</span>
                <button
                  aria-label="Refresh paired devices"
                  className="desktop-icon-button"
                  disabled={devicesLoading}
                  onClick={loadDevices}
                  type="button"
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={devicesLoading ? 'desktop-spin' : ''}
                    size={14}
                  />
                </button>
              </div>
              {devicesLoading ? (
                <div className="desktop-setting-empty">
                  <LoaderCircle aria-hidden="true" className="desktop-spin" size={14} /> Loading
                  devices…
                </div>
              ) : devicesError ? (
                <div className="desktop-setting-error">{devicesError}</div>
              ) : devices.length ? (
                <ul className="desktop-device-list">
                  {devices.map((device) => (
                    <li key={device.id}>
                      <span className="desktop-device-icon">
                        <Smartphone aria-hidden="true" size={15} />
                      </span>
                      <div>
                        <strong>{device.label}</strong>
                        <span>Last used {formatDeviceDate(device.lastUsedAt)}</span>
                        <small>Expires {formatDeviceDate(device.expiresAt)}</small>
                      </div>
                      <button
                        aria-label={`Revoke ${device.label}`}
                        className="desktop-danger-button"
                        disabled={revoking === device.id}
                        onClick={() => void revoke(device.id)}
                        type="button"
                      >
                        {revoking === device.id ? (
                          <LoaderCircle aria-hidden="true" className="desktop-spin" size={13} />
                        ) : (
                          <Trash2 aria-hidden="true" size={13} />
                        )}
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="desktop-setting-empty">No remote devices are paired.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
