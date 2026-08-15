package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"pi-web/internal/agentdir"
	"pi-web/internal/pairing"
)

// PushManager owns the VAPID key pair and the set of browser push
// subscriptions. Subscriptions are persisted as JSON on disk so they
// survive restarts; one file under ~/.pi/agent/web/.
type PushManager struct {
	mu               sync.Mutex
	publicKey        string
	privateKey       string
	subject          string
	storeDir         string
	subs             map[string]pushSub
	client           *http.Client
	pairing          *pairing.Store
	sendNotification func([]byte, *webpush.Subscription, *webpush.Options) (*http.Response, error)
}

type pushSub struct {
	Endpoint string `json:"endpoint"`
	DeviceID string `json:"deviceId,omitempty"`
	Local    bool   `json:"local,omitempty"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

type vapidFile struct {
	PublicKey  string `json:"publicKey"`
	PrivateKey string `json:"privateKey"`
}

// NewPushManager loads/creates VAPID keys and subscription store under
// <agentDir>/pi-web/. Returns a manager ready to register HTTP handlers.
func NewPushManager(agentDir string) (*PushManager, error) {
	dir := agentdir.WebDir(agentDir)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}

	// Migrate old push data from pre-pi-web directory layout.
	oldDir := filepath.Join(agentDir, "web")
	if info, err := os.Stat(oldDir); err == nil && info.IsDir() {
		for _, name := range []string{"vapid.json", "push-subs.json"} {
			oldPath := filepath.Join(oldDir, name)
			newPath := filepath.Join(dir, name)
			if _, err := os.Stat(oldPath); err == nil {
				if _, err := os.Stat(newPath); os.IsNotExist(err) {
					_ = os.Rename(oldPath, newPath)
				}
			}
		}
		_ = os.Remove(oldDir)
	}

	m := &PushManager{
		storeDir:         dir,
		subs:             make(map[string]pushSub),
		subject:          "mailto:pi-web@local",
		client:           &http.Client{Timeout: 10 * time.Second},
		sendNotification: webpush.SendNotification,
	}
	if err := m.loadOrCreateKeys(); err != nil {
		return nil, err
	}
	m.loadSubs()
	return m, nil
}

func (m *PushManager) loadOrCreateKeys() error {
	path := filepath.Join(m.storeDir, "vapid.json")
	data, err := os.ReadFile(path)
	if err == nil {
		var v vapidFile
		if json.Unmarshal(data, &v) == nil && v.PublicKey != "" && v.PrivateKey != "" {
			m.publicKey = v.PublicKey
			m.privateKey = v.PrivateKey
			return nil
		}
	}
	priv, pub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return fmt.Errorf("generate VAPID keys: %w", err)
	}
	m.publicKey = pub
	m.privateKey = priv
	out, _ := json.Marshal(vapidFile{PublicKey: pub, PrivateKey: priv})
	return os.WriteFile(path, out, 0600)
}

func (m *PushManager) subsPath() string {
	return filepath.Join(m.storeDir, "push-subs.json")
}

func (m *PushManager) loadSubs() {
	data, err := os.ReadFile(m.subsPath())
	if err != nil {
		return
	}
	var subs map[string]pushSub
	if json.Unmarshal(data, &subs) != nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.subs = make(map[string]pushSub, len(subs))
	for key, sub := range subs {
		if sub.Endpoint == "" {
			continue
		}
		if key == "" || key != sub.Endpoint {
			key = sub.Endpoint
		}
		m.subs[key] = sub
	}
}

func (m *PushManager) saveSubsLocked() {
	out, _ := json.MarshalIndent(m.subs, "", "  ")
	_ = os.WriteFile(m.subsPath(), out, 0600)
}

func (m *PushManager) PublicKey() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.publicKey
}

// ConfigureDeviceBinding installs the paired-device authorization source. Old
// subscription files had no device identity. On a public deployment those
// ambiguous entries are removed rather than risking a push after revocation;
// browsers safely re-post an existing PushSubscription on their next opt-in.
// A local-only deployment migrates them to explicit local subscriptions.
func (m *PushManager) ConfigureDeviceBinding(store *pairing.Store, public bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pairing = store
	changed := false
	for endpoint, sub := range m.subs {
		if sub.DeviceID != "" {
			continue
		}
		if public {
			changed = true
			delete(m.subs, endpoint)
			continue
		}
		if sub.Local {
			continue
		}
		changed = true
		sub.Local = true
		m.subs[endpoint] = sub
	}
	if changed {
		m.saveSubsLocked()
	}
}

// Register installs the /api/push/* handlers on mux behind auth.
func (m *PushManager) Register(mux *http.ServeMux, auth func(http.HandlerFunc) http.HandlerFunc) {
	mux.HandleFunc("/api/push/vapid", auth(m.handleVapid))
	mux.HandleFunc("/api/push/subscribe", auth(m.handleSubscribe))
	mux.HandleFunc("/api/push/unsubscribe", auth(m.handleUnsubscribe))
}

func (m *PushManager) handleVapid(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 0, map[string]any{"publicKey": m.PublicKey()})
}

func (m *PushManager) handleSubscribe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var sub pushSub
	if !decodeJSONBody(w, r, &sub) {
		return
	}
	if sub.Endpoint == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid subscription")
		return
	}
	if device, ok := pairedDeviceFromContext(r.Context()); ok {
		sub.DeviceID = device.ID
		sub.Local = false
	} else {
		sub.DeviceID = ""
		sub.Local = true
	}
	m.mu.Lock()
	m.subs[sub.Endpoint] = sub
	m.saveSubsLocked()
	m.mu.Unlock()
	writeJSON(w, 0, map[string]any{"ok": true})
}

func (m *PushManager) handleUnsubscribe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Endpoint string `json:"endpoint"`
	}
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if body.Endpoint == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid endpoint")
		return
	}
	m.mu.Lock()
	if device, ok := pairedDeviceFromContext(r.Context()); ok {
		if sub, exists := m.subs[body.Endpoint]; exists && sub.DeviceID == device.ID {
			delete(m.subs, body.Endpoint)
		}
	} else {
		delete(m.subs, body.Endpoint)
	}
	m.saveSubsLocked()
	m.mu.Unlock()
	writeJSON(w, 0, map[string]any{"ok": true})
}

func (m *PushManager) RemoveDevice(deviceID string) {
	if m == nil || deviceID == "" {
		return
	}
	m.mu.Lock()
	changed := false
	for endpoint, sub := range m.subs {
		if sub.DeviceID == deviceID {
			delete(m.subs, endpoint)
			changed = true
		}
	}
	if changed {
		m.saveSubsLocked()
	}
	m.mu.Unlock()
}

// NotifyDone sends a "response ready" push for a finished session.
func (m *PushManager) NotifyDone(sessionID string) {
	m.notify(map[string]string{
		"type":      "session-done",
		"sessionId": sessionID,
		"title":     "pi session",
		"body":      "Response ready",
	})
}

// NotifyScheduleDone sends a schedule-specific push when a scheduled run
// finishes. Unlike session-done, the service worker shows this even when the
// app is foregrounded, since a schedule firing is a background event the user
// may not be watching.
func (m *PushManager) NotifyScheduleDone(scheduleName, sessionID string) {
	title := scheduleName
	if strings.TrimSpace(title) == "" {
		title = "Scheduled run"
	}
	m.notify(map[string]string{
		"type":      "schedule-done",
		"sessionId": sessionID,
		"title":     title,
		"body":      "Scheduled run finished",
	})
}

// notify marshals payload and sends it to every registered subscription. Failed
// endpoints (gone / 410) are pruned. Best-effort: errors are logged to stderr.
func (m *PushManager) notify(payload map[string]string) {
	if m == nil {
		return
	}
	m.mu.Lock()
	if len(m.subs) == 0 {
		m.mu.Unlock()
		return
	}
	type keyedSub struct {
		key string
		sub pushSub
	}
	subs := make([]keyedSub, 0, len(m.subs))
	for key, sub := range m.subs {
		subs = append(subs, keyedSub{key: key, sub: sub})
	}
	pub := m.publicKey
	priv := m.privateKey
	subj := m.subject
	store := m.pairing
	sendNotification := m.sendNotification
	m.mu.Unlock()

	payloadBytes, _ := json.Marshal(payload)

	var stale []string
	for _, item := range subs {
		s := item.sub
		if s.DeviceID != "" {
			active := false
			var err error
			if store != nil {
				active, err = store.IsDeviceActive(context.Background(), s.DeviceID)
			}
			if err != nil {
				fmt.Fprintf(os.Stderr, "push device authorization failed: %v\n", err)
				continue
			}
			if !active {
				stale = append(stale, item.key)
				continue
			}
		} else if !s.Local {
			stale = append(stale, item.key)
			continue
		}
		ws := &webpush.Subscription{
			Endpoint: s.Endpoint,
			Keys:     webpush.Keys{P256dh: s.Keys.P256dh, Auth: s.Keys.Auth},
		}
		resp, err := sendNotification(payloadBytes, ws, &webpush.Options{
			HTTPClient:      m.client,
			Subscriber:      subj,
			VAPIDPublicKey:  pub,
			VAPIDPrivateKey: priv,
			TTL:             60,
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "push send failed: %v\n", err)
			continue
		}
		if resp != nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
				stale = append(stale, item.key)
			}
		}
	}
	if len(stale) > 0 {
		m.mu.Lock()
		for _, e := range stale {
			delete(m.subs, e)
		}
		m.saveSubsLocked()
		m.mu.Unlock()
	}
}
