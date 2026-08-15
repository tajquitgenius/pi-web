package server

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"pi-web/internal/pairing"
)

const deviceCredentialCookieName = "pi_device"

type pairedDeviceContextKey struct{}

type pairedDeviceIdentity struct {
	ID        string
	ExpiresAt time.Time
}

type deviceRenewingResponseWriter struct {
	http.ResponseWriter
	server     *Server
	request    *http.Request
	identity   *pairedDeviceIdentity
	credential string
	deviceID   string
	committed  bool
}

func (w *deviceRenewingResponseWriter) commit(status int) {
	if w.committed {
		return
	}
	w.committed = true
	if status >= http.StatusOK && status < http.StatusMultipleChoices && w.server.pairing != nil {
		if device, renewed, err := w.server.pairing.RenewDevice(w.request.Context(), w.deviceID); err == nil && renewed {
			w.identity.ExpiresAt = device.ExpiresAt
			w.server.setDeviceCredentialCookie(w.ResponseWriter, w.request, w.credential, device.ExpiresAt)
		}
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *deviceRenewingResponseWriter) WriteHeader(status int) {
	w.commit(status)
}

func (w *deviceRenewingResponseWriter) Write(p []byte) (int, error) {
	if !w.committed {
		w.commit(http.StatusOK)
	}
	return w.ResponseWriter.Write(p)
}

func (w *deviceRenewingResponseWriter) Flush() {
	if !w.committed {
		w.commit(http.StatusOK)
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *deviceRenewingResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func pairedDeviceFromContext(ctx context.Context) (pairedDeviceIdentity, bool) {
	value := ctx.Value(pairedDeviceContextKey{})
	switch device := value.(type) {
	case pairedDeviceIdentity:
		return device, device.ID != ""
	case *pairedDeviceIdentity:
		if device != nil {
			return *device, device.ID != ""
		}
	}
	return pairedDeviceIdentity{}, false
}

func (s *Server) registerDevicePairingRoutes(mux *http.ServeMux) {
	boundary := func(handler http.HandlerFunc) http.HandlerFunc {
		return s.auth.WrapBoundary(handler).ServeHTTP
	}
	mux.HandleFunc("/pairing", boundary(s.handlePairingShell))
	mux.HandleFunc("/api/pairing-codes", boundary(s.handlePairingCodes))
	mux.HandleFunc("/api/pair", boundary(s.handlePairDevice))
	mux.HandleFunc("/api/devices", boundary(s.handleDevices))
	mux.HandleFunc("/api/devices/", boundary(s.handleDevice))
	mux.HandleFunc("/api/pairing-status", boundary(s.handlePairingStatus))
}

// HTTPHandler applies the exact Host/Origin boundary to every route and adds
// the public-host device gate around the complete mux, including static assets.
func (s *Server) HTTPHandler(next http.Handler) http.Handler {
	gate := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.isPublicRequest(r) || isPublicPairingPath(r) {
			next.ServeHTTP(w, r)
			return
		}

		credential := ""
		if cookie, err := r.Cookie(deviceCredentialCookieName); err == nil {
			credential = cookie.Value
		}
		if credential != "" && s.pairing != nil {
			device, paired, err := s.pairing.LookupDevice(r.Context(), credential)
			if err != nil {
				writeJSONError(w, http.StatusInternalServerError, "device authentication unavailable")
				return
			}
			if paired {
				identity := &pairedDeviceIdentity{ID: device.ID, ExpiresAt: device.ExpiresAt}
				ctx := context.WithValue(r.Context(), pairedDeviceContextKey{}, identity)
				renewing := &deviceRenewingResponseWriter{
					ResponseWriter: w,
					server:         s,
					request:        r.WithContext(ctx),
					identity:       identity,
					credential:     credential,
					deviceID:       device.ID,
				}
				next.ServeHTTP(renewing, r.WithContext(ctx))
				if !renewing.committed {
					renewing.commit(http.StatusOK)
				}
				return
			}
			s.clearDeviceCredential(w, r)
		}

		if (r.Method == http.MethodGet || r.Method == http.MethodHead) && !strings.HasPrefix(r.URL.Path, "/api/") {
			http.Redirect(w, r, "/pairing", http.StatusFound)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSONError(w, http.StatusUnauthorized, "device pairing required")
	})
	return s.auth.WrapBoundary(gate)
}

func isPublicPairingPath(r *http.Request) bool {
	switch r.URL.Path {
	case "/api/pair", "/api/pairing-status":
		return true
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	switch r.URL.Path {
	case "/pairing", "/manifest.webmanifest", "/app-build.json", "/sw.js", "/offline.html", "/icon.svg", "/icon-maskable.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/pi-logo.svg", "/custom-themes.css":
		return true
	}
	return strings.HasPrefix(r.URL.Path, "/static/desktop/assets/") || strings.HasPrefix(r.URL.Path, "/static/mobile/assets/")
}

func (s *Server) handlePairingShell(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.handleAppShell(w, r, "")
}

func (s *Server) handlePairingCodes(w http.ResponseWriter, r *http.Request) {
	setPairingNoStore(w)
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !isLoopbackRequestHost(r.Host) {
		writeJSONError(w, http.StatusForbidden, "pairing codes may only be created locally")
		return
	}
	if r.URL.RawQuery != "" {
		writeJSONError(w, http.StatusBadRequest, "pairing codes are not accepted in URLs")
		return
	}
	if s.pairing == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "device pairing unavailable")
		return
	}
	code, err := s.pairing.CreateCode(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "could not create pairing code")
		return
	}
	writeJSON(w, http.StatusCreated, code)
}

func (s *Server) handlePairDevice(w http.ResponseWriter, r *http.Request) {
	setPairingNoStore(w)
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.pairing == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "device pairing unavailable")
		return
	}
	if err := s.pairing.ConsumeRedemptionAttempt(r.Context()); err != nil {
		if errors.Is(err, pairing.ErrRateLimited) {
			w.Header().Set("Retry-After", "60")
			writeJSONError(w, http.StatusTooManyRequests, "too many pairing attempts")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "device pairing unavailable")
		return
	}
	if r.URL.RawQuery != "" {
		writeJSONError(w, http.StatusBadRequest, "pairing credentials are not accepted in URLs")
		return
	}
	var body struct {
		Code  string `json:"code"`
		Label string `json:"label"`
	}
	if !decodeJSONBody(w, r, &body) {
		return
	}
	credential, device, err := s.pairing.Redeem(r.Context(), body.Code, body.Label)
	if err != nil {
		switch {
		case errors.Is(err, pairing.ErrInvalidCode):
			writeJSONError(w, http.StatusUnauthorized, "invalid or expired pairing code")
		case errors.Is(err, pairing.ErrInvalidLabel):
			writeJSONError(w, http.StatusBadRequest, "device label is required and must be at most 80 characters")
		default:
			writeJSONError(w, http.StatusInternalServerError, "could not pair device")
		}
		return
	}
	s.setDeviceCredentialCookie(w, r, credential, device.ExpiresAt)
	writeJSON(w, http.StatusCreated, map[string]any{"paired": true, "device": device})
}

func (s *Server) handleDevices(w http.ResponseWriter, r *http.Request) {
	setPairingNoStore(w)
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !isLoopbackRequestHost(r.Host) {
		writeJSONError(w, http.StatusForbidden, "paired devices may only be administered locally")
		return
	}
	if s.pairing == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "device pairing unavailable")
		return
	}
	devices, err := s.pairing.ListDevices(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "could not list paired devices")
		return
	}
	writeJSON(w, 0, map[string]any{"devices": devices})
}

func (s *Server) handleDevice(w http.ResponseWriter, r *http.Request) {
	setPairingNoStore(w)
	if r.Method != http.MethodDelete {
		w.Header().Set("Allow", "DELETE")
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !isLoopbackRequestHost(r.Host) {
		writeJSONError(w, http.StatusForbidden, "paired devices may only be administered locally")
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/devices/")
	if id == "" || strings.Contains(id, "/") || r.URL.RawQuery != "" {
		writeJSONError(w, http.StatusBadRequest, "invalid device id")
		return
	}
	if s.pairing == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "device pairing unavailable")
		return
	}
	revoked, err := s.pairing.RevokeDevice(r.Context(), id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "could not revoke paired device")
		return
	}
	if !revoked {
		writeJSONError(w, http.StatusNotFound, "paired device not found")
		return
	}
	s.closeDeviceClients(id)
	if s.push != nil {
		s.push.RemoveDevice(id)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handlePairingStatus(w http.ResponseWriter, r *http.Request) {
	setPairingNoStore(w)
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if r.URL.RawQuery != "" {
		writeJSONError(w, http.StatusBadRequest, "device credentials are not accepted in URLs")
		return
	}
	if isLoopbackRequestHost(r.Host) {
		writeJSON(w, 0, map[string]bool{"paired": true, "local": true})
		return
	}
	if !s.isPublicRequest(r) || s.pairing == nil {
		writeJSON(w, 0, map[string]bool{"paired": false, "local": false})
		return
	}
	cookie, err := r.Cookie(deviceCredentialCookieName)
	if err != nil {
		writeJSON(w, 0, map[string]bool{"paired": false, "local": false})
		return
	}
	_, paired, err := s.pairing.LookupDevice(r.Context(), cookie.Value)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "device authentication unavailable")
		return
	}
	if !paired {
		s.clearDeviceCredential(w, r)
	}
	writeJSON(w, 0, map[string]bool{"paired": paired, "local": false})
}

func (s *Server) setDeviceCredentialCookie(w http.ResponseWriter, r *http.Request, credential string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     deviceCredentialCookieName,
		Value:    credential,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   int(pairing.CredentialLifetime / time.Second),
		HttpOnly: true,
		Secure:   s.isPublicRequest(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearDeviceCredential(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     deviceCredentialCookieName,
		Path:     "/",
		Expires:  time.Unix(1, 0).UTC(),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.isPublicRequest(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) isPublicRequest(r *http.Request) bool {
	return s.publicAuthority != "" && normalizeHTTPSAuthority(r.Host) == s.publicAuthority
}

func normalizeHTTPSAuthority(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	if !strings.Contains(value, "://") {
		value = "//" + value
	}
	u, err := url.Parse(value)
	if err != nil || u.Hostname() == "" {
		return ""
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	port := u.Port()
	if port == "" || port == "443" {
		return host
	}
	return net.JoinHostPort(host, port)
}

func isLoopbackRequestHost(raw string) bool {
	value := raw
	if !strings.Contains(value, "://") {
		value = "//" + value
	}
	u, err := url.Parse(value)
	if err != nil {
		return false
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func setPairingNoStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
}
