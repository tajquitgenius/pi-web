package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/term"

	"pi-web/internal/agentdir"
	"pi-web/internal/hub"
)

func runHubCLI(args []string, input *os.File, output io.Writer) (bool, error) {
	if len(args) == 0 || (args[0] != "hub" && args[0] != "node") {
		return false, nil
	}
	if len(args) >= 3 && args[0] == "hub" && args[1] == "invite" {
		label := args[2]
		if len(args) > 3 {
			label = strings.Join(args[3:], " ")
		}
		return true, createHubInvitation(args[2], label, output)
	}
	if len(args) == 3 && args[0] == "node" && args[1] == "join" {
		return true, joinHubNode(args[2], input, output)
	}
	return true, errors.New("usage: pi-web hub invite <id> [label] | pi-web node join <hub-url>")
}

func createHubInvitation(id, label string, output io.Writer) error {
	payload, _ := json.Marshal(map[string]string{"id": id, "label": label})
	localURL := os.Getenv("PI_WEB_HUB_LOCAL_URL")
	if localURL == "" {
		localURL = "http://127.0.0.1:31415"
	}
	request, err := http.NewRequest(http.MethodPost, strings.TrimRight(localURL, "/")+"/api/hub/enrollments", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("create hub invitation: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("create hub invitation: hub returned HTTP %d", response.StatusCode)
	}
	var enrollment hub.Enrollment
	if err := decodeLimitedJSON(response.Body, &enrollment); err != nil {
		return fmt.Errorf("decode hub invitation: %w", err)
	}
	_, err = fmt.Fprintf(output, "Node: %s\nEnrollment code: %s\nExpires: %s\n", label, enrollment.Code, enrollment.ExpiresAt.Format(time.RFC3339))
	return err
}

func joinHubNode(rawHubURL string, input *os.File, output io.Writer) error {
	hubURL, err := validatePublicURL(rawHubURL)
	if err != nil || hubURL == "" {
		return errors.New("hub URL must be an absolute HTTPS origin")
	}
	if input == nil || !term.IsTerminal(int(input.Fd())) {
		return errors.New("node enrollment code must be entered from a terminal")
	}
	if _, err := fmt.Fprint(output, "Enrollment code: "); err != nil {
		return err
	}
	code, err := term.ReadPassword(int(input.Fd()))
	_, _ = fmt.Fprintln(output)
	if err != nil {
		return fmt.Errorf("read enrollment code: %w", err)
	}
	enrolled, err := requestHubEnrollment(hubURL, strings.TrimSpace(string(code)))
	if err != nil {
		return err
	}
	config := hubNodeConfig{
		HubURL: hubURL, ID: enrolled.ID, Label: enrolled.Label, Credential: enrolled.Credential,
	}
	if err := writeHubNodeConfig(agentdir.Path(), config); err != nil {
		return err
	}
	_, err = fmt.Fprintf(output, "Enrolled %s with Main. Restart pi-web to connect.\n", enrolled.Label)
	return err
}

func requestHubEnrollment(hubURL, code string) (hub.NodeCredential, error) {
	payload, _ := json.Marshal(map[string]string{"code": code})
	request, err := http.NewRequest(http.MethodPost, hubURL+"/api/hub/enroll", bytes.NewReader(payload))
	if err != nil {
		return hub.NodeCredential{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return hub.NodeCredential{}, fmt.Errorf("enroll with hub: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return hub.NodeCredential{}, fmt.Errorf("enroll with hub: hub returned HTTP %d", response.StatusCode)
	}
	var enrolled hub.NodeCredential
	if err := decodeLimitedJSON(response.Body, &enrolled); err != nil {
		return hub.NodeCredential{}, fmt.Errorf("decode hub enrollment: %w", err)
	}
	return enrolled, nil
}

func writeHubNodeConfig(agentDir string, config hubNodeConfig) error {
	if err := os.MkdirAll(agentDir, 0700); err != nil {
		return fmt.Errorf("create agent directory: %w", err)
	}
	encoded, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')
	path := hubNodeConfigPath(agentDir)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("create hub config directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".pi-web-hub-node-*")
	if err != nil {
		return fmt.Errorf("create hub node config: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := secureHubCredentialFile(temporaryPath); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(encoded); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := installHubCredentialFile(temporaryPath, path); err != nil {
		return fmt.Errorf("install hub node config: %w", err)
	}
	return secureHubCredentialFile(path)
}

func decodeLimitedJSON(reader io.Reader, destination any) error {
	decoder := json.NewDecoder(io.LimitReader(reader, 64<<10))
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("invalid trailing response data")
	}
	return nil
}
