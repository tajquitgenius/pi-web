<script>
  import { onMount } from 'svelte';

  // Click-to-zoom overlay for transcript images in a static snapshot.
  const ZOOMABLE_SELECTOR = '.message-image';

  let open = $state(false);
  // null (not '') so the bound <img> drops its src attribute when closed.
  let src = $state(null);
  let alt = $state('');
  let containerEl = $state(null);
  let imgEl = $state(null);

  function show(nextSrc, nextAlt) {
    if (!nextSrc) return;
    src = nextSrc;
    alt = nextAlt || '';
    open = true;
  }

  function close() {
    open = false;
    src = null;
  }

  onMount(() => {
    const onClick = (e) => {
      const zoomable = e.target.closest?.(ZOOMABLE_SELECTOR);
      if (zoomable && zoomable !== imgEl) {
        show(zoomable.currentSrc || zoomable.src, zoomable.alt);
        return;
      }
      // Click anywhere on the open overlay (backdrop or the image) dismisses it.
      if (open && (e.target === containerEl || e.target === imgEl)) close();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && open) close();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  });
</script>

<div id="image-modal" class="image-modal" class:open bind:this={containerEl}>
  <img id="modal-image" {src} {alt} bind:this={imgEl} />
</div>
