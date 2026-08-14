package ui

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"testing"

	"pi-web/internal/sessions"
)

func sessionWithNEntries(n int) sessions.Session {
	entries := make([]map[string]any, n)
	for i := 0; i < n; i++ {
		entries[i] = map[string]any{
			"type":      "message",
			"id":        fmt.Sprintf("id%06d", i),
			"timestamp": "2026-05-06T00:00:00.000Z",
			"message":   map[string]any{"role": "user", "content": "m"},
		}
	}
	return sessions.Session{
		SessionSummary: sessions.SessionSummary{ID: "test.jsonl", Filename: "test.jsonl", ChatAvailable: true},
		Header:         map[string]any{"cwd": "/tmp", "name": "Test"},
		Entries:        entries,
	}
}

func decodeEmbed(t *testing.T, dataBase64 string) map[string]any {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(dataBase64)
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("json decode: %v", err)
	}
	return payload
}

func TestPrepareSessionPageData_EmbedsEverySmallSessionEntry(t *testing.T) {
	n := LargeSessionThreshold - 1
	dataBase64, _, _ := prepareSessionPageData(sessionWithNEntries(n), "")

	payload := decodeEmbed(t, dataBase64)
	entries, _ := payload["entries"].([]any)
	if len(entries) != n {
		t.Fatalf("static export embedded %d entries, want all %d", len(entries), n)
	}
}

func TestPrepareSessionPageData_LargeExportIsCompleteAndSelfContained(t *testing.T) {
	n := LargeSessionThreshold + 500
	dataBase64, _, _ := prepareSessionPageData(sessionWithNEntries(n), "")

	payload := decodeEmbed(t, dataBase64)
	entries, _ := payload["entries"].([]any)
	if len(entries) != n {
		t.Fatalf("static export embedded %d entries, want all %d", len(entries), n)
	}
	for _, livePaginationField := range []string{"truncated", "from", "total"} {
		if _, found := payload[livePaginationField]; found {
			t.Fatalf("static export leaked live pagination field %q", livePaginationField)
		}
	}
	wantLeaf := fmt.Sprintf("id%06d", n-1)
	if leaf, _ := payload["leafId"].(string); leaf != wantLeaf {
		t.Fatalf("leafId = %q, want %q", leaf, wantLeaf)
	}
}
