<script module>
  // Click-to-expand static tool output. Code blocks are marked for the export
  // runtime's post-render syntax-highlighting pass.
  export function toggleExpanded(e) {
    if (window.getSelection && window.getSelection().toString()) return;
    e.currentTarget.classList.toggle('expanded');
  }
</script>

<script>
  import { splitOutputLines } from '../../session/render/entry-format.js';

  let { text = '', maxLines = 10, lang = null } = $props();

  const split = $derived(splitOutputLines(text, maxLines));
  const expandable = $derived(split.remaining > 0);
</script>

{#if lang}
  {#if expandable}
    <div class="tool-output expandable" onclick={toggleExpanded} role="presentation">
      <div class="output-preview">
        <pre><code class="hljs" data-highlight-pending data-lang={lang}
            >{split.preview.join('\n')}</code
          ></pre>
        <div class="expand-hint">... ({split.remaining} more lines)</div>
      </div>
      <div class="output-full">
        <pre><code class="hljs" data-highlight-pending data-lang={lang}
            >{split.lines.join('\n')}</code
          ></pre>
      </div>
    </div>
  {:else}
    <div class="tool-output">
      <pre><code class="hljs" data-highlight-pending data-lang={lang}>{split.lines.join('\n')}</code
        ></pre>
    </div>
  {/if}
{:else if expandable}
  <div class="tool-output expandable" onclick={toggleExpanded} role="presentation">
    <div class="output-preview">
      {#each split.preview as line, lineIndex (lineIndex)}<div>{line}</div>{/each}
      <div class="expand-hint">... ({split.remaining} more lines)</div>
    </div>
    <div class="output-full">
      {#each split.lines as line, lineIndex (lineIndex)}<div>{line}</div>{/each}
    </div>
  </div>
{:else}
  <div class="tool-output">
    {#each split.preview as line, lineIndex (lineIndex)}<div>{line}</div>{/each}
  </div>
{/if}
