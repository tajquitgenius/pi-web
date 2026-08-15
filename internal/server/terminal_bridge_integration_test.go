package server

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"pi-web/internal/terminalbridge"
	"pi-web/internal/workers"
)

type terminalIntegrationFallback struct {
	*fakeSender
	mu       sync.Mutex
	releases int
}

func (f *terminalIntegrationFallback) Release(context.Context, string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.releases++
	return nil
}

func TestChatHandlerRoutesIntoConnectedTerminalWithoutRPCFallback(t *testing.T) {
	agentDir := t.TempDir()
	sessionsDir := t.TempDir()
	path := writeSessionFile(t, sessionsDir, "project", "session.jsonl")
	fallback := &terminalIntegrationFallback{fakeSender: &fakeSender{}}
	bridge, err := terminalbridge.Start(agentDir, sessionsDir, fallback)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = bridge.Close(context.Background()) })
	data, err := os.ReadFile(filepath.Join(agentDir, "pi-web", terminalbridge.DiscoveryFilename))
	if err != nil {
		t.Fatal(err)
	}
	var discovery terminalbridge.Discovery
	if err := json.Unmarshal(data, &discovery); err != nil {
		t.Fatal(err)
	}
	connection, _, err := websocket.Dial(t.Context(),
		"ws://127.0.0.1:"+strconv.Itoa(discovery.Port)+"/api/terminal/connect",
		&websocket.DialOptions{Subprotocols: []string{"pi-web-terminal-v1", "token." + discovery.Token}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close(websocket.StatusNormalClosure, "test complete") })
	if err := wsjson.Write(t.Context(), connection, map[string]any{
		"type": "hello", "version": 1, "sessionId": "session.jsonl", "sessionUuid": "sid", "leafId": "aaaaaaaa",
		"state": workers.WorkerStatus{State: workers.WorkerStateIdle},
	}); err != nil {
		t.Fatal(err)
	}
	var ready map[string]any
	if err := wsjson.Read(t.Context(), connection, &ready); err != nil {
		t.Fatal(err)
	}
	if ready["type"] != "ready" {
		t.Fatalf("first terminal frame = %#v", ready)
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("message", "visible in the terminal")
	_ = writer.Close()
	request := httptest.NewRequest(http.MethodPost, "/api/chat?id=session.jsonl", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		server := &Server{sessionsDir: sessionsDir, chatSender: bridge.Router}
		server.handleChat(response, request)
		close(done)
	}()

	readCtx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	var prompt map[string]any
	if err := wsjson.Read(readCtx, connection, &prompt); err != nil {
		t.Fatal(err)
	}
	if prompt["operation"] != "prompt" {
		t.Fatalf("terminal operation = %#v", prompt)
	}
	chatPayload, _ := prompt["chat"].(map[string]any)
	if chatPayload["message"] != "visible in the terminal" {
		t.Fatalf("terminal chat payload = %#v", chatPayload)
	}
	if err := wsjson.Write(t.Context(), connection, map[string]any{
		"type": "response", "id": prompt["id"], "ok": true,
	}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("chat handler did not finish after terminal acknowledgement")
	}
	if response.Code != http.StatusAccepted {
		t.Fatalf("chat status = %d body=%s", response.Code, response.Body.String())
	}
	fallback.mu.Lock()
	releases := fallback.releases
	fallback.mu.Unlock()
	sentID, sentPath, _ := fallback.sentInfo()
	if releases != 1 || sentID != "" || sentPath != "" {
		t.Fatalf("fallback activity releases=%d sentID=%q path=%q; session path was %q", releases, sentID, sentPath, path)
	}
}
