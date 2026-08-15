package ui

import (
	"bytes"
	_ "embed"
	"net/http"
	"time"
)

//go:embed embedded/assets/manifest.webmanifest
var manifestJSON string

//go:embed embedded/assets/sw.js
var swJS string

//go:embed embedded/assets/icon.svg
var iconSVG string

//go:embed embedded/assets/icon-maskable.svg
var iconMaskableSVG string

//go:embed embedded/assets/pi-logo.svg
var piLogoSVG string

//go:embed embedded/assets/icon-192.png
var icon192PNG []byte

//go:embed embedded/assets/icon-512.png
var icon512PNG []byte

//go:embed embedded/assets/apple-touch-icon.png
var appleTouchIconPNG []byte

//go:embed embedded/assets/offline.html
var offlineHTML string

//go:embed embedded/assets/cat.mp3
var CatMP3 []byte

//go:embed embedded/assets/done.mp3
var DoneMP3 []byte

//go:embed embedded/assets/cat.webm
var catWebm []byte

// RegisterPWAHandlers serves only install metadata and generic bootstrap assets.
// The outer server boundary still validates Host/Origin and public-device
// pairing. These responses contain no session, account, or user content, so
// they can be reached by the pairing screen before a device is authenticated.
func RegisterPWAHandlers(mux *http.ServeMux) {
	serve := func(path, contentType, cacheControl string, body []byte) {
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				w.Header().Set("Allow", "GET, HEAD")
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			w.Header().Set("Content-Type", contentType)
			w.Header().Set("Cache-Control", cacheControl)
			w.Header().Set("X-Content-Type-Options", "nosniff")
			if r.Method == http.MethodGet {
				_, _ = w.Write(body)
			}
		})
	}

	serve("/manifest.webmanifest", "application/manifest+json", "no-cache", []byte(manifestJSON))
	serve("/sw.js", "application/javascript; charset=utf-8", "no-cache", []byte(swJS))
	serve("/offline.html", "text/html; charset=utf-8", "no-cache", []byte(offlineHTML))
	serve("/icon.svg", "image/svg+xml", "public, max-age=31536000, immutable", []byte(iconSVG))
	serve("/icon-maskable.svg", "image/svg+xml", "public, max-age=31536000, immutable", []byte(iconMaskableSVG))
	serve("/pi-logo.svg", "image/svg+xml", "public, max-age=31536000, immutable", []byte(piLogoSVG))
	serve("/icon-192.png", "image/png", "public, max-age=31536000, immutable", icon192PNG)
	serve("/icon-512.png", "image/png", "public, max-age=31536000, immutable", icon512PNG)
	serve("/apple-touch-icon.png", "image/png", "public, max-age=31536000, immutable", appleTouchIconPNG)

	mux.HandleFunc("/cat.webm", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "video/webm")
		w.Header().Set("Cache-Control", "no-store")
		http.ServeContent(w, r, "cat.webm", time.Time{}, bytes.NewReader(catWebm))
	})
}
