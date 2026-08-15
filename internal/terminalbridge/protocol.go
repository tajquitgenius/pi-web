package terminalbridge

import (
	"pi-web/internal/chat"
	"pi-web/internal/workers"
)

const protocolVersion = 1

type wireChat struct {
	Message string       `json:"message,omitempty"`
	Images  []chat.Image `json:"images,omitempty"`
}

type clientMessage struct {
	Type        string                 `json:"type"`
	Version     int                    `json:"version,omitempty"`
	SessionID   string                 `json:"sessionId,omitempty"`
	SessionUUID string                 `json:"sessionUuid,omitempty"`
	LeafID      string                 `json:"leafId,omitempty"`
	ID          string                 `json:"id,omitempty"`
	OK          bool                   `json:"ok,omitempty"`
	Error       string                 `json:"error,omitempty"`
	State       workers.WorkerStatus   `json:"state,omitempty"`
	Commands    []workers.SlashCommand `json:"commands,omitempty"`
}

type serverMessage struct {
	Type      string    `json:"type"`
	ID        string    `json:"id,omitempty"`
	Operation string    `json:"operation,omitempty"`
	Chat      *wireChat `json:"chat,omitempty"`
	Provider  string    `json:"provider,omitempty"`
	ModelID   string    `json:"modelId,omitempty"`
	Level     string    `json:"level,omitempty"`
	Name      string    `json:"name,omitempty"`
	EntryID   string    `json:"entryId,omitempty"`
	Label     string    `json:"label,omitempty"`
}
