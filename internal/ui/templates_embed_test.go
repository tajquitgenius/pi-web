package ui

import (
	"regexp"
	"strings"
	"testing"

	"pi-web/internal/sessions"
)

func TestRenderedExportPageReplacesKnownPlaceholders(t *testing.T) {
	session := sessions.Session{SessionSummary: sessions.SessionSummary{ID: "s.jsonl", Name: "Session"}}
	placeholders := []string{
		"{{TITLE}}", "{{SESSION_PRELOAD}}", "{{CSS}}", "{{BODY_ATTRS}}",
		"{{SESSION_DATA}}", "{{SESSION_SCRIPT}}", "{{FIRST_MESSAGE_STUB}}",
		"{{LIVE_DOCUMENT_START}}", "{{LIVE_THEME_BOOT}}", "{{LIVE_SERVICE_WORKER}}", "{{LIVE_DOCUMENT_END}}",
		"{{CHAT_COMPOSER}}", "{{THEME_VARS_DARK}}", "{{THEME_VARS_LIGHT}}",
		"{{BODY_BG}}", "{{CONTAINER_BG}}", "{{INFO_BG}}",
		"{{BODY_BG_LIGHT}}", "{{CONTAINER_BG_LIGHT}}", "{{INFO_BG_LIGHT}}",
		"{{SESSION_PALETTE}}",
	}
	html := RenderExportSessionPage(session, "dark")
	for _, placeholder := range placeholders {
		if strings.Contains(html, placeholder) {
			t.Fatalf("export render leaked template placeholder %s", placeholder)
		}
	}
}

func TestRenderedExportCSSDefinesUsedCustomProperties(t *testing.T) {
	html := RenderExportSessionPage(sessions.Session{SessionSummary: sessions.SessionSummary{ID: "s.jsonl", Name: "Session"}}, "dark")
	assertCSSCustomPropertiesDefined(t, "export", html)
}

func assertCSSCustomPropertiesDefined(t *testing.T, name, html string) {
	t.Helper()
	definedRE := regexp.MustCompile(`--([A-Za-z0-9_-]+)\s*:`)
	usedRE := regexp.MustCompile(`var\(--([A-Za-z0-9_-]+)`)
	defined := map[string]bool{}
	for _, match := range definedRE.FindAllStringSubmatch(html, -1) {
		defined[match[1]] = true
	}
	allowedRuntime := map[string]bool{}
	for _, match := range usedRE.FindAllStringSubmatch(html, -1) {
		if !defined[match[1]] && !allowedRuntime[match[1]] {
			t.Fatalf("%s CSS uses undefined custom property --%s", name, match[1])
		}
	}
}

// TestExportBundleIsSelfContained guards the static export runtime built by
// Vite (web/src/export/export-entry.js). The snapshot must run from a single
// inlined <script> with no server, so the bundle may not pull in any live-only
// machinery. If the export entry accidentally imports a module that reaches
// SSE/chat/live-reload, that symbol leaks into this bundle and fails here.
func TestExportBundleIsSelfContained(t *testing.T) {
	if strings.TrimSpace(exportJs) == "" {
		t.Fatal("embedded export.js is empty — run `npm run build:export` (or `make build`) first")
	}
	// The static snapshot cannot depend on the server or either React product.
	forbidden := []string{
		"EventSource", "WebSocket", "fetch(", "/api/",
		"runLiveReload", "live-reload-runner", "live-reload",
		"chatComposerRunner", "ChatComposer",
		"ArtifactPanel", "AnnotationLayer",
	}
	for _, sym := range forbidden {
		if strings.Contains(exportJs, sym) {
			t.Fatalf("export bundle contains live-only symbol %q — a live module leaked into the static export graph", sym)
		}
	}
}

func TestStaticExportDoesNotRegisterLiveServiceWorker(t *testing.T) {
	html := RenderExportSessionPage(sessions.Session{SessionSummary: sessions.SessionSummary{ID: "s.jsonl", Name: "Session"}}, "dark")
	if strings.Contains(html, "navigator.serviceWorker") || strings.Contains(html, "sw.js") {
		t.Fatal("static export must not register or reference the live service worker")
	}
}

func TestStaticExportKeepsInlineSessionRenderer(t *testing.T) {
	html := RenderExportSessionPage(sessions.Session{SessionSummary: sessions.SessionSummary{ID: "s.jsonl", Name: "Session"}}, "dark")
	// The export must inline its own self-contained runtime (the IIFE bundle is
	// exposed under the PiExport global), not pull a server-hosted Vite module.
	if !strings.Contains(html, "PiExport") {
		t.Fatal("static export missing inlined self-contained renderer bundle")
	}
	if strings.Contains(html, `src="/static/`) {
		t.Fatal("static export should not depend on a React product asset")
	}
}
