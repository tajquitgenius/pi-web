package ui

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"pi-web/internal/sessions"
)

func TestGenerateExportHtmlOmitsLiveProductControls(t *testing.T) {
	session := sessions.Session{
		SessionSummary: sessions.SessionSummary{ID: "s.jsonl", Filename: "s.jsonl"},
		Entries:        []map[string]any{{"id": "aaaaaaaa"}},
	}
	html := RenderExportSessionPage(session, "dark")
	for _, forbidden := range []string{
		`id="pi-chat-composer"`, `id="resume-btn"`, `class="fork-btn"`,
		`class="label-btn"`, `class="copy-link-btn"`, `#pi-chat-`,
		`.right-sidebar`, `.artifact-`, `.pi-annotation`, `@pierre/diffs`,
	} {
		if strings.Contains(html, forbidden) {
			t.Fatalf("static export contains live-only control %s", forbidden)
		}
	}
}

func TestPrepareSessionPageDataUsesLastNonLabelEntryWithIDAsLeaf(t *testing.T) {
	session := sessions.Session{Entries: []map[string]any{
		{"id": "root"},
		{"id": "leaf"},
		{"id": "label1", "type": "label", "targetId": "leaf", "label": "Done"},
		{"type": "session_info", "name": "Renamed"},
	}}
	dataBase64, _, _ := prepareSessionPageData(session, exportSessionCSS)
	dataJSON, err := base64.StdEncoding.DecodeString(dataBase64)
	if err != nil {
		t.Fatalf("decode session data: %v", err)
	}
	var payload struct {
		LeafID string `json:"leafId"`
	}
	if err := json.Unmarshal(dataJSON, &payload); err != nil {
		t.Fatalf("unmarshal session data: %v", err)
	}
	if payload.LeafID != "leaf" {
		t.Fatalf("leafId = %q, want leaf", payload.LeafID)
	}
}

func TestSanitizeTheme(t *testing.T) {
	valid := []string{"dark", "light", "nord", "dracula", "custom"}
	for _, theme := range valid {
		if got := sanitizeTheme(theme); got != theme {
			t.Errorf("sanitizeTheme(%q) = %q, want %q", theme, got, theme)
		}
	}

	malicious := []string{
		"'; alert(1); //",
		"dark\"; alert(1); //",
		"unknown",
		"",
		"DARK",
	}
	for _, theme := range malicious {
		if got := sanitizeTheme(theme); got != "dark" {
			t.Errorf("sanitizeTheme(%q) = %q, want dark", theme, got)
		}
	}
}
