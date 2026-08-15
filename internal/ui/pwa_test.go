package ui

import (
	"bytes"
	"encoding/json"
	"image"
	_ "image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPWAManifestProvidesInstallableAppMetadata(t *testing.T) {
	var manifest struct {
		Name            string `json:"name"`
		ShortName       string `json:"short_name"`
		StartURL        string `json:"start_url"`
		Scope           string `json:"scope"`
		Display         string `json:"display"`
		BackgroundColor string `json:"background_color"`
		ThemeColor      string `json:"theme_color"`
		Icons           []struct {
			Src     string `json:"src"`
			Sizes   string `json:"sizes"`
			Type    string `json:"type"`
			Purpose string `json:"purpose"`
		} `json:"icons"`
	}
	if err := json.Unmarshal([]byte(manifestJSON), &manifest); err != nil {
		t.Fatalf("manifest JSON: %v", err)
	}
	if manifest.Name == "" || manifest.ShortName == "" {
		t.Fatalf("manifest app names = %q / %q, want accessible names", manifest.Name, manifest.ShortName)
	}
	if manifest.StartURL != "/" || manifest.Scope != "/" || manifest.Display != "standalone" {
		t.Fatalf("manifest install boundary = start %q, scope %q, display %q", manifest.StartURL, manifest.Scope, manifest.Display)
	}
	if manifest.ThemeColor == "" || manifest.BackgroundColor == "" {
		t.Fatalf("manifest colors = theme %q, background %q", manifest.ThemeColor, manifest.BackgroundColor)
	}

	wantIcons := map[string]struct {
		typeName string
		purpose  string
	}{
		"/icon-192.png":         {typeName: "image/png", purpose: "any maskable"},
		"/icon-512.png":         {typeName: "image/png", purpose: "any maskable"},
		"/apple-touch-icon.png": {typeName: "image/png", purpose: "any"},
	}
	seen := make(map[string]bool, len(manifest.Icons))
	for _, icon := range manifest.Icons {
		want, ok := wantIcons[icon.Src]
		if !ok {
			continue
		}
		seen[icon.Src] = true
		if icon.Type != want.typeName || icon.Purpose != want.purpose {
			t.Errorf("icon %q metadata = type %q purpose %q", icon.Src, icon.Type, icon.Purpose)
		}
		if icon.Sizes != "192x192" && icon.Sizes != "512x512" && icon.Sizes != "180x180" {
			t.Errorf("icon %q sizes = %q", icon.Src, icon.Sizes)
		}
	}
	for src := range wantIcons {
		if !seen[src] {
			t.Errorf("manifest missing install icon %s", src)
		}
	}
}

func TestPWAHandlersServeOnlyReadOnlyMetadataAndOfflineDocument(t *testing.T) {
	mux := http.NewServeMux()
	RegisterPWAHandlers(mux)

	for _, test := range []struct {
		path        string
		contentType string
		cache       string
	}{
		{path: "/manifest.webmanifest", contentType: "application/manifest+json", cache: "no-cache"},
		{path: "/sw.js", contentType: "application/javascript", cache: "no-cache"},
		{path: "/offline.html", contentType: "text/html", cache: "no-cache"},
		{path: "/icon-192.png", contentType: "image/png", cache: "public, max-age=31536000, immutable"},
		{path: "/icon-512.png", contentType: "image/png", cache: "public, max-age=31536000, immutable"},
		{path: "/apple-touch-icon.png", contentType: "image/png", cache: "public, max-age=31536000, immutable"},
		{path: "/cat.webm", contentType: "video/webm", cache: "no-store"},
	} {
		t.Run(test.path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, test.path, nil)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("GET %s = %d, want 200", test.path, rec.Code)
			}
			if !strings.HasPrefix(rec.Header().Get("Content-Type"), test.contentType) {
				t.Fatalf("GET %s Content-Type = %q, want %q", test.path, rec.Header().Get("Content-Type"), test.contentType)
			}
			if rec.Header().Get("Cache-Control") != test.cache {
				t.Fatalf("GET %s Cache-Control = %q, want %q", test.path, rec.Header().Get("Cache-Control"), test.cache)
			}
			if rec.Body.Len() == 0 {
				t.Fatalf("GET %s returned an empty body", test.path)
			}
		})
	}

	for _, path := range []string{"/manifest.webmanifest", "/sw.js", "/offline.html", "/icon-192.png"} {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(nil))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("POST %s = %d, want 405", path, rec.Code)
		}
	}
}

func TestPWAInstallIconsHaveDeclaredPNGDimensions(t *testing.T) {
	mux := http.NewServeMux()
	RegisterPWAHandlers(mux)
	for _, test := range []struct {
		path string
		want int
	}{
		{path: "/icon-192.png", want: 192},
		{path: "/icon-512.png", want: 512},
		{path: "/apple-touch-icon.png", want: 180},
	} {
		req := httptest.NewRequest(http.MethodGet, test.path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		bounds, _, err := image.DecodeConfig(bytes.NewReader(rec.Body.Bytes()))
		if err != nil {
			t.Fatalf("decode %s: %v", test.path, err)
		}
		if bounds.Width != test.want || bounds.Height != test.want {
			t.Fatalf("%s dimensions = %dx%d, want %dx%d", test.path, bounds.Width, bounds.Height, test.want, test.want)
		}
	}
}

func TestServiceWorkerHasNetworkOnlyNavigationAndNarrowStaticCache(t *testing.T) {
	for _, required := range []string{
		"self.skipWaiting()",
		"self.clients.claim()",
		"request.mode === 'navigate'",
		"/offline.html",
		"/static/desktop/assets/",
		"/static/mobile/assets/",
		"/manifest.webmanifest",
		"/icon-192.png",
		"/icon-512.png",
		"/apple-touch-icon.png",
		"response.status === 200",
		"response.redirected",
		"response.type !== 'basic'",
		"/api/",
		"/session",
		"/events",
		"/sounds/",
		"/pairing",
		"/device",
	} {
		if !strings.Contains(swJS, required) {
			t.Errorf("service worker missing security behavior %q", required)
		}
	}
	if strings.Contains(swJS, "cache.addAll") {
		t.Error("service worker must not precache an uncontrolled URL list")
	}
}
