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
	path      string
	offset    int64
	active    map[string]struct{}
	holdUntil time.Time
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

func (s *Server) hasActiveBackgroundRuns(sessionID string) bool {
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
		tracker = &backgroundRunTracker{path: path, active: make(map[string]struct{})}
		s.backgroundRuns[sessionID] = tracker
	}

	file, err := os.Open(path)
	if err != nil {
		return len(tracker.active) > 0
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return len(tracker.active) > 0
	}
	if info.Size() < tracker.offset {
		tracker.offset = 0
		tracker.active = make(map[string]struct{})
	}
	if _, err := file.Seek(tracker.offset, io.SeekStart); err != nil {
		return len(tracker.active) > 0
	}

	now := time.Now()
	if s.now != nil {
		now = s.now()
	}
	reader := bufio.NewReader(file)
	for {
		line, readErr := reader.ReadString('\n')
		if line != "" {
			var event backgroundRunEvent
			parseErr := json.Unmarshal([]byte(strings.TrimSpace(line)), &event)
			if parseErr == nil {
				switch event.CustomType {
				case "background-agent-run-created":
					if event.Type == "custom" && event.Data.Run.ID != "" {
						tracker.active[event.Data.Run.ID] = struct{}{}
						tracker.holdUntil = time.Time{}
					}
				case "background-agent-run-terminal":
					if event.Type == "custom" && event.Data.Run.ID != "" {
						delete(tracker.active, event.Data.Run.ID)
						if len(tracker.active) == 0 {
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
	return len(tracker.active) > 0 || now.Before(tracker.holdUntil)
}
