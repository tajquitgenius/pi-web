import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostContext } from '../live-shared';
import { MobileNavigationDrawer } from './mobile-navigation-drawer';

const host: HostContext = {
  instanceName: 'Work Mac',
  currentUrl: 'https://work.example',
  peers: [],
};

afterEach(cleanup);

describe('MobileNavigationDrawer', () => {
  it('marks Projects current without also marking Threads current', () => {
    render(
      <MobileNavigationDrawer
        host={host}
        currentPath="/"
        currentSearch="?view=projects"
        recentSessions={[]}
        onNavigate={vi.fn()}
        onNewTask={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Projects' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Threads' })).not.toHaveAttribute('aria-current');
  });

  it('keeps Recents stable and hides computer controls without peers', () => {
    render(
      <MobileNavigationDrawer
        host={host}
        currentPath="/"
        recentSessions={[]}
        onNavigate={vi.fn()}
        onNewTask={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Recents' })).toBeInTheDocument();
    expect(screen.getByText('No recent threads')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Other computers' })).not.toBeInTheDocument();
  });
});
