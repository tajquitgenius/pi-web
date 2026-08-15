package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPublicPairingSurfaceAllowsOnlyPWAAndBootstrapAssets(t *testing.T) {
	for _, path := range []string{
		"/manifest.webmanifest",
		"/sw.js",
		"/offline.html",
		"/icon.svg",
		"/icon-maskable.svg",
		"/icon-192.png",
		"/icon-512.png",
		"/apple-touch-icon.png",
		"/pi-logo.svg",
		"/custom-themes.css",
		"/static/desktop/assets/app-123.js",
		"/static/mobile/assets/app-123.css",
	} {
		req := httptest.NewRequest(http.MethodGet, "https://pi.example"+path, nil)
		if !isPublicPairingPath(req) {
			t.Errorf("%s is not in the public pairing bootstrap surface", path)
		}
	}

	for _, path := range []string{
		"/",
		"/session?id=private",
		"/api/sessions",
		"/events",
		"/sounds/done.mp3",
		"/api/push/subscribe",
		"/api/devices/one",
	} {
		req := httptest.NewRequest(http.MethodGet, "https://pi.example"+path, nil)
		if isPublicPairingPath(req) {
			t.Errorf("%s must remain protected by the device gate", path)
		}
	}
}
