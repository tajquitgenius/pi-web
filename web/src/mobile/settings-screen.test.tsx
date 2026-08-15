import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PiWebClient } from '../live-shared';
import { SettingsScreen } from './settings-screen';

let surfaceCookie = '';

function makeClient(): PiWebClient {
  return {
    getHostContext: vi.fn(() => ({
      instanceName: 'Work Mac',
      currentUrl: 'https://work.example',
      peers: [],
    })),
    getPairingStatus: vi.fn(async () => ({ paired: false, local: false })),
    listPairedDevices: vi.fn(async () => ({ devices: [] })),
  } as unknown as PiWebClient;
}

function renderSettings() {
  render(
    <SettingsScreen
      client={makeClient()}
      internalLink={(url, children, className) => (
        <a href={url} className={className}>
          {children}
        </a>
      )}
    />,
  );
}

beforeEach(() => {
  surfaceCookie = 'pi-web-surface=auto';
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => surfaceCookie,
    set: (value: string) => {
      surfaceCookie = value;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('mobile surface settings', () => {
  it('keeps device administration Main-owned on a hub node view', async () => {
    const client = makeClient();
    vi.mocked(client.getHostContext).mockReturnValue({
      instanceName: 'Work',
      currentUrl: '/hosts/work/',
      peers: [{ id: 'main', label: 'Main', url: '/' }],
    });
    render(
      <SettingsScreen
        client={client}
        internalLink={(url, children) => <a href={url}>{children}</a>}
      />,
    );
    await Promise.resolve();

    expect(client.getPairingStatus).not.toHaveBeenCalled();
    expect(client.listPairedDevices).not.toHaveBeenCalled();
    expect(screen.getByText(/only be administered on the host computer/i)).toBeInTheDocument();
  });

  it('marks the stored surface override instead of assuming mobile', () => {
    renderSettings();

    expect(screen.getByRole('link', { name: /Automatic selection/ })).toHaveClass('is-current');
    expect(screen.getByRole('link', { name: /Mobile product/ })).not.toHaveClass('is-current');
    expect(screen.getByRole('button', { name: /Desktop product/ })).not.toHaveClass('is-current');
  });

  it('traps modal focus, closes with Escape, and restores the Desktop trigger', async () => {
    renderSettings();
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: /Desktop product/ });
    await user.click(trigger);

    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /Switch to desktop/ })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('requires confirmation before applying Desktop', async () => {
    surfaceCookie = 'pi-web-surface=mobile';
    renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Desktop product/ }));

    expect(surfaceCookie).toBe('pi-web-surface=mobile');
    expect(screen.getByRole('dialog', { name: /Switch to desktop/ })).toBeInTheDocument();
    const apply = screen.getByRole('link', { name: 'Apply desktop' });
    expect(apply).toBeInTheDocument();

    fireEvent.click(apply);
    expect(surfaceCookie).toContain('pi-web-surface=desktop');
  });
});
