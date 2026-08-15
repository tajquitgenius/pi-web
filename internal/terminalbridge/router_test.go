package terminalbridge

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"pi-web/internal/chat"
	"pi-web/internal/workers"
)

type fakeFallback struct {
	mu       sync.Mutex
	sends    int
	releases int
}

func (f *fakeFallback) Send(context.Context, string, string, chat.Request) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sends++
	return nil
}
func (f *fakeFallback) SetModel(context.Context, string, string, string, string) error { return nil }
func (f *fakeFallback) SetThinkingLevel(context.Context, string, string, string) error { return nil }
func (f *fakeFallback) Abort(context.Context, string) error                            { return nil }
func (f *fakeFallback) GetState(context.Context, string) (workers.WorkerStatus, error) {
	return workers.WorkerStatus{State: workers.WorkerStateIdle}, nil
}
func (f *fakeFallback) GetCommands(context.Context, string) ([]workers.SlashCommand, bool, error) {
	return nil, false, nil
}
func (f *fakeFallback) Status(string) workers.WorkerStatus {
	return workers.WorkerStatus{State: workers.WorkerStateIdle}
}
func (f *fakeFallback) EnsureWorker(context.Context, string, string) error { return nil }
func (f *fakeFallback) Release(context.Context, string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.releases++
	return nil
}

func writeTerminalTestSession(t *testing.T, sessionsDir string) (string, string) {
	t.Helper()
	project := filepath.Join(sessionsDir, "project")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	id := "2026-08-15T12-00-00-000Z_terminal.jsonl"
	path := filepath.Join(project, id)
	body := `{"type":"session","version":3,"id":"terminal","cwd":` + quoteJSON(project) + `}` + "\n"
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return id, path
}

func quoteJSON(value string) string {
	out := `"`
	for _, r := range value {
		switch r {
		case '\\', '"':
			out += `\` + string(r)
		default:
			out += string(r)
		}
	}
	return out + `"`
}

func connectTerminal(t *testing.T, router *Router, id, token string) (*websocket.Conn, *httptest.Server) {
	t.Helper()
	server := httptest.NewServer(router)
	connection, _, err := websocket.Dial(t.Context(), "ws"+server.URL[len("http"):]+"/api/terminal/connect", &websocket.DialOptions{
		Subprotocols: []string{"pi-web-terminal-v1", "token." + token},
	})
	if err != nil {
		server.Close()
		t.Fatal(err)
	}
	if err := wsjson.Write(t.Context(), connection, clientMessage{
		Type:        "hello",
		Version:     protocolVersion,
		SessionID:   id,
		SessionUUID: "terminal",
		State:       workers.WorkerStatus{State: workers.WorkerStateIdle},
	}); err != nil {
		t.Fatal(err)
	}
	var ready serverMessage
	if err := wsjson.Read(t.Context(), connection, &ready); err != nil {
		t.Fatal(err)
	}
	if ready.Type != "ready" {
		t.Fatalf("first server frame = %#v, want ready", ready)
	}
	t.Cleanup(func() {
		_ = connection.Close(websocket.StatusNormalClosure, "test complete")
		server.Close()
	})
	return connection, server
}

func TestConnectedTerminalIsSolePromptOwner(t *testing.T) {
	sessionsDir := t.TempDir()
	id, path := writeTerminalTestSession(t, sessionsDir)
	fallback := &fakeFallback{}
	router := NewRouter(sessionsDir, "test-terminal-token", fallback)
	connection, _ := connectTerminal(t, router, id, "test-terminal-token")

	result := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		result <- router.Send(ctx, id, path, chat.Request{Message: "from the PWA"})
	}()

	var request serverMessage
	if err := wsjson.Read(t.Context(), connection, &request); err != nil {
		t.Fatal(err)
	}
	if request.Type != "request" || request.Operation != "prompt" || request.Chat == nil || request.Chat.Message != "from the PWA" {
		t.Fatalf("terminal request = %#v", request)
	}
	if err := wsjson.Write(t.Context(), connection, clientMessage{Type: "response", ID: request.ID, OK: true}); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatalf("terminal Send: %v", err)
	}

	fallback.mu.Lock()
	defer fallback.mu.Unlock()
	if fallback.sends != 0 {
		t.Fatalf("RPC fallback sends = %d, want 0", fallback.sends)
	}
	if fallback.releases != 1 {
		t.Fatalf("RPC releases = %d, want 1", fallback.releases)
	}
}

func TestTerminalStatusStaysNonBlockingDuringControlRequest(t *testing.T) {
	sessionsDir := t.TempDir()
	id, path := writeTerminalTestSession(t, sessionsDir)
	router := NewRouter(sessionsDir, "test-terminal-token", &fakeFallback{})
	connection, _ := connectTerminal(t, router, id, "test-terminal-token")

	result := make(chan error, 1)
	go func() {
		result <- router.SetModel(context.Background(), id, path, "anthropic", "claude")
	}()
	readCtx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	var request serverMessage
	if err := wsjson.Read(readCtx, connection, &request); err != nil {
		t.Fatal(err)
	}
	if request.Operation != "set_model" {
		t.Fatalf("operation = %q, want set_model", request.Operation)
	}
	statusDone := make(chan workers.WorkerStatus, 1)
	go func() { statusDone <- router.Status(id) }()
	select {
	case status := <-statusDone:
		if status.State != workers.WorkerStateIdle {
			t.Fatalf("status = %q, want cached idle", status.State)
		}
	case <-time.After(50 * time.Millisecond):
		t.Fatal("Status blocked behind terminal network request")
	}
	if err := wsjson.Write(t.Context(), connection, clientMessage{Type: "response", ID: request.ID, OK: true}); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

func TestLostTerminalAcknowledgementNeverFallsBackOrReplays(t *testing.T) {
	sessionsDir := t.TempDir()
	id, path := writeTerminalTestSession(t, sessionsDir)
	fallback := &fakeFallback{}
	router := NewRouter(sessionsDir, "test-terminal-token", fallback)
	connection, _ := connectTerminal(t, router, id, "test-terminal-token")

	result := make(chan error, 1)
	go func() {
		result <- router.Send(context.Background(), id, path, chat.Request{Message: "maybe delivered"})
	}()
	var request serverMessage
	if err := wsjson.Read(t.Context(), connection, &request); err != nil {
		t.Fatal(err)
	}
	if err := connection.Close(websocket.StatusGoingAway, "lost before acknowledgement"); err != nil {
		t.Fatal(err)
	}
	if err := <-result; !errors.Is(err, ErrDeliveryUnknown) {
		t.Fatalf("Send error = %v, want ErrDeliveryUnknown", err)
	}
	fallback.mu.Lock()
	defer fallback.mu.Unlock()
	if fallback.sends != 0 {
		t.Fatalf("ambiguous terminal delivery fell back to RPC %d times", fallback.sends)
	}
}

func TestTerminalBridgeRejectsPublicAndBrowserConnections(t *testing.T) {
	router := NewRouter(t.TempDir(), "test-terminal-token", &fakeFallback{})
	publicRequest := httptest.NewRequest(http.MethodGet, "http://pi.example/api/terminal/connect", nil)
	publicRequest.Host = "pi.example"
	publicRequest.RemoteAddr = "203.0.113.5:1234"
	publicResponse := httptest.NewRecorder()
	router.ServeHTTP(publicResponse, publicRequest)
	if publicResponse.Code != http.StatusForbidden {
		t.Fatalf("public terminal bridge status = %d, want 403", publicResponse.Code)
	}

	server := httptest.NewServer(router)
	defer server.Close()
	_, response, err := websocket.Dial(t.Context(), "ws"+server.URL[len("http"):]+"/api/terminal/connect", &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": {"https://evil.example"}},
	})
	if err == nil {
		t.Fatal("browser-origin websocket unexpectedly connected")
	}
	if response == nil || response.StatusCode != http.StatusForbidden {
		t.Fatalf("browser-origin response = %#v, want 403", response)
	}
}

func TestTerminalBridgeAllowsNodeFetchModeWithoutBrowserOrigin(t *testing.T) {
	sessionsDir := t.TempDir()
	id, _ := writeTerminalTestSession(t, sessionsDir)
	router := NewRouter(sessionsDir, "test-terminal-token", &fakeFallback{})
	server := httptest.NewServer(router)
	defer server.Close()
	connection, _, err := websocket.Dial(t.Context(), "ws"+server.URL[len("http"):]+"/api/terminal/connect", &websocket.DialOptions{
		HTTPHeader:   http.Header{"Sec-Fetch-Mode": {"websocket"}},
		Subprotocols: []string{"pi-web-terminal-v1", "token.test-terminal-token"},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer connection.CloseNow()
	if err := wsjson.Write(t.Context(), connection, clientMessage{
		Type: "hello", Version: protocolVersion, SessionID: id, SessionUUID: "terminal",
		State: workers.WorkerStatus{State: workers.WorkerStateIdle},
	}); err != nil {
		t.Fatal(err)
	}
	var ready serverMessage
	if err := wsjson.Read(t.Context(), connection, &ready); err != nil {
		t.Fatal(err)
	}
	if ready.Type != "ready" {
		t.Fatalf("Node-style websocket first frame = %#v, want ready", ready)
	}
}

func TestTerminalBridgeRejectsWrongHandshakeCredential(t *testing.T) {
	router := NewRouter(t.TempDir(), "correct-token", &fakeFallback{})
	server := httptest.NewServer(router)
	defer server.Close()
	_, response, err := websocket.Dial(t.Context(), "ws"+server.URL[len("http"):]+"/api/terminal/connect", &websocket.DialOptions{
		Subprotocols: []string{"pi-web-terminal-v1", "token.wrong-token"},
	})
	if err == nil {
		t.Fatal("wrong terminal credential unexpectedly connected")
	}
	if response == nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong credential response = %#v, want 401", response)
	}
}

func TestTerminalBridgeRejectsStaleInMemoryLeaf(t *testing.T) {
	sessionsDir := t.TempDir()
	id, _ := writeTerminalTestSession(t, sessionsDir)
	project := filepath.Join(sessionsDir, "project")
	file, err := os.OpenFile(filepath.Join(project, id), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.WriteString(`{"type":"message","id":"disk-leaf","parentId":null,"message":{"role":"user","content":"external"}}` + "\n")
	file.Close()
	router := NewRouter(sessionsDir, "test-terminal-token", &fakeFallback{})
	server := httptest.NewServer(router)
	defer server.Close()
	connection, _, err := websocket.Dial(t.Context(), "ws"+server.URL[len("http"):]+"/api/terminal/connect", &websocket.DialOptions{
		Subprotocols: []string{"pi-web-terminal-v1", "token.test-terminal-token"},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer connection.CloseNow()
	if err := wsjson.Write(t.Context(), connection, clientMessage{
		Type: "hello", Version: protocolVersion, SessionID: id, SessionUUID: "terminal", LeafID: "old-leaf",
	}); err != nil {
		t.Fatal(err)
	}
	var responseMessage serverMessage
	if err := wsjson.Read(t.Context(), connection, &responseMessage); err == nil || !strings.Contains(err.Error(), "behind disk") {
		t.Fatalf("stale leaf read error = %v, want behind-disk policy close", err)
	}
}

func TestDuplicateTerminalCannotReplaceCurrentOwner(t *testing.T) {
	sessionsDir := t.TempDir()
	id, _ := writeTerminalTestSession(t, sessionsDir)
	fallback := &fakeFallback{}
	router := NewRouter(sessionsDir, "test-terminal-token", fallback)
	_, server := connectTerminal(t, router, id, "test-terminal-token")

	second, _, err := websocket.Dial(t.Context(), "ws"+server.URL[len("http"):]+"/api/terminal/connect", &websocket.DialOptions{
		Subprotocols: []string{"pi-web-terminal-v1", "token.test-terminal-token"},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer second.CloseNow()
	if err := wsjson.Write(t.Context(), second, clientMessage{
		Type: "hello", Version: protocolVersion, SessionID: id, SessionUUID: "terminal",
	}); err != nil {
		t.Fatal(err)
	}
	var message serverMessage
	if err := wsjson.Read(t.Context(), second, &message); err == nil {
		t.Fatalf("duplicate terminal received frame %#v, want policy close", message)
	}
	fallback.mu.Lock()
	defer fallback.mu.Unlock()
	if fallback.releases != 1 {
		t.Fatalf("duplicate terminal changed RPC ownership: releases=%d", fallback.releases)
	}
}

func TestLiveTerminalHeartbeatQuarantinesRPCDuringReconnect(t *testing.T) {
	sessionsDir := t.TempDir()
	id, path := writeTerminalTestSession(t, sessionsDir)
	ownerDir := t.TempDir()
	marker := filepath.Join(ownerDir, id+".json")
	if err := os.WriteFile(marker, []byte(`{"pid":123}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fallback := &fakeFallback{}
	router := NewRouter(sessionsDir, "test-terminal-token", fallback)
	router.ownerDir = ownerDir

	err := router.Send(context.Background(), id, path, chat.Request{Message: "during reconnect"})
	if !errors.Is(err, ErrTerminalReconnecting) {
		t.Fatalf("Send error = %v, want ErrTerminalReconnecting", err)
	}
	fallback.mu.Lock()
	if fallback.sends != 0 {
		t.Fatalf("fresh terminal heartbeat spawned RPC fallback %d times", fallback.sends)
	}
	fallback.mu.Unlock()

	stale := time.Now().Add(-ownerHeartbeatTTL - time.Second)
	if err := os.Chtimes(marker, stale, stale); err != nil {
		t.Fatal(err)
	}
	if err := router.Send(context.Background(), id, path, chat.Request{Message: "after terminal died"}); err != nil {
		t.Fatal(err)
	}
	fallback.mu.Lock()
	defer fallback.mu.Unlock()
	if fallback.sends != 1 {
		t.Fatalf("stale terminal heartbeat fallback sends = %d, want 1", fallback.sends)
	}
}

func TestFuturePromptFallsBackOnlyAfterTerminalDisconnects(t *testing.T) {
	sessionsDir := t.TempDir()
	id, path := writeTerminalTestSession(t, sessionsDir)
	fallback := &fakeFallback{}
	router := NewRouter(sessionsDir, "test-terminal-token", fallback)
	connection, _ := connectTerminal(t, router, id, "test-terminal-token")
	if err := connection.Close(websocket.StatusNormalClosure, "terminal exited"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		router.mu.RLock()
		connected := router.connections[id] != nil
		router.mu.RUnlock()
		if !connected {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("terminal lease was not removed after disconnect")
		}
		time.Sleep(time.Millisecond)
	}

	if err := router.Send(context.Background(), id, path, chat.Request{Message: "new prompt"}); err != nil {
		t.Fatal(err)
	}
	fallback.mu.Lock()
	defer fallback.mu.Unlock()
	if fallback.sends != 1 {
		t.Fatalf("fallback sends after disconnect = %d, want 1", fallback.sends)
	}
}
