import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostContext } from '../live-shared';
import { MobileNavigationDrawer } from './mobile-navigation-drawer';

const host: HostContext = {
  instanceName: 'Work Mac',
  currentUrl: 'https://work.example',
  peers: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it('tracks a leftward swipe and settles closed with animation', async () => {
    const onClose = vi.fn();
    render(
      <MobileNavigationDrawer
        host={host}
        currentPath="/"
        recentSessions={[]}
        onNavigate={vi.fn()}
        onNewTask={vi.fn()}
        onClose={onClose}
      />,
    );
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });

    fireEvent.touchStart(drawer, {
      touches: [{ identifier: 7, clientX: 260, clientY: 220 }],
    });
    fireEvent.touchMove(drawer, {
      touches: [{ identifier: 7, clientX: 215, clientY: 224 }],
    });
    expect(drawer).toHaveClass('is-dragging');
    expect(drawer).toHaveStyle({ '--mobile-drawer-drag-x': '-45px' });

    fireEvent.touchEnd(drawer, {
      changedTouches: [{ identifier: 7, clientX: 180, clientY: 225 }],
    });
    expect(drawer.parentElement).toHaveClass('is-closing');
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('settles an incomplete close drag without replaying the entrance', () => {
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
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    expect(drawer).toHaveClass('is-entering');

    fireEvent.touchStart(drawer, {
      touches: [{ identifier: 8, clientX: 260, clientY: 220 }],
    });
    fireEvent.touchMove(drawer, {
      touches: [{ identifier: 8, clientX: 230, clientY: 222 }],
    });
    fireEvent.touchEnd(drawer, {
      changedTouches: [{ identifier: 8, clientX: 230, clientY: 222 }],
    });

    expect(drawer).not.toHaveClass('is-entering', 'is-dragging', 'is-closing');
    expect(drawer).toHaveStyle({ '--mobile-drawer-drag-x': '0px' });
  });

  it('closes immediately when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const onClose = vi.fn();
    render(
      <MobileNavigationDrawer
        host={host}
        currentPath="/"
        recentSessions={[]}
        onNavigate={vi.fn()}
        onNewTask={vi.fn()}
        onClose={onClose}
      />,
    );
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });

    fireEvent.touchStart(drawer, {
      touches: [{ identifier: 9, clientX: 260, clientY: 220 }],
    });
    fireEvent.touchEnd(drawer, {
      changedTouches: [{ identifier: 9, clientX: 180, clientY: 220 }],
    });

    expect(onClose).toHaveBeenCalledOnce();
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
