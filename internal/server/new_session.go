package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"pi-web/internal/sessions"
)

func (s *Server) handleSessionDefaults(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	sourceSessionID := r.URL.Query().Get("sourceSessionId")
	if sourceSessionID == "" && s.sessionDefaults == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "session defaults are unavailable")
		return
	}
	settings, err := s.resolveInitialSettings(r.Context(), sourceSessionID)
	if err != nil {
		writeJSONError(w, http.StatusServiceUnavailable, "could not resolve session defaults")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"modelProvider": settings.ModelProvider,
		"modelId":       settings.ModelID,
		"thinkingLevel": settings.ThinkingLevel,
	})
}

func (s *Server) modelSelectionAvailable(ctx context.Context, provider, modelID string) (bool, error) {
	if s.models == nil {
		return true, nil
	}
	data, err := s.models(ctx)
	if err != nil {
		return false, err
	}
	var payload struct {
		Models []struct {
			Provider string `json:"provider"`
			ID       string `json:"id"`
		} `json:"models"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return false, err
	}
	for _, candidate := range payload.Models {
		if candidate.Provider == provider && candidate.ID == modelID {
			return true, nil
		}
	}
	return false, nil
}

func (s *Server) resolveInitialSettings(ctx context.Context, sourceSessionID string) (sessions.InitialSettings, error) {
	if sourceSessionID == "" {
		if s.sessionDefaults == nil {
			return sessions.InitialSettings{}, nil
		}
		return s.sessionDefaults(ctx)
	}
	resolved, err := sessions.ResolveByID(s.sessionsDir, sourceSessionID)
	if err != nil {
		return sessions.InitialSettings{}, err
	}
	settings, err := sessions.ReadSessionSettings(resolved.Path)
	if err != nil {
		return sessions.InitialSettings{}, err
	}
	if settings.ModelProvider == "" || settings.ModelID == "" || settings.ThinkingLevel == "" {
		return sessions.InitialSettings{}, errors.New("source session has incomplete persisted settings")
	}
	return settings, nil
}

func (s *Server) initializeNewSessionWorker(ctx context.Context, sessionID, sessionPath string, settings sessions.InitialSettings) {
	if s.chatSender == nil {
		return
	}
	// The settings have already been written into the new session file as
	// implicit entries. Starting the worker directly on the session lets Pi
	// restore them from history. Do not call SetModel/SetThinkingLevel here: those RPC
	// calls append visible "Switched to model" entries and duplicate the implicit
	// initial settings.
	workerCtx, cancel := context.WithTimeout(ctx, 35*time.Second)
	defer cancel()
	_ = s.chatSender.EnsureWorker(workerCtx, sessionID, sessionPath)
}
