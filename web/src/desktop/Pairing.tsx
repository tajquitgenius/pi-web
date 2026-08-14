import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Laptop,
  LoaderCircle,
  Server,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { HostContext, PiWebClient } from '../live-shared';

interface PairingPageProps {
  client: PiWebClient;
  host: HostContext;
  navigate: (destination: string) => void;
}

export function PairingPage({ client, host, navigate }: PairingPageProps) {
  const [loading, setLoading] = useState(true);
  const [paired, setPaired] = useState(false);
  const [local, setLocal] = useState(false);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void client
      .getPairingStatus()
      .then((status) => {
        if (!active) return;
        setPaired(status.paired);
        setLocal(status.local);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Could not check device access.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const pairingCode = code.trim().toLocaleUpperCase();
    const deviceLabel = label.trim();
    if (!pairingCode || !deviceLabel || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await client.submitPairing({ code: pairingCode, label: deviceLabel });
      setPaired(result.paired);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Pairing failed. Check the code and retry.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="desktop-pairing-route" data-desktop-route="pairing">
      <div className="desktop-pairing-backdrop" />
      <header className="desktop-pairing-topbar">
        <a
          className="desktop-pairing-brand"
          href="/"
          onClick={(event) => {
            if (!paired) return;
            event.preventDefault();
            navigate('/');
          }}
        >
          <span>
            <ShieldCheck aria-hidden="true" size={16} />
          </span>
          <strong>pi-web</strong>
        </a>
        <div className="desktop-pairing-host">
          <Server aria-hidden="true" size={14} />
          {host.instanceName}
        </div>
        {paired ? (
          <nav aria-label="Primary navigation">
            <a
              href="/"
              onClick={(event) => {
                event.preventDefault();
                navigate('/');
              }}
            >
              <Laptop aria-hidden="true" size={14} /> Workspace
            </a>
            <a
              href="/settings"
              onClick={(event) => {
                event.preventDefault();
                navigate('/settings');
              }}
            >
              <Settings aria-hidden="true" size={14} /> Settings
            </a>
          </nav>
        ) : null}
      </header>

      <section className="desktop-pairing-card" aria-labelledby="pairing-title">
        {loading ? (
          <div className="desktop-pairing-loading">
            <LoaderCircle aria-hidden="true" className="desktop-spin" size={20} />
            Checking this device…
          </div>
        ) : paired ? (
          <div className="desktop-pairing-complete">
            <span className="desktop-pairing-status-icon">
              <CheckCircle2 aria-hidden="true" size={24} />
            </span>
            <p className="desktop-card-eyebrow">Device ready</p>
            <h1 id="pairing-title">
              {local ? 'You are on the host computer' : 'This device is paired'}
            </h1>
            <p>
              {local
                ? 'Local access is trusted. You can open the workspace or administer paired devices.'
                : 'The device credential is stored in a secure cookie and never appears in the URL.'}
            </p>
            <button className="desktop-pairing-submit" onClick={() => navigate('/')} type="button">
              Open workspace <ArrowRight aria-hidden="true" size={15} />
            </button>
          </div>
        ) : (
          <>
            <span className="desktop-pairing-status-icon">
              <KeyRound aria-hidden="true" size={23} />
            </span>
            <p className="desktop-card-eyebrow">Secure device access</p>
            <h1 id="pairing-title">Pair with {host.instanceName}</h1>
            <p className="desktop-pairing-description">
              Enter the one-time code shown on the host, then give this browser a recognizable name.
            </p>
            <form className="desktop-pairing-form" onSubmit={(event) => void submit(event)}>
              <label htmlFor="desktop-pairing-code">Pairing code</label>
              <input
                autoCapitalize="characters"
                autoComplete="one-time-code"
                autoCorrect="off"
                className="desktop-pairing-code"
                id="desktop-pairing-code"
                maxLength={8}
                onChange={(event) =>
                  setCode(
                    event.currentTarget.value
                      .toLocaleUpperCase()
                      .replace(/[^23456789A-HJ-NP-Z]/g, ''),
                  )
                }
                placeholder="8 character code"
                required
                spellCheck={false}
                value={code}
              />
              <label htmlFor="desktop-device-label">Device label</label>
              <input
                autoComplete="off"
                id="desktop-device-label"
                maxLength={80}
                onChange={(event) => setLabel(event.currentTarget.value)}
                placeholder="e.g. Work laptop"
                required
                value={label}
              />
              {error ? <div className="desktop-pairing-error">{error}</div> : null}
              <button
                className="desktop-pairing-submit"
                disabled={submitting || code.length !== 8 || !label.trim()}
                type="submit"
              >
                {submitting ? (
                  <LoaderCircle aria-hidden="true" className="desktop-spin" size={15} />
                ) : (
                  <ShieldCheck aria-hidden="true" size={15} />
                )}
                {submitting ? 'Pairing…' : 'Pair device'}
              </button>
            </form>
            <div className="desktop-pairing-privacy">
              The pairing code is submitted in the request body. Credentials are not accepted in
              URLs.
            </div>
          </>
        )}
      </section>
    </main>
  );
}
