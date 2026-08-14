package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	sessID := r.URL.Query().Get("id")
	if sessID == "" {
		http.Error(w, "missing id", 400)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	device, _ := pairedDeviceFromContext(r.Context())
	client := s.addClientForDevice(sessID, device)
	defer s.removeClient(client)

	fmt.Fprintf(w, ":ok\n\n")
	flusher.Flush()

	if sessID == globalSessID {
		s.writeStatusSnapshot(w)
		flusher.Flush()
	}

	var expiry <-chan time.Time
	var expiryTimer *time.Timer
	if !client.deviceExpiresAt.IsZero() {
		remaining := client.deviceExpiresAt.Sub(s.now())
		if remaining <= 0 {
			return
		}
		expiryTimer = time.NewTimer(remaining)
		expiry = expiryTimer.C
		defer expiryTimer.Stop()
	}

	for {
		select {
		case msg, open := <-client.ch:
			if !open {
				return
			}
			if key := eventKey(msg); key != "" {
				client.mu.Lock()
				delete(client.queued, key)
				client.mu.Unlock()
			}
			if strings.HasPrefix(msg, "event: ") {
				// Already-formatted named SSE event; pass through with the
				// terminating blank line.
				fmt.Fprint(w, msg+"\n\n")
			} else {
				fmt.Fprintf(w, "data: %s\n\n", msg)
			}
			flusher.Flush()
		case <-expiry:
			return
		case <-r.Context().Done():
			return
		}
	}
}

// writeStatusSnapshot emits a single SSE event listing every session id that
// is currently broadcast as running. Sorted for deterministic test output.
func (s *Server) writeStatusSnapshot(w http.ResponseWriter) {
	s.lastKnownMu.Lock()
	ids := make([]string, 0, len(s.lastKnown))
	for id := range s.lastKnown {
		ids = append(ids, id)
	}
	s.lastKnownMu.Unlock()
	sort.Strings(ids)

	var sb strings.Builder
	sb.WriteString(`{"running":[`)
	for i, id := range ids {
		if i > 0 {
			sb.WriteByte(',')
		}
		idJSON, _ := json.Marshal(id)
		sb.Write(idJSON)
	}
	sb.WriteString(`],"statuses":{`)
	for i, id := range ids {
		if i > 0 {
			sb.WriteByte(',')
		}
		idJSON, _ := json.Marshal(id)
		sb.Write(idJSON)
		sb.WriteByte(':')
		data, _ := json.Marshal(s.runningStatusPayload(id, true))
		sb.Write(data)
	}
	sb.WriteString("}}")

	fmt.Fprintf(w, "event: status-snapshot\ndata: %s\n\n", sb.String())
}
