package rpc

import (
	"context"
	"encoding/json"
	"errors"
)

type SessionDefaults struct {
	ModelProvider string `json:"modelProvider"`
	ModelID       string `json:"modelId"`
	ThinkingLevel string `json:"thinkingLevel"`
}

func ResolveSessionDefaults(ctx context.Context) (SessionDefaults, error) {
	data, err := oneShot(
		ctx,
		[]string{"--mode", "rpc", "--no-session", "--no-context-files"},
		"get_state",
		nil,
	)
	if err != nil {
		return SessionDefaults{}, err
	}
	var state struct {
		Model         model  `json:"model"`
		ThinkingLevel string `json:"thinkingLevel"`
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return SessionDefaults{}, err
	}
	if state.Model.Provider == "" || state.Model.ID == "" || state.ThinkingLevel == "" ||
		state.Model.Provider == "unknown" || state.Model.ID == "unknown" {
		return SessionDefaults{}, errors.New("pi has no authenticated model available")
	}
	return SessionDefaults{
		ModelProvider: state.Model.Provider,
		ModelID:       state.Model.ID,
		ThinkingLevel: state.ThinkingLevel,
	}, nil
}
