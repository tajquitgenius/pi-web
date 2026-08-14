import { describe, expect, it, vi } from 'vitest';
import { isEditableTarget, setupKeyboardNav } from './keyboard-nav.js';

describe('isEditableTarget', () => {
  it('recognizes form and contenteditable targets', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });
});

describe('setupKeyboardNav', () => {
  function createWindow() {
    return { scrollBy: vi.fn(), scrollTo: vi.fn() };
  }

  function createDocument(activeElement = null, content = null) {
    const listeners = [];
    return {
      activeElement,
      documentElement: { scrollHeight: 5000 },
      getElementById: vi.fn((id) => (id === 'content' ? content : null)),
      addEventListener(type, handler, options) {
        listeners.push({ type, handler, options });
      },
      dispatch(key, init = {}) {
        const event = {
          key,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          ...init,
        };
        for (const listener of listeners) {
          if (listener.type === 'keydown') listener.handler(event);
        }
        return event;
      },
    };
  }

  function createTimers() {
    let pending = null;
    return {
      setTimeoutImpl(fn) {
        pending = fn;
        return 1;
      },
      clearTimeoutImpl() {
        pending = null;
      },
      fire() {
        const fn = pending;
        pending = null;
        fn?.();
      },
    };
  }

  it('blurs the export search field on Escape in capture phase', () => {
    const active = { tagName: 'INPUT', blur: vi.fn() };
    const documentImpl = createDocument(active);
    setupKeyboardNav({ windowImpl: createWindow(), documentImpl });

    const event = documentImpl.dispatch('Escape');

    expect(active.blur).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it('does not intercept keys while an editable element has focus', () => {
    const windowImpl = createWindow();
    const documentImpl = createDocument({ tagName: 'INPUT' });
    setupKeyboardNav({ windowImpl, documentImpl });

    documentImpl.dispatch('j');
    documentImpl.dispatch('G');

    expect(windowImpl.scrollBy).not.toHaveBeenCalled();
    expect(windowImpl.scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls the static content pane with j and k', () => {
    const content = { scrollBy: vi.fn(), scrollTo: vi.fn(), scrollHeight: 8000 };
    const documentImpl = createDocument(null, content);
    setupKeyboardNav({ windowImpl: createWindow(), documentImpl });

    documentImpl.dispatch('j');
    documentImpl.dispatch('k');

    expect(content.scrollBy).toHaveBeenNthCalledWith(1, { top: 300, behavior: 'instant' });
    expect(content.scrollBy).toHaveBeenNthCalledWith(2, { top: -300, behavior: 'instant' });
  });

  it('scrolls the static content pane to the top on gg and bottom on G', () => {
    const content = { scrollBy: vi.fn(), scrollTo: vi.fn(), scrollHeight: 8000 };
    const documentImpl = createDocument(null, content);
    setupKeyboardNav({ windowImpl: createWindow(), documentImpl });

    documentImpl.dispatch('g');
    documentImpl.dispatch('g');
    documentImpl.dispatch('G');

    expect(content.scrollTo).toHaveBeenNthCalledWith(1, { top: 0, behavior: 'instant' });
    expect(content.scrollTo).toHaveBeenNthCalledWith(2, { top: 8000, behavior: 'instant' });
  });

  it('expires a single g after the double-tap window', () => {
    const timers = createTimers();
    const windowImpl = createWindow();
    const documentImpl = createDocument();
    setupKeyboardNav({ windowImpl, documentImpl, ...timers });

    documentImpl.dispatch('g');
    timers.fire();
    documentImpl.dispatch('g');

    expect(windowImpl.scrollTo).not.toHaveBeenCalled();
  });

  it('ignores modified and unrelated keys', () => {
    const windowImpl = createWindow();
    const documentImpl = createDocument();
    setupKeyboardNav({ windowImpl, documentImpl });

    documentImpl.dispatch('j', { metaKey: true });
    documentImpl.dispatch('G', { altKey: true });
    documentImpl.dispatch('I');

    expect(windowImpl.scrollBy).not.toHaveBeenCalled();
    expect(windowImpl.scrollTo).not.toHaveBeenCalled();
  });
});
