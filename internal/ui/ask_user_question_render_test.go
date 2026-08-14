package ui

import (
	"strings"
	"testing"
)

// These tests assert that the static export renders ask_user_question through
// its dedicated <AskQuestion> component. The source is easier to inspect than
// the minified embedded export bundle.
func readAskQuestionSrc(t *testing.T) string {
	t.Helper()
	return readSrc(t, "web/src/components/session/ToolCall.svelte") +
		readSrc(t, "web/src/components/session/AskQuestion.svelte")
}

func TestAskUserQuestionToolHasDedicatedRenderer(t *testing.T) {
	src := readAskQuestionSrc(t)
	jsChecks := []string{
		"'ask_user_question'",
		"'pi_web_ask_user_question'",
		"<AskQuestion",
	}
	for _, check := range jsChecks {
		if !strings.Contains(src, check) {
			t.Fatalf("missing %q; ask_user_question should not render as raw JSON", check)
		}
	}
	// The read-only card/option chrome is styled in the export session CSS.
	for _, check := range []string{"ask-question-card", "ask-question-option"} {
		if !strings.Contains(exportSessionCSS, check) {
			t.Fatalf("missing %q in session CSS", check)
		}
	}
}

func TestAskUserQuestionSnapshotPreservesQuestionState(t *testing.T) {
	src := readAskQuestionSrc(t)
	for _, check := range []string{
		"data-multi-select=",
		"result?.details?.awaitingChatReply === true",
		"result?.isError === true",
		"question UI failed",
		"waiting for response",
	} {
		if !strings.Contains(src, check) {
			t.Fatalf("read-only question snapshot missing %q", check)
		}
	}
}

func TestAskUserQuestionSnapshotHasNoLiveReplyControls(t *testing.T) {
	src := readAskQuestionSrc(t)
	for _, forbidden := range []string{
		"<button",
		"ask-question-option-action",
		"ask-question-submit-btn",
		"chat composer",
		"send your answer",
	} {
		if strings.Contains(src, forbidden) {
			t.Fatalf("read-only question snapshot contains live control %q", forbidden)
		}
	}
}
