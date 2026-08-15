package terminalbridge

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
)

func TestBridgeUsesEphemeralAuthenticatedLoopbackDiscovery(t *testing.T) {
	agentDir := t.TempDir()
	bridge, err := Start(agentDir, t.TempDir(), &fakeFallback{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = bridge.Close(context.Background()) })
	address := bridge.listener.Addr().String()
	host, _, err := net.SplitHostPort(address)
	if err != nil || host != "127.0.0.1" {
		t.Fatalf("terminal bridge listener = %q, want numeric IPv4 loopback", address)
	}
	path := filepath.Join(agentDir, "pi-web", DiscoveryFilename)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var discovery Discovery
	if err := json.Unmarshal(data, &discovery); err != nil {
		t.Fatal(err)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(discovery.Token)
	if err != nil || len(decoded) != 32 {
		t.Fatalf("token is not 256-bit base64url: len=%d err=%v", len(decoded), err)
	}
	if discovery.Port != bridge.listener.Addr().(*net.TCPAddr).Port || discovery.PID != os.Getpid() {
		t.Fatalf("discovery does not describe live listener: %#v", discovery)
	}
	request, err := http.NewRequest(http.MethodGet, "http://"+address+"/api/terminal/connect", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Host = "localhost:" + strconv.Itoa(discovery.Port)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("non-advertised Host status = %d, want 403", response.StatusCode)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != 0o600 {
			t.Fatalf("terminal bridge discovery mode = %o, want 600", got)
		}
	}
}

func TestBridgeRotatesCredentialAndRemovesOnlyOwnedDiscovery(t *testing.T) {
	agentDir := t.TempDir()
	first, err := Start(agentDir, t.TempDir(), &fakeFallback{})
	if err != nil {
		t.Fatal(err)
	}
	firstToken := first.discovery.Token
	second, err := Start(agentDir, t.TempDir(), &fakeFallback{})
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close(context.Background())
	if firstToken == second.discovery.Token {
		t.Fatal("terminal bridge credential did not rotate on restart")
	}
	path := filepath.Join(agentDir, "pi-web", DiscoveryFilename)
	if err := first.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("old bridge removed successor discovery: %v", err)
	}
}
