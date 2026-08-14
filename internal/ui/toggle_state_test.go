package ui

import (
	"os"
	"strings"
	"testing"
)

func readSrc(t *testing.T, rel string) string {
	t.Helper()
	data, err := os.ReadFile(repoPath(rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return string(data)
}

func TestExportToggleButtonsReflectPersistedActiveState(t *testing.T) {
	toggleSrc := readSrc(t, "web/src/session/ui/toggle-state.js")
	runnerSrc := readSrc(t, "web/src/session/ui/session-ui-runner.js")
	headerSrc := readSrc(t, "web/src/components/session/SessionInfoHeader.svelte")

	srcChecks := map[string][]string{
		toggleSrc: {
			"const TOGGLE_STATE_STORAGE_KEY = 'pi.sessionDetail.toggleState';",
			"toolsVisible: true",
			"toolOutputsExpanded: false",
			"storage?.getItem(TOGGLE_STATE_STORAGE_KEY)",
			"storage?.setItem(TOGGLE_STATE_STORAGE_KEY, JSON.stringify(map));",
			"btn.classList.toggle('active', isActive);",
			"btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');",
		},
		runnerSrc: {"sessionRuntime.toggleState = toggleController;"},
		headerSrc: {`data-action="toggle-tool-output"`, "show/hide thinking"},
	}
	for src, checks := range srcChecks {
		for _, check := range checks {
			if !strings.Contains(src, check) {
				t.Fatalf("export toggle controls missing persisted state behavior %q", check)
			}
		}
	}
	if !strings.Contains(exportSessionCSS, ".header-toggle-btn.active") {
		t.Fatal("export CSS missing active toggle styling")
	}
}

func TestExportToolsVisibilityAndOutputExpansionAreSeparateStates(t *testing.T) {
	src := readSrc(t, "web/src/session/ui/toggle-state.js")
	checks := []string{
		"node.querySelectorAll('.tool-execution, .compaction').forEach((el) => {",
		"el.style.display = state.toolsVisible ? '' : 'none';",
		"node.querySelectorAll('.tool-output.expandable').forEach((el) => {",
		"el.classList.toggle('expanded', state.toolOutputsExpanded);",
		"toggleToolsVisibility: () => toggle('toolsVisible'),",
		"if (!state.toolsVisible) return;",
		"toggle('toolOutputsExpanded');",
	}
	for _, check := range checks {
		if !strings.Contains(src, check) {
			t.Fatalf("export tool toggle behavior missing %q", check)
		}
	}
}

func TestExportReappliesToggleStateAfterRenderingMessages(t *testing.T) {
	contentSrc := readSrc(t, "web/src/components/session/SessionContent.svelte")
	exportSrc := readSrc(t, "web/src/export/export-entry.js")
	for src, checks := range map[string][]string{
		contentSrc: {"afterRender(containerEl)"},
		exportSrc:  {"sessionRuntime.toggleState?.applyToNode(container)"},
	} {
		for _, check := range checks {
			if !strings.Contains(src, check) {
				t.Fatalf("export message pane does not reapply toggle state; missing %q", check)
			}
		}
	}
}

func TestExportRendererUsesToggleableThinkingAndToolMarkup(t *testing.T) {
	entrySrc := readSrc(t, "web/src/components/session/SessionEntry.svelte")
	outputSrc := readSrc(t, "web/src/components/session/ToolOutput.svelte")
	for src, checks := range map[string][]string{
		entrySrc:  {`thinking-block`, `Thinking ...`},
		outputSrc: {`tool-output expandable`, `output-preview`, `output-full`},
	} {
		for _, check := range checks {
			if !strings.Contains(src, check) {
				t.Fatalf("export entry markup missing toggle-compatible class %q", check)
			}
		}
	}
}
