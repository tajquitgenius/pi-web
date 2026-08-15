import { KeyRound, Link, LoaderCircle, Menu, ShieldCheck, Smartphone } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { PiWebClient } from '../live-shared';
import { t } from '../shared/i18n.js';
import { MobileConnectivityNotice, type MobileConnectionState } from './connectivity';

const PAIRING_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;

interface PairingScreenProps {
  client: PiWebClient;
  topLevelNavigate: (url: string) => void;
  onOpenNavigation?: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Could not pair this device.';
}

export function PairingScreen({ client, topLevelNavigate, onOpenNavigation }: PairingScreenProps) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<MobileConnectionState>('connected');

  const attemptPairing = async (pairingCode: string, deviceLabel: string) => {
    setSubmitting(true);
    setConnection('connecting');
    setError('');
    try {
      const result = await client.submitPairing({ code: pairingCode, label: deviceLabel });
      if (!result.paired) throw new Error('The device was not paired.');
      topLevelNavigate('/');
    } catch (pairingError) {
      setConnection('offline');
      setError(errorMessage(pairingError));
      setSubmitting(false);
    }
  };

  const validateForm = (): { code: string; label: string } | null => {
    const deviceLabel = label.trim();
    if (!PAIRING_CODE.test(code)) {
      setError('Enter the exact 8-character code shown on the host computer.');
      return null;
    }
    if (!deviceLabel || deviceLabel.length > 80) {
      setError('Enter a device label of 80 characters or fewer.');
      return null;
    }
    return { code, label: deviceLabel };
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const values = validateForm();
    if (values) void attemptPairing(values.code, values.label);
  };

  return (
    <main className="mobile-screen mobile-pairing-screen" data-mobile-route="pairing">
      <div className="mobile-pairing-scroll">
        <header className="mobile-pairing-navigation">
          <button
            type="button"
            className="mobile-icon-button"
            aria-label={t('index.openNavigation')}
            aria-haspopup="dialog"
            onClick={() => onOpenNavigation?.()}
          >
            <Menu aria-hidden="true" size={21} />
          </button>
        </header>
        <MobileConnectivityNotice
          state={connection}
          onRetry={() => {
            const values = validateForm();
            if (values) void attemptPairing(values.code, values.label);
          }}
        />
        <header className="mobile-pairing-header">
          <span className="mobile-pairing-mark">
            <ShieldCheck aria-hidden="true" size={29} />
          </span>
          <p className="mobile-eyebrow">Secure remote access</p>
          <h1>Pair this device</h1>
          <p>
            Use a one-time code from the computer running pi-web. The code is sent only in this
            form.
          </p>
        </header>

        <form className="mobile-pairing-form" onSubmit={submit} noValidate>
          <label htmlFor="mobile-pairing-code">8-character pairing code</label>
          <div className="mobile-input-with-icon mobile-code-input">
            <KeyRound aria-hidden="true" size={19} />
            <input
              id="mobile-pairing-code"
              name="code"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={8}
              pattern="[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}"
              aria-describedby="mobile-pairing-code-hint"
              value={code}
              disabled={submitting}
              onChange={(event) =>
                setCode(
                  event.currentTarget.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '')
                    .slice(0, 8),
                )
              }
            />
          </div>
          <p id="mobile-pairing-code-hint">Codes expire after five minutes and can be used once.</p>

          <label htmlFor="mobile-device-label">Device label</label>
          <div className="mobile-input-with-icon">
            <Smartphone aria-hidden="true" size={19} />
            <input
              id="mobile-device-label"
              name="label"
              type="text"
              autoComplete="name"
              maxLength={80}
              placeholder="My iPhone"
              value={label}
              disabled={submitting}
              onChange={(event) => setLabel(event.currentTarget.value)}
            />
          </div>
          <p>Use a name you will recognize later in paired-device settings.</p>

          {error && (
            <p className="mobile-form-error" role="alert">
              {error}
            </p>
          )}

          <button
            className="mobile-primary-button mobile-wide-button"
            type="submit"
            disabled={submitting}
          >
            {submitting ? (
              <LoaderCircle className="mobile-spin" aria-hidden="true" size={19} />
            ) : (
              <Link aria-hidden="true" size={19} />
            )}
            {submitting ? 'Pairing device…' : 'Pair device'}
          </button>
        </form>
      </div>
    </main>
  );
}

export const mobilePairingTestHooks = { codePattern: PAIRING_CODE };
