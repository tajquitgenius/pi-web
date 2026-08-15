//go:build linux || darwin

package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHandleApiFileRejectsSymlinkComponent(t *testing.T) {
	s, cwd := newFilesTestServer(t)
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(cwd, "linked")); err != nil {
		t.Skipf("symlink unsupported: %v", err)
	}

	w := getFile(t, s, "linked/secret.txt")
	if w.Code != 400 {
		t.Fatalf("status = %d, body = %s; want 400", w.Code, w.Body.String())
	}
}

func TestValidateRelativeFilePathRejectsOversizedRawPath(t *testing.T) {
	requested := strings.Repeat("a", maxFilePreviewPathBytes+1)
	if _, err := validateRelativeFilePath(requested); err != errFilePathInvalid {
		t.Fatalf("validateRelativeFilePath(%d bytes) error = %v; want %v", len(requested), err, errFilePathInvalid)
	}
}

func TestHandleApiFileReturnsNotFoundForDeletedCachedSession(t *testing.T) {
	s, _ := newFilesTestServer(t)
	sessionPath := filepath.Join(s.sessionsDir, "project", "s.jsonl")
	if _, err := s.cache.Resolve(s.sessionsDir, "s.jsonl"); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(sessionPath); err != nil {
		t.Fatal(err)
	}

	w := getFile(t, s, "missing.txt")
	if w.Code != 404 {
		t.Fatalf("status = %d, body = %s; want 404", w.Code, w.Body.String())
	}
}
