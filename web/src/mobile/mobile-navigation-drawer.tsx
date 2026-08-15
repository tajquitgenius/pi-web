import { ExternalLink, Folder, Menu, MessageSquare, Plus, Server, Settings, X } from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type TouchEvent,
} from 'react';
import type { HostContext, SessionSummary } from '../live-shared';
import { t } from '../shared/i18n.js';
import { useMobileDialog } from './dialog';

function shouldHandleDrawerLink(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export interface MobileNavigationContextValue {
  openDrawer: () => void;
  closeDrawer: () => void;
}

const MobileNavigationContext = createContext<MobileNavigationContextValue>({
  openDrawer: () => undefined,
  closeDrawer: () => undefined,
});

export function MobileNavigationProvider({
  value,
  children,
}: {
  value: MobileNavigationContextValue;
  children: ReactNode;
}) {
  return (
    <MobileNavigationContext.Provider value={value}>{children}</MobileNavigationContext.Provider>
  );
}

export function useMobileNavigation(): MobileNavigationContextValue {
  return useContext(MobileNavigationContext);
}

export function MobileNavigationTrigger({
  className = 'mobile-navigation-trigger',
  label = t('index.openNavigation'),
}: {
  className?: string;
  label?: string;
}) {
  const { openDrawer } = useMobileNavigation();
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-haspopup="dialog"
      onClick={openDrawer}
    >
      <Menu aria-hidden="true" size={21} />
    </button>
  );
}

export interface MobileNavigationDrawerProps {
  host: HostContext;
  currentPath: string;
  currentSearch?: string;
  routeBase?: string;
  recentSessions: SessionSummary[];
  recentsLoading?: boolean;
  recentsError?: boolean;
  onNavigate: (url: string) => void;
  onNewTask: () => void;
  onClose: () => void;
}

function recentSessionLabel(session: SessionSummary): string {
  return session.name || t('index.untitledSession');
}

function projectLabel(path: string): string {
  const parts = path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .filter(Boolean);
  return parts.at(-1) || path || t('index.unknownProject');
}

export function MobileNavigationDrawer({
  host,
  currentPath,
  currentSearch = '',
  routeBase = '',
  recentSessions,
  recentsLoading = false,
  recentsError = false,
  onNavigate,
  onNewTask,
  onClose,
}: MobileNavigationDrawerProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeSwipeStart = useRef<{ identifier: number; x: number; y: number } | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [entering, setEntering] = useState(true);
  const [closing, setClosing] = useState(false);
  useMobileDialog(dialogRef, onClose);
  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const animateClosed = () => {
    setDragging(false);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true) {
      onClose();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, 180);
  };

  const currentView = new URLSearchParams(currentSearch).get('view');
  const threadsCurrent = currentPath === '/' && currentView !== 'projects';
  const projectsCurrent = currentPath === '/' && currentView === 'projects';
  const settingsCurrent = currentPath === '/settings';

  const startCloseSwipe = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches.length === 1 ? event.touches[0] : null;
    closeSwipeStart.current = touch
      ? { identifier: touch.identifier, x: touch.clientX, y: touch.clientY }
      : null;
    setEntering(false);
    setDragging(false);
    setDragX(0);
  };

  const moveCloseSwipe = (event: TouchEvent<HTMLElement>) => {
    const start = closeSwipeStart.current;
    if (!start) return;
    const touch = Array.from(event.touches).find(
      (candidate) => candidate.identifier === start.identifier,
    );
    if (!touch) {
      closeSwipeStart.current = null;
      return;
    }
    const deltaX = touch.clientX - start.x;
    const deltaY = Math.abs(touch.clientY - start.y);
    if ((deltaY > 12 && deltaY > Math.abs(deltaX)) || deltaX > 12) {
      closeSwipeStart.current = null;
      setDragging(false);
      setDragX(0);
      return;
    }
    if (deltaX < -8 && Math.abs(deltaX) > deltaY) {
      event.preventDefault();
      setDragging(true);
      setDragX(deltaX);
    }
  };

  const finishCloseSwipe = (event: TouchEvent<HTMLElement>) => {
    const start = closeSwipeStart.current;
    closeSwipeStart.current = null;
    if (!start) return;
    const touch = Array.from(event.changedTouches).find(
      (candidate) => candidate.identifier === start.identifier,
    );
    if (!touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = Math.abs(touch.clientY - start.y);
    if (deltaX <= -56 && Math.abs(deltaX) > deltaY * 1.25) {
      animateClosed();
    } else {
      setDragging(false);
      setDragX(0);
    }
  };

  const navigate = (url: string) => {
    onNavigate(url);
    onClose();
  };

  return (
    <div
      className={`mobile-navigation-backdrop${closing ? ' is-closing' : ''}`}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={dialogRef}
        className={`mobile-navigation-drawer${entering ? ' is-entering' : ''}${dragging ? ' is-dragging' : ''}${closing ? ' is-closing' : ''}`}
        style={{ '--mobile-drawer-drag-x': `${dragX}px` } as CSSProperties}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setEntering(false);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-navigation-title"
        tabIndex={-1}
        onTouchStart={startCloseSwipe}
        onTouchMove={moveCloseSwipe}
        onTouchEnd={finishCloseSwipe}
        onTouchCancel={() => {
          closeSwipeStart.current = null;
          setDragging(false);
          setDragX(0);
        }}
      >
        <header className="mobile-navigation-header">
          <div className="mobile-navigation-brand">
            <span className="mobile-navigation-brand-mark" aria-hidden="true">
              <Server size={18} />
            </span>
            <div>
              <p className="mobile-eyebrow">{host.instanceName}</p>
              <h2 id="mobile-navigation-title">{t('index.mobileNavigation')}</h2>
            </div>
          </div>
          <button
            type="button"
            className="mobile-icon-button"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>

        <nav className="mobile-navigation-primary" aria-label={t('index.mobileNavigation')}>
          <button
            type="button"
            onClick={() => {
              onNewTask();
              onClose();
            }}
          >
            <Plus aria-hidden="true" size={19} />
            <span>{t('index.newTask')}</span>
          </button>
          <button
            type="button"
            className={threadsCurrent ? 'is-current' : ''}
            aria-current={threadsCurrent ? 'page' : undefined}
            onClick={() => navigate('/')}
          >
            <MessageSquare aria-hidden="true" size={19} />
            <span>{t('index.mobileThreads')}</span>
          </button>
          <button
            type="button"
            className={projectsCurrent ? 'is-current' : ''}
            aria-current={projectsCurrent ? 'page' : undefined}
            onClick={() => navigate('/?view=projects')}
          >
            <Folder aria-hidden="true" size={19} />
            <span>{t('index.mobileProjects')}</span>
          </button>
          <a
            href={`${routeBase}/settings`}
            className={settingsCurrent ? 'is-current' : ''}
            aria-current={settingsCurrent ? 'page' : undefined}
            onClick={(event) => {
              if (!shouldHandleDrawerLink(event)) return;
              event.preventDefault();
              navigate('/settings');
            }}
          >
            <Settings aria-hidden="true" size={19} />
            <span>{t('settings.title')}</span>
          </a>
        </nav>

        <section className="mobile-navigation-section" aria-labelledby="mobile-navigation-recents">
          <div className="mobile-navigation-section-heading">
            <h3 id="mobile-navigation-recents">{t('index.recents')}</h3>
          </div>
          {recentsLoading && recentSessions.length === 0 ? (
            <p className="mobile-navigation-empty" role="status">
              {t('index.loadingSessions')}
            </p>
          ) : recentsError && recentSessions.length === 0 ? (
            <p className="mobile-navigation-empty" role="alert">
              {t('index.sessionsLoadFailed')}
            </p>
          ) : recentSessions.length > 0 ? (
            <div className="mobile-navigation-recents">
              {recentSessions.map((session) => (
                <a
                  href={`${routeBase}/session?id=${encodeURIComponent(session.id)}`}
                  key={session.id}
                  onClick={(event) => {
                    if (!shouldHandleDrawerLink(event)) return;
                    event.preventDefault();
                    navigate(`/session?id=${encodeURIComponent(session.id)}`);
                  }}
                >
                  <span>
                    <strong>{recentSessionLabel(session)}</strong>
                    <small>{projectLabel(session.project)}</small>
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="mobile-navigation-empty">{t('index.noRecentSessions')}</p>
          )}
        </section>

        {host.peers.length > 0 && (
          <section
            className="mobile-navigation-section mobile-navigation-hosts"
            aria-labelledby="mobile-navigation-hosts"
          >
            <div className="mobile-navigation-section-heading">
              <h3 id="mobile-navigation-hosts">{t('host.otherComputers')}</h3>
            </div>
            <div className="mobile-navigation-recents">
              <div className="mobile-navigation-host is-current" aria-current="page">
                <span>
                  <strong>{host.instanceName}</strong>
                  <small>{t('host.currentComputer')}</small>
                </span>
              </div>
              {host.peers.map((peer) => (
                <a href={peer.url} key={`${peer.url}:${peer.label}`}>
                  <span>
                    <strong>{peer.label}</strong>
                    <small>{peer.url}</small>
                  </span>
                  {peer.id ? (
                    <Server aria-hidden="true" size={16} />
                  ) : (
                    <ExternalLink aria-hidden="true" size={16} />
                  )}
                </a>
              ))}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
