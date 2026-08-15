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
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

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
	return newPairingRouteTestServerWithToken(t, publicURL, "", clock)
}

func newPairingRouteTestServerWithToken(t *testing.T, publicURL, token string, clock *serverPairingClock) (*Server, http.Handler) {
	t.Helper()
	return newPairingRouteTestServerInDir(t, t.TempDir(), publicURL, token, clock)
}

func newPairingRouteTestServerInDir(t *testing.T, dir, publicURL, token string, clock *serverPairingClock) (*Server, http.Handler) {
	t.Helper()
	authMiddleware := auth.New(token)
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
		RenderAppShell: func(w io.Writer, _ *http.Request, bootstrap string) error {
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
	mux.HandleFunc("/app-build.json", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		_, _ = io.WriteString(w, `{"build":"test-build"}`)
	})
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
	build := pairingRequest(handler, http.MethodGet, "https://pi.example/app-build.json", "", "")
	if build.Code != http.StatusOK || !strings.Contains(build.Body.String(), `"build":"test-build"`) {
		t.Fatalf("unpaired app build = (%d, %s), want public fingerprint", build.Code, build.Body.String())
	}
	pairingPage := pairingRequest(handler, http.MethodGet, "https://pi.example/pairing", "", "")
	if pairingPage.Code != http.StatusOK || pairingPage.Body.String() != "pairing shell" {
		t.Fatalf("pairing shell = (%d, %q), want public shell", pairingPage.Code, pairingPage.Body.String())
	}
	for _, path := range []string{"/static/desktop/assets/missing.js", "/static/mobile/assets/missing.js"} {
		asset := pairingRequest(handler, http.MethodGet, "https://pi.example"+path, "", "")
		if asset.Code != http.StatusNotFound {
			t.Fatalf("pairing asset %s status = %d, want inner 404 rather than device-gate 401", path, asset.Code)
		}
	}
	legacyAsset := pairingRequest(handler, http.MethodGet, "https://pi.example/static/assets/missing.js", "", "")
	if legacyAsset.Code != http.StatusFound || legacyAsset.Header().Get("Location") != "/pairing" {
		t.Fatalf("legacy static asset = (%d, %q), want device-gate redirect", legacyAsset.Code, legacyAsset.Header().Get("Location"))
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

func TestSoundsRequirePairingThenOptionalToken(t *testing.T) {
	s, handler := newPairingRouteTestServerWithToken(
		t,
		"https://pi.example",
		"extra-secret",
		newServerPairingClock(),
	)
	assetsDir := filepath.Join(s.agentDir, "pi-web", "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assetsDir, "tone.mp3"), []byte("sound"), 0644); err != nil {
		t.Fatal(err)
	}

	unpaired := pairingRequest(handler, http.MethodGet, "https://pi.example/sounds/tone.mp3", "", "")
	if unpaired.Code != http.StatusFound || unpaired.Header().Get("Location") != "/pairing" {
		t.Fatalf("unpaired sound = (%d, %q)", unpaired.Code, unpaired.Header().Get("Location"))
	}
	code := createPairingCode(t, handler)
	cookie, _, _ := redeemPairingCode(t, handler, "https://pi.example/api/pair", code, "Phone")
	pairedOnly := pairingRequest(handler, http.MethodGet, "https://pi.example/sounds/tone.mp3", "", "", cookie)
	if pairedOnly.Code != http.StatusUnauthorized {
		t.Fatalf("paired sound without optional token = %d, want 401", pairedOnly.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "https://pi.example/sounds/tone.mp3", nil)
	req.AddCookie(cookie)
	req.Header.Set("X-Pi-Token", "extra-secret")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "sound" {
		t.Fatalf("paired + token sound = (%d, %q), want sound", rec.Code, rec.Body.String())
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

func TestDeviceRevocationClosesOnlyThatDevicesSSEStreams(t *testing.T) {
	s, handler := newPairingRouteTestServer(t, "https://pi.example", newServerPairingClock())
	codeA := createPairingCode(t, handler)
	cookieA, responseA, _ := redeemPairingCode(t, handler, "https://pi.example/api/pair", codeA, "Phone A")
	codeB := createPairingCode(t, handler)
	cookieB, _, _ := redeemPairingCode(t, handler, "https://pi.example/api/pair", codeB, "Phone B")

	startStream := func(cookie *http.Cookie) (*syncRecorder, context.CancelFunc, <-chan struct{}) {
		req := httptest.NewRequest(http.MethodGet, "https://pi.example/events?id=__all__", nil)
		req.AddCookie(cookie)
		ctx, cancel := context.WithCancel(req.Context())
		req = req.WithContext(ctx)
		rec := newSyncRecorder()
		done := make(chan struct{})
		go func() {
			handler.ServeHTTP(rec, req)
			close(done)
		}()
		waitFor(t, rec, ":ok")
		return rec, cancel, done
	}

	_, cancelA, doneA := startStream(cookieA)
	recB, cancelB, doneB := startStream(cookieB)
	defer cancelA()
	defer cancelB()

	deviceA := responseA["device"].(map[string]any)
	revoke := pairingRequest(
		handler,
		http.MethodDelete,
		"http://127.0.0.1:31415/api/devices/"+deviceA["id"].(string),
		"",
		"",
	)
	if revoke.Code != http.StatusNoContent {
		t.Fatalf("revoke status = %d, want 204", revoke.Code)
	}
	select {
	case <-doneA:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("revoked device SSE stream did not close promptly")
	}
	select {
	case <-doneB:
		t.Fatal("revoking device A closed device B SSE stream")
	default:
	}

	s.broadcast(globalSessID, "new-session")
	waitFor(t, recB, "data: new-session")
	cancelB()
	<-doneB
}

func TestPublicPushSubscriptionsAreBoundToPairedDevices(t *testing.T) {
	clock := newServerPairingClock()
	s, handler := newPairingRouteTestServer(t, "https://pi.example", clock)
	codeA := createPairingCode(t, handler)
	cookieA, responseA, _ := redeemPairingCode(t, handler, "https://pi.example/api/pair", codeA, "Phone A")
	codeB := createPairingCode(t, handler)
	cookieB, _, _ := redeemPairingCode(t, handler, "https://pi.example/api/pair", codeB, "Phone B")

	var sent []string
	s.push.sendNotification = func(_ []byte, subscription *webpush.Subscription, _ *webpush.Options) (*http.Response, error) {
		sent = append(sent, subscription.Endpoint)
		return &http.Response{StatusCode: http.StatusCreated, Body: io.NopCloser(strings.NewReader(""))}, nil
	}
	subscribe := func(cookie *http.Cookie, endpoint string) {
		body := `{"endpoint":"` + endpoint + `","keys":{"p256dh":"key","auth":"auth"}}`
		rec := pairingRequest(
			handler,
			http.MethodPost,
			"https://pi.example/api/push/subscribe",
			body,
			"https://pi.example",
			cookie,
		)
		if rec.Code != http.StatusOK {
			t.Fatalf("subscribe %s = (%d, %s)", endpoint, rec.Code, rec.Body.String())
		}
	}
	subscribe(cookieA, "https://push.example/a")
	subscribe(cookieB, "https://push.example/b")

	s.push.NotifyDone("session.jsonl")
	sort.Strings(sent)
	if got, want := strings.Join(sent, ","), "https://push.example/a,https://push.example/b"; got != want {
		t.Fatalf("first push endpoints = %q, want %q", got, want)
	}

	deviceA := responseA["device"].(map[string]any)
	revoke := pairingRequest(
		handler,
		http.MethodDelete,
		"http://127.0.0.1:31415/api/devices/"+deviceA["id"].(string),
		"",
		"",
	)
	if revoke.Code != http.StatusNoContent {
		t.Fatalf("revoke status = %d, want 204", revoke.Code)
	}
	sent = nil
	s.push.NotifyDone("session.jsonl")
	if len(sent) != 1 || sent[0] != "https://push.example/b" {
		t.Fatalf("push endpoints after revoking A = %#v, want only B", sent)
	}

	clock.Advance(pairing.CredentialLifetime)
	sent = nil
	s.push.NotifyDone("session.jsonl")
	if len(sent) != 0 {
		t.Fatalf("expired device received pushes: %#v", sent)
	}
	s.push.mu.Lock()
	remaining := len(s.push.subs)
	s.push.mu.Unlock()
	if remaining != 0 {
		t.Fatalf("stored subscriptions after revocation/expiry = %d, want 0", remaining)
	}
}

func TestActiveDeviceCredentialRenewsThroughHTTP(t *testing.T) {
	clock := newServerPairingClock()
	_, handler := newPairingRouteTestServer(t, "https://pi.example", clock)
	code := createPairingCode(t, handler)
	cookie, _, _ := redeemPairingCode(t, handler, "https://pi.example/api/pair", code, "Phone")

	clock.Advance(pairing.CredentialLifetime - 24*time.Hour)
	renewed := pairingRequest(handler, http.MethodGet, "https://pi.example/api/sessions", "", "", cookie)
	if renewed.Code != http.StatusOK {
		t.Fatalf("active request near expiry status = %d, want 200", renewed.Code)
	}
	var refreshed *http.Cookie
	for _, setCookie := range renewed.Result().Cookies() {
		if setCookie.Name == deviceCredentialCookieName {
			refreshed = setCookie
			break
		}
	}
	if refreshed == nil {
		t.Fatal("active request did not refresh the device credential cookie")
	}
	if !refreshed.Expires.Equal(clock.Now().Add(pairing.CredentialLifetime)) {
		t.Fatalf("refreshed cookie expiry = %s, want %s", refreshed.Expires, clock.Now().Add(pairing.CredentialLifetime))
	}

	clock.Advance(2 * 24 * time.Hour)
	afterOriginalExpiry := pairingRequest(handler, http.MethodGet, "https://pi.example/api/sessions", "", "", refreshed)
	if afterOriginalExpiry.Code != http.StatusOK {
		t.Fatalf("active device after original expiry status = %d, body = %s, want 200", afterOriginalExpiry.Code, afterOriginalExpiry.Body.String())
	}
}

func TestPairingTrustAndDatabasePermissionsSurviveRestart(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("SQLite file permissions are not portable to Windows")
	}

	dir := t.TempDir()
	clock := newServerPairingClock()
	first, firstHandler := newPairingRouteTestServerInDir(t, dir, "https://pi.example", "", clock)
	dbPath := filepath.Join(dir, "pi-web.sqlite")
	if info, err := os.Stat(dbPath); err != nil {
		t.Fatalf("stat pairing database: %v", err)
	} else if info.Mode().Perm() != 0600 {
		t.Fatalf("initial pairing database permissions = %o, want 600", info.Mode().Perm())
	}
	keyPath := filepath.Join(dir, "pi-web", pairing.CodeKeyFilename)
	keyBefore, err := os.ReadFile(keyPath)
	if err != nil {
		t.Fatalf("read pairing key before restart: %v", err)
	}

	code := createPairingCode(t, firstHandler)
	cookie, _, _ := redeemPairingCode(t, firstHandler, "https://pi.example/api/pair", code, "Phone")
	first.Shutdown()
	if err := os.Chmod(dbPath, 0644); err != nil {
		t.Fatalf("make database mode regression: %v", err)
	}

	second, secondHandler := newPairingRouteTestServerInDir(t, dir, "https://pi.example", "", clock)
	keyAfter, err := os.ReadFile(keyPath)
	if err != nil {
		t.Fatalf("read pairing key after restart: %v", err)
	}
	if !bytes.Equal(keyBefore, keyAfter) {
		t.Fatal("pairing key changed across restart")
	}
	if info, err := os.Stat(dbPath); err != nil {
		t.Fatalf("stat pairing database after restart: %v", err)
	} else if info.Mode().Perm() != 0600 {
		t.Fatalf("pairing database permissions after restart = %o, want 600", info.Mode().Perm())
	}
	trusted := pairingRequest(secondHandler, http.MethodGet, "https://pi.example/api/sessions", "", "", cookie)
	if trusted.Code != http.StatusOK {
		t.Fatalf("paired request after restart status = %d, body = %s, want 200", trusted.Code, trusted.Body.String())
	}
	second.Shutdown()
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

func TestRegisteredSessionRoutesCopyDormantSourceSettings(t *testing.T) {
	s, handler := newPairingRouteTestServer(t, "", newServerPairingClock())
	sourcePath := writeSessionFile(t, s.sessionsDir, "--tmp--source--", "source.jsonl")
	f, err := os.OpenFile(sourcePath, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.WriteString(
		`{"type":"model_change","provider":"openai-codex-secondary","modelId":"gpt-5.6-sol"}` + "\n" +
			`{"type":"thinking_level_change","thinkingLevel":"high"}` + "\n",
	)
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		t.Fatal(err)
	}

	defaults := pairingRequest(
		handler,
		http.MethodGet,
		"http://127.0.0.1:31415/api/session-defaults?sourceSessionId=source.jsonl",
		"",
		"",
	)
	if defaults.Code != http.StatusOK ||
		!strings.Contains(defaults.Body.String(), `"modelProvider":"openai-codex-secondary"`) ||
		!strings.Contains(defaults.Body.String(), `"modelId":"gpt-5.6-sol"`) ||
		!strings.Contains(defaults.Body.String(), `"thinkingLevel":"high"`) {
		t.Fatalf("dormant source defaults = (%d, %s)", defaults.Code, defaults.Body.String())
	}

	projectPath := filepath.Join(s.sessionsDir, "copied-project")
	body := `{"path":` + jsonString(projectPath) + `,"sourceSessionId":"source.jsonl"}`
	created := pairingRequest(
		handler,
		http.MethodPost,
		"http://127.0.0.1:31415/api/new-session",
		body,
		"http://127.0.0.1:31415",
	)
	if created.Code != http.StatusOK {
		t.Fatalf("create from dormant source = (%d, %s)", created.Code, created.Body.String())
	}
	var result struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(s.sessionsDir, sessions.EncodeProjectName(projectPath), result.ID))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`"provider":"openai-codex-secondary"`,
		`"modelId":"gpt-5.6-sol"`,
		`"thinkingLevel":"high"`,
		`"implicit":true`,
	} {
		if !strings.Contains(string(data), want) {
			t.Fatalf("created session missing %s: %s", want, data)
		}
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
