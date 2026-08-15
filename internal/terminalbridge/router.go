package terminalbridge

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"pi-web/internal/chat"
	"pi-web/internal/sessions"
	"pi-web/internal/workers"
)

var ErrDeliveryUnknown = errors.New("terminal prompt delivery could not be confirmed")
var ErrTerminalReconnecting = errors.New("terminal session is reconnecting; RPC fallback is quarantined")

const ownerHeartbeatTTL = 10 * time.Second

type Fallback interface {
	Send(context.Context, string, string, chat.Request) error
	SetModel(context.Context, string, string, string, string) error
	SetThinkingLevel(context.Context, string, string, string) error
	Abort(context.Context, string) error
	GetState(context.Context, string) (workers.WorkerStatus, error)
	GetCommands(context.Context, string) ([]workers.SlashCommand, bool, error)
	Status(string) workers.WorkerStatus
	EnsureWorker(context.Context, string, string) error
	Release(context.Context, string) error
}

type Router struct {
	sessionsDir string
	token       string
	authority   string
	ownerDir    string
	fallback    Fallback

	mu          sync.RWMutex
	connections map[string]*connection
	closed      bool
	gates       sync.Map
	sequence    atomic.Uint64
	requestBase string
}

type connection struct {
	socket *websocket.Conn

	writeMu sync.Mutex
	mu      sync.Mutex
	pending map[string]chan clientMessage
	status  workers.WorkerStatus
	done    chan struct{}
	once    sync.Once
}

func NewRouter(sessionsDir, token string, fallback Fallback) *Router {
	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		random = []byte(fmt.Sprintf("%d", time.Now().UnixNano()))
	}
	return &Router{
		sessionsDir: sessionsDir,
		token:       token,
		fallback:    fallback,
		connections: make(map[string]*connection),
		requestBase: hex.EncodeToString(random),
	}
}

func (r *Router) sessionGate(sessionID string) *sync.Mutex {
	gate, _ := r.gates.LoadOrStore(sessionID, &sync.Mutex{})
	return gate.(*sync.Mutex)
}

func (r *Router) ServeHTTP(w http.ResponseWriter, request *http.Request) {
	if request.URL.Path != "/api/terminal/connect" || request.URL.RawQuery != "" {
		http.NotFound(w, request)
		return
	}
	if request.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !loopbackHost(request.Host) || !loopbackRemote(request.RemoteAddr) || (r.authority != "" && request.Host != r.authority) {
		http.Error(w, "terminal bridge is local only", http.StatusForbidden)
		return
	}
	// Browser WebSocket clients always attach Origin and JavaScript cannot remove it.
	// Node's standards-compliant WebSocket also sends Sec-Fetch-Mode: websocket, so
	// fetch metadata alone is not evidence of a browser origin.
	if request.Header.Get("Origin") != "" {
		http.Error(w, "browser websocket clients are not allowed", http.StatusForbidden)
		return
	}
	if !sameSecret(websocketToken(request.Header), r.token) {
		http.Error(w, "terminal bridge authentication required", http.StatusUnauthorized)
		return
	}

	socket, err := websocket.Accept(w, request, &websocket.AcceptOptions{
		CompressionMode: websocket.CompressionDisabled,
		Subprotocols:    []string{"pi-web-terminal-v1"},
	})
	if err != nil {
		return
	}
	// Client-to-server frames contain only hello, state, and bounded responses.
	// Prompt/image bodies flow server-to-terminal and use the larger limits below.
	socket.SetReadLimit(1 << 20)
	ctx, cancel := context.WithTimeout(request.Context(), 5*time.Second)
	var hello clientMessage
	err = wsjson.Read(ctx, socket, &hello)
	cancel()
	if err != nil {
		_ = socket.Close(websocket.StatusPolicyViolation, "terminal hello required")
		return
	}
	if hello.Type != "hello" || hello.Version != protocolVersion || hello.SessionID == "" {
		_ = socket.Close(websocket.StatusPolicyViolation, "invalid terminal hello")
		return
	}
	resolved, err := sessions.ResolveByID(r.sessionsDir, hello.SessionID)
	if err != nil || resolved.Session.ID != hello.SessionID {
		_ = socket.Close(websocket.StatusPolicyViolation, "unknown terminal session")
		return
	}
	headerUUID, _ := resolved.Session.Header["id"].(string)
	if hello.SessionUUID == "" || headerUUID == "" || hello.SessionUUID != headerUUID {
		_ = socket.Close(websocket.StatusPolicyViolation, "terminal session identity mismatch")
		return
	}
	if hello.LeafID != sessionLeafID(resolved.Session) {
		_ = socket.Close(websocket.StatusPolicyViolation, "terminal session is behind disk; resume or restart it")
		return
	}

	connection := &connection{
		socket:  socket,
		pending: make(map[string]chan clientMessage),
		status:  normalizeStatus(hello.State),
		done:    make(chan struct{}),
	}
	gate := r.sessionGate(hello.SessionID)
	gate.Lock()
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		gate.Unlock()
		_ = socket.Close(websocket.StatusGoingAway, "terminal bridge is shutting down")
		return
	}
	if existing := r.connections[hello.SessionID]; existing != nil {
		r.mu.Unlock()
		gate.Unlock()
		_ = socket.Close(websocket.StatusPolicyViolation, "session already has a terminal owner")
		return
	}
	r.mu.Unlock()

	releaseCtx, releaseCancel := context.WithTimeout(request.Context(), 10*time.Second)
	err = r.fallback.Release(releaseCtx, hello.SessionID)
	releaseCancel()
	if err != nil {
		gate.Unlock()
		_ = socket.Close(websocket.StatusTryAgainLater, "could not release RPC session owner")
		return
	}
	r.mu.Lock()
	if r.closed || r.connections[hello.SessionID] != nil {
		r.mu.Unlock()
		gate.Unlock()
		_ = socket.Close(websocket.StatusTryAgainLater, "terminal ownership changed")
		return
	}
	r.connections[hello.SessionID] = connection
	r.mu.Unlock()
	if err := connection.write(request.Context(), serverMessage{Type: "ready"}); err != nil {
		connection.stop(err)
		r.mu.Lock()
		if r.connections[hello.SessionID] == connection {
			delete(r.connections, hello.SessionID)
		}
		r.mu.Unlock()
		gate.Unlock()
		return
	}
	gate.Unlock()
	connection.readLoop(request.Context())
	r.remove(hello.SessionID, connection)
}

func (r *Router) remove(sessionID string, connection *connection) {
	gate := r.sessionGate(sessionID)
	gate.Lock()
	defer gate.Unlock()
	r.mu.Lock()
	if r.connections[sessionID] == connection {
		delete(r.connections, sessionID)
	}
	r.mu.Unlock()
}

func (c *connection) readLoop(ctx context.Context) {
	for {
		var message clientMessage
		if err := wsjson.Read(ctx, c.socket, &message); err != nil {
			c.stop(err)
			return
		}
		switch message.Type {
		case "response":
			c.mu.Lock()
			pending := c.pending[message.ID]
			if pending != nil {
				delete(c.pending, message.ID)
			}
			c.mu.Unlock()
			if pending != nil {
				pending <- message
			}
		case "state":
			c.mu.Lock()
			c.status = normalizeStatus(message.State)
			c.mu.Unlock()
		default:
			c.stop(errors.New("unsupported terminal message"))
			_ = c.socket.Close(websocket.StatusUnsupportedData, "unsupported terminal message")
			return
		}
	}
}

func (c *connection) write(ctx context.Context, message serverMessage) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return wsjson.Write(ctx, c.socket, message)
}

func (c *connection) stop(_ error) {
	c.once.Do(func() {
		close(c.done)
		c.mu.Lock()
		pending := c.pending
		c.pending = make(map[string]chan clientMessage)
		c.mu.Unlock()
		for _, response := range pending {
			close(response)
		}
	})
}

func (r *Router) request(ctx context.Context, sessionID string, connection *connection, message serverMessage) (clientMessage, error) {
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
	}
	message.Type = "request"
	message.ID = fmt.Sprintf("terminal-%s-%d", r.requestBase, r.sequence.Add(1))
	response := make(chan clientMessage, 1)
	connection.mu.Lock()
	select {
	case <-connection.done:
		connection.mu.Unlock()
		return clientMessage{}, ErrDeliveryUnknown
	default:
	}
	connection.pending[message.ID] = response
	connection.mu.Unlock()

	if err := connection.write(ctx, message); err != nil {
		connection.mu.Lock()
		delete(connection.pending, message.ID)
		connection.mu.Unlock()
		return clientMessage{}, fmt.Errorf("%w: %v", ErrDeliveryUnknown, err)
	}
	select {
	case result, ok := <-response:
		if !ok {
			return clientMessage{}, ErrDeliveryUnknown
		}
		if !result.OK {
			if result.Error == "" {
				result.Error = "terminal rejected request"
			}
			return result, errors.New(result.Error)
		}
		return result, nil
	case <-ctx.Done():
		connection.mu.Lock()
		delete(connection.pending, message.ID)
		connection.mu.Unlock()
		return clientMessage{}, ctx.Err()
	case <-connection.done:
		return clientMessage{}, ErrDeliveryUnknown
	}
}

func (r *Router) withOwner(sessionID string, terminal func(*connection) error, fallback func() error) error {
	gate := r.sessionGate(sessionID)
	gate.Lock()
	defer gate.Unlock()
	r.mu.RLock()
	connection := r.connections[sessionID]
	r.mu.RUnlock()
	if connection != nil {
		return terminal(connection)
	}
	if r.ownerHeartbeatFresh(sessionID) {
		return ErrTerminalReconnecting
	}
	return fallback()
}

func (r *Router) Send(ctx context.Context, sessionID, sessionPath string, request chat.Request) error {
	return r.withOwner(sessionID, func(connection *connection) error {
		_, err := r.request(ctx, sessionID, connection, serverMessage{
			Operation: "prompt",
			Chat:      &wireChat{Message: request.Message, Images: request.Images},
		})
		return err
	}, func() error { return r.fallback.Send(ctx, sessionID, sessionPath, request) })
}

func (r *Router) SetModel(ctx context.Context, sessionID, sessionPath, provider, modelID string) error {
	return r.withOwner(sessionID, func(connection *connection) error {
		_, err := r.request(ctx, sessionID, connection, serverMessage{Operation: "set_model", Provider: provider, ModelID: modelID})
		return err
	}, func() error { return r.fallback.SetModel(ctx, sessionID, sessionPath, provider, modelID) })
}

func (r *Router) SetThinkingLevel(ctx context.Context, sessionID, sessionPath, level string) error {
	return r.withOwner(sessionID, func(connection *connection) error {
		_, err := r.request(ctx, sessionID, connection, serverMessage{Operation: "set_thinking", Level: level})
		return err
	}, func() error { return r.fallback.SetThinkingLevel(ctx, sessionID, sessionPath, level) })
}

func (r *Router) SetSessionName(ctx context.Context, sessionID, sessionPath, name string, at time.Time) error {
	return r.withOwner(sessionID, func(connection *connection) error {
		_, err := r.request(ctx, sessionID, connection, serverMessage{Operation: "set_session_name", Name: name})
		return err
	}, func() error {
		if err := r.fallback.Release(ctx, sessionID); err != nil {
			return err
		}
		return sessions.RenameSession(sessionPath, name, func() time.Time { return at })
	})
}

func (r *Router) SetLabel(ctx context.Context, sessionID, sessionPath, entryID, label string, at time.Time) error {
	return r.withOwner(sessionID, func(connection *connection) error {
		_, err := r.request(ctx, sessionID, connection, serverMessage{Operation: "set_label", EntryID: entryID, Label: label})
		return err
	}, func() error {
		if err := r.fallback.Release(ctx, sessionID); err != nil {
			return err
		}
		return sessions.LabelSessionEntry(sessionPath, entryID, label, func() time.Time { return at })
	})
}

func (r *Router) AuthoritativeStatus(sessionID string) (workers.WorkerStatus, bool) {
	r.mu.RLock()
	connection := r.connections[sessionID]
	r.mu.RUnlock()
	if connection != nil {
		connection.mu.Lock()
		defer connection.mu.Unlock()
		return connection.status, true
	}
	if r.ownerHeartbeatFresh(sessionID) {
		return workers.WorkerStatus{State: workers.WorkerStateError, Error: ErrTerminalReconnecting.Error()}, true
	}
	return workers.WorkerStatus{}, false
}

func (r *Router) TerminalOwned(sessionID string) bool {
	r.mu.RLock()
	connected := r.connections[sessionID] != nil
	r.mu.RUnlock()
	return connected || r.ownerHeartbeatFresh(sessionID)
}

func (r *Router) Abort(ctx context.Context, sessionID string) error {
	return r.withOwner(sessionID, func(connection *connection) error {
		_, err := r.request(ctx, sessionID, connection, serverMessage{Operation: "abort"})
		return err
	}, func() error { return r.fallback.Abort(ctx, sessionID) })
}

func (r *Router) GetState(ctx context.Context, sessionID string) (workers.WorkerStatus, error) {
	r.mu.RLock()
	connection := r.connections[sessionID]
	r.mu.RUnlock()
	if connection == nil {
		if r.ownerHeartbeatFresh(sessionID) {
			return workers.WorkerStatus{State: workers.WorkerStateError, Error: ErrTerminalReconnecting.Error()}, nil
		}
		return r.fallback.GetState(ctx, sessionID)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	return connection.status, nil
}

func (r *Router) GetCommands(ctx context.Context, sessionID string) ([]workers.SlashCommand, bool, error) {
	gate := r.sessionGate(sessionID)
	gate.Lock()
	defer gate.Unlock()
	r.mu.RLock()
	connection := r.connections[sessionID]
	r.mu.RUnlock()
	if connection == nil {
		if r.ownerHeartbeatFresh(sessionID) {
			return nil, false, ErrTerminalReconnecting
		}
		return r.fallback.GetCommands(ctx, sessionID)
	}
	response, err := r.request(ctx, sessionID, connection, serverMessage{Operation: "get_commands"})
	if err != nil {
		return nil, true, err
	}
	return response.Commands, true, nil
}

func (r *Router) Status(sessionID string) workers.WorkerStatus {
	r.mu.RLock()
	connection := r.connections[sessionID]
	r.mu.RUnlock()
	if connection == nil {
		if r.ownerHeartbeatFresh(sessionID) {
			return workers.WorkerStatus{State: workers.WorkerStateError, Error: ErrTerminalReconnecting.Error()}
		}
		return r.fallback.Status(sessionID)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	return connection.status
}

func (r *Router) EnsureWorker(ctx context.Context, sessionID, sessionPath string) error {
	return r.withOwner(sessionID, func(*connection) error { return nil }, func() error {
		return r.fallback.EnsureWorker(ctx, sessionID, sessionPath)
	})
}

func (r *Router) Close() error {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return nil
	}
	r.closed = true
	connections := make([]*connection, 0, len(r.connections))
	for _, connection := range r.connections {
		connections = append(connections, connection)
	}
	r.connections = make(map[string]*connection)
	r.mu.Unlock()
	for _, connection := range connections {
		connection.stop(errors.New("terminal bridge closed"))
		_ = connection.socket.Close(websocket.StatusGoingAway, "terminal bridge shutting down")
	}
	return nil
}

func (r *Router) ownerHeartbeatFresh(sessionID string) bool {
	if r.ownerDir == "" || sessionID == "" || filepath.Base(sessionID) != sessionID {
		return false
	}
	info, err := os.Stat(filepath.Join(r.ownerDir, sessionID+".json"))
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	return time.Since(info.ModTime()) <= ownerHeartbeatTTL
}

func sessionLeafID(session sessions.Session) string {
	parents := make(map[string]struct{})
	for _, entry := range session.Entries {
		if entry["type"] == "session" {
			continue
		}
		if parent, _ := entry["parentId"].(string); parent != "" {
			parents[parent] = struct{}{}
		}
	}
	for index := len(session.Entries) - 1; index >= 0; index-- {
		if session.Entries[index]["type"] == "session" {
			continue
		}
		id, _ := session.Entries[index]["id"].(string)
		if id == "" {
			continue
		}
		if _, parent := parents[id]; !parent {
			return id
		}
	}
	return ""
}

func normalizeStatus(status workers.WorkerStatus) workers.WorkerStatus {
	switch status.State {
	case workers.WorkerStateIdle, workers.WorkerStateRunning, workers.WorkerStateError:
	default:
		status.State = workers.WorkerStateIdle
	}
	return status
}

func sameSecret(got, want string) bool {
	return len(got) == len(want) && subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func loopbackHost(raw string) bool {
	value := raw
	if !strings.Contains(value, "://") {
		value = "//" + value
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return false
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func websocketToken(header http.Header) string {
	for _, value := range header.Values("Sec-WebSocket-Protocol") {
		for _, protocol := range strings.Split(value, ",") {
			protocol = strings.TrimSpace(protocol)
			if token, found := strings.CutPrefix(protocol, "token."); found {
				return token
			}
		}
	}
	return ""
}

func loopbackRemote(raw string) bool {
	host, _, err := net.SplitHostPort(raw)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
