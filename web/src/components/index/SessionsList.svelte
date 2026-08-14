<script>
  import { onMount } from 'svelte';
  import { icon, ChevronDown } from '../../shared/icons.js';
  import { t } from '../../shared/i18n.js';
  import {
    collapsedProjectsStorageKey,
    groupSessionsByDate,
    groupSessionsByProject,
    sessionsCountLabel,
  } from '../../index/sessions.js';
  import SessionCard from './SessionCard.svelte';

  const dateBucketLabels = {
    today: 'index.dateToday',
    yesterday: 'index.dateYesterday',
    previous7days: 'index.datePrevious7Days',
    previous30days: 'index.datePrevious30Days',
    older: 'index.dateOlder',
  };

  let {
    sessions = [],
    layout = 'timeline',
    runningSessionIds = new Set(),
    runningStatuses = new Map(),
    loading = false,
    layoutReady = false,
    hasMore = false,
    loadingMore = false,
    onLoadMore = () => {},
  } = $props();

  let now = $state(Date.now());
  let collapsed = $state({});

  const isTimeline = $derived(layout === 'timeline');
  const runningSessions = $derived(sessions.filter((session) => runningSessionIds.has(session.id)));
  const recentSessions = $derived(sessions.filter((session) => !runningSessionIds.has(session.id)));
  const groups = $derived(
    isTimeline ? groupSessionsByDate(recentSessions, now) : groupSessionsByProject(recentSessions),
  );

  function readCollapsed() {
    try {
      const raw = localStorage.getItem(collapsedProjectsStorageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeCollapsed(state) {
    try {
      localStorage.setItem(collapsedProjectsStorageKey, JSON.stringify(state));
    } catch {}
  }

  function toggleProject(project) {
    collapsed = { ...collapsed, [project]: collapsed[project] ? undefined : 1 };
    if (!collapsed[project]) {
      const next = { ...collapsed };
      delete next[project];
      collapsed = next;
    }
    writeCollapsed(collapsed);
  }

  function runningCountFor(group) {
    return group.sessions.filter((session) => runningSessionIds.has(session.id)).length;
  }

  onMount(() => {
    collapsed = readCollapsed();
    const timer = setInterval(() => {
      now = Date.now();
    }, 60000);
    return () => clearInterval(timer);
  });
</script>

<!-- eslint-disable svelte/no-at-html-tags -- trusted: Lucide icon SVG and rendered session markdown -->

<div
  class="content"
  class:content--timeline={isTimeline}
  class:index-layout-ready={layoutReady}
  data-sessions-content
>
  {#if loading && sessions.length === 0}
    <div class="empty-state">
      <h3>{t('index.loadingSessions')}</h3>
      <p>{t('index.loadingSessionsHint')}</p>
    </div>
  {:else if sessions.length === 0}
    <div class="empty-state">
      <h3>{t('index.noSessionsYet')}</h3>
      <p>{t('index.noSessionsYetHint')}</p>
    </div>
  {:else}
    {#if runningSessions.length > 0}
      <section class="active-sessions" aria-labelledby="active-sessions-heading">
        <div class="section-heading-row">
          <div>
            <span class="section-eyebrow">{t('index.liveWork')}</span>
            <h2 id="active-sessions-heading">{t('index.runningNow')}</h2>
          </div>
          <span class="section-count">{runningSessions.length}</span>
        </div>
        <div class="session-grid session-grid--active">
          {#each runningSessions as session (session.id)}
            <SessionCard {session} running runningStatus={runningStatuses.get(session.id)} {now} />
          {/each}
        </div>
      </section>
    {/if}

    {#if recentSessions.length > 0}
      <div class="section-heading-row section-heading-row--recent">
        <div>
          <span class="section-eyebrow">{t('index.history')}</span>
          <h2>{t('index.recentSessions')}</h2>
        </div>
      </div>
    {/if}

    {#if isTimeline}
      {#each groups as group (group.bucket)}
        {@const runningCount = runningCountFor(group)}
        <div class="timeline-section" data-bucket={group.bucket}>
          <div class="date-separator">
            <span class="date-separator-label">{t(dateBucketLabels[group.bucket])}</span>
            <span class="date-separator-count" data-running={runningCount}>
              {runningCount > 0
                ? t('index.activeCount', { count: runningCount })
                : sessionsCountLabel(group.sessions.length)}
            </span>
          </div>
          <div class="session-grid">
            {#each group.sessions as session (session.id)}
              <SessionCard
                {session}
                running={runningSessionIds.has(session.id)}
                runningStatus={runningStatuses.get(session.id)}
                {now}
              />
            {/each}
          </div>
        </div>
      {/each}
    {:else}
      {#each groups as group (group.project + ':' + group.sessions[0]?.id)}
        {@const runningCount = runningCountFor(group)}
        {@const isCollapsed = !!collapsed[group.project]}
        <div class="project-group" class:collapsed={isCollapsed} data-project={group.project}>
          <button
            class="project-toggle"
            type="button"
            aria-expanded={String(!isCollapsed)}
            onclick={() => toggleProject(group.project)}
          >
            <span class="project-chevron" aria-hidden="true"
              >{@html icon(ChevronDown, { size: 12 })}</span
            >
            <span class="project-name">{group.project}</span>
            <span
              class="project-count"
              data-project-count
              data-running={runningCount}
              data-total={group.sessions.length}
            >
              {runningCount > 0
                ? t('index.activeCount', { count: runningCount })
                : sessionsCountLabel(group.sessions.length)}
            </span>
          </button>
          <div class="session-grid">
            {#each group.sessions as session (session.id)}
              <SessionCard
                {session}
                running={runningSessionIds.has(session.id)}
                runningStatus={runningStatuses.get(session.id)}
                {now}
              />
            {/each}
          </div>
        </div>
      {/each}
    {/if}
    {#if hasMore}
      <div class="load-more">
        <button class="load-more-btn" type="button" onclick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? t('index.loadingMore') : t('index.loadMore')}
        </button>
      </div>
    {/if}
  {/if}
</div>
