<script>
  // Read-only ask_user_question card for a static conversation snapshot.
  import { icon, Check } from '../../shared/icons.js';

  let { args = {}, result = null } = $props();

  const questions = $derived(Array.isArray(args.questions) ? args.questions : []);
  const answers = $derived(result?.details?.answers || {});
  const cancelled = $derived(result?.details?.cancelled === true);
  const awaitingChatReply = $derived(result?.details?.awaitingChatReply === true);
  const questionToolFailed = $derived(result?.isError === true);
  const isMulti = $derived(questions.length > 1);
  const anyMultiSelect = $derived(questions.some((q) => q && q.multiSelect === true));
  const needsSubmit = $derived(isMulti || anyMultiSelect);

  function optionLabel(option) {
    if (typeof option?.label === 'string') return option.label;
    if (typeof option?.value === 'string') return option.value;
    return String(option || '');
  }
  function optionDesc(option) {
    return typeof option?.description === 'string' ? option.description : '';
  }
  function answerFor(q, questionText) {
    if (Array.isArray(answers)) {
      const answer = answers.find((item) => item?.id === q?.id);
      return answer?.label ?? answer?.value ?? '';
    }
    return answers[questionText] ?? answers[q?.id] ?? '';
  }
  function isSelected(answer, label) {
    return answer === label || (typeof answer === 'string' && answer.split(', ').includes(label));
  }
  function questionTextOf(q, i) {
    if (typeof q?.question === 'string') return q.question;
    if (typeof q?.question_text === 'string') return q.question_text;
    if (typeof q?.prompt === 'string') return q.prompt;
    return `Question ${i + 1}`;
  }
  function questionHeaderOf(q) {
    return q?.header ?? q?.label ?? '';
  }
</script>

<!-- eslint-disable svelte/no-at-html-tags -- trusted: Lucide icon SVG and rendered session markdown -->

<div
  class="ask-question-card"
  data-question-count={questions.length}
  data-needs-submit={needsSubmit}
>
  <div class="ask-question-title">Question for you</div>
  {#if questionToolFailed}
    <div class="ask-question-state error">question UI failed</div>
  {:else if cancelled}
    <div class="ask-question-state error">cancelled</div>
  {:else if awaitingChatReply}
    <div class="ask-question-state pending">waiting for response</div>
  {:else if result}
    <div class="ask-question-state answered">answered</div>
  {:else}
    <div class="ask-question-state pending">waiting for response</div>
  {/if}

  {#if questions.length === 0}
    <div class="ask-question-text">No question payload provided.</div>
  {/if}

  {#each questions as q, qIndex (questionTextOf(q, qIndex))}
    {@const questionText = questionTextOf(q, qIndex)}
    {@const answer = answerFor(q, questionText)}
    {@const options = Array.isArray(q.options) ? q.options : []}
    <div
      class="ask-question-block"
      data-question-text={questionText}
      data-multi-select={q && q.multiSelect === true}
    >
      {#if questionHeaderOf(q)}<div class="ask-question-header">
          {String(questionHeaderOf(q))}
        </div>{/if}
      <div class="ask-question-text">{questionText}</div>
      {#if options.length > 0}
        <div class="ask-question-options">
          {#each options as option, optionIndex (optionIndex)}
            {@const label = optionLabel(option)}
            {@const desc = optionDesc(option)}
            {@const selected = isSelected(answer, label)}
            <div class="ask-question-option{selected ? ' selected' : ''}">
              <div class="ask-question-option-label">
                {#if selected}{@html icon(Check, { size: 13 })}
                {/if}{label}
              </div>
              {#if desc}<div class="ask-question-option-desc">{desc}</div>{/if}
            </div>
          {/each}
        </div>
      {/if}
      {#if answer}<div class="ask-question-answer"><span>Answer:</span> {String(answer)}</div>{/if}
    </div>
  {/each}
</div>
