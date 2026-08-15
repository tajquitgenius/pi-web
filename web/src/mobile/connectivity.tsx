import { LoaderCircle, RefreshCw, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../shared/i18n.js';

export type MobileConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

interface ConnectivityNoticeProps {
  state: MobileConnectionState;
  onRetry?: () => void;
  children?: ReactNode;
}

export function MobileConnectivityNotice({ state, onRetry, children }: ConnectivityNoticeProps) {
  if (state === 'connected') return null;
  const reconnecting = state === 'reconnecting';
  const connecting = state === 'connecting';
  const label = connecting
    ? 'Connecting to Pi…'
    : reconnecting
      ? t('version.reconnecting')
      : 'Pi host is offline';
  return (
    <div
      className={`mobile-connectivity-notice is-${state}`}
      role="status"
      aria-label="Connection status"
      aria-live="polite"
    >
      {connecting || reconnecting ? (
        <LoaderCircle className="mobile-spin" aria-hidden="true" size={16} />
      ) : (
        <WifiOff aria-hidden="true" size={16} />
      )}
      <span>{children || label}</span>
      {onRetry && !connecting && (
        <button type="button" onClick={onRetry} aria-label="Retry connection">
          {reconnecting ? <RefreshCw aria-hidden="true" size={15} /> : t('common.retry')}
        </button>
      )}
    </div>
  );
}
