package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"pi-web/internal/auth"
	"pi-web/internal/hub"
	"pi-web/internal/sessions"
)

func newHubRouteTestServer(t *testing.T) http.Handler {
	t.Helper()
	authMiddleware := auth.New("")
	authMiddleware.AllowHost("127.0.0.1:31415")
	authMiddleware.AllowHost("https://pi.example")
	authMiddleware.UseSecureCookiesForHost("https://pi.example")
	authMiddleware.AllowAnyHost()
	srv, err := New(Deps{
		AgentDir:              t.TempDir(),
		SessionsDir:           t.TempDir(),
		Auth:                  authMiddleware,
		PublicURL:             "https://pi.example",
		Cache:                 sessions.NewCache(),
		HubEnabled:            true,
		DisableBackgroundJobs: true,
		Models: func(context.Context) (json.RawMessage, error) {
			return json.RawMessage(`{"models":[]}`), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(srv.Shutdown)
	mux := http.NewServeMux()
	srv.Register(mux)
	return srv.HTTPHandler(mux)
}

func hubJSONRequest(t *testing.T, handler http.Handler, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var encoded bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&encoded).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, target, &encoded)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if req.URL.Scheme == "https" {
		req.Header.Set("Origin", "https://pi.example")
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func enrollHubNode(t *testing.T, handler http.Handler, id, label string) string {
	t.Helper()
	created := hubJSONRequest(t, handler, http.MethodPost,
		"http://127.0.0.1:31415/api/hub/enrollments",
		map[string]string{"id": id, "label": label})
	if created.Code != http.StatusOK {
		t.Fatalf("create enrollment status = %d, body = %s", created.Code, created.Body.String())
	}
	var invitation struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &invitation); err != nil {
		t.Fatal(err)
	}
	redeemed := hubJSONRequest(t, handler, http.MethodPost,
		"https://pi.example/api/hub/enroll", map[string]string{"code": invitation.Code})
	if redeemed.Code != http.StatusOK {
		t.Fatalf("redeem enrollment status = %d, body = %s", redeemed.Code, redeemed.Body.String())
	}
	var node struct {
		Credential string `json:"credential"`
	}
	if err := json.Unmarshal(redeemed.Body.Bytes(), &node); err != nil {
		t.Fatal(err)
	}
	return node.Credential
}

func TestHubRelayRequiresPairedBrowser(t *testing.T) {
	handler := newHubRouteTestServer(t)

	rec := hubJSONRequest(t, handler, http.MethodGet,
		"https://pi.example/_host/work/api/sessions", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unpaired relay status = %d, want 401", rec.Code)
	}
}

func TestHubNodeListingRemainsLoopbackOnly(t *testing.T) {
	handler := newHubRouteTestServer(t)
	code := createPairingCode(t, handler)
	cookie, _, _ := redeemPairingCode(t, handler, "https://pi.example/api/pair", code, "iPhone")

	rec := pairingRequest(handler, http.MethodGet, "https://pi.example/api/hub/nodes", "", "", cookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("public hub node listing status = %d, want 403", rec.Code)
	}
}

func TestHubNodeConnectsWithEnrolledCredential(t *testing.T) {
	handler := newHubRouteTestServer(t)
	credential := enrollHubNode(t, handler, "work", "Work")
	httpServer := httptest.NewServer(handler)
	t.Cleanup(httpServer.Close)
	requestHeader := http.Header{"Authorization": {"Bearer " + credential}}
	connection, _, err := websocket.Dial(t.Context(),
		"ws"+strings.TrimPrefix(httpServer.URL, "http")+"/api/hub/connect", &websocket.DialOptions{HTTPHeader: requestHeader})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close(websocket.StatusNormalClosure, "test complete") })

	deadline := time.Now().Add(time.Second)
	for {
		nodes := hubJSONRequest(t, handler, http.MethodGet,
			"http://127.0.0.1:31415/api/hub/nodes", nil)
		if nodes.Code != http.StatusOK {
			t.Fatalf("list nodes status = %d, body = %s", nodes.Code, nodes.Body.String())
		}
		if strings.Contains(nodes.Body.String(), `"id":"work"`) && strings.Contains(nodes.Body.String(), `"online":true`) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("node did not become online: %s", nodes.Body.String())
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestHubNodeRevocationClosesConnectionAndRejectsCredential(t *testing.T) {
	handler := newHubRouteTestServer(t)
	credential := enrollHubNode(t, handler, "work", "Work")
	httpServer := httptest.NewServer(handler)
	t.Cleanup(httpServer.Close)
	connectURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/api/hub/connect"
	header := http.Header{"Authorization": {"Bearer " + credential}}
	connection, _, err := websocket.Dial(t.Context(), connectURL,
		&websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		t.Fatal(err)
	}

	revoked := hubJSONRequest(t, handler, http.MethodDelete,
		"http://127.0.0.1:31415/api/hub/nodes/work", nil)
	if revoked.Code != http.StatusNoContent {
		t.Fatalf("revoke node status = %d, body = %s", revoked.Code, revoked.Body.String())
	}
	readContext, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	if _, _, err := connection.Read(readContext); err == nil {
		t.Fatal("revoked node connection remained open")
	}
	_ = connection.CloseNow()

	if next, response, err := websocket.Dial(t.Context(), connectURL,
		&websocket.DialOptions{HTTPHeader: header}); err == nil {
		next.CloseNow()
		t.Fatal("revoked node credential reconnected")
	} else if response == nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked reconnect response = %#v, err = %v", response, err)
	}
}

func TestHubRelaysNodeAPIResponseThroughSameOriginRoute(t *testing.T) {
	handler := newHubRouteTestServer(t)
	credential := enrollHubNode(t, handler, "work", "Work")
	httpServer := httptest.NewServer(handler)
	t.Cleanup(httpServer.Close)
	connection, _, err := websocket.Dial(t.Context(),
		"ws"+strings.TrimPrefix(httpServer.URL, "http")+"/api/hub/connect",
		&websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + credential}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close(websocket.StatusNormalClosure, "test complete") })

	nodeDone := make(chan error, 1)
	go func() {
		for {
			_, data, readErr := connection.Read(t.Context())
			if readErr != nil {
				nodeDone <- readErr
				return
			}
			var message hub.WireMessage
			if err := json.Unmarshal(data, &message); err != nil {
				nodeDone <- err
				return
			}
			if message.Type == hub.MessageRequestStart {
				if message.Method != http.MethodGet || message.Path != "/api/sessions" {
					nodeDone <- errors.New("unexpected relayed request")
					return
				}
				for _, response := range []hub.WireMessage{
					{Version: hub.ProtocolVersion, Type: hub.MessageResponseStart, RequestID: message.RequestID, Status: http.StatusOK, Header: http.Header{"Content-Type": {"application/json"}}},
					{Version: hub.ProtocolVersion, Type: hub.MessageResponseChunk, RequestID: message.RequestID, Data: []byte(`{"sessions":[{"id":"remote.jsonl"}],"total":1}`)},
					{Version: hub.ProtocolVersion, Type: hub.MessageResponseEnd, RequestID: message.RequestID},
				} {
					encoded, _ := json.Marshal(response)
					if err := connection.Write(t.Context(), websocket.MessageText, encoded); err != nil {
						nodeDone <- err
						return
					}
				}
				nodeDone <- nil
				return
			}
		}
	}()

	response := hubJSONRequest(t, handler, http.MethodGet,
		"http://127.0.0.1:31415/_host/work/api/sessions", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("relayed response status = %d, body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "remote.jsonl") {
		t.Fatalf("relayed response body = %s", response.Body.String())
	}
	if err := <-nodeDone; err != nil {
		t.Fatal(err)
	}
}

func TestHubConnectorServesItsLocalPiWebHandler(t *testing.T) {
	handler := newHubRouteTestServer(t)
	credential := enrollHubNode(t, handler, "work", "Work")
	httpServer := httptest.NewServer(handler)
	t.Cleanup(httpServer.Close)
	connector := hub.Connector{
		HubURL:     httpServer.URL,
		Credential: credential,
		LocalHost:  "127.0.0.1:31415",
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/api/sessions" {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"sessions":[{"id":"work-live.jsonl"}],"total":1}`))
		}),
	}
	connectorError := make(chan error, 1)
	go func() { connectorError <- connector.Run(t.Context()) }()

	deadline := time.Now().Add(2 * time.Second)
	for {
		response := hubJSONRequest(t, handler, http.MethodGet,
			"http://127.0.0.1:31415/_host/work/api/sessions", nil)
		if response.Code == http.StatusOK {
			if !strings.Contains(response.Body.String(), "work-live.jsonl") {
				t.Fatalf("connector response body = %s", response.Body.String())
			}
			break
		}
		if time.Now().After(deadline) {
			select {
			case err := <-connectorError:
				t.Fatalf("connector stopped: %v", err)
			default:
				t.Fatalf("connector did not come online: %d %s", response.Code, response.Body.String())
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestHubConnectorUnreadBodyDoesNotBlockOtherRequests(t *testing.T) {
	handler := newHubRouteTestServer(t)
	credential := enrollHubNode(t, handler, "work-body", "Work body")
	httpServer := httptest.NewServer(handler)
	t.Cleanup(httpServer.Close)
	streamStarted := make(chan struct{})
	connector := hub.Connector{
		HubURL:     httpServer.URL,
		Credential: credential,
		LocalHost:  "127.0.0.1:31415",
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/events":
				w.Header().Set("Content-Type", "text/event-stream")
				w.WriteHeader(http.StatusOK)
				if flusher, ok := w.(http.Flusher); ok {
					flusher.Flush()
				}
				close(streamStarted)
				<-r.Context().Done()
			case "/api/sessions":
				_, _ = w.Write([]byte(`{"sessions":[],"total":0}`))
			default:
				http.NotFound(w, r)
			}
		}),
	}
	connectorError := make(chan error, 1)
	go func() { connectorError <- connector.Run(t.Context()) }()
	deadline := time.Now().Add(2 * time.Second)
	for {
		nodes := hubJSONRequest(t, handler, http.MethodGet,
			"http://127.0.0.1:31415/api/hub/nodes", nil)
		if nodes.Code == http.StatusOK && strings.Contains(nodes.Body.String(), `"id":"work-body"`) && strings.Contains(nodes.Body.String(), `"online":true`) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("connector did not become online: %s", nodes.Body.String())
		}
		time.Sleep(10 * time.Millisecond)
	}

	streamContext, cancelStream := context.WithCancel(t.Context())
	defer cancelStream()
	streamRequest, err := http.NewRequestWithContext(streamContext, http.MethodGet,
		httpServer.URL+"/_host/work-body/events", strings.NewReader(strings.Repeat("x", 1<<20)))
	if err != nil {
		t.Fatal(err)
	}
	streamResult := make(chan error, 1)
	go func() {
		response, requestErr := http.DefaultClient.Do(streamRequest)
		if response != nil {
			_ = response.Body.Close()
		}
		streamResult <- requestErr
	}()
	select {
	case <-streamStarted:
	case err := <-connectorError:
		t.Fatalf("connector stopped: %v", err)
	case <-time.After(2 * time.Second):
		t.Fatal("local stream did not start")
	}

	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get(httpServer.URL + "/_host/work-body/api/sessions")
	if err != nil {
		t.Fatalf("second relay was blocked by unread request body: %v", err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("second relay status = %d, want 200", response.StatusCode)
	}
	select {
	case <-streamResult:
	case <-time.After(2 * time.Second):
		t.Fatal("overflowed unread-body request did not receive a terminal response")
	}
}

func TestHubStreamsRemoteEventsBeforeTheNodeResponseEnds(t *testing.T) {
	handler := newHubRouteTestServer(t)
	credential := enrollHubNode(t, handler, "personal", "Personal")
	httpServer := httptest.NewServer(handler)
	t.Cleanup(httpServer.Close)
	connection, _, err := websocket.Dial(t.Context(),
		"ws"+strings.TrimPrefix(httpServer.URL, "http")+"/api/hub/connect",
		&websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + credential}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close(websocket.StatusNormalClosure, "test complete") })

	releaseStream := make(chan struct{})
	go func() {
		for {
			_, data, readErr := connection.Read(t.Context())
			if readErr != nil {
				return
			}
			var message hub.WireMessage
			if json.Unmarshal(data, &message) != nil || message.Type != hub.MessageRequestStart {
				continue
			}
			start, _ := json.Marshal(hub.WireMessage{
				Version: hub.ProtocolVersion, Type: hub.MessageResponseStart,
				RequestID: message.RequestID, Status: http.StatusOK,
				Header: http.Header{"Content-Type": {"text/event-stream"}},
			})
			chunk, _ := json.Marshal(hub.WireMessage{
				Version: hub.ProtocolVersion, Type: hub.MessageResponseChunk,
				RequestID: message.RequestID, Data: []byte("event: status-delta\ndata: {\"running\":true}\n\n"),
			})
			_ = connection.Write(t.Context(), websocket.MessageText, start)
			_ = connection.Write(t.Context(), websocket.MessageText, chunk)
			<-releaseStream
			end, _ := json.Marshal(hub.WireMessage{
				Version: hub.ProtocolVersion, Type: hub.MessageResponseEnd, RequestID: message.RequestID,
			})
			_ = connection.Write(t.Context(), websocket.MessageText, end)
			return
		}
	}()

	request, _ := http.NewRequestWithContext(t.Context(), http.MethodGet,
		httpServer.URL+"/_host/personal/events?topic=__all__", nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	line, err := bufio.NewReader(response.Body).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if line != "event: status-delta\n" {
		t.Fatalf("first streamed line = %q", line)
	}
	close(releaseStream)
}

func TestHubResponseHeadersStripRedirectsAndHopByHopFields(t *testing.T) {
	source := http.Header{
		"Content-Type":       {"application/json"},
		"Connection":         {"keep-alive, X-Private-Hop"},
		"connection":         {"Content-Encoding"},
		"X-Private-Hop":      {"secret"},
		"Content-Encoding":   {"gzip"},
		"Proxy-Connection":   {"keep-alive"},
		"Refresh":            {"0; url=https://attacker.example"},
		"Set-Cookie":         {"stolen=true"},
		"Location":           {"https://attacker.example"},
		"Transfer-Encoding":  {"chunked"},
		"X-Safe-Node-Header": {"present"},
	}
	target := make(http.Header)
	copyHubResponseHeaders(target, source)

	if target.Get("Content-Type") != "application/json" || target.Get("X-Safe-Node-Header") != "present" {
		t.Fatalf("safe headers were not copied: %#v", target)
	}
	for _, blocked := range []string{"Connection", "X-Private-Hop", "Content-Encoding", "Proxy-Connection", "Refresh", "Set-Cookie", "Location", "Transfer-Encoding"} {
		if got := target.Get(blocked); got != "" {
			t.Fatalf("blocked response header %s = %q", blocked, got)
		}
	}
}

func TestHubEnrollmentRateLimitsPublicCodeAttempts(t *testing.T) {
	handler := newHubRouteTestServer(t)
	for attempt := 1; attempt <= 11; attempt++ {
		response := hubJSONRequest(t, handler, http.MethodPost,
			"https://pi.example/api/hub/enroll", map[string]string{"code": "ZZZZZZZZ"})
		if attempt <= 10 && response.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d status = %d, want 401", attempt, response.Code)
		}
		if attempt == 11 {
			if response.Code != http.StatusTooManyRequests {
				t.Fatalf("rate-limited status = %d, body = %s", response.Code, response.Body.String())
			}
			if response.Header().Get("Retry-After") != "60" {
				t.Fatalf("Retry-After = %q, want 60", response.Header().Get("Retry-After"))
			}
		}
	}
}

func TestHubEnrollmentIssuesAndRedeemsOneTimeNodeCredential(t *testing.T) {
	handler := newHubRouteTestServer(t)
	created := hubJSONRequest(t, handler, http.MethodPost,
		"http://127.0.0.1:31415/api/hub/enrollments",
		map[string]string{"id": "work", "label": "Work"})
	if created.Code != http.StatusOK {
		t.Fatalf("create enrollment status = %d, body = %s", created.Code, created.Body.String())
	}
	var invitation struct {
		Code      string `json:"code"`
		ExpiresAt string `json:"expiresAt"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &invitation); err != nil {
		t.Fatal(err)
	}
	if len(invitation.Code) != 8 || invitation.ExpiresAt == "" {
		t.Fatalf("invalid invitation response: %+v", invitation)
	}

	redeemed := hubJSONRequest(t, handler, http.MethodPost,
		"https://pi.example/api/hub/enroll",
		map[string]string{"code": invitation.Code})
	if redeemed.Code != http.StatusOK {
		t.Fatalf("redeem enrollment status = %d, body = %s", redeemed.Code, redeemed.Body.String())
	}
	var node struct {
		ID         string `json:"id"`
		Label      string `json:"label"`
		Credential string `json:"credential"`
	}
	if err := json.Unmarshal(redeemed.Body.Bytes(), &node); err != nil {
		t.Fatal(err)
	}
	if node.ID != "work" || node.Label != "Work" || len(node.Credential) < 40 {
		t.Fatalf("invalid enrolled node: %+v", node)
	}
}
