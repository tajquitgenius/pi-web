package server

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"strings"
	"time"

	"pi-web/internal/sessions"
)

const backgroundCompletionGrace = 250 * time.Millisecond

type backgroundRunTracker struct {
	path           string
	offset         int64
	parentActive   bool
	activeChildren map[string]struct{}
	holdUntil      time.Time
}

func (t *backgroundRunTracker) running(now time.Time) bool {
	return t.parentActive || len(t.activeChildren) > 0 || now.Before(t.holdUntil)
}

type backgroundRunEvent struct {
	Type       string `json:"type"`
	CustomType string `json:"customType"`
	Data       struct {
		Run struct {
			ID string `json:"id"`
		} `json:"run"`
	} `json:"data"`
}

func (s *Server) hasDurableThreadActivity(sessionID string) bool {
	path := ""
	if s.cache != nil {
		path, _ = s.cache.FindPath(sessionID)
	}
	if path == "" {
		var err error
		path, err = sessions.FindPathByID(s.sessionsDir, sessionID)
		if err != nil {
			return false
		}
	}

	s.backgroundRunsMu.Lock()
	defer s.backgroundRunsMu.Unlock()
	if s.backgroundRuns == nil {
		s.backgroundRuns = make(map[string]*backgroundRunTracker)
	}
	tracker := s.backgroundRuns[sessionID]
	if tracker == nil || tracker.path != path {
		tracker = &backgroundRunTracker{path: path, activeChildren: make(map[string]struct{})}
		s.backgroundRuns[sessionID] = tracker
	}

	now := time.Now()
	if s.now != nil {
		now = s.now()
	}
	file, err := os.Open(path)
	if err != nil {
		return tracker.running(now)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return tracker.running(now)
	}
	if info.Size() < tracker.offset {
		tracker.offset = 0
		tracker.parentActive = false
		tracker.activeChildren = make(map[string]struct{})
		tracker.holdUntil = time.Time{}
	}
	reconstructing := tracker.offset == 0
	if _, err := file.Seek(tracker.offset, io.SeekStart); err != nil {
		return tracker.running(now)
	}
	reader := bufio.NewReader(file)
	for {
		line, readErr := reader.ReadString('\n')
		if line != "" {
			var event backgroundRunEvent
			parseErr := json.Unmarshal([]byte(strings.TrimSpace(line)), &event)
			if parseErr == nil {
				switch event.CustomType {
				case "pi-web-parent-agent-started":
					if event.Type == "custom" {
						tracker.parentActive = true
						tracker.holdUntil = time.Time{}
					}
				case "pi-web-parent-agent-settled":
					if event.Type == "custom" {
						tracker.parentActive = false
					}
				case "background-agent-run-created":
					if event.Type == "custom" && event.Data.Run.ID != "" {
						tracker.activeChildren[event.Data.Run.ID] = struct{}{}
						tracker.holdUntil = time.Time{}
					}
				case "background-agent-run-terminal":
					if event.Type == "custom" && event.Data.Run.ID != "" {
						delete(tracker.activeChildren, event.Data.Run.ID)
						if len(tracker.activeChildren) == 0 && !tracker.parentActive && !reconstructing {
							tracker.holdUntil = now.Add(backgroundCompletionGrace)
						}
					}
				}
				tracker.offset += int64(len(line))
			} else if strings.HasSuffix(line, "\n") {
				tracker.offset += int64(len(line))
			}
		}
		if readErr != nil {
			break
		}
	}
	return tracker.running(now)
}
