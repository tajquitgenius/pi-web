<script>
  // Static snapshot message pane for the active root-to-leaf branch.
  import SessionEntry from './SessionEntry.svelte';

  let { model, afterRender = null } = $props();

  let containerEl = $state(null);

  // Re-run post-render side effects whenever the rendered path changes.
  $effect(() => {
    model.activePath;
    if (containerEl && typeof afterRender === 'function') {
      afterRender(containerEl);
    }
  });
</script>

<div id="messages-list" class="messages-list" bind:this={containerEl}>
  {#each model.activePath as entry (entry.id)}
    <SessionEntry {entry} {model} />
  {/each}
</div>
