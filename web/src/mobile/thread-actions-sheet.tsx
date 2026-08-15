import { Check, Copy, GitBranch, GitFork, X } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import type { PiWebClient } from '../live-shared';
import { getMobileCapability } from './capabilities';
import { useMobileDialog } from './dialog';

interface ThreadActionsSheetProps {
  client: PiWebClient;
  sessionId: string;
  sessionName: string;
  leafEntryId?: string;
  onClose: () => void;
  onRenamed: (name: string) => void;
  onNavigate: (sessionId: string) => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function copyText(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Try the browser's legacy clipboard path below.
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

export function ThreadActionsSheet({
  client,
  sessionId,
  sessionName,
  leafEntryId,
  onClose,
  onRenamed,
  onNavigate,
}: ThreadActionsSheetProps) {
  const renameSession = getMobileCapability(client, 'renameSession');
  const forkSession = getMobileCapability(client, 'forkSession');
  const cloneSession = getMobileCapability(client, 'cloneSession');
  const labelSession = getMobileCapability(client, 'labelSession');
  const [name, setName] = useState(sessionName);
  const [label, setLabel] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [labeling, setLabeling] = useState(false);
  const [working, setWorking] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLElement | null>(null);
  useMobileDialog(dialogRef, onClose);

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameSession || !name.trim()) return;
    setRenaming(true);
    setError('');
    try {
      const result = await renameSession.call(client, sessionId, name.trim());
      if (!result.ok) throw new Error('Could not rename this thread.');
      onRenamed(name.trim());
    } catch (renameError) {
      setError(errorMessage(renameError, 'Could not rename this thread.'));
    } finally {
      setRenaming(false);
    }
  };

  const labelLatest = async (event: FormEvent) => {
    event.preventDefault();
    if (!labelSession || !leafEntryId || !label.trim()) return;
    setLabeling(true);
    setError('');
    try {
      const result = await labelSession.call(client, sessionId, leafEntryId, label.trim());
      if (!result.ok) throw new Error('Could not label this entry.');
      setLabel('');
    } catch (labelError) {
      setError(errorMessage(labelError, 'Could not label this entry.'));
    } finally {
      setLabeling(false);
    }
  };

  const branch = async (kind: 'fork' | 'clone') => {
    if (kind === 'fork' ? !forkSession : !cloneSession) return;
    setWorking(kind);
    setError('');
    try {
      const result =
        kind === 'fork'
          ? await forkSession!.call(client, sessionId, leafEntryId || '')
          : await cloneSession!.call(client, sessionId, leafEntryId);
      if (!result.ok || !result.id) throw new Error(`Could not ${kind} this thread.`);
      onNavigate(result.id);
    } catch (branchError) {
      setError(errorMessage(branchError, `Could not ${kind} this thread.`));
    } finally {
      setWorking('');
    }
  };

  return (
    <div
      className="mobile-sheet-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="mobile-bottom-sheet mobile-actions-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-actions-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="mobile-eyebrow">Thread actions</p>
            <h2 id="mobile-actions-title">{sessionName || 'Untitled thread'}</h2>
          </div>
          <button
            type="button"
            className="mobile-icon-button"
            aria-label="Close thread actions"
            onClick={onClose}
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        {renameSession && (
          <form className="mobile-action-form" onSubmit={rename}>
            <label htmlFor="mobile-thread-name">Thread name</label>
            <div className="mobile-action-row">
              <input
                id="mobile-thread-name"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <button
                type="submit"
                className="mobile-primary-icon-button"
                aria-label="Save thread name"
                disabled={renaming || !name.trim()}
              >
                <Check aria-hidden="true" size={18} />
              </button>
            </div>
          </form>
        )}
        {labelSession && leafEntryId && (
          <form className="mobile-action-form" onSubmit={labelLatest}>
            <label htmlFor="mobile-entry-label">Label latest entry</label>
            <div className="mobile-action-row">
              <input
                id="mobile-entry-label"
                value={label}
                onChange={(event) => setLabel(event.currentTarget.value)}
                placeholder="e.g. review"
              />
              <button
                type="submit"
                className="mobile-primary-icon-button"
                aria-label="Save entry label"
                disabled={labeling || !label.trim()}
              >
                <Check aria-hidden="true" size={18} />
              </button>
            </div>
          </form>
        )}
        <div className="mobile-action-list">
          <button
            type="button"
            onClick={async () => {
              setError('');
              const copied = await copyText(sessionId);
              setCopyState(copied ? 'success' : 'error');
              if (!copied)
                setError('Could not copy the session ID. Copy it manually from the details.');
            }}
          >
            <Copy aria-hidden="true" size={18} />
            <span>
              {copyState === 'success'
                ? 'Session ID copied'
                : copyState === 'error'
                  ? 'Copy failed — try again'
                  : 'Copy session ID'}
            </span>
          </button>
          {forkSession && (
            <button type="button" disabled={Boolean(working)} onClick={() => void branch('fork')}>
              <GitFork aria-hidden="true" size={18} />
              <span>{working === 'fork' ? 'Forking…' : 'Fork from latest entry'}</span>
            </button>
          )}
          {cloneSession && (
            <button type="button" disabled={Boolean(working)} onClick={() => void branch('clone')}>
              <GitBranch aria-hidden="true" size={18} />
              <span>{working === 'clone' ? 'Cloning…' : 'Clone this thread'}</span>
            </button>
          )}
        </div>
        {error && (
          <p className="mobile-form-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
