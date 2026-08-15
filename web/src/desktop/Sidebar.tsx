import {
  Check,
  ChevronRight,
  CircleDot,
  Copy,
  Ellipsis,
  GitBranch,
  GitFork,
  Laptop,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SquarePen,
  SquareTerminal,
  Tag,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { HostContext, PiWebClient, SessionSummary } from '../live-shared';
import { groupSessions, projectLabel, relativeTime } from './desktop-model';

interface NavigationProps {
  navigate: (destination: string) => void;
  path: string;
}

interface HostRailProps extends NavigationProps {
  host: HostContext;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

function InternalNavButton({
  destination,
  label,
  path,
  navigate,
  children,
}: NavigationProps & {
  destination: string;
  label: string;
  children: React.ReactNode;
}) {
  const selected = destination === '/' ? path === '/' || path === '/session' : path === destination;
  return (
    <a
      aria-label={label}
      className="desktop-rail-button"
      data-active={selected || undefined}
      href={destination}
      onClick={(event) => {
        event.preventDefault();
        navigate(destination);
      }}
      title={label}
    >
      {children}
    </a>
  );
}

export function HostRail({
  host,
  navigate,
  onToggleSidebar,
  path,
  sidebarCollapsed,
}: HostRailProps) {
  return (
    <nav aria-label="Hosts and primary navigation" className="desktop-host-rail">
      <div className="desktop-brand-mark" title="pi-web">
        <span>
          <SquareTerminal aria-hidden="true" size={17} />
        </span>
      </div>
      <div className="desktop-rail-stack">
        <InternalNavButton destination="/" label="Workspace" navigate={navigate} path={path}>
          <Laptop aria-hidden="true" size={17} />
        </InternalNavButton>
        {sidebarCollapsed ? (
          <button
            aria-label="Show projects and threads"
            className="desktop-rail-button"
            onClick={onToggleSidebar}
            title="Show sidebar"
            type="button"
          >
            <PanelLeftOpen aria-hidden="true" size={17} />
          </button>
        ) : null}
      </div>

      <div aria-label="Pi hosts" className="desktop-environments">
        <a
          aria-current="page"
          aria-label={host.instanceName}
          className="desktop-environment-button"
          href={host.currentUrl || '/'}
          title={`${host.instanceName} (current)`}
        >
          <Server aria-hidden="true" size={16} />
          <span className="desktop-presence-dot" />
        </a>
        {host.peers.map((peer) => (
          <a
            aria-label={peer.label}
            className="desktop-environment-button"
            href={peer.url}
            key={`${peer.url}:${peer.label}`}
            title={`${peer.label} (configured host; open to check)`}
          >
            <Server aria-hidden="true" size={16} />
          </a>
        ))}
      </div>

      <div className="desktop-rail-stack desktop-rail-bottom">
        <InternalNavButton
          destination="/pairing"
          label="Device pairing"
          navigate={navigate}
          path={path}
        >
          <ShieldCheck aria-hidden="true" size={17} />
        </InternalNavButton>
        <InternalNavButton destination="/settings" label="Settings" navigate={navigate} path={path}>
          <Settings aria-hidden="true" size={17} />
        </InternalNavButton>
      </div>
    </nav>
  );
}

interface ProjectSidebarProps {
  activeSessionId: string;
  client: PiWebClient;
  collapsed: boolean;
  host: HostContext;
  loading: boolean;
  navigate: (destination: string) => void;
  onRefresh: () => void | Promise<void>;
  onToggle: () => void;
  onWidthChange: (width: number) => void;
  runningSessionIds: ReadonlySet<string>;
  sessions: SessionSummary[];
  width: number;
}

interface ThreadActionsMenuProps {
  client: PiWebClient;
  navigate: (destination: string) => void;
  onRefresh: () => void | Promise<void>;
  session: SessionSummary;
}

type ActionFeedback = { kind: 'error' | 'success'; message: string };

async function copyText(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the legacy clipboard API.
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

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function ThreadActionsMenu({ client, navigate, onRefresh, session }: ThreadActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(session.name);
  const [label, setLabel] = useState('');
  const [working, setWorking] = useState('');
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const latestEntryId = async () => {
    const details = await client.getSession(session.id, { paginate: true });
    const entry = details.entries.at(-1);
    const entryId = entry && typeof entry.id === 'string' ? entry.id : '';
    if (!entryId) throw new Error('This thread has no entry to act on.');
    return entryId;
  };

  const refresh = async () => {
    await onRefresh();
  };

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || working) return;
    setWorking('rename');
    setFeedback(null);
    try {
      if (typeof client.renameSession !== 'function') throw new Error('Rename is unavailable.');
      const result = await client.renameSession(session.id, trimmedName);
      if (!result.ok) throw new Error('Could not rename this thread.');
      await refresh();
      setFeedback({ kind: 'success', message: 'Thread renamed.' });
    } catch (reason) {
      setFeedback({
        kind: 'error',
        message: errorMessage(reason, 'Could not rename this thread.'),
      });
    } finally {
      setWorking('');
    }
  };

  const labelLatestEntry = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedLabel = label.trim();
    if (!trimmedLabel || working) return;
    setWorking('label');
    setFeedback(null);
    try {
      if (typeof client.labelSession !== 'function') throw new Error('Labels are unavailable.');
      const entryId = await latestEntryId();
      const result = await client.labelSession(session.id, entryId, trimmedLabel);
      if (!result.ok) throw new Error('Could not label this entry.');
      await refresh();
      setLabel('');
      setFeedback({ kind: 'success', message: 'Entry labeled.' });
    } catch (reason) {
      setFeedback({ kind: 'error', message: errorMessage(reason, 'Could not label this entry.') });
    } finally {
      setWorking('');
    }
  };

  const branch = async (kind: 'fork' | 'clone') => {
    if (working) return;
    setWorking(kind);
    setFeedback(null);
    try {
      const result =
        kind === 'fork'
          ? typeof client.forkSession === 'function'
            ? await client.forkSession(session.id, await latestEntryId())
            : null
          : typeof client.cloneSession === 'function'
            ? await client.cloneSession(session.id)
            : null;
      if (!result?.ok || !result.id) throw new Error(`Could not ${kind} this thread.`);
      await refresh();
      setOpen(false);
      navigate(`/session?id=${encodeURIComponent(result.id)}`);
    } catch (reason) {
      setFeedback({
        kind: 'error',
        message: errorMessage(reason, `Could not ${kind} this thread.`),
      });
    } finally {
      setWorking('');
    }
  };

  const copyId = async () => {
    setFeedback(null);
    const copied = await copyText(session.id);
    setCopyState(copied ? 'success' : 'error');
    if (!copied) {
      setFeedback({ kind: 'error', message: 'Could not copy the session ID. Copy it manually.' });
    }
  };

  const descriptionId = `desktop-thread-actions-description-${session.id}`;

  return (
    <div className="desktop-thread-actions" ref={menuRef}>
      <span className="sr-only" id={descriptionId}>
        Actions for {session.name}
      </span>
      <button
        aria-describedby={descriptionId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Thread actions"
        className="desktop-thread-actions-trigger"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setFeedback(null);
          setOpen((current) => !current);
        }}
        title="Thread actions"
        type="button"
      >
        <Ellipsis aria-hidden="true" size={15} />
      </button>
      {open ? (
        <div aria-label="Thread actions" className="desktop-thread-actions-menu" role="menu">
          <form className="desktop-thread-action-form" onSubmit={(event) => void rename(event)}>
            <label htmlFor={`desktop-thread-name-${session.id}`}>Thread name</label>
            <div>
              <input
                id={`desktop-thread-name-${session.id}`}
                onChange={(event) => setName(event.currentTarget.value)}
                value={name}
              />
              <button
                aria-label="Save thread name"
                disabled={Boolean(working) || !name.trim()}
                type="submit"
              >
                {working === 'rename' ? 'Saving…' : <Check aria-hidden="true" size={14} />}
              </button>
            </div>
          </form>
          <form
            className="desktop-thread-action-form"
            onSubmit={(event) => void labelLatestEntry(event)}
          >
            <label htmlFor={`desktop-entry-label-${session.id}`}>Entry label</label>
            <div>
              <input
                id={`desktop-entry-label-${session.id}`}
                onChange={(event) => setLabel(event.currentTarget.value)}
                placeholder="e.g. review"
                value={label}
              />
              <button
                aria-label="Save entry label"
                disabled={Boolean(working) || !label.trim()}
                type="submit"
              >
                {working === 'label' ? 'Saving…' : <Tag aria-hidden="true" size={14} />}
              </button>
            </div>
          </form>
          <div className="desktop-thread-action-list">
            <button onClick={() => void branch('fork')} role="menuitem" type="button">
              <GitFork aria-hidden="true" size={14} />
              {working === 'fork' ? 'Forking…' : 'Fork from latest entry'}
            </button>
            <button onClick={() => void branch('clone')} role="menuitem" type="button">
              <GitBranch aria-hidden="true" size={14} />
              {working === 'clone' ? 'Cloning…' : 'Clone this thread'}
            </button>
            <button onClick={() => void copyId()} role="menuitem" type="button">
              <Copy aria-hidden="true" size={14} />
              {copyState === 'success' ? 'Session ID copied' : 'Copy session ID'}
            </button>
          </div>
          {feedback ? (
            <p
              className="desktop-thread-action-feedback"
              data-kind={feedback.kind}
              role={feedback.kind === 'error' ? 'alert' : 'status'}
            >
              {feedback.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ProjectSidebar({
  activeSessionId,
  client,
  collapsed,
  host,
  loading,
  navigate,
  onRefresh,
  onToggle,
  onWidthChange,
  runningSessionIds,
  sessions,
  width,
}: ProjectSidebarProps) {
  const [query, setQuery] = useState('');
  const visibleSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return sessions;
    return sessions.filter((session) =>
      [session.name, session.project, session.model, session.modelProvider, session.sessionUUID]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  }, [query, sessions]);
  const groups = useMemo(
    () => groupSessions(visibleSessions, runningSessionIds),
    [runningSessionIds, visibleSessions],
  );

  if (collapsed) return null;

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const handleMove = (moveEvent: PointerEvent) => {
      onWidthChange(Math.min(440, Math.max(224, startWidth + moveEvent.clientX - startX)));
    };
    const handleEnd = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd, { once: true });
  };

  return (
    <aside aria-label="Projects and threads" className="desktop-project-sidebar">
      <header className="desktop-sidebar-header">
        <div className="desktop-sidebar-host" aria-label={`${host.instanceName} online`}>
          <span className="desktop-sidebar-eyebrow">
            <span aria-hidden="true" className="desktop-host-online-dot" /> Online
          </span>
          <strong>{host.instanceName}</strong>
        </div>
        <button
          aria-label="Hide projects and threads"
          className="desktop-icon-button"
          onClick={onToggle}
          title="Hide sidebar"
          type="button"
        >
          <PanelLeftClose aria-hidden="true" size={16} />
        </button>
      </header>

      <div className="desktop-sidebar-actions">
        <button className="desktop-new-thread" onClick={() => navigate('/')} type="button">
          <SquarePen aria-hidden="true" size={15} />
          New task
          <span>Ctrl T</span>
        </button>
        <label className="desktop-search-field">
          <Search aria-hidden="true" size={14} />
          <span className="sr-only">Search threads</span>
          <input
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search threads"
            type="search"
            value={query}
          />
        </label>
      </div>

      <div className="desktop-thread-scroll" data-testid="thread-scroll-pane">
        {loading ? (
          <div className="desktop-sidebar-empty">Loading threads…</div>
        ) : groups.length === 0 ? (
          <div className="desktop-sidebar-empty">
            {query ? 'No matching threads' : 'No threads yet'}
          </div>
        ) : (
          groups.map((group) => (
            <details className="desktop-project-group" key={group.project} open>
              <summary>
                <ChevronRight aria-hidden="true" className="desktop-project-chevron" size={12} />
                <span className="desktop-project-icon">
                  <span>{projectLabel(group.project).slice(0, 1).toLocaleUpperCase()}</span>
                </span>
                <span className="desktop-project-name" title={group.project}>
                  {projectLabel(group.project)}
                </span>
                {group.running ? (
                  <CircleDot aria-label="Project has a running task" size={11} />
                ) : null}
                <span className="desktop-project-count">{group.sessions.length}</span>
              </summary>
              <ul>
                {group.sessions.map((session) => {
                  const running = runningSessionIds.has(session.id);
                  return (
                    <li key={session.id}>
                      <a
                        aria-current={activeSessionId === session.id ? 'page' : undefined}
                        className="desktop-thread-row"
                        data-active={activeSessionId === session.id || undefined}
                        data-running={running || undefined}
                        href={`/session?id=${encodeURIComponent(session.id)}`}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(`/session?id=${encodeURIComponent(session.id)}`);
                        }}
                      >
                        <span className="desktop-thread-status" aria-hidden="true" />
                        <span className="desktop-thread-copy">
                          <span className="desktop-thread-name">{session.name}</span>
                          <span className="desktop-thread-meta">
                            {running ? 'Running' : relativeTime(session.lastActivity)}
                            {session.model ? ` · ${session.model}` : ''}
                          </span>
                        </span>
                      </a>
                      <ThreadActionsMenu
                        client={client}
                        navigate={navigate}
                        onRefresh={onRefresh}
                        session={session}
                      />
                    </li>
                  );
                })}
              </ul>
            </details>
          ))
        )}
      </div>

      <footer className="desktop-sidebar-footer">
        <Link2 aria-hidden="true" size={13} />
        <span>{sessions.length} threads</span>
      </footer>
      <div
        aria-label="Resize thread sidebar"
        className="desktop-sidebar-resizer"
        onDoubleClick={() => onWidthChange(288)}
        onPointerDown={beginResize}
        aria-orientation="vertical"
        aria-valuemax={440}
        aria-valuemin={224}
        aria-valuenow={width}
        onKeyDown={(event) => {
          if (
            event.key !== 'ArrowLeft' &&
            event.key !== 'ArrowRight' &&
            event.key !== 'Home' &&
            event.key !== 'End'
          )
            return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 224
              : event.key === 'End'
                ? 440
                : width + (event.key === 'ArrowRight' ? 16 : -16);
          onWidthChange(Math.min(440, Math.max(224, next)));
        }}
        role="separator"
        tabIndex={0}
        title="Drag to resize · Use Arrow keys · Double-click to reset"
      />
    </aside>
  );
}
