<script>
  import { t } from '../../shared/i18n.js';
  import { handleNavClick } from '../../shared/navigation.js';
  import { prefetchSession } from '../../routes/session-prefetch.js';
  import {
    formatRelativeTime,
    formatRunningModel,
    sessionModelLabel,
    sessionSearchText,
  } from '../../index/sessions.js';

  let { session, running = false, runningStatus = null, now = Date.now() } = $props();

  const href = $derived(`/session?id=${encodeURIComponent(session.id || '')}`);
  const title = $derived(displayTitle(session));
  const modelLabel = $derived(formatRunningModel(runningStatus) || sessionModelLabel(session));
  const runningModel = $derived(running ? formatRunningModel(runningStatus) : '');
  const search = $derived(sessionSearchText(session));

  // Start /api/session as soon as the user signals intent (hover or press), so
  // the response is usually back by the time SessionPage mounts. All three
  // events route through prefetchSession, which dedupes on session id.
  function startPrefetch() {
    if (session?.id) prefetchSession(session.id);
  }

  function displayTitle(value) {
    const name = String(value?.name || '').trim();
    const rawSessionName =
      !name ||
      name.endsWith('.jsonl') ||
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(name) ||
      /^\d{4}-\d{2}-\d{2}T.*\.jsonl$/i.test(name);
    return rawSessionName ? t('index.untitledSession') : name;
  }
</script>

<a
  class="session-card"
  class:session-card--running={running}
  {href}
  onclick={(event) => handleNavClick(event, href)}
  onpointerenter={startPrefetch}
  onmousedown={startPrefetch}
  ontouchstart={startPrefetch}
  data-id={session.id}
  data-session-id={session.id}
  data-search={search}
>
  <div class="session-title-row">
    <div class="session-title">{title}</div>
    <div class="session-card-flags">
      {#if !session.chatAvailable}
        <span
          class="session-card-badge"
          title={session.chatDisabledReason || t('composer.disabledNotice')}
          >{t('index.viewOnly')}</span
        >
      {/if}
    </div>
  </div>
  <div class="session-project">{session.project || t('index.unknownProject')}</div>
  <div class="session-meta">
    {#if running}<span class="session-active-status" data-running-status
        ><span class="status-dot" aria-hidden="true"></span>{t('index.running')}</span
      >{/if}
    <span class="session-model" data-session-model>{runningModel || modelLabel}</span>
    <span class="session-time" data-timestamp={session.lastActivity} title={session.lastActivity}
      >{formatRelativeTime(session.lastActivity, now)}</span
    >
  </div>
</a>
