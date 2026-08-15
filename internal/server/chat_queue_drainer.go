package server

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"pi-web/internal/chat"
	"pi-web/internal/sessions"
	"pi-web/internal/terminalbridge"
	"pi-web/internal/workers"
)

// queueDrainer is the autonomous worker that pulls items off the per-session
// chat_queue and feeds them to the chat sender, whether or not anyone has the
// session open in a browser.
//
// Wake-up paths:
//
//   - kick(sessionID): called by the chat-queue HTTP handlers and by the
//     status sweeper when a worker transitions to idle. Cheap and immediate.
//   - periodic tick: a safety net that catches sessions whose kick was
//     dropped (the kick channel is bounded) or that ended up paused-then-
//     unpaused via another tab.
//   - startup: drain once when the drainer starts so items from a previous
//     server run pick up automatically.
//
// Concurrency: the drainer runs a single goroutine that processes one
// dispatch at a time. We rely on ChatSender.Status (cheap) to avoid
// double-dispatching while a previous Send is still streaming.
type queueDrainer struct {
	server     *Server
	kickCh     chan string
	stopCh     chan struct{}
	doneCh     chan struct{}
	tickPeriod time.Duration
	nowFn      func() time.Time

	// dispatchTimeout caps how long a single Send may block before we give up
	// on it. The dispatch goroutine will continue in the background; we just
	// stop blocking the drainer loop on it.
	dispatchTimeout time.Duration
	dispatchMu      sync.Mutex
	dispatching     map[string]bool
}

func newQueueDrainer(s *Server) *queueDrainer {
	return &queueDrainer{
		server:          s,
		kickCh:          make(chan string, 64),
		stopCh:          make(chan struct{}),
		doneCh:          make(chan struct{}),
		tickPeriod:      5 * time.Second,
		nowFn:           time.Now,
		dispatchTimeout: 30 * time.Second,
		dispatching:     make(map[string]bool),
	}
}

func (d *queueDrainer) start() {
	go d.run()
}

func (d *queueDrainer) stop() {
	close(d.stopCh)
	<-d.doneCh
}

// kick asks the drainer to re-evaluate one session promptly. Safe to call
// from any goroutine; never blocks.
func (d *queueDrainer) kick(sessionID string) {
	if d == nil || sessionID == "" {
		return
	}
	select {
	case d.kickCh <- sessionID:
	default:
		// Buffer full — the drainer's about to wake up anyway from a tick or
		// another kick. Dropping is safe because drainAll() catches up.
	}
}

func (d *queueDrainer) run() {
	defer close(d.doneCh)
	// Initial scan: pick up any items left from a previous server run.
	d.drainAll()
	ticker := time.NewTicker(d.tickPeriod)
	defer ticker.Stop()
	for {
		select {
		case <-d.stopCh:
			return
		case sessionID := <-d.kickCh:
			d.drainSession(sessionID)
		case <-ticker.C:
			d.drainAll()
		}
	}
}

func (d *queueDrainer) drainAll() {
	if d.server.chatQueue == nil {
		return
	}
	ids, err := d.server.chatQueue.SessionsWithItems()
	if err != nil {
		fmt.Fprintf(os.Stderr, "queue drainer: list sessions: %v\n", err)
		return
	}
	for _, id := range ids {
		d.drainSession(id)
	}
}

func (d *queueDrainer) drainSession(sessionID string) {
	if sessionID == "" {
		return
	}
	if d.server.chatQueue == nil || d.server.chatSender == nil {
		return
	}
	paused, err := d.server.chatQueue.IsPaused(sessionID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "queue drainer: IsPaused %s: %v\n", sessionID, err)
		return
	}
	if paused {
		return
	}
	// If a previous Send for this session is still streaming, skip — we'll
	// come back on the next idle transition (or tick).
	status := d.server.chatSender.Status(sessionID)
	if status.State != workers.WorkerStateIdle {
		return
	}
	d.dispatchMu.Lock()
	if d.dispatching[sessionID] {
		d.dispatchMu.Unlock()
		return
	}
	d.dispatching[sessionID] = true
	d.dispatchMu.Unlock()
	clearDispatch := func() {
		d.dispatchMu.Lock()
		delete(d.dispatching, sessionID)
		d.dispatchMu.Unlock()
	}
	// Resolve the on-disk path so chatSender can spawn the worker if needed.
	resolved, err := sessions.ResolveByID(d.server.sessionsDir, sessionID)
	if err != nil {
		clearDispatch()
		fmt.Fprintf(os.Stderr, "queue drainer: resolve %s: %v\n", sessionID, err)
		return
	}
	if !resolved.Session.ChatAvailable {
		// Chat is disabled for this session (e.g., its working directory was
		// removed). Leave the items in the queue; the user can clear them
		// from the UI.
		clearDispatch()
		return
	}
	snapshot, err := d.server.chatQueue.List(sessionID)
	if err != nil {
		clearDispatch()
		fmt.Fprintf(os.Stderr, "queue drainer: list %s: %v\n", sessionID, err)
		return
	}
	if len(snapshot.Items) == 0 {
		clearDispatch()
		return
	}
	item := snapshot.Items[0]
	req := chat.Request{Message: item.Message}
	if !d.server.startTask(func(taskCtx context.Context) {
		defer clearDispatch()
		ctx, cancel := context.WithTimeout(taskCtx, d.dispatchTimeout)
		defer cancel()
		if err := d.server.chatSender.Send(ctx, sessionID, resolved.Path, req); err != nil {
			if !errors.Is(err, context.Canceled) && !errors.Is(err, terminalbridge.ErrTerminalReconnecting) {
				_ = d.server.chatQueue.SetPaused(sessionID, true)
				fmt.Fprintf(os.Stderr,
					"queue drainer: Send %s position %d failed; queue paused without retry: %v\n",
					sessionID, item.Position, err)
			}
		} else if err := d.server.chatQueue.Remove(sessionID, item.Position); err != nil {
			fmt.Fprintf(os.Stderr, "queue drainer: acknowledge %s position %d: %v\n", sessionID, item.Position, err)
		}
		if msg, err := formatSSEJSONEvent("queue", map[string]any{"sessionId": sessionID}); err == nil {
			d.server.broadcast(sessionID, msg)
		}
	}) {
		clearDispatch()
	}
}
