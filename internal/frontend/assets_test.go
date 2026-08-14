package frontend

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func desktopBuildFS(manifestEntry string) fstest.MapFS {
	return fstest.MapFS{
		".vite/manifest.json":      &fstest.MapFile{Data: []byte(manifestEntry)},
		"assets/desktop-abc123.js": &fstest.MapFile{Data: []byte("console.log('desktop')")},
	}
}

func TestLoadScriptsAtLoadsProductEntrypointAndStyles(t *testing.T) {
	fsys := desktopBuildFS(`{"src/desktop/bootstrap.tsx":{"file":"assets/desktop-abc123.js","css":["assets/desktop-def456.css"]}}`)
	scripts, err := LoadScriptsAt(fsys, "/static/desktop", DesktopEntry)
	if err != nil {
		t.Fatalf("LoadScriptsAt: %v", err)
	}
	if len(scripts) != 1 {
		t.Fatalf("len(scripts) = %d, want 1", len(scripts))
	}
	if got, want := scripts[0].Path, "/static/desktop/assets/desktop-abc123.js"; got != want {
		t.Fatalf("path = %q, want %q", got, want)
	}
	if got, want := scripts[0].Styles[0], "/static/desktop/assets/desktop-def456.css"; got != want {
		t.Fatalf("style = %q, want %q", got, want)
	}
	if got, want := scripts[0].JS, "console.log('desktop')"; got != want {
		t.Fatalf("JS = %q, want %q", got, want)
	}
}

func TestLoadScriptsAtRejectsInvalidAssetBase(t *testing.T) {
	if _, err := LoadScriptsAt(fstest.MapFS{}, "static/desktop", DesktopEntry); err == nil {
		t.Fatal("expected error for relative asset base")
	}
	if _, err := LoadScriptsAt(fstest.MapFS{}, "/static/../desktop", DesktopEntry); err == nil {
		t.Fatal("expected error for asset base traversal")
	}
}

func TestServeStaticAssetsAtUsesProductNamespaceAndContentType(t *testing.T) {
	fsys := fstest.MapFS{
		"assets/mobile.css": &fstest.MapFile{Data: []byte("body{}")},
	}
	handler := ServeStaticAssetsAt(fsys, "/static/mobile/assets/")

	rec := httptest.NewRecorder()
	handler(rec, httptest.NewRequest(http.MethodGet, "/static/mobile/assets/mobile.css", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "text/css; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want CSS", got)
	}

	legacy := httptest.NewRecorder()
	handler(legacy, httptest.NewRequest(http.MethodGet, "/static/assets/mobile.css", nil))
	if legacy.Code != http.StatusNotFound {
		t.Fatalf("legacy namespace status = %d, want 404", legacy.Code)
	}
}

func TestLoadScriptsAtMissingManifest(t *testing.T) {
	if _, err := LoadScriptsAt(fstest.MapFS{}, "/static/desktop", DesktopEntry); err == nil {
		t.Fatal("expected error for missing manifest")
	}
}

func TestLoadScriptsAtRejectsEmptyFile(t *testing.T) {
	fsys := desktopBuildFS(`{"src/desktop/bootstrap.tsx":{"file":""}}`)
	if _, err := LoadScriptsAt(fsys, "/static/desktop", DesktopEntry); err == nil {
		t.Fatal("expected error for empty file")
	}
}

func TestLoadScriptsAtRejectsAbsolutePath(t *testing.T) {
	fsys := desktopBuildFS(`{"src/desktop/bootstrap.tsx":{"file":"/etc/passwd"}}`)
	if _, err := LoadScriptsAt(fsys, "/static/desktop", DesktopEntry); err == nil {
		t.Fatal("expected error for absolute path")
	}
}

func TestLoadScriptsAtRejectsPathTraversal(t *testing.T) {
	fsys := desktopBuildFS(`{"src/desktop/bootstrap.tsx":{"file":"../etc/passwd"}}`)
	if _, err := LoadScriptsAt(fsys, "/static/desktop", DesktopEntry); err == nil {
		t.Fatal("expected error for path traversal")
	}
}
