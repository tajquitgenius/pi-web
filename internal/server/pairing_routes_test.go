package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"pi-web/internal/auth"
	"pi-web/internal/pairing"
	"pi-web/internal/sessions"
)

type serverPairingClock struct {
	unix atomic.Int64
}

func newServerPairingClock() *serverPairingClock {
	clock := &serverPairingClock{}
	clock.unix.Store(time.Date(2026, 7, 2, 9, 0, 0, 0, time.UTC).Unix())
	return clock
}

func (c *serverPairingClock) Now() time.Time {
	return time.Unix(c.unix.Load(), 0).UTC()
}

func (c *serverPairingClock) Advance(d time.Duration) {
	c.unix.Add(int64(d / time.Second))
}

func newPairingRouteTestServer(t *testing.T, publicURL string, clock *serverPairingClock) (*Server, http.Handler) {
	t.Helper()
	dir := t.TempDir()
	authMiddleware := auth.New("")
	authMiddleware.AllowHost("127.0.0.1:31415")
	if publicURL != "" {
		authMiddleware.AllowHost(publicURL)
	}
	s, err := New(Deps{
		AgentDir:    dir,
		SessionsDir: dir,
		Auth:        authMiddleware,
		PublicURL:   publicURL,
		Cache:       sessions.NewCache(),
		RenderAppShell: func(w io.Writer, bootstrap string) error {
			_, err := io.WriteString(w, "pairing shell")
			return err
		},
		Now: clock.Now,
		Models: func(context.Context) (json.RawMessage, error) {
			return nil, nil
		},
		DisableBackgroundJobs: true,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(s.Shutdown)
	mux := http.NewServeMux()
	s.Register(mux)
	return s, s.HTTPHandler(mux)
}

func pairingRequest(handler http.Handler, method, target, body, origin string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func createPairingCode(t *testing.T, handler http.Handler) pairing.Code {
	t.Helper()
	rec := pairingRequest(handler, http.MethodPost, "http://127.0.0.1:31415/api/pairing-codes", "", "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create pairing code status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var code pairing.Code
	if err := json.Unmarshal(rec.Body.Bytes(), &code); err != nil {
		t.Fatalf("decode pairing code: %v", err)
	}
	return code
}

func redeemPairingCode(t *testing.T, handler http.Handler, target string, code pairing.Code, label string) (*http.Cookie, map[string]any, *httptest.ResponseRecorder) {
	t.Helper()
	body, err := json.Marshal(map[string]string{"code": code.Value, "label": label})
	if err != nil {
		t.Fatalf("marshal pair request: %v", err)
	}
	origin := ""
	if strings.HasPrefix(target, "https://") {
		origin = "https://" + strings.Split(strings.TrimPrefix(target, "https://"), "/")[0]
	}
	rec := pairingRequest(handler, http.MethodPost, target, string(body), origin)
	if rec.Code != http.StatusCreated {
		t.Fatalf("redeem pairing code status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode pairing response: %v", err)
	}
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == deviceCredentialCookieName {
			return cookie, response, rec
		}
	}
	t.Fatal("pairing response did not set the device credential cookie")
	return nil, nil, rec
}

func TestPublicDeviceGateExposesOnlyPairingSurface(t *testing.T) {
	_, handler := newPairingRouteTestServer(t, "https://pi.example", newServerPairingClock())

	status := pairingRequest(handler, http.MethodGet, "https://pi.example/api/pairing-status", "", "")
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"paired":false`) {
		t.Fatalf("unpaired status = (%d, %s), want 200 paired=false", status.Code, status.Body.String())
	}

	protected := pairingRequest(handler, http.MethodGet, "https://pi.example/api/sessions", "", "")
	if protected.Code != http.StatusUnauthorized {
		t.Fatalf("unpaired protected API status = %d, want 401", protected.Code)
	}
	page := pairingRequest(handler, http.MethodGet, "https://pi.example/session?id=private-session", "", "")
	if page.Code != http.StatusFound || page.Header().Get("Location") != "/pairing" {
		t.Fatalf("unpaired page = (%d, %q), want redirect to /pairing", page.Code, page.Header().Get("Location"))
	}
	if strings.Contains(page.Header().Get("Location"), "private-session") {
		t.Fatal("protected page URL was copied into the pairing redirect")
	}
	pairingPage := pairingRequest(handler, http.MethodGet, "https://pi.example/pairing", "", "")
	if pairingPage.Code != http.StatusOK || pairingPage.Body.String() != "pairing shell" {
		t.Fatalf("pairing shell = (%d, %q), want public shell", pairingPage.Code, pairingPage.Body.String())
	}
	asset := pairingRequest(handler, http.MethodGet, "https://pi.example/static/assets/missing.js", "", "")
	if asset.Code != http.StatusNotFound {
		t.Fatalf("pairing asset request status = %d, want inner 404 rather than device-gate 401", asset.Code)
	}

	unknownHost := pairingRequest(handler, http.MethodGet, "https://evil.example/api/pairing-status", "", "")
	if unknownHost.Code != http.StatusForbidden {
		t.Fatalf("unknown Host status = %d, want 403", unknownHost.Code)
	}
	crossOrigin := pairingRequest(handler, http.MethodPost, "https://pi.example/api/pair", `{"code":"AAAAAAAA","label":"Phone"}`, "https://evil.example")
	if crossOrigin.Code != http.StatusForbidden {
		t.Fatalf("cross-origin pairing status = %d, want 403", crossOrigin.Code)
	}
}

func TestPairingCookieSecurityAndSecretTransport(t *testing.T) {
	clock := newServerPairingClock()
	s, handler := newPairingRouteTestServer(t, "https://pi.example", clock)
	code := createPairingCode(t, handler)

	var logs bytes.Buffer
	previousLogWriter := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(previousLogWriter) })

	cookie, response, rec := redeemPairingCode(t, handler, "https://pi.example/api/pair", code, "Personal phone")
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("public cookie flags = HttpOnly:%v Secure:%v SameSite:%v", cookie.HttpOnly, cookie.Secure, cookie.SameSite)
	}
	if cookie.Path != "/" || cookie.MaxAge != int(pairing.CredentialLifetime/time.Second) {
		t.Fatalf("public cookie scope/lifetime = (%q, %d)", cookie.Path, cookie.MaxAge)
	}
	if !cookie.Expires.Equal(clock.Now().Add(pairing.CredentialLifetime)) {
		t.Fatalf("cookie expiry = %s, want %s", cookie.Expires, clock.Now().Add(pairing.CredentialLifetime))
	}
	credentialBytes, err := base64.RawURLEncoding.DecodeString(cookie.Value)
	if err != nil || len(credentialBytes) < pairing.CredentialBytes {
		t.Fatalf("credential decodes to %d bytes with error %v", len(credentialBytes), err)
	}
	if rec.Header().Get("Location") != "" {
		t.Fatalf("pair response Location = %q, want none", rec.Header().Get("Location"))
	}
	serialized, _ := json.Marshal(response)
	if bytes.Contains(serialized, []byte(code.Value)) || bytes.Contains(serialized, []byte(cookie.Value)) {
		t.Fatal("pair response body exposed a pairing code or device credential")
	}
	if strings.Contains(logs.String(), code.Value) || strings.Contains(logs.String(), cookie.Value) {
		t.Fatal("pairing code or device credential appeared in logs")
	}

	var storedHash []byte
	if err := s.db.QueryRow(`SELECT credential_hash FROM paired_devices`).Scan(&storedHash); err != nil {
		t.Fatalf("read stored credential hash: %v", err)
	}
	wantHash := sha256.Sum256([]byte(cookie.Value))
	if !bytes.Equal(storedHash, wantHash[:]) || bytes.Contains(storedHash, []byte(cookie.Value)) {
		t.Fatal("device credential was not persisted hash-only")
	}

	localCode := createPairingCode(t, handler)
	localCookie, _, _ := redeemPairingCode(t, handler, "http://127.0.0.1:31415/api/pair", localCode, "Local test browser")
	if localCookie.Secure {
		t.Fatal("loopback HTTP pairing cookie unexpectedly has Secure set")
	}
}

func TestMalformedAndBruteForcePairingAttemptsAreRateLimited(t *testing.T) {
	_, handler := newPairingRouteTestServer(t, "https://pi.example", newServerPairingClock())
	for i := 0; i < 5; i++ {
		rec := pairingRequest(handler, http.MethodPost, "https://pi.example/api/pair", "{", "https://pi.example")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("malformed attempt %d status = %d, want 400", i+1, rec.Code)
		}
	}
	for i := 0; i < 5; i++ {
		rec := pairingRequest(handler, http.MethodPost, "https://pi.example/api/pair", `{"code":"AAAAAAAA","label":"Phone"}`, "https://pi.example")
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("brute-force attempt %d status = %d, want 401", i+1, rec.Code)
		}
	}
	limited := pairingRequest(handler, http.MethodPost, "https://pi.example/api/pair", `{"code":"BBBBBBBB","label":"Phone"}`, "https://pi.example")
	if limited.Code != http.StatusTooManyRequests || limited.Header().Get("Retry-After") != "60" {
		t.Fatalf("rate-limited attempt = (%d, Retry-After %q), want (429, 60)", limited.Code, limited.Header().Get("Retry-After"))
	}
}

func TestPairingCodeExpiryAndReuseThroughAPI(t *testing.T) {
	t.Run("expiry", func(t *testing.T) {
		clock := newServerPairingClock()
		_, handler := newPairingRouteTestServer(t, "https://pi.example", clock)
		code := createPairingCode(t, handler)
		clock.Advance(pairing.CodeLifetime)
		body, _ := json.Marshal(map[string]string{"code": code.Value, "label": "Phone"})
		rec := pairingRequest(handler, http.MethodPost, "https://pi.example/api/pair", string(body), "https://pi.example")
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expired code status = %d, want 401", rec.Code)
		}
	})

	t.Run("reuse", func(t *testing.T) {
		_, handler := newPairingRouteTestServer(t, "https://pi.example", newServerPairingClock())
		code := createPairingCode(t, handler)
		redeemPairingCode(t, handler, "https://pi.example/api/pair", code, "Phone")
		body, _ := json.Marshal(map[string]string{"code": code.Value, "label": "Second phone"})
		rec := pairingRequest(handler, http.MethodPost, "https://pi.example/api/pair", string(body), "https://pi.example")
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("reused code status = %d, want 401", rec.Code)
		}
	})
}

func TestDeviceRevocationTakesEffectOnNextRequest(t *testing.T) {
	_, handler := newPairingRouteTestServer(t, "https://pi.example", newServerPairingClock())
	code := createPairingCode(t, handler)
	cookie, response, _ := redeemPairingCode(t, handler, "https://pi.example/api/pair", code, "Phone")
	device := response["device"].(map[string]any)
	deviceID := device["id"].(string)

	before := pairingRequest(handler, http.MethodGet, "https://pi.example/api/sessions", "", "", cookie)
	if before.Code != http.StatusOK {
		t.Fatalf("paired protected request status = %d, want 200", before.Code)
	}
	devices := pairingRequest(handler, http.MethodGet, "http://127.0.0.1:31415/api/devices", "", "")
	if devices.Code != http.StatusOK || !strings.Contains(devices.Body.String(), "Phone") {
		t.Fatalf("local device list = (%d, %s)", devices.Code, devices.Body.String())
	}
	revoke := pairingRequest(handler, http.MethodDelete, "http://127.0.0.1:31415/api/devices/"+deviceID, "", "")
	if revoke.Code != http.StatusNoContent {
		t.Fatalf("revoke status = %d, want 204", revoke.Code)
	}
	after := pairingRequest(handler, http.MethodGet, "https://pi.example/api/sessions", "", "", cookie)
	if after.Code != http.StatusUnauthorized {
		t.Fatalf("revoked protected request status = %d, want 401", after.Code)
	}
	status := pairingRequest(handler, http.MethodGet, "https://pi.example/api/pairing-status", "", "", cookie)
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"paired":false`) {
		t.Fatalf("revoked pairing status = (%d, %s), want paired=false", status.Code, status.Body.String())
	}
	cleared := false
	for _, setCookie := range status.Result().Cookies() {
		if setCookie.Name == deviceCredentialCookieName && setCookie.MaxAge < 0 {
			cleared = true
		}
	}
	if !cleared {
		t.Fatal("revoked credential cookie was not cleared")
	}
}

func TestPairingAdministrationIsLoopbackOnlyAndDevelopmentStaysOpen(t *testing.T) {
	_, publicHandler := newPairingRouteTestServer(t, "https://pi.example", newServerPairingClock())
	code := createPairingCode(t, publicHandler)
	cookie, _, _ := redeemPairingCode(t, publicHandler, "https://pi.example/api/pair", code, "Phone")
	publicCreate := pairingRequest(publicHandler, http.MethodPost, "https://pi.example/api/pairing-codes", "", "https://pi.example", cookie)
	if publicCreate.Code != http.StatusForbidden {
		t.Fatalf("public pairing-code creation status = %d, want 403", publicCreate.Code)
	}
	publicDevices := pairingRequest(publicHandler, http.MethodGet, "https://pi.example/api/devices", "", "", cookie)
	if publicDevices.Code != http.StatusForbidden {
		t.Fatalf("public device administration status = %d, want 403", publicDevices.Code)
	}

	_, localHandler := newPairingRouteTestServer(t, "", newServerPairingClock())
	localProtected := pairingRequest(localHandler, http.MethodGet, "http://127.0.0.1:31415/api/sessions", "", "")
	if localProtected.Code != http.StatusOK {
		t.Fatalf("local development protected API status = %d, want 200", localProtected.Code)
	}
	localStatus := pairingRequest(localHandler, http.MethodGet, "http://127.0.0.1:31415/api/pairing-status", "", "")
	if localStatus.Code != http.StatusOK || !strings.Contains(localStatus.Body.String(), `"local":true`) {
		t.Fatalf("local pairing status = (%d, %s)", localStatus.Code, localStatus.Body.String())
	}
}
