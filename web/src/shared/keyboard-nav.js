const SCROLL_AMOUNT = 300;
const GG_TIMEOUT = 500;

export function isEditableTarget(element) {
  if (!element) return false;
  const tagName = element.tagName;
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
  return element.isContentEditable || Boolean(element.closest?.('[contenteditable="true"]'));
}

// Keyboard navigation for the read-only static conversation export.
export function setupKeyboardNav({
  windowImpl = window,
  documentImpl = document,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  let ggTimer = null;

  documentImpl.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return;
      const active = documentImpl.activeElement;
      if (!isEditableTarget(active)) return;
      event.preventDefault();
      event.stopPropagation();
      active.blur();
    },
    { capture: true },
  );

  documentImpl.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditableTarget(documentImpl.activeElement)) return;

    const content =
      typeof documentImpl.getElementById === 'function'
        ? documentImpl.getElementById('content')
        : null;

    if (event.key === 'j' || event.key === 'k') {
      event.preventDefault();
      const top = event.key === 'j' ? SCROLL_AMOUNT : -SCROLL_AMOUNT;
      if (content) content.scrollBy({ top, behavior: 'instant' });
      else windowImpl.scrollBy({ top, behavior: 'instant' });
      return;
    }

    if (event.key === 'g') {
      event.preventDefault();
      if (!ggTimer) {
        ggTimer = setTimeoutImpl(() => {
          ggTimer = null;
        }, GG_TIMEOUT);
        return;
      }
      clearTimeoutImpl(ggTimer);
      ggTimer = null;
      if (content) content.scrollTo({ top: 0, behavior: 'instant' });
      else windowImpl.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }

    if (event.key === 'G') {
      event.preventDefault();
      if (content) content.scrollTo({ top: content.scrollHeight, behavior: 'instant' });
      else {
        windowImpl.scrollTo({
          top: documentImpl.documentElement.scrollHeight,
          behavior: 'instant',
        });
      }
    }
  });
}
