import { describe, expect, it } from 'vitest';
import { readHostContext } from './host-context.js';

function documentWith(value) {
  const documentImpl = document.implementation.createHTMLDocument();
  if (value !== undefined) {
    const el = documentImpl.createElement('script');
    el.id = 'pi-host-context';
    el.textContent = value;
    documentImpl.body.append(el);
  }
  return documentImpl;
}

describe('readHostContext', () => {
  it('returns a useful local fallback without bootstrap data', () => {
    expect(readHostContext({ documentImpl: documentWith() })).toEqual({
      instanceName: 'This computer',
      currentUrl: '',
      peers: [],
    });
  });

  it('normalizes the current instance and valid peer links', () => {
    const value = JSON.stringify({
      instanceName: ' Personal laptop ',
      currentUrl: 'https://personal-pi.example.com',
      peers: [
        { label: ' Work laptop ', url: 'https://work-pi.example.com' },
        { label: '', url: 'https://ignored.example.com' },
      ],
    });
    expect(readHostContext({ documentImpl: documentWith(value) })).toEqual({
      instanceName: 'Personal laptop',
      currentUrl: 'https://personal-pi.example.com',
      peers: [{ label: 'Work laptop', url: 'https://work-pi.example.com' }],
    });
  });

  it('fails closed to local context when JSON is invalid', () => {
    expect(readHostContext({ documentImpl: documentWith('{') }).instanceName).toBe('This computer');
  });
});
