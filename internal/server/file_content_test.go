package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"pi-web/internal/auth"
)

func getFile(t *testing.T, s *Server, path string) *httptest.ResponseRecorder {
	t.Helper()
	query := url.Values{"id": {"s.jsonl"}, "path": {path}}
	req := httptest.NewRequest(http.MethodGet, "/api/file?"+query.Encode(), nil)
	w := httptest.NewRecorder()
	s.handleApiFile(w, req)
	return w
}

func TestHandleApiFileRejectsNonGet(t *testing.T) {
	s, _ := newFilesTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/file?id=s.jsonl&path=README.md", nil)
	w := httptest.NewRecorder()
	s.handleApiFile(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, body = %s; want 405", w.Code, w.Body.String())
	}
}

func TestRegisteredApiFileRequiresNormalAuth(t *testing.T) {
	s := &Server{auth: auth.New("secret")}
	mux := http.NewServeMux()
	s.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/file?id=s.jsonl&path=README.md", nil)
	req.Header.Set("Accept", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s; want 401", w.Code, w.Body.String())
	}
}

func TestHandleApiFileRejectsOversizedContent(t *testing.T) {
	s, cwd := newFilesTestServer(t)
	if err := os.WriteFile(filepath.Join(cwd, "large.txt"), make([]byte, maxFilePreviewBytes+1), 0o644); err != nil {
		t.Fatal(err)
	}
	w := getFile(t, s, "large.txt")
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, body = %s; want 413", w.Code, w.Body.String())
	}
}

func TestHandleApiFileRejectsAbsoluteTraversalAndDirectories(t *testing.T) {
	s, cwd := newFilesTestServer(t, "inside.txt", "nested/child.txt")
	outside := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(outside, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(cwd, "escape")); err != nil {
		t.Skipf("symlink unsupported: %v", err)
	}

	for _, path := range []string{"/etc/passwd", "../outside.txt", "nested/../../outside.txt", "nested", "escape"} {
		w := getFile(t, s, path)
		if w.Code != http.StatusBadRequest {
			t.Errorf("path %q status = %d, body = %s; want 400", path, w.Code, w.Body.String())
		}
	}
}

func TestHandleApiFileClassifiesBinaryWithoutReturningContent(t *testing.T) {
	s, cwd := newFilesTestServer(t)
	data := []byte{0x89, 'P', 'N', 'G', 0x00, 0xff}
	if err := os.WriteFile(filepath.Join(cwd, "image.bin"), data, 0o644); err != nil {
		t.Fatal(err)
	}

	w := getFile(t, s, "image.bin")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["kind"] != "binary" || got["path"] != "image.bin" || got["size"] != float64(len(data)) {
		t.Fatalf("unexpected binary response: %+v", got)
	}
	if _, ok := got["content"]; ok {
		t.Fatalf("binary response unexpectedly includes content: %+v", got)
	}
}

func TestHandleApiFileRevisionChangesWithContent(t *testing.T) {
	s, cwd := newFilesTestServer(t)
	path := filepath.Join(cwd, "notes.txt")
	if err := os.WriteFile(path, []byte("one"), 0o644); err != nil {
		t.Fatal(err)
	}
	first := getFile(t, s, "notes.txt")
	var firstBody struct {
		Revision string `json:"revision"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &firstBody); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("two"), 0o644); err != nil {
		t.Fatal(err)
	}
	second := getFile(t, s, "notes.txt")
	var secondBody struct {
		Revision string `json:"revision"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &secondBody); err != nil {
		t.Fatal(err)
	}
	if firstBody.Revision == "" || firstBody.Revision == secondBody.Revision {
		t.Fatalf("revisions = %q and %q; want a content change", firstBody.Revision, secondBody.Revision)
	}
}

func TestHandleApiFileReturnsBoundedTextMetadataAndContent(t *testing.T) {
	s, cwd := newFilesTestServer(t)
	content := "hello, pi-web\n"
	if err := os.WriteFile(filepath.Join(cwd, "README.md"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	w := getFile(t, s, "README.md")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	var got struct {
		Path       string  `json:"path"`
		Kind       string  `json:"kind"`
		Content    *string `json:"content"`
		Size       int64   `json:"size"`
		ModifiedAt string  `json:"modifiedAt"`
		Revision   string  `json:"revision"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Path != "README.md" || got.Kind != "text" || got.Content == nil || *got.Content != content {
		t.Fatalf("unexpected file response: %+v", got)
	}
	if got.Size != int64(len(content)) || got.ModifiedAt == "" || got.Revision == "" {
		t.Fatalf("missing file metadata: %+v", got)
	}
}
