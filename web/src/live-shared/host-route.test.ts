import { describe, expect, it } from 'vitest';
import { resolveHostRoute } from './host-route';

describe('resolveHostRoute', () => {
  it.each([
    ['/', { hostId: 'main', routeBase: '', transportBase: '' }],
    ['/session', { hostId: 'main', routeBase: '', transportBase: '' }],
    [
      '/hosts/work/session',
      { hostId: 'work', routeBase: '/hosts/work', transportBase: '/_host/work' },
    ],
    [
      '/hosts/personal/',
      { hostId: 'personal', routeBase: '/hosts/personal', transportBase: '/_host/personal' },
    ],
  ])('maps %s to one UI and transport host', (path, expected) => {
    expect(resolveHostRoute(path)).toEqual(expected);
  });
});
