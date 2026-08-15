package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"pi-web/internal/pairing"
)

func responseHasCookie(rec *httptest.ResponseRecorder, name string) bool {
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == name {
			return true
		}
	}
	return false
}

func requestWithToken(handler http.Handler, method, target, token string, cookie *http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, nil)
	req.Header.Set("X-Pi-Token", token)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestPublicBootstrapAssetsNeverRefreshDeviceCookie(t *testing.T) {
	_, handler := newPairingRouteTestServer(t, "https://pi.example", newServerPairingClock())
	code := createPairingCode(t, handler)
	cookie, _, _ := redeemPairingCode(t, handler, "https://pi.example/api/pair", code, "Phone")

	for _, path := range []string{
		"/pairing",
		"/manifest.webmanifest",
		"/sw.js",
		"/static/desktop/assets/app.js",
		"/static/mobile/assets/app.js",
	} {
		rec := pairingRequest(handler, http.MethodGet, "https://pi.example"+path, "", "", cookie)
		if responseHasCookie(rec, deviceCredentialCookieName) {
			t.Fatalf("public bootstrap asset %s set a device cookie", path)
		}
	}
}

func TestRejectedPublicRequestsDoNotRenewDeviceTrust(t *testing.T) {
	clock := newServerPairingClock()
	s, handler := newPairingRouteTestServerWithToken(t, "https://pi.example", "optional-token", clock)
	code := createPairingCode(t, handler)
	cookie, response, _ := redeemPairingCode(t, handler, "https://pi.example/api/pair", code, "Phone")
	device := response["device"].(map[string]any)
	deviceID := device["id"].(string)
	initialExpiry := clock.Now().Add(pairing.CredentialLifetime).Unix()

	clock.Advance(pairing.CredentialLifetime - 24*time.Hour)
	if rec := pairingRequest(handler, http.MethodGet, "https://pi.example/api/sessions", "", "", cookie); rec.Code != http.StatusUnauthorized || responseHasCookie(rec, deviceCredentialCookieName) {
		t.Fatalf("request without optional auth = status %d, device cookie %v; want 401 without device cookie", rec.Code, responseHasCookie(rec, deviceCredentialCookieName))
	}
	var expiresAfterAuth int64
	if err := s.db.QueryRow(`SELECT expires_at FROM paired_devices WHERE id = ?`, deviceID).Scan(&expiresAfterAuth); err != nil {
		t.Fatal(err)
	}
	if expiresAfterAuth != initialExpiry {
		t.Fatalf("missing-token request renewed expiry to %d, want unchanged %d", expiresAfterAuth, initialExpiry)
	}
	if rec := requestWithToken(handler, http.MethodPost, "https://pi.example/api/models", "optional-token", cookie); rec.Code != http.StatusMethodNotAllowed || responseHasCookie(rec, deviceCredentialCookieName) {
		t.Fatalf("unsupported method = status %d, device cookie %v; want 405 without device cookie", rec.Code, responseHasCookie(rec, deviceCredentialCookieName))
	}
	var expires int64
	if err := s.db.QueryRow(`SELECT expires_at FROM paired_devices WHERE id = ?`, deviceID).Scan(&expires); err != nil {
		t.Fatal(err)
	}
	if expires != initialExpiry {
		t.Fatalf("rejected requests renewed expiry to %d, want unchanged %d", expires, initialExpiry)
	}

	clock.Advance(2 * 24 * time.Hour)
	if rec := requestWithToken(handler, http.MethodGet, "https://pi.example/api/sessions", "optional-token", cookie); rec.Code != http.StatusUnauthorized {
		t.Fatalf("trust after rejected requests = %d, want expired 401", rec.Code)
	}
}

func TestPublicTransitionRemovesUnboundLocalPushSubscriptions(t *testing.T) {
	dir := t.TempDir()
	webDir := filepath.Join(dir, "pi-web")
	if err := os.MkdirAll(webDir, 0700); err != nil {
		t.Fatal(err)
	}
	data := map[string]pushSub{
		"https://push.example/local": {
			Endpoint: "https://push.example/local",
			Local:    true,
		},
		"https://push.example/paired": {
			Endpoint: "https://push.example/paired",
			DeviceID: "device-a",
		},
	}
	serialized, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(webDir, "push-subs.json"), serialized, 0600); err != nil {
		t.Fatal(err)
	}

	manager, err := NewPushManager(dir)
	if err != nil {
		t.Fatal(err)
	}
	manager.ConfigureDeviceBinding(nil, true)
	if len(manager.subs) != 1 || manager.subs["https://push.example/paired"].DeviceID != "device-a" {
		t.Fatalf("public subscriptions retained = %d, want only the device-bound subscription", len(manager.subs))
	}
	if _, ok := manager.subs["https://push.example/local"]; ok {
		t.Fatal("public transition retained an unbound local subscription")
	}
}

func TestRevokedSSERegistrationAndBufferedEventsAreRejected(t *testing.T) {
	clock := newServerPairingClock()
	s, handler := newPairingRouteTestServer(t, "https://pi.example", clock)
	code := createPairingCode(t, handler)
	_, response, _ := redeemPairingCode(t, handler, "https://pi.example/api/pair", code, "Phone")
	device := response["device"].(map[string]any)
	deviceID := device["id"].(string)

	if revoked, err := s.pairing.RevokeDevice(context.Background(), deviceID); err != nil || !revoked {
		t.Fatalf("revoke device = (%v, %v), want (true, nil)", revoked, err)
	}
	request := httptest.NewRequest(http.MethodGet, "https://pi.example/events?id=__all__", nil)
	identity := pairedDeviceIdentity{ID: deviceID, ExpiresAt: clock.Now().Add(pairing.CredentialLifetime)}
	request = request.WithContext(context.WithValue(request.Context(), pairedDeviceContextKey{}, identity))
	rec := httptest.NewRecorder()
	s.handleEvents(rec, request)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("revoked SSE registration status = %d, want 401", rec.Code)
	}

	client := &sseClient{ch: make(chan string, 2), deviceID: deviceID, queued: make(map[string]bool)}
	client.ch <- "private event"
	s.clientsMu.Lock()
	s.clients = append(s.clients, client)
	s.clientsMu.Unlock()
	s.closeDeviceClients(deviceID)
	if _, open := <-client.ch; open {
		t.Fatal("revocation left a buffered SSE event deliverable")
	}
}

func TestRenewalKeepsTrustWindowMonotonic(t *testing.T) {
	clock := newServerPairingClock()
	s, _ := newPairingRouteTestServer(t, "https://pi.example", clock)
	code, err := s.pairing.CreateCode(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	credential, device, err := s.pairing.Redeem(context.Background(), code.Value, "Phone")
	if err != nil {
		t.Fatal(err)
	}

	clock.Advance(2 * time.Hour)
	newerNow := clock.Now()
	if _, renewed, err := s.pairing.AuthenticateDevice(context.Background(), credential); err != nil || !renewed {
		t.Fatalf("newer renewal = (%v, %v), want (true, nil)", renewed, err)
	}
	newerExpires := newerNow.Add(pairing.CredentialLifetime)
	clock.Advance(-time.Hour)
	if _, renewed, err := s.pairing.RenewDevice(context.Background(), device.ID); err != nil || !renewed {
		t.Fatalf("older renewal = (%v, %v), want (true, nil)", renewed, err)
	}
	var lastUsed, expires int64
	if err := s.db.QueryRow(`SELECT last_used_at, expires_at FROM paired_devices WHERE id = ?`, device.ID).Scan(&lastUsed, &expires); err != nil {
		t.Fatal(err)
	}
	if expires != newerExpires.Unix() || lastUsed != newerNow.Unix() {
		t.Fatalf("renewal timestamps = (%d, %d), want latest (%d, %d)", lastUsed, expires, newerNow.Unix(), newerExpires.Unix())
	}
}
