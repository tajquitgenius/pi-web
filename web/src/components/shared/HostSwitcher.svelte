<script>
  import { onMount } from 'svelte';
  import { icon, Check, ChevronDown } from '../../shared/icons.js';
  import { t } from '../../shared/i18n.js';

  let { host = { instanceName: 'This computer', currentUrl: '', peers: [] }, compact = false } =
    $props();

  let open = $state(false);
  let buttonEl = $state(null);
  let menuEl = $state(null);
  const hasPeers = $derived(Array.isArray(host.peers) && host.peers.length > 0);

  function close({ restoreFocus = false } = {}) {
    if (!open) return;
    open = false;
    if (restoreFocus) requestAnimationFrame(() => buttonEl?.focus());
  }

  function toggle(event) {
    event.stopPropagation();
    if (!hasPeers) return;
    open = !open;
    if (open) requestAnimationFrame(() => menuEl?.querySelector('[role="menuitem"]')?.focus());
  }

  onMount(() => {
    const onDocumentClick = () => close();
    const onKeydown = (event) => {
      if (event.key === 'Escape') close({ restoreFocus: true });
    };
    document.addEventListener('click', onDocumentClick);
    window.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('click', onDocumentClick);
      window.removeEventListener('keydown', onKeydown);
    };
  });
</script>

<!-- eslint-disable svelte/no-at-html-tags -- trusted Lucide SVG -->

<div class="host-switcher" class:host-switcher--compact={compact}>
  <button
    bind:this={buttonEl}
    type="button"
    class="host-switcher-trigger"
    class:host-switcher-trigger--static={!hasPeers}
    aria-label={hasPeers
      ? t('host.switch', { host: host.instanceName })
      : t('host.current', { host: host.instanceName })}
    aria-haspopup={hasPeers ? 'menu' : undefined}
    aria-expanded={hasPeers ? String(open) : undefined}
    onclick={toggle}
  >
    <span class="host-presence" aria-hidden="true"></span>
    <span class="host-switcher-label">{host.instanceName}</span>
    {#if hasPeers}<span class="host-switcher-chevron" aria-hidden="true"
        >{@html icon(ChevronDown, { size: 14 })}</span
      >{/if}
  </button>

  {#if open && hasPeers}
    <div bind:this={menuEl} class="host-switcher-menu" role="menu" aria-label={t('host.menu')}>
      <div class="host-switcher-caption">{t('host.currentComputer')}</div>
      <div class="host-switcher-current" aria-current="true">
        <span>{@html icon(Check, { size: 14 })}</span>
        <span>{host.instanceName}</span>
      </div>
      <div class="host-switcher-caption host-switcher-caption--peers">
        {t('host.otherComputers')}
      </div>
      {#each host.peers as peer (peer.url)}
        <a class="host-switcher-peer" href={peer.url} role="menuitem">{peer.label}</a>
      {/each}
    </div>
  {/if}
</div>
