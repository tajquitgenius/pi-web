import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import SessionsList from './SessionsList.svelte';

afterEach(cleanup);

const sessions = [
  {
    id: 'running-session',
    name: 'Implement remote access',
    project: 'pi-web',
    lastActivity: '2026-08-14T12:00:00Z',
    chatAvailable: true,
  },
  {
    id: 'recent-session',
    name: 'Review the dashboard',
    project: 'design-system',
    lastActivity: '2026-08-14T11:00:00Z',
    chatAvailable: true,
  },
];

describe('SessionsList', () => {
  it('promotes active work above recent session history without duplicating it', () => {
    render(SessionsList, {
      sessions,
      layout: 'timeline',
      runningSessionIds: new Set(['running-session']),
      runningStatuses: new Map([['running-session', { model: 'claude-sonnet' }]]),
      layoutReady: true,
    });

    expect(screen.getByRole('heading', { name: 'Running now' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent sessions' })).toBeInTheDocument();
    expect(screen.getAllByText('Implement remote access')).toHaveLength(1);
    expect(screen.getByText('Review the dashboard')).toBeInTheDocument();
    expect(screen.getByText('pi-web')).toBeInTheDocument();
  });

  it('replaces raw session filenames with a readable fallback title', () => {
    render(SessionsList, {
      sessions: [
        {
          ...sessions[1],
          id: 'raw-session',
          name: '2026-08-14T11-00-00.000Z_deadbeef.jsonl',
        },
      ],
      layout: 'timeline',
      layoutReady: true,
    });

    expect(screen.getByText('Untitled session')).toBeInTheDocument();
  });
});
