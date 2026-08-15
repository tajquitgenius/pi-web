//go:build !linux && !darwin

package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"pi-web/internal/auth"
)

func TestRegisteredApiFileReturnsNotImplementedOnUnsupportedPlatform(t *testing.T) {
	s, _ := newFilesTestServer(t)
	s.auth = auth.New("secret")
	mux := http.NewServeMux()
	s.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/file?id=s.jsonl&path=README.md", nil)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, body = %s; want 501", w.Code, w.Body.String())
	}
}
