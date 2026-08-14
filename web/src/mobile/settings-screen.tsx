import {
  ArrowLeft,
  Check,
  ChevronRight,
  ExternalLink,
  KeyRound,
  Monitor,
  Palette,
  Server,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  writeSurfaceOverride,
  type PairedDevice,
  type PairingCode,
  type PiWebClient,
} from '../live-shared';
import { t } from '../shared/i18n.js';

interface SettingsScreenProps {
  client: PiWebClient;
  internalLink: (url: string, children: ReactNode, className?: string) => ReactNode;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDate(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

function formatCodeExpiry(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

function storedTheme(): string {
  try {
    return globalThis.localStorage?.getItem('pi-web-theme') || '';
  } catch {
    return '';
  }
}

function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
  try {
    globalThis.localStorage?.setItem('pi-web-theme', theme);
    document.cookie = `pi-web-theme=${theme};path=/;SameSite=Lax;max-age=31536000`;
  } catch {
    // The visual change still applies when storage is unavailable.
  }
}

export function SettingsScreen({ client, internalLink }: SettingsScreenProps) {
  const host = useMemo(() => client.getHostContext(), [client]);
  const [theme, setTheme] = useState(
    document.documentElement.dataset.theme || storedTheme() || 'dark',
  );
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [local, setLocal] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [deviceError, setDeviceError] = useState('');
  const [revokingId, setRevokingId] = useState('');
  const [pairingCode, setPairingCode] = useState<PairingCode | null>(null);
  const [creatingCode, setCreatingCode] = useState(false);

  useEffect(() => {
    let active = true;
    client
      .getPairingStatus()
      .then(async (status) => {
        if (!active) return;
        setLocal(status.local);
        if (!status.local) return;
        const result = await client.listPairedDevices();
        if (active) setDevices(result.devices);
      })
      .catch((error) => {
        if (active) setDeviceError(errorMessage(error, 'Paired devices are unavailable here.'));
      })
      .finally(() => {
        if (active) setDevicesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client]);

  const createPairingCode = async () => {
    setCreatingCode(true);
    setDeviceError('');
    try {
      setPairingCode(await client.createPairingCode());
    } catch (error) {
      setDeviceError(errorMessage(error, t('settings.pairingCodeError')));
    } finally {
      setCreatingCode(false);
    }
  };

  const revoke = async (device: PairedDevice) => {
    setRevokingId(device.id);
    setDeviceError('');
    try {
      await client.revokePairedDevice(device.id);
      setDevices((current) => current.filter((item) => item.id !== device.id));
    } catch (error) {
      setDeviceError(errorMessage(error, 'Could not revoke this device.'));
    } finally {
      setRevokingId('');
    }
  };

  const changeTheme = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.currentTarget.value;
    setTheme(next);
    applyTheme(next);
  };

  const currentPath = `${window.location.pathname}${window.location.search}`;

  return (
    <main className="mobile-screen mobile-settings-screen" data-mobile-route="settings">
      <header className="mobile-nav-header">
        {internalLink(
          '/',
          <>
            <ArrowLeft aria-hidden="true" size={21} />
            <span className="mobile-visually-hidden">{t('common.back')}</span>
          </>,
          'mobile-icon-button',
        )}
        <div>
          <p className="mobile-eyebrow">{host.instanceName}</p>
          <h1>{t('settings.title')}</h1>
        </div>
        <div className="mobile-header-spacer" />
      </header>

      <div className="mobile-settings-scroll">
        <section className="mobile-settings-group" aria-labelledby="mobile-product-heading">
          <div className="mobile-settings-heading">
            <Monitor aria-hidden="true" size={19} />
            <div>
              <p className="mobile-eyebrow">Product</p>
              <h2 id="mobile-product-heading">Interface override</h2>
            </div>
          </div>
          <a
            className="mobile-settings-link is-current"
            href={currentPath}
            onClick={() => writeSurfaceOverride('mobile')}
          >
            <span>
              <strong>Mobile product</strong>
              <small>Dedicated touch interface</small>
            </span>
            <Check aria-hidden="true" size={18} />
          </a>
          <a
            className="mobile-settings-link"
            href={currentPath}
            onClick={() => writeSurfaceOverride('desktop')}
          >
            <span>
              <strong>Desktop product</strong>
              <small>Use the desktop React interface on this device</small>
            </span>
            <ChevronRight aria-hidden="true" size={18} />
          </a>
          <a
            className="mobile-settings-link"
            href={currentPath}
            onClick={() => writeSurfaceOverride('auto')}
          >
            <span>
              <strong>Automatic selection</strong>
              <small>Let pi-web choose for this browser</small>
            </span>
            <ChevronRight aria-hidden="true" size={18} />
          </a>
        </section>

        <section className="mobile-settings-group" aria-labelledby="mobile-appearance-heading">
          <div className="mobile-settings-heading">
            <Palette aria-hidden="true" size={19} />
            <div>
              <p className="mobile-eyebrow">Display</p>
              <h2 id="mobile-appearance-heading">{t('settings.appearance')}</h2>
            </div>
          </div>
          <label className="mobile-settings-control" htmlFor="mobile-theme-select">
            <span>
              <strong>{t('settings.theme')}</strong>
              <small>{t('settings.themeHint')}</small>
            </span>
            <select id="mobile-theme-select" value={theme} onChange={changeTheme}>
              <option value="dark">{t('settings.themeDark')}</option>
              <option value="light">{t('settings.themeLight')}</option>
              <option value="nord">Nord</option>
              <option value="dracula">Dracula</option>
              <option value="custom">{t('settings.themeCustom')}</option>
            </select>
          </label>
        </section>

        <section className="mobile-settings-group" aria-labelledby="mobile-hosts-heading">
          <div className="mobile-settings-heading">
            <Server aria-hidden="true" size={19} />
            <div>
              <p className="mobile-eyebrow">Network</p>
              <h2 id="mobile-hosts-heading">Computers</h2>
            </div>
          </div>
          {host.currentUrl && (
            <a className="mobile-settings-link is-current" href={host.currentUrl}>
              <span>
                <strong>{host.instanceName}</strong>
                <small>{t('host.currentComputer')}</small>
              </span>
              <Check aria-hidden="true" size={18} />
            </a>
          )}
          {host.peers.map((peer) => (
            <a className="mobile-settings-link" key={`${peer.url}:${peer.label}`} href={peer.url}>
              <span>
                <strong>{peer.label}</strong>
                <small>Open this computer</small>
              </span>
              <ExternalLink aria-hidden="true" size={17} />
            </a>
          ))}
          {host.peers.length === 0 && !host.currentUrl && (
            <p className="mobile-settings-note">No additional host links are configured.</p>
          )}
        </section>

        <section className="mobile-settings-group" aria-labelledby="mobile-devices-heading">
          <div className="mobile-settings-heading">
            <ShieldCheck aria-hidden="true" size={19} />
            <div>
              <p className="mobile-eyebrow">Security</p>
              <h2 id="mobile-devices-heading">Paired devices</h2>
            </div>
          </div>
          {devicesLoading && (
            <p className="mobile-settings-note" role="status">
              Checking device access…
            </p>
          )}
          {!devicesLoading && !local && !deviceError && (
            <p className="mobile-settings-note">
              Paired devices can only be administered on the host computer.
            </p>
          )}
          {local && !devicesLoading && (
            <div className="mobile-pairing-code-actions">
              <button
                className="mobile-secondary-button mobile-wide-button"
                disabled={creatingCode}
                onClick={() => void createPairingCode()}
                type="button"
              >
                <KeyRound aria-hidden="true" size={18} />
                {creatingCode ? t('settings.creatingPairingCode') : t('settings.createPairingCode')}
              </button>
              {pairingCode ? (
                <div className="mobile-pairing-code-result">
                  <output aria-label={t('settings.pairingCodeLabel')}>{pairingCode.code}</output>
                  <small>
                    {t('settings.pairingCodeExpires')} {formatCodeExpiry(pairingCode.expiresAt)}
                  </small>
                </div>
              ) : null}
            </div>
          )}
          {local && devices.length === 0 && !devicesLoading && (
            <p className="mobile-settings-note">No remote devices are paired.</p>
          )}
          {devices.map((device) => (
            <div className="mobile-device-row" key={device.id}>
              <Smartphone aria-hidden="true" size={19} />
              <span>
                <strong>{device.label}</strong>
                <small>Last used {formatDate(device.lastUsedAt)}</small>
              </span>
              <button
                type="button"
                className="mobile-danger-icon-button"
                aria-label={`Revoke ${device.label}`}
                disabled={revokingId === device.id}
                onClick={() => void revoke(device)}
              >
                <Trash2 aria-hidden="true" size={18} />
              </button>
            </div>
          ))}
          {deviceError && (
            <p className="mobile-form-error" role="alert">
              {deviceError}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
