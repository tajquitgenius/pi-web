import {
  FolderSearch,
  Keyboard,
  PanelLeft,
  PanelRight,
  Search,
  Settings,
  ShieldCheck,
  SquarePen,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PiWebClient, SessionSummary } from '../live-shared';
import { t } from '../shared/i18n.js';
import { normalizeCommands, type DesktopCommand } from './desktop-capabilities';

function slashCommand(value: string): string {
  const command = value.trim().replace(/^\/+/, '');
  return command ? `/${command}` : '';
}

interface PaletteAction {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  icon: typeof Search;
  run: () => void;
}

interface CommandPaletteProps {
  activeSessionId: string;
  client: PiWebClient;
  navigate: (destination: string) => void;
  onClose: () => void;
  onToggleDetails: () => void;
  onToggleSidebar: () => void;
  sessions: SessionSummary[];
}

export function CommandPalette({
  activeSessionId,
  client,
  navigate,
  onClose,
  onToggleDetails,
  onToggleSidebar,
  sessions,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [showingShortcuts, setShowingShortcuts] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [piCommands, setPiCommands] = useState<DesktopCommand[]>([]);
  const paletteRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    let active = true;
    setPiCommands([]);
    if (!activeSessionId || typeof client.getCommands !== 'function') return () => undefined;
    const getCommands = client.getCommands;
    void getCommands
      .call(client, activeSessionId, true)
      .then((result) => {
        if (active) setPiCommands(normalizeCommands(result));
      })
      .catch(() => {
        if (active) setPiCommands([]);
      });
    return () => {
      active = false;
    };
  }, [activeSessionId, client]);

  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: 'new-task',
        label: t('palette.newSession'),
        description: 'Start a fresh Pi task',
        shortcut: 'Ctrl T',
        icon: SquarePen,
        run: () => navigate('/'),
      },
      {
        id: 'toggle-sidebar',
        label: 'Toggle sidebar',
        description: 'Show or hide projects and threads',
        shortcut: 'Ctrl B',
        icon: PanelLeft,
        run: onToggleSidebar,
      },
      {
        id: 'toggle-panel',
        label: 'Toggle context panel',
        description: 'Open details, files, diff, or scratchpad',
        shortcut: 'Ctrl Shift P',
        icon: PanelRight,
        run: onToggleDetails,
      },
      {
        id: 'settings',
        label: t('settings.title'),
        description: 'Manage this browser and Pi host access',
        icon: Settings,
        run: () => navigate('/settings'),
      },
      {
        id: 'pairing',
        label: 'Pair device',
        description: 'Connect this browser to a Pi host',
        icon: ShieldCheck,
        run: () => navigate('/pairing'),
      },
      {
        id: 'shortcuts',
        label: t('session.shortcuts'),
        description: 'Show keyboard shortcuts',
        icon: Keyboard,
        run: () => {
          setShowingShortcuts(true);
          setQuery('');
        },
      },
    ],
    [navigate, onToggleDetails, onToggleSidebar],
  );

  const piCommandActions = useMemo<PaletteAction[]>(
    () =>
      piCommands.map((command) => {
        const message = slashCommand(command.command ?? command.name ?? '');
        return {
          id: `pi-command:${message}`,
          label: message || 'Pi command',
          description: command.description ?? command.source ?? 'Pi slash command',
          icon: Keyboard,
          run: () => {
            if (message) void client.sendChat(activeSessionId, { message });
          },
        };
      }),
    [activeSessionId, client, piCommands],
  );

  const sessionActions = useMemo<PaletteAction[]>(
    () =>
      sessions.map((session) => ({
        id: `session:${session.id}`,
        label: session.name || session.id,
        description: `${session.project || 'Unknown project'} / ${session.model || 'Pi'}`,
        icon: FolderSearch,
        run: () => navigate(`/session?id=${encodeURIComponent(session.id)}`),
      })),
    [navigate, sessions],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const availableActions = showingShortcuts
      ? actions.filter((action) => action.shortcut)
      : [...actions, ...piCommandActions, ...sessionActions];
    return availableActions.filter((action) => {
      if (!normalized) return true;
      return `${action.label} ${action.description} ${action.shortcut ?? ''}`
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [actions, piCommandActions, query, sessionActions, showingShortcuts]);

  useEffect(() => setHighlighted(0), [query, showingShortcuts]);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const execute = (action: PaletteAction) => {
    action.run();
    if (action.id !== 'shortcuts') onClose();
  };

  const handlePaletteKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (!focusable.length) return;
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey
      ? currentIndex <= 0
        ? focusable.length - 1
        : currentIndex - 1
      : currentIndex === focusable.length - 1
        ? 0
        : currentIndex + 1;
    event.preventDefault();
    focusable[nextIndex].focus();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((current) => (current + 1) % Math.max(filtered.length, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((current) => (current - 1 + filtered.length) % Math.max(filtered.length, 1));
    } else if (event.key === 'Enter' && filtered[highlighted]) {
      event.preventDefault();
      execute(filtered[highlighted]);
    }
  };

  return (
    <div
      aria-label="Command palette"
      aria-modal="true"
      className="desktop-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <section
        className="desktop-command-palette"
        onKeyDown={handlePaletteKeyDown}
        ref={paletteRef}
      >
        <div className="desktop-palette-search">
          <Search aria-hidden="true" size={16} />
          <input
            aria-label="Search commands"
            autoFocus
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search commands, tasks, and Pi actions"
            value={query}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="desktop-palette-results" role="listbox" aria-label="Commands">
          {filtered.length ? (
            <>
              <div className="desktop-palette-group-label">
                {showingShortcuts ? t('shortcuts.title') : t('palette.actions')}
              </div>
              {filtered.map((action, index) => {
                const Icon = action.icon;
                const selected = index === highlighted;
                return (
                  <button
                    aria-selected={selected}
                    className="desktop-palette-option"
                    data-highlighted={selected || undefined}
                    key={action.id}
                    onClick={() => execute(action)}
                    onMouseEnter={() => setHighlighted(index)}
                    role="option"
                    type="button"
                  >
                    <span className="desktop-palette-option-icon">
                      <Icon aria-hidden="true" size={15} />
                    </span>
                    <span className="desktop-palette-option-copy">
                      <strong>{action.label}</strong>
                      <small>{action.description}</small>
                    </span>
                    {action.id === `session:${activeSessionId}` ? <span>Current</span> : null}
                    {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
                  </button>
                );
              })}
            </>
          ) : (
            <div className="desktop-palette-empty">{t('palette.noSessionsFound')}</div>
          )}
        </div>
        <footer className="desktop-palette-footer">
          <span>
            <kbd>Up</kbd>
            <kbd>Down</kbd> Navigate
          </span>
          <span>
            <kbd>Enter</kbd> Open
          </span>
          <span>
            <kbd>Esc</kbd> {t('palette.closeSearch')}
          </span>
        </footer>
      </section>
    </div>
  );
}
