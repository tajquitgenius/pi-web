package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"pi-web/internal/sessions"
	"pi-web/internal/workers"
)

func TestComputeRunningStatusFromStatusFile(t *testing.T) {
	root := t.TempDir()
	sessionsDir := filepath.Join(root, "sessions")
	statusDir := filepath.Join(root, "session-status")
	if err := os.MkdirAll(sessionsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(statusDir, 0o755); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(sessionStatusFile{State: "running", UpdatedAt: time.Now().UTC().Format(time.RFC3339)})
	if err := os.WriteFile(filepath.Join(statusDir, "session.jsonl"), payload, 0o644); err != nil {
		t.Fatal(err)
	}

	s := &Server{agentDir: root, sessionsDir: sessionsDir, chatSender: &fakeSender{}}
	if !s.computeRunningStatus("session.jsonl") {
		t.Fatalf("expected running=true from session-status file")
	}
}

func TestComputeRunningStatusFromChatSender(t *testing.T) {
	s := &Server{
		sessionsDir: t.TempDir(),
		chatSender:  &fakeSender{status: workers.WorkerStatus{State: workers.WorkerStateRunning}},
	}
	if !s.computeRunningStatus("session.jsonl") {
		t.Fatalf("expected running=true from chatSender")
	}
}

func TestComputeRunningStatusFromRecentMtime(t *testing.T) {
	now := time.Date(2026, 5, 8, 12, 0, 0, 0, time.UTC)
	s := &Server{
		sessionsDir: t.TempDir(),
		chatSender:  &fakeSender{},
		fileMod:     map[string]time.Time{"session.jsonl": now.Add(-400 * time.Millisecond)},
		now:         func() time.Time { return now },
	}
	if !s.computeRunningStatus("session.jsonl") {
		t.Fatalf("expected running=true from recent mtime")
	}
}

func TestComputeRunningStatusIdleByDefault(t *testing.T) {
	s := &Server{sessionsDir: t.TempDir(), chatSender: &fakeSender{}, now: time.Now}
	if s.computeRunningStatus("session.jsonl") {
		t.Fatalf("expected running=false by default")
	}
}

func TestComputeRunningStatusEmptyID(t *testing.T) {
	s := &Server{sessionsDir: t.TempDir(), chatSender: &fakeSender{}}
	if s.computeRunningStatus("") {
		t.Fatalf("empty id must be idle")
	}
}

func TestRunningStatusPayloadIncludesCachedProject(t *testing.T) {
	sessionsDir := t.TempDir()
	writeSessionWithCWD(t, filepath.Join(sessionsDir, "sub"), "a.jsonl", "/repo/pi-web")
	cache := sessions.NewCache()
	if _, err := cache.LoadAll(sessionsDir); err != nil {
		t.Fatal(err)
	}
	s := &Server{cache: cache}

	payload := s.runningStatusPayload("a.jsonl", true)
	if payload["project"] != "/repo/pi-web" {
		t.Fatalf("project = %v, want /repo/pi-web", payload["project"])
	}
}

func TestRecomputeAndBroadcastStatusEmitsDeltaOnFlip(t *testing.T) {
	now := time.Date(2026, 5, 8, 12, 0, 0, 0, time.UTC)
	s := &Server{
		sessionsDir: t.TempDir(),
		chatSender:  &fakeSender{},
		clients:     make([]*sseClient, 0),
		lastKnown:   make(map[string]struct{}),
		fileMod:     map[string]time.Time{"a.jsonl": now.Add(-400 * time.Millisecond)},
		now:         func() time.Time { return now },
	}
	c := s.addClient(globalSessID)
	defer s.removeClient(c)

	s.recomputeAndBroadcastStatus("a.jsonl")

	want := "event: status-delta\ndata: {\"id\":\"a.jsonl\",\"running\":true}"
	select {
	case msg := <-c.ch:
		if msg != want {
			t.Fatalf("msg = %q want %q", msg, want)
		}
	case <-time.After(time.Second):
		t.Fatalf("expected status-delta broadcast")
	}
}

func TestRecomputeAndBroadcastStatusNoBroadcastWhenUnchanged(t *testing.T) {
	s := &Server{
		sessionsDir: t.TempDir(),
		chatSender:  &fakeSender{},
		clients:     make([]*sseClient, 0),
		lastKnown:   make(map[string]struct{}),
		now:         time.Now,
	}
	c := s.addClient(globalSessID)
	defer s.removeClient(c)

	// First call on an idle session: idle was never recorded, computeRunning
	// returns false → was==false, now==false → no broadcast.
	s.recomputeAndBroadcastStatus("a.jsonl")

	select {
	case msg := <-c.ch:
		t.Fatalf("unexpected broadcast: %q", msg)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestThreadStaysRunningUntilLastBackgroundAgentTerminates(t *testing.T) {
	sessionsDir := t.TempDir()
	sessionDir := filepath.Join(sessionsDir, "--repo--")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatal(err)
	}
	sessionID := "parent.jsonl"
	sessionPath := filepath.Join(sessionDir, sessionID)
	created := `{"type":"session","version":3,"id":"parent","timestamp":"2026-08-15T00:00:00Z","cwd":"/repo"}` + "\n" +
		`{"type":"custom","customType":"background-agent-run-created","data":{"run":{"id":"agent-1","status":"running"}}}` + "\n"
	if err := os.WriteFile(sessionPath, []byte(created), 0o644); err != nil {
		t.Fatal(err)
	}

	now := time.Now().Add(time.Minute)
	s := &Server{
		sessionsDir: sessionsDir,
		chatSender: &fakeSender{status: workers.WorkerStatus{
			State: workers.WorkerStateIdle,
			Model: "settled-parent",
		}},
		clients:   make([]*sseClient, 0),
		lastKnown: map[string]struct{}{sessionID: {}},
		fileMod:   map[string]time.Time{sessionID: now.Add(-time.Minute)},
		now:       func() time.Time { return now },
	}
	client := s.addClient(globalSessID)
	defer s.removeClient(client)

	s.recomputeAndBroadcastStatus(sessionID)
	select {
	case msg := <-client.ch:
		t.Fatalf("live background agent made settled parent idle: %q", msg)
	case <-time.After(50 * time.Millisecond):
	}
	if _, running := s.lastKnown[sessionID]; !running {
		t.Fatal("thread must remain running while a background agent is live")
	}

	file, err := os.OpenFile(sessionPath, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	_, writeErr := file.WriteString(`{"type":"custom","customType":"background-agent-run-terminal","data":{"run":{"id":"agent-1","status":"completed"}}}` + "\n")
	closeErr := file.Close()
	if writeErr != nil {
		t.Fatal(writeErr)
	}
	if closeErr != nil {
		t.Fatal(closeErr)
	}

	// The short grace window lets a terminal child publish an automatic parent
	// continuation without bouncing the thread idle in between.
	s.recomputeAndBroadcastStatus(sessionID)
	now = now.Add(time.Second)
	s.recomputeAndBroadcastStatus(sessionID)
	select {
	case msg := <-client.ch:
		want := "event: status-delta\ndata: {\"id\":\"parent.jsonl\",\"running\":false}"
		if msg != want {
			t.Fatalf("msg = %q want %q", msg, want)
		}
	case <-time.After(time.Second):
		t.Fatal("expected idle delta after the final background agent terminated")
	}
}

func TestHistoricalBackgroundTerminalIsIdleOnStartup(t *testing.T) {
	sessionsDir := t.TempDir()
	sessionDir := filepath.Join(sessionsDir, "--repo--")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatal(err)
	}
	sessionID := "parent.jsonl"
	contents := `{"type":"session","version":3,"id":"parent","timestamp":"2026-08-14T00:00:00Z","cwd":"/repo"}` + "\n" +
		`{"type":"custom","customType":"background-agent-run-created","data":{"run":{"id":"agent-1","status":"running"}}}` + "\n" +
		`{"type":"custom","customType":"background-agent-run-terminal","data":{"run":{"id":"agent-1","status":"completed"}}}` + "\n"
	if err := os.WriteFile(filepath.Join(sessionDir, sessionID), []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}

	s := &Server{
		sessionsDir: sessionsDir,
		chatSender: &fakeSender{status: workers.WorkerStatus{
			State: workers.WorkerStateIdle,
			Model: "settled-parent",
		}},
		now: time.Now,
	}
	if s.computeRunningStatus(sessionID) {
		t.Fatal("historical terminal event must not receive a fresh completion grace on startup")
	}
}

func TestLastBackgroundTerminalDoesNotBounceIdleBeforeAutomaticContinuation(t *testing.T) {
	sessionsDir := t.TempDir()
	sessionDir := filepath.Join(sessionsDir, "--repo--")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatal(err)
	}
	sessionID := "parent.jsonl"
	sessionPath := filepath.Join(sessionDir, sessionID)
	contents := `{"type":"session","version":3,"id":"parent","timestamp":"2026-08-15T00:00:00Z","cwd":"/repo"}` + "\n" +
		`{"type":"custom","customType":"background-agent-run-created","data":{"run":{"id":"agent-1","status":"running"}}}` + "\n"
	if err := os.WriteFile(sessionPath, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	sender := &fakeSender{status: workers.WorkerStatus{State: workers.WorkerStateIdle, Model: "settled-parent"}}
	s := &Server{
		sessionsDir: sessionsDir,
		chatSender:  sender,
		clients:     make([]*sseClient, 0),
		lastKnown:   map[string]struct{}{sessionID: {}},
		fileMod:     map[string]time.Time{sessionID: now.Add(-time.Minute)},
		now:         func() time.Time { return now },
	}
	client := s.addClient(globalSessID)
	defer s.removeClient(client)
	if !s.computeRunningStatus(sessionID) {
		t.Fatal("created background run must be active before its terminal append")
	}

	file, err := os.OpenFile(sessionPath, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	_, writeErr := file.WriteString(`{"type":"custom","customType":"background-agent-run-terminal","data":{"run":{"id":"agent-1","status":"completed"}}}` + "\n")
	closeErr := file.Close()
	if writeErr != nil {
		t.Fatal(writeErr)
	}
	if closeErr != nil {
		t.Fatal(closeErr)
	}

	s.recomputeAndBroadcastStatus(sessionID)
	select {
	case msg := <-client.ch:
		t.Fatalf("last terminal bounced thread idle before result continuation: %q", msg)
	case <-time.After(50 * time.Millisecond):
	}

	sender.status = workers.WorkerStatus{State: workers.WorkerStateRunning, Model: "continuation"}
	s.recomputeAndBroadcastStatus(sessionID)
	sender.status = workers.WorkerStatus{State: workers.WorkerStateIdle, Model: "continuation"}
	now = now.Add(time.Second)
	s.recomputeAndBroadcastStatus(sessionID)

	select {
	case msg := <-client.ch:
		want := "event: status-delta\ndata: {\"id\":\"parent.jsonl\",\"running\":false}"
		if msg != want {
			t.Fatalf("msg = %q want %q", msg, want)
		}
	case <-time.After(time.Second):
		t.Fatal("expected one idle delta after the automatic continuation settled")
	}
	select {
	case msg := <-client.ch:
		t.Fatalf("unexpected duplicate status transition: %q", msg)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestParentIdleKicksQueueWhileBackgroundAgentKeepsThreadRunning(t *testing.T) {
	sessionsDir := t.TempDir()
	sessionDir := filepath.Join(sessionsDir, "--repo--")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatal(err)
	}
	sessionID := "parent.jsonl"
	contents := `{"type":"session","version":3,"id":"parent","timestamp":"2026-08-15T00:00:00Z","cwd":"/repo"}` + "\n" +
		`{"type":"custom","customType":"background-agent-run-created","data":{"run":{"id":"agent-1","status":"running"}}}` + "\n"
	if err := os.WriteFile(filepath.Join(sessionDir, sessionID), []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}

	sender := &fakeSender{status: workers.WorkerStatus{State: workers.WorkerStateRunning}}
	s := &Server{
		sessionsDir: sessionsDir,
		chatSender:  sender,
		clients:     make([]*sseClient, 0),
		lastKnown:   make(map[string]struct{}),
		fileMod:     make(map[string]time.Time),
		now:         time.Now,
	}
	s.queueDrainer = newQueueDrainer(s)
	client := s.addClient(globalSessID)
	defer s.removeClient(client)

	s.recomputeAndBroadcastStatus(sessionID)
	select {
	case <-client.ch:
	case <-time.After(time.Second):
		t.Fatal("expected initial running delta")
	}

	sender.status = workers.WorkerStatus{State: workers.WorkerStateIdle, Model: "settled-parent"}
	s.recomputeAndBroadcastStatus(sessionID)
	select {
	case kicked := <-s.queueDrainer.kickCh:
		if kicked != sessionID {
			t.Fatalf("kicked session = %q, want %q", kicked, sessionID)
		}
	case <-time.After(50 * time.Millisecond):
		t.Fatal("parent idle transition did not promptly kick its queue")
	}
	select {
	case msg := <-client.ch:
		t.Fatalf("thread should remain running while background agent is live: %q", msg)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestRecomputeAndBroadcastStatusFlipsBackToIdle(t *testing.T) {
	s := &Server{
		sessionsDir: t.TempDir(),
		chatSender:  &fakeSender{},
		clients:     make([]*sseClient, 0),
		lastKnown:   map[string]struct{}{"a.jsonl": {}},
		now:         time.Now,
	}
	c := s.addClient(globalSessID)
	defer s.removeClient(c)

	s.recomputeAndBroadcastStatus("a.jsonl")

	want := "event: status-delta\ndata: {\"id\":\"a.jsonl\",\"running\":false}"
	select {
	case msg := <-c.ch:
		if msg != want {
			t.Fatalf("msg = %q want %q", msg, want)
		}
	case <-time.After(time.Second):
		t.Fatalf("expected idle delta")
	}
	if _, ok := s.lastKnown["a.jsonl"]; ok {
		t.Fatalf("lastKnown should no longer contain a.jsonl")
	}
}
