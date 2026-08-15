import {
  Clock3,
  ExternalLink,
  Folder,
  Menu,
  MessageSquare,
  Plus,
  Server,
  Settings,
  X,
} from 'lucide-react';
import { createContext, useContext, useRef, type ReactNode } from 'react';
import type { HostContext, SessionSummary } from '../live-shared';
import { t } from '../shared/i18n.js';
import { useMobileDialog } from './dialog';

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
  recentSessions,
  recentsLoading = false,
  recentsError = false,
  onNavigate,
  onNewTask,
  onClose,
}: MobileNavigationDrawerProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useMobileDialog(dialogRef, onClose);

  const currentView = new URLSearchParams(currentSearch).get('view');
  const threadsCurrent = currentPath === '/' && currentView !== 'projects';
  const projectsCurrent = currentPath === '/' && currentView === 'projects';
  const settingsCurrent = currentPath === '/settings';

  const navigate = (url: string) => {
    onNavigate(url);
    onClose();
  };

  return (
    <div
      className="mobile-navigation-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={dialogRef}
        className="mobile-navigation-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-navigation-title"
        tabIndex={-1}
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
            href="/settings"
            className={settingsCurrent ? 'is-current' : ''}
            aria-current={settingsCurrent ? 'page' : undefined}
            onClick={(event) => {
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
            <Clock3 aria-hidden="true" size={17} />
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
                  href={`/session?id=${encodeURIComponent(session.id)}`}
                  key={session.id}
                  onClick={(event) => {
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
              <Server aria-hidden="true" size={17} />
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
                  <ExternalLink aria-hidden="true" size={16} />
                </a>
              ))}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
