package frontend

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"

	"pi-web/internal/render"
)

const (
	AppEntry     = "src/main.js"
	DesktopEntry = "src/desktop/bootstrap.tsx"
	MobileEntry  = "src/mobile/bootstrap.tsx"

	// Backward-compatible unexported alias used by package tests.
	appEntry = AppEntry
)

// Script is one Vite-built JavaScript entrypoint ready to be served by Go.
type Script struct {
	Entry  string
	Path   string
	JS     string
	Styles []string
}

type frontendScript = Script

func loadManifest(distFS fs.FS) (render.Manifest, error) {
	data, err := fs.ReadFile(distFS, ".vite/manifest.json")
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	var manifest render.Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("parse manifest: %w", err)
	}
	return manifest, nil
}

func validateManifestEntry(manifest render.Manifest, entryName string) (render.ManifestEntry, error) {
	entry, ok := manifest[entryName]
	if !ok {
		return render.ManifestEntry{}, fmt.Errorf("manifest missing %s entry", entryName)
	}
	if entry.File == "" {
		return render.ManifestEntry{}, fmt.Errorf("manifest entry file is empty: %s", entryName)
	}
	if strings.HasPrefix(entry.File, "/") {
		return render.ManifestEntry{}, fmt.Errorf("manifest entry file is absolute: %s", entry.File)
	}
	if strings.Contains(entry.File, "..") {
		return render.ManifestEntry{}, fmt.Errorf("manifest entry file contains path traversal: %s", entry.File)
	}
	return entry, nil
}

func loadFrontendScript(distFS fs.FS, manifest render.Manifest, assetBase, entryName string) (frontendScript, error) {
	entry, err := validateManifestEntry(manifest, entryName)
	if err != nil {
		return frontendScript{}, err
	}
	content, err := fs.ReadFile(distFS, entry.File)
	if err != nil {
		return frontendScript{}, fmt.Errorf("read %s js: %w", entryName, err)
	}
	base := strings.TrimRight(assetBase, "/")
	styles := make([]string, 0, len(entry.CSS))
	for _, stylesheet := range entry.CSS {
		if stylesheet == "" || strings.HasPrefix(stylesheet, "/") || strings.Contains(stylesheet, "..") {
			return frontendScript{}, fmt.Errorf("invalid stylesheet path for %s: %s", entryName, stylesheet)
		}
		styles = append(styles, base+"/"+stylesheet)
	}
	return frontendScript{
		Entry:  entryName,
		Path:   base + "/" + entry.File,
		JS:     string(content),
		Styles: styles,
	}, nil
}

func LoadScripts(distFS fs.FS, entryNames ...string) ([]Script, error) {
	return loadFrontendScriptsAt(distFS, "/static", entryNames...)
}

func LoadScriptsAt(distFS fs.FS, assetBase string, entryNames ...string) ([]Script, error) {
	if assetBase == "" || !strings.HasPrefix(assetBase, "/") || strings.Contains(assetBase, "..") {
		return nil, fmt.Errorf("invalid asset base: %q", assetBase)
	}
	return loadFrontendScriptsAt(distFS, assetBase, entryNames...)
}

func loadFrontendScripts(distFS fs.FS, entryNames ...string) ([]Script, error) {
	return loadFrontendScriptsAt(distFS, "/static", entryNames...)
}

func loadFrontendScriptsAt(distFS fs.FS, assetBase string, entryNames ...string) ([]Script, error) {
	manifest, err := loadManifest(distFS)
	if err != nil {
		return nil, err
	}
	scripts := make([]Script, 0, len(entryNames))
	for _, entryName := range entryNames {
		script, err := loadFrontendScript(distFS, manifest, assetBase, entryName)
		if err != nil {
			return nil, err
		}
		scripts = append(scripts, script)
	}
	return scripts, nil
}

func gzipAsset(data []byte) []byte {
	var buf bytes.Buffer
	w, err := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
	if err != nil {
		return data
	}
	_, _ = w.Write(data)
	_ = w.Close()
	return buf.Bytes()
}

type staticAsset struct {
	raw         []byte
	compressed  []byte
	contentType string
}

func ServeStaticAssets(dfs fs.FS) http.HandlerFunc {
	return ServeStaticAssetsAt(dfs, "/static/assets/")
}

// ServeStaticAssetsAt serves every Vite-generated file under assets/ from one
// output-specific URL namespace. This keeps desktop, mobile, and legacy chunk
// names independent even when two builds emit the same filename.
func ServeStaticAssetsAt(dfs fs.FS, requestPrefix string) http.HandlerFunc {
	cache := make(map[string]staticAsset)
	entries, _ := fs.ReadDir(dfs, "assets")
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		raw, err := fs.ReadFile(dfs, "assets/"+entry.Name())
		if err != nil {
			continue
		}
		contentType := mime.TypeByExtension(path.Ext(entry.Name()))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		cache[entry.Name()] = staticAsset{
			raw:         raw,
			compressed:  gzipAsset(raw),
			contentType: contentType,
		}
	}

	return func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, requestPrefix) {
			http.NotFound(w, r)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, requestPrefix)
		if name == "" || strings.Contains(name, "/") || strings.Contains(name, "..") {
			http.NotFound(w, r)
			return
		}
		asset, ok := cache[name]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", asset.contentType)
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			w.Header().Set("Content-Encoding", "gzip")
			_, _ = w.Write(asset.compressed)
		} else {
			_, _ = w.Write(asset.raw)
		}
	}
}

func ServeJS(js string, immutable bool) http.HandlerFunc {
	raw := []byte(js)
	compressed := gzipAsset(raw)
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		if immutable {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			w.Header().Set("Content-Encoding", "gzip")
			_, _ = w.Write(compressed)
		} else {
			_, _ = w.Write(raw)
		}
	}
}
