package server

import (
	"context"
	"encoding/json"

	"pi-web/internal/workers"
)

// computeWorkerRunningStatus reports whether the parent agent itself is
// running. It intentionally excludes background agents so worker-status and
// Cancel controls remain scoped to the parent process.
func (s *Server) computeWorkerRunningStatus(sessionID string) bool {
	if sessionID == "" {
		return false
	}
	if status := s.readSessionStatus(sessionID); status != nil && status.State == workers.WorkerStateRunning {
		return true
	}
	if s.chatSender != nil {
		workerStatus := s.chatSender.Status(sessionID)
		if workerStatus.State == workers.WorkerStateRunning {
			return true
		}
		// Authoritative: if we have an in-process chat worker for this
		// session (Model set ⇒ EnsureWorker has resolved it) and it
		// reports idle, trust it and skip the activity-window fallback.
		// Without this short-circuit the JSONL write that records the
		// assistant's final message keeps the session "running" for up
		// to recentSessionActivityWindow, making the Cancel button
		// linger after the response is clearly done.
		if workerStatus.Model != "" {
			return false
		}
	}
	return s.hasRecentSessionActivity(sessionID)
}

// computeRunningStatus is the thread-list aggregate: a thread remains running
// until its parent has settled and every background agent is terminal.
func (s *Server) computeRunningStatus(sessionID string) bool {
	return s.computeWorkerRunningStatus(sessionID) || s.hasDurableThreadActivity(sessionID)
}

func (s *Server) runningStatusPayload(sessionID string, running bool) map[string]any {
	payload := map[string]any{"id": sessionID, "running": running}
	if s.cache != nil {
		if project, ok := s.cache.ProjectForID(sessionID); ok && project != "" {
			payload["project"] = project
		}
	}
	if !running || s.chatSender == nil {
		return payload
	}
	status := s.chatSender.Status(sessionID)
	if status.Model != "" {
		payload["model"] = status.Model
	}
	if status.ModelName != "" {
		payload["modelName"] = status.ModelName
	}
	if status.ModelProvider != "" {
		payload["modelProvider"] = status.ModelProvider
	}
	return payload
}

// recomputeAndBroadcastStatus recomputes the running state for sessionID and,
// if it changed since the last broadcast, sends a status-delta SSE event to
// every __all__ subscriber.
//
// `lastKnown` is the set of session ids currently broadcast as running.
// Absence == idle. We only emit when (now == running) != (id ∈ lastKnown).
// First-touch idle is therefore silent (no spurious running:false flood when
// the sweeper rescans).
func (s *Server) recomputeAndBroadcastStatus(sessionID string) {
	if sessionID == "" {
		return
	}
	parentNow := s.computeWorkerRunningStatus(sessionID)
	now := parentNow || s.hasDurableThreadActivity(sessionID)

	s.parentRunningMu.Lock()
	if s.parentRunning == nil {
		s.parentRunning = make(map[string]struct{})
	}
	_, parentWas := s.parentRunning[sessionID]
	if parentNow {
		s.parentRunning[sessionID] = struct{}{}
	} else {
		delete(s.parentRunning, sessionID)
	}
	s.parentRunningMu.Unlock()
	if parentWas && !parentNow && s.queueDrainer != nil {
		s.queueDrainer.kick(sessionID)
	}

	s.lastKnownMu.Lock()
	_, was := s.lastKnown[sessionID]
	if now == was {
		s.lastKnownMu.Unlock()
		return
	}
	if now {
		s.lastKnown[sessionID] = struct{}{}
	} else {
		delete(s.lastKnown, sessionID)
	}
	s.lastKnownMu.Unlock()

	data, _ := json.Marshal(s.runningStatusPayload(sessionID, now))
	s.broadcast(globalSessID, "event: status-delta\ndata: "+string(data))

	// Transition running → idle: fire a push notification so subscribed
	// clients learn the response is ready even when the tab is closed
	// or the device is locked. Scheduled runs get a schedule-specific push
	// (shown even in the foreground) instead of the generic one.
	if was && !now && s.push != nil && !s.disableBackgroundJobs {
		if name, ok := s.scheduleNameForSession(sessionID); ok {
			s.startTask(func(context.Context) {
				s.push.NotifyScheduleDone(name, sessionID)
			})
		} else {
			s.startTask(func(context.Context) {
				s.push.NotifyDone(sessionID)
			})
		}
	}

}
