package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"pi-web/internal/hub"
)

const hubNodeConfigEnvVar = "PI_WEB_HUB_NODE_CONFIG"

type hubNodeConfig struct {
	HubURL     string `json:"hubUrl"`
	ID         string `json:"id"`
	Label      string `json:"label"`
	Credential string `json:"credential"`
}

func hubNodeConfigPath(agentDir string) string {
	if configured := os.Getenv(hubNodeConfigEnvVar); configured != "" {
		return configured
	}
	return filepath.Join(agentDir, "pi-web-hub-node.json")
}

func loadHubNodeConfig(agentDir string) (*hubNodeConfig, error) {
	path := hubNodeConfigPath(agentDir)
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read hub node config: %w", err)
	}
	if err := secureHubCredentialFile(path); err != nil {
		return nil, fmt.Errorf("secure hub node config: %w", err)
	}
	var config hubNodeConfig
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&config); err != nil {
		return nil, fmt.Errorf("decode hub node config: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, errors.New("decode hub node config: multiple JSON values")
	}
	hubURL, err := validatePublicURL(config.HubURL)
	if err != nil || hubURL == "" {
		return nil, fmt.Errorf("invalid hub node URL")
	}
	if config.ID == "" || config.Label == "" || config.Credential == "" {
		return nil, errors.New("hub node config is incomplete")
	}
	config.HubURL = hubURL
	return &config, nil
}

func runHubNodeConnector(
	ctx context.Context,
	config hubNodeConfig,
	localHost string,
	localToken string,
	handler http.Handler,
) {
	delay := time.Second
	for ctx.Err() == nil {
		connector := hub.Connector{
			HubURL: config.HubURL, Credential: config.Credential,
			LocalHost: localHost, LocalToken: localToken, Handler: handler,
		}
		_ = connector.Run(ctx)
		if ctx.Err() != nil {
			return
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if delay < 30*time.Second {
			delay *= 2
			if delay > 30*time.Second {
				delay = 30 * time.Second
			}
		}
	}
}
