package server

import (
	"errors"
	"sync"
	"testing"
	"time"

	"pi-web/internal/chatqueue"
	"pi-web/internal/workers"
)

func newDrainerServer(t *testing.T, sender ChatSender) (*Server, *queueDrainer, string) {
	t.Helper()
	db := newQueueTestDB(t)
	s := &Server{
		sessionsDir: t.TempDir(),
		db:          db,
		chatQueue:   chatqueue.NewStore(db),
		chatSender:  sender,
	}
	d := newQueueDrainer(s)
	s.queueDrainer = d
	id := writeQueueTestSession(t, s.sessionsDir)
	return s, d, id
}

func waitQueueLength(t *testing.T, store *chatqueue.Store, sessionID string, count int) chatqueue.Snapshot {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		snapshot, err := store.List(sessionID)
		if err != nil {
			t.Fatal(err)
		}
		if len(snapshot.Items) == count {
			return snapshot
		}
		if time.Now().After(deadline) {
			t.Fatalf("queue length = %d, want %d: %#v", len(snapshot.Items), count, snapshot.Items)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestDrainerDispatchesNextItem(t *testing.T) {
	fake := &fakeSender{sendCh: make(chan struct{}, 1)}
	s, d, id := newDrainerServer(t, fake)

	if _, err := s.chatQueue.Add(id, "first prompt", "first prompt"); err != nil {
		t.Fatalf("Add: %v", err)
	}

	d.drainSession(id)

	select {
	case <-fake.sendCh:
	case <-time.After(2 * time.Second):
		t.Fatalf("expected Send within 2s")
	}

	sentID, _, req := fake.sentInfo()
	if sentID != id {
		t.Fatalf("Send sessionID=%q want %q", sentID, id)
	}
	if req.Message != "first prompt" {
		t.Fatalf("Send message=%q want %q", req.Message, "first prompt")
	}

	// The item is acknowledged only after Send returns successfully.
	waitQueueLength(t, s.chatQueue, id, 0)
}

func TestDrainerRetainsAndPausesItemWhenOwnerAdmissionFails(t *testing.T) {
	fake := &fakeSender{sendCh: make(chan struct{}, 1), sendErr: errors.New("ambiguous terminal delivery")}
	s, d, id := newDrainerServer(t, fake)
	if _, err := s.chatQueue.Add(id, "do not replay", "do not replay"); err != nil {
		t.Fatal(err)
	}

	d.drainSession(id)
	select {
	case <-fake.sendCh:
	case <-time.After(time.Second):
		t.Fatal("expected Send")
	}
	deadline := time.Now().Add(time.Second)
	for {
		snapshot, err := s.chatQueue.List(id)
		if err != nil {
			t.Fatal(err)
		}
		if snapshot.Paused && len(snapshot.Items) == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("failed item was not retained and paused: %#v", snapshot)
		}
		time.Sleep(time.Millisecond)
	}

	d.drainSession(id)
	select {
	case <-fake.sendCh:
		t.Fatal("paused ambiguous item was replayed")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestDrainerSkipsWhenPaused(t *testing.T) {
	fake := &fakeSender{sendCh: make(chan struct{}, 1)}
	s, d, id := newDrainerServer(t, fake)
	s.chatQueue.SetPaused(id, true)
	s.chatQueue.Add(id, "should not dispatch", "should not dispatch")

	d.drainSession(id)

	select {
	case <-fake.sendCh:
		t.Fatalf("Send should not have fired while paused")
	case <-time.After(150 * time.Millisecond):
	}

	// Item is still in the queue.
	snap, _ := s.chatQueue.List(id)
	if len(snap.Items) != 1 {
		t.Fatalf("expected item to remain, got %#v", snap.Items)
	}
}

func TestDrainerSkipsWhenWorkerBusy(t *testing.T) {
	fake := &fakeSender{
		status: workers.WorkerStatus{State: workers.WorkerStateRunning},
		sendCh: make(chan struct{}, 1),
	}
	s, d, id := newDrainerServer(t, fake)
	s.chatQueue.Add(id, "wait your turn", "wait your turn")

	d.drainSession(id)

	select {
	case <-fake.sendCh:
		t.Fatalf("Send should not fire while worker is running")
	case <-time.After(150 * time.Millisecond):
	}

	// Item must remain queued, waiting for the next idle transition.
	snap, _ := s.chatQueue.List(id)
	if len(snap.Items) != 1 {
		t.Fatalf("expected item to remain queued, got %#v", snap.Items)
	}
}

func TestDrainerDrainAllScansEveryActiveSession(t *testing.T) {
	fake := &fakeSender{sendCh: make(chan struct{}, 4)}
	s, d, id := newDrainerServer(t, fake)
	// Same session, two items. drainAll calls drainSession once, which pops
	// one item; the next idle kick handles the rest.
	s.chatQueue.Add(id, "alpha", "alpha")
	s.chatQueue.Add(id, "beta", "beta")

	d.drainAll()
	select {
	case <-fake.sendCh:
	case <-time.After(2 * time.Second):
		t.Fatalf("expected first Send")
	}

	// Second item still queued (waiting for next idle).
	snap := waitQueueLength(t, s.chatQueue, id, 1)
	if snap.Items[0].Message != "beta" {
		t.Fatalf("after first drain, queue should hold beta: %#v", snap.Items)
	}
}

func TestDrainerKickIsNonBlocking(t *testing.T) {
	d := newQueueDrainer(&Server{})
	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			d.kick("any")
		}()
	}
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatalf("kick should never block")
	}
}
