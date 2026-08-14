<script>
  import { t } from '../../shared/i18n.js';
  import {
    icon,
    SquarePen,
    FolderGit2,
    BookOpen,
    Send,
    Settings,
    Tag,
  } from '../../shared/icons.js';
  import { openVersionModal } from '../../shared/version.js';
  import { USER_DOCS_URL, TELEGRAM_INVITE_URL } from '../../shared/links.js';
  import { handleNavClick } from '../../shared/navigation.js';

  let {
    open = false,
    onClose = () => {},
    onNewSession = () => {},
    onManageProjects = () => {},
  } = $props();

  let menuEl = $state(null);

  function handleBackdropClick(e) {
    e.stopPropagation();
    onClose();
  }

  function handleMenuKeydown(event) {
    const items = [...(menuEl?.querySelectorAll('[role="menuitem"]') || [])];
    const current = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      document.getElementById('web-menu-btn')?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || items.length === 0) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  $effect(() => {
    if (open) requestAnimationFrame(() => menuEl?.querySelector('[role="menuitem"]')?.focus());
  });
</script>

<!-- eslint-disable svelte/no-at-html-tags -- trusted: Lucide icon SVG and rendered session markdown -->

<div
  id="web-menu-backdrop"
  class="mobile-command-backdrop"
  class:open
  style:display={open ? '' : 'none'}
  role="presentation"
  onclick={handleBackdropClick}
></div>
<div
  bind:this={menuEl}
  id="web-menu"
  class="web-menu"
  class:open
  role="menu"
  tabindex="-1"
  aria-labelledby="web-menu-btn"
  hidden={!open}
  onclick={(e) => e.stopPropagation()}
  onkeydown={handleMenuKeydown}
>
  <div class="web-menu-section">
    <button
      class="web-menu-item"
      type="button"
      data-new-session-btn
      role="menuitem"
      onclick={() => {
        onClose();
        onNewSession();
      }}
      ><span class="menu-item-label"
        >{@html icon(SquarePen, { size: 15 })}{t('index.newSession')}</span
      ></button
    >
    <button
      class="web-menu-item"
      type="button"
      id="manage-projects-btn"
      data-manage-projects-btn
      role="menuitem"
      onclick={() => {
        onClose();
        onManageProjects();
      }}
      ><span class="menu-item-label"
        >{@html icon(FolderGit2, { size: 15 })}{t('index.manageProjects')}</span
      ></button
    >
  </div>
  <div class="web-menu-section">
    <a
      class="web-menu-item"
      href={USER_DOCS_URL}
      target="_blank"
      rel="noreferrer"
      role="menuitem"
      onclick={onClose}
      ><span class="menu-item-label"
        >{@html icon(BookOpen, { size: 15 })}{t('common.userDocs')}</span
      ></a
    >
    <a
      class="web-menu-item"
      href={TELEGRAM_INVITE_URL}
      target="_blank"
      rel="noreferrer"
      role="menuitem"
      onclick={onClose}
      ><span class="menu-item-label">{@html icon(Send, { size: 15 })}{t('common.telegram')}</span
      ></a
    >
    <a
      class="web-menu-item"
      href="/settings"
      role="menuitem"
      onclick={(event) => {
        onClose();
        handleNavClick(event, '/settings');
      }}
      ><span class="menu-item-label"
        >{@html icon(Settings, { size: 15 })}{t('common.settings')}</span
      ><kbd>⌘,</kbd></a
    >
    <button
      class="web-menu-item"
      type="button"
      id="index-version-row"
      data-version-row
      role="menuitem"
      onclick={() => {
        onClose();
        openVersionModal();
      }}
      ><span class="menu-item-label">{@html icon(Tag, { size: 15 })}{t('common.version')}</span
      ><span class="version-status" data-version-status>…</span></button
    >
  </div>
</div>
