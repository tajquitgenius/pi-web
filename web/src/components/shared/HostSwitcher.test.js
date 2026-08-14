import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import HostSwitcher from './HostSwitcher.svelte';

afterEach(cleanup);

describe('HostSwitcher', () => {
  it('shows the current host as static context when no peers exist', () => {
    render(HostSwitcher, { host: { instanceName: 'Personal laptop', currentUrl: '', peers: [] } });
    expect(screen.getByText('Personal laptop')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens an accessible menu with top-level peer links', async () => {
    render(HostSwitcher, {
      host: {
        instanceName: 'Personal laptop',
        currentUrl: 'https://personal.example.com',
        peers: [{ label: 'Cloud runner', url: 'https://cloud.example.com' }],
      },
    });
    const trigger = screen.getByRole('button', { name: /Personal laptop/ });
    await fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Cloud runner' })).toHaveAttribute(
      'href',
      'https://cloud.example.com',
    );
  });
});
