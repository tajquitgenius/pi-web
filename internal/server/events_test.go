package server

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// syncRecorder wraps httptest.ResponseRecorder so the handler goroutine's
// writes and the test goroutine's reads of the body do not race under -race.
type syncRecorder struct {
	*httptest.ResponseRecorder
	mu  sync.Mutex
	buf bytes.Buffer
}

func newSyncRecorder() *syncRecorder {
	return &syncRecorder{ResponseRecorder: httptest.NewRecorder()}
}

func (s *syncRecorder) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *syncRecorder) body() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.String()
}

func waitFor(t *testing.T, rec *syncRecorder, want string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(rec.body(), want) {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %q in body:\n%s", want, rec.body())
}

func TestHandleEventsSendsStatusSnapshotForAllSubscribers(t *testing.T) {
	s := &Server{
		sessionsDir: t.TempDir(),
		chatSender:  &fakeSender{},
		clients:     make([]*sseClient, 0),
		lastKnown:   map[string]struct{}{"a.jsonl": {}, "b.jsonl": {}},
	}

	req := httptest.NewRequest(http.MethodGet, "/events?id=__all__", nil)
	ctx, cancel := context.WithCancel(req.Context())
	req = req.WithContext(ctx)
	w := newSyncRecorder()

	done := make(chan struct{})
	go func() {
		s.handleEvents(w, req)
		close(done)
	}()

	// Wait for the snapshot to be written, then close.
	waitFor(t, w, "event: status-snapshot")
	cancel()
	<-done

	body := w.body()
	if !strings.Contains(body, "event: status-snapshot") {
		t.Fatalf("missing snapshot event header in body:\n%s", body)
	}
	if !strings.Contains(body, `"a.jsonl"`) || !strings.Contains(body, `"b.jsonl"`) {
		t.Fatalf("snapshot did not include both ids:\n%s", body)
	}
}

func TestHandleEventsForwardsNamedDeltaEvents(t *testing.T) {
	s := &Server{
		sessionsDir: t.TempDir(),
		chatSender:  &fakeSender{},
		clients:     make([]*sseClient, 0),
		lastKnown:   make(map[string]struct{}),
	}

	req := httptest.NewRequest(http.MethodGet, "/events?id=__all__", nil)
	ctx, cancel := context.WithCancel(req.Context())
	req = req.WithContext(ctx)
	w := newSyncRecorder()

	done := make(chan struct{})
	go func() {
		s.handleEvents(w, req)
		close(done)
	}()

	// Wait for the initial :ok, then push a delta and a legacy reload.
	waitFor(t, w, ":ok")
	s.broadcast(globalSessID, "event: status-delta\ndata: {\"id\":\"x\",\"running\":true}")
	s.broadcast(globalSessID, "new-session")
	waitFor(t, w, "event: status-delta")
	waitFor(t, w, "data: new-session")
	cancel()
	<-done

	body := w.body()
	if !strings.Contains(body, "event: status-delta\ndata: {\"id\":\"x\",\"running\":true}") {
		t.Fatalf("expected named delta passthrough, got:\n%s", body)
	}
	if !strings.Contains(body, "data: new-session") {
		t.Fatalf("expected legacy plain-data passthrough, got:\n%s", body)
	}
}

func TestHandleEventsClosesAtPairedDeviceExpiry(t *testing.T) {
	now := time.Now().UTC()
	s := &Server{
		clients:   make([]*sseClient, 0),
		lastKnown: make(map[string]struct{}),
		now:       func() time.Time { return now },
	}
	req := httptest.NewRequest(http.MethodGet, "/events?id=__all__", nil)
	identity := pairedDeviceIdentity{ID: "device-a", ExpiresAt: now.Add(40 * time.Millisecond)}
	req = req.WithContext(context.WithValue(req.Context(), pairedDeviceContextKey{}, identity))
	rec := newSyncRecorder()
	done := make(chan struct{})
	go func() {
		s.handleEvents(rec, req)
		close(done)
	}()
	waitFor(t, rec, ":ok")

	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("SSE stream remained open after paired-device expiry")
	}
}

func TestRecordModTimeBroadcastsReloadForKnownZeroModTime(t *testing.T) {
	s := &Server{
		sessionsDir: t.TempDir(),
		clients:     make([]*sseClient, 0),
		fileMod:     map[string]time.Time{"fresh.jsonl": {}},
		lastKnown:   make(map[string]struct{}),
		now:         func() time.Time { return time.Date(2026, 5, 8, 11, 0, 1, 0, time.UTC) },
	}
	client := s.addClient("fresh.jsonl")

	s.recordModTime("fresh.jsonl", time.Date(2026, 5, 8, 11, 0, 0, 0, time.UTC))

	select {
	case got := <-client.ch:
		if got != "reload" {
			t.Fatalf("event = %q, want reload", got)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for reload")
	}
}
