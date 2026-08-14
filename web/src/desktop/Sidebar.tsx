import {
  ChevronRight,
  CircleDot,
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
} from 'lucide-react';
import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { HostContext, SessionSummary } from '../live-shared';
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

      <div aria-label="Environments" className="desktop-environments">
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
            title={peer.label}
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
  collapsed: boolean;
  loading: boolean;
  navigate: (destination: string) => void;
  onToggle: () => void;
  onWidthChange: (width: number) => void;
  runningSessionIds: ReadonlySet<string>;
  sessions: SessionSummary[];
  width: number;
}

export function ProjectSidebar({
  activeSessionId,
  collapsed,
  loading,
  navigate,
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
        <div className="desktop-sidebar-host">
          <span className="desktop-sidebar-eyebrow">Environment</span>
          <strong>Threads</strong>
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
        role="separator"
        title="Drag to resize · Double-click to reset"
      />
    </aside>
  );
}
