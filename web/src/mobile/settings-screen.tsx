import {
  ArrowLeft,
  Menu,
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
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import {
  readSurfaceOverride,
  writeSurfaceOverride,
  type PairedDevice,
  type PairingCode,
  type PiWebClient,
} from '../live-shared';
import { t } from '../shared/i18n.js';
import { MobileConnectivityNotice, type MobileConnectionState } from './connectivity';
import { useMobileDialog } from './dialog';

interface SettingsScreenProps {
  client: PiWebClient;
  internalLink: (url: string, children: ReactNode, className?: string) => ReactNode;
  onOpenNavigation?: () => void;
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

function DesktopSurfaceConfirmation({
  currentPath,
  onApply,
  onClose,
}: {
  currentPath: string;
  onApply: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useMobileDialog(dialogRef, onClose);
  return (
    <div
      className="mobile-sheet-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section
        ref={dialogRef}
        aria-labelledby="mobile-surface-confirmation-title"
        aria-modal="true"
        className="mobile-bottom-sheet mobile-surface-confirmation"
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="mobile-eyebrow">Product surface</p>
            <h2 id="mobile-surface-confirmation-title">
              {t('settings.surfaceDesktopConfirmTitle')}
            </h2>
          </div>
          <button
            aria-label={t('common.close')}
            className="mobile-icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <p className="mobile-surface-confirmation-copy">
          {t('settings.surfaceDesktopConfirmHint')}
        </p>
        <div className="mobile-surface-confirmation-actions">
          <a
            className="mobile-primary-link mobile-wide-button"
            href={currentPath}
            onClick={onApply}
          >
            {t('settings.surfaceDesktopApply')}
          </a>
          <button
            className="mobile-secondary-button mobile-wide-button"
            onClick={onClose}
            type="button"
          >
            {t('common.cancel')}
          </button>
        </div>
      </section>
    </div>
  );
}

export function SettingsScreen({
  client,
  internalLink: _internalLink,
  onOpenNavigation,
}: SettingsScreenProps) {
  const host = useMemo(() => client.getHostContext(), [client]);
  const [theme, setTheme] = useState(
    document.documentElement.dataset.theme || storedTheme() || 'dark',
  );
  const [surface, setSurface] = useState(() => readSurfaceOverride(document.cookie));
  const [desktopConfirmationOpen, setDesktopConfirmationOpen] = useState(false);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [local, setLocal] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [deviceError, setDeviceError] = useState('');
  const [connection, setConnection] = useState<MobileConnectionState>('connecting');
  const [revokingId, setRevokingId] = useState('');
  const [pairingCode, setPairingCode] = useState<PairingCode | null>(null);
  const [creatingCode, setCreatingCode] = useState(false);

  const loadDevices = useCallback(
    async (isActive: () => boolean = () => true) => {
      setDevicesLoading(true);
      setDeviceError('');
      setConnection('connecting');
      try {
        const status = await client.getPairingStatus();
        if (!isActive()) return;
        setConnection('connected');
        setLocal(status.local);
        if (!status.local) {
          setDevices([]);
          return;
        }
        const result = await client.listPairedDevices();
        if (isActive()) setDevices(result.devices);
      } catch (error) {
        if (isActive()) {
          setConnection('offline');
          setDeviceError(errorMessage(error, 'Paired devices are unavailable here.'));
        }
      } finally {
        if (isActive()) setDevicesLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    let active = true;
    void loadDevices(() => active);
    return () => {
      active = false;
    };
  }, [loadDevices]);

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
  const selectSurface = (next: 'auto' | 'mobile') => {
    writeSurfaceOverride(next);
    setSurface(next);
  };

  return (
    <main className="mobile-screen mobile-settings-screen" data-mobile-route="settings">
      <header className="mobile-nav-header">
        <button
          type="button"
          className="mobile-icon-button"
          aria-label={t('index.openNavigation')}
          aria-haspopup="dialog"
          onClick={() => onOpenNavigation?.()}
        >
          <Menu aria-hidden="true" size={21} />
        </button>
        <div>
          <p className="mobile-eyebrow">{host.instanceName}</p>
          <h1>{t('settings.title')}</h1>
        </div>
        {_internalLink(
          '/',
          <>
            <ArrowLeft aria-hidden="true" size={21} />
            <span className="mobile-visually-hidden">{t('common.back')}</span>
          </>,
          'mobile-icon-button',
        )}
      </header>

      <MobileConnectivityNotice state={connection} onRetry={() => void loadDevices()} />

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
            className={`mobile-settings-link${surface === 'mobile' ? ' is-current' : ''}`}
            href={currentPath}
            onClick={() => selectSurface('mobile')}
          >
            <span>
              <strong>Mobile product</strong>
              <small>Dedicated touch interface</small>
            </span>
            {surface === 'mobile' ? (
              <Check aria-hidden="true" size={18} />
            ) : (
              <ChevronRight aria-hidden="true" size={18} />
            )}
          </a>
          <button
            className={`mobile-settings-link${surface === 'desktop' ? ' is-current' : ''}`}
            onClick={() => setDesktopConfirmationOpen(true)}
            type="button"
          >
            <span>
              <strong>Desktop product</strong>
              <small>Use the desktop React interface on this device</small>
            </span>
            {surface === 'desktop' ? (
              <Check aria-hidden="true" size={18} />
            ) : (
              <ChevronRight aria-hidden="true" size={18} />
            )}
          </button>
          <a
            className={`mobile-settings-link${surface === 'auto' ? ' is-current' : ''}`}
            href={currentPath}
            onClick={() => selectSurface('auto')}
          >
            <span>
              <strong>Automatic selection</strong>
              <small>Let pi-web choose for this browser</small>
            </span>
            {surface === 'auto' ? (
              <Check aria-hidden="true" size={18} />
            ) : (
              <ChevronRight aria-hidden="true" size={18} />
            )}
          </a>
        </section>

        {desktopConfirmationOpen ? (
          <DesktopSurfaceConfirmation
            currentPath={currentPath}
            onApply={() => {
              writeSurfaceOverride('desktop');
              setSurface('desktop');
            }}
            onClose={() => setDesktopConfirmationOpen(false)}
          />
        ) : null}

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
