package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"
)

func TestNewPushManager_CreatesDirUnderAgentPath(t *testing.T) {
	tmp := t.TempDir()
	pm, err := NewPushManager(tmp)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(tmp, "pi-web")
	if pm.storeDir != want {
		t.Fatalf("storeDir = %s, want %s", pm.storeDir, want)
	}
	if _, err := os.Stat(pm.storeDir); err != nil {
		t.Fatalf("dir not created: %v", err)
	}
}

func TestNewPushManager_PersistsVapidKeys(t *testing.T) {
	tmp := t.TempDir()
	pm1, err := NewPushManager(tmp)
	if err != nil {
		t.Fatal(err)
	}
	pub1 := pm1.PublicKey()
	if pub1 == "" {
		t.Fatal("expected non-empty public key")
	}

	// Second instance should load existing keys
	pm2, err := NewPushManager(tmp)
	if err != nil {
		t.Fatal(err)
	}
	if pm2.PublicKey() != pub1 {
		t.Fatal("expected same public key after reload")
	}
}

func TestPushManagerPreservesLocalSubscriptions(t *testing.T) {
	pm, err := NewPushManager(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	pm.ConfigureDeviceBinding(nil, false)
	body := `{"endpoint":"https://push.example/local","keys":{"p256dh":"key","auth":"auth"}}`
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/push/subscribe", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	pm.handleSubscribe(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("subscribe = (%d, %s)", rec.Code, rec.Body.String())
	}

	var sent []string
	pm.sendNotification = func(_ []byte, subscription *webpush.Subscription, _ *webpush.Options) (*http.Response, error) {
		sent = append(sent, subscription.Endpoint)
		return &http.Response{StatusCode: http.StatusCreated, Body: io.NopCloser(strings.NewReader(""))}, nil
	}
	pm.NotifyDone("session.jsonl")
	if len(sent) != 1 || sent[0] != "https://push.example/local" {
		t.Fatalf("local push endpoints = %#v", sent)
	}
}

func TestPushManagerMigratesLegacyUnboundSubscriptionsSafely(t *testing.T) {
	for _, tt := range []struct {
		name      string
		public    bool
		wantCount int
		wantLocal bool
	}{
		{name: "local-only becomes explicit local", wantCount: 1, wantLocal: true},
		{name: "public deployment removes ambiguous binding", public: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			webDir := filepath.Join(dir, "pi-web")
			if err := os.MkdirAll(webDir, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(
				filepath.Join(webDir, "push-subs.json"),
				[]byte(`{"legacy":{"endpoint":"https://push.example/legacy","keys":{"p256dh":"p","auth":"a"}}}`),
				0600,
			); err != nil {
				t.Fatal(err)
			}
			pm, err := NewPushManager(dir)
			if err != nil {
				t.Fatal(err)
			}
			pm.ConfigureDeviceBinding(nil, tt.public)
			if len(pm.subs) != tt.wantCount {
				t.Fatalf("subscriptions = %d, want %d", len(pm.subs), tt.wantCount)
			}
			if tt.wantCount == 1 && pm.subs["https://push.example/legacy"].Local != tt.wantLocal {
				t.Fatalf("legacy subscription Local = %v, want %v", pm.subs["https://push.example/legacy"].Local, tt.wantLocal)
			}
		})
	}
}

func TestNewPushManager_MigratesOldWebDir(t *testing.T) {
	tmp := t.TempDir()
	oldDir := filepath.Join(tmp, "web")
	newDir := filepath.Join(tmp, "pi-web")

	if err := os.MkdirAll(oldDir, 0700); err != nil {
		t.Fatal(err)
	}
	// Write old VAPID keys
	oldVapid := []byte(`{"publicKey":"pub","privateKey":"priv"}`)
	if err := os.WriteFile(filepath.Join(oldDir, "vapid.json"), oldVapid, 0600); err != nil {
		t.Fatal(err)
	}
	// Write old subscriptions
	oldSubs := []byte(`{"sub1":{"endpoint":"e","keys":{"p256dh":"p","auth":"a"}}}`)
	if err := os.WriteFile(filepath.Join(oldDir, "push-subs.json"), oldSubs, 0600); err != nil {
		t.Fatal(err)
	}

	pm, err := NewPushManager(tmp)
	if err != nil {
		t.Fatal(err)
	}
	if pm.storeDir != newDir {
		t.Fatalf("storeDir = %s, want %s", pm.storeDir, newDir)
	}
	if _, err := os.Stat(oldDir); !os.IsNotExist(err) {
		t.Fatal("old web dir should have been removed")
	}
	if pm.PublicKey() != "pub" {
		t.Fatalf("expected migrated public key pub, got %s", pm.PublicKey())
	}
}
