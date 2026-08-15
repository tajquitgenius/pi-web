package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"sync/atomic"
	"testing"
)

func TestHubEnrollmentDoesNotFollowRedirects(t *testing.T) {
	var redirectedRequests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		redirectedRequests.Add(1)
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/stolen", http.StatusTemporaryRedirect)
	}))
	defer source.Close()

	if _, err := requestHubEnrollment(source.URL, "single-use-secret"); err == nil {
		t.Fatal("redirecting enrollment unexpectedly succeeded")
	}
	if got := redirectedRequests.Load(); got != 0 {
		t.Fatalf("enrollment secret followed redirect %d time(s)", got)
	}
}

func TestWriteHubNodeConfigIsOwnerOnly(t *testing.T) {
	agentDir := t.TempDir()
	config := hubNodeConfig{
		HubURL: "https://pi.example", ID: "work", Label: "Work", Credential: "secret",
	}
	if err := writeHubNodeConfig(agentDir, config); err != nil {
		t.Fatal(err)
	}
	config.Credential = "rotated-secret"
	if err := writeHubNodeConfig(agentDir, config); err != nil {
		t.Fatalf("replace hub node config: %v", err)
	}
	loaded, err := loadHubNodeConfig(agentDir)
	if err != nil {
		t.Fatal(err)
	}
	if loaded == nil || loaded.Credential != "rotated-secret" {
		t.Fatalf("rotated hub credential was not installed: %+v", loaded)
	}
	if runtime.GOOS == "windows" {
		return
	}
	info, err := os.Stat(hubNodeConfigPath(agentDir))
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0600 {
		t.Fatalf("hub node config mode = %o, want 600", got)
	}
}
