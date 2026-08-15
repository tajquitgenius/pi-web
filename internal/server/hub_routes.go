package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"pi-web/internal/hub"
)

const (
	hubFrameBytes      = 32 << 10
	hubMaxRequestBytes = 32 << 20
)

type hubNodeConnection struct {
	node      hub.Node
	socket    *websocket.Conn
	writeMu   sync.Mutex
	pendingMu sync.Mutex
	pending   map[string]*hubPendingRequest
}

type hubPendingRequest struct {
	events chan hubResponseEvent
	failed chan error
}

type hubResponseEvent struct {
	start *hubResponseStart
	data  []byte
	end   bool
	err   error
}

type hubResponseStart struct {
	status int
	header http.Header
}

type hubNodeStatus struct {
	hub.Node
	Online bool `json:"online"`
}

func (s *Server) registerHubRoutes(mux *http.ServeMux) {
	if s.hub == nil {
		return
	}
	boundary := func(handler http.HandlerFunc) http.HandlerFunc {
		return s.auth.WrapBoundary(handler).ServeHTTP
	}
	mux.HandleFunc("/api/hub/enrollments", boundary(s.handleHubEnrollments))
	mux.HandleFunc("/api/hub/enroll", boundary(s.handleHubEnroll))
	mux.HandleFunc("/api/hub/connect", boundary(s.handleHubConnect))
	mux.HandleFunc("/api/hub/nodes", s.auth.Wrap(s.handleHubNodes))
	mux.HandleFunc("/api/hub/nodes/", boundary(s.handleHubNode))
	mux.HandleFunc("/_host/", s.auth.Wrap(s.handleHubProxy))
}

func (s *Server) isPublicHubPath(r *http.Request) bool {
	return s.hub != nil && (r.URL.Path == "/api/hub/enroll" || r.URL.Path == "/api/hub/connect")
}

func (s *Server) handleHubConnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	credential, found := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !found || credential == "" {
		writeJSONError(w, http.StatusUnauthorized, "node authentication required")
		return
	}
	node, authenticated, err := s.hub.AuthenticateNode(r.Context(), credential)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "hub authentication unavailable")
		return
	}
	if !authenticated {
		writeJSONError(w, http.StatusUnauthorized, "node authentication required")
		return
	}
	socket, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		CompressionMode: websocket.CompressionDisabled,
	})
	if err != nil {
		return
	}
	socket.SetReadLimit(64 << 10)
	connection := &hubNodeConnection{
		node:    node,
		socket:  socket,
		pending: make(map[string]*hubPendingRequest),
	}
	s.hubConnectionsMu.Lock()
	// Revalidate while holding the same lock used by revocation. This closes the
	// authenticate/register race without putting a database call on the relay path.
	node, authenticated, authErr := s.hub.AuthenticateNode(r.Context(), credential)
	if authErr != nil || !authenticated {
		s.hubConnectionsMu.Unlock()
		_ = socket.Close(websocket.StatusPolicyViolation, "node credential is no longer valid")
		return
	}
	connection.node = node
	previous := s.hubConnections[node.ID]
	s.hubConnections[node.ID] = connection
	s.hubConnectionsMu.Unlock()
	if previous != nil {
		_ = previous.socket.Close(websocket.StatusPolicyViolation, "node reconnected")
	}
	connectionContext, cancelConnection := context.WithDeadline(r.Context(), node.ExpiresAt)
	defer cancelConnection()
	defer func() {
		s.hubConnectionsMu.Lock()
		if s.hubConnections[node.ID] == connection {
			delete(s.hubConnections, node.ID)
		}
		s.hubConnectionsMu.Unlock()
		connection.failPending(errors.New("node disconnected"))
		_ = socket.CloseNow()
	}()
	for {
		_, data, err := socket.Read(connectionContext)
		if err != nil {
			return
		}
		var message hub.WireMessage
		if err := json.Unmarshal(data, &message); err != nil || message.Version != hub.ProtocolVersion {
			_ = socket.Close(websocket.StatusUnsupportedData, "invalid hub protocol message")
			return
		}
		connection.dispatch(message)
	}
}

func (connection *hubNodeConnection) send(ctx context.Context, message hub.WireMessage) error {
	message.Version = hub.ProtocolVersion
	encoded, err := json.Marshal(message)
	if err != nil {
		return err
	}
	connection.writeMu.Lock()
	defer connection.writeMu.Unlock()
	return connection.socket.Write(ctx, websocket.MessageText, encoded)
}

func (connection *hubNodeConnection) dispatch(message hub.WireMessage) {
	connection.pendingMu.Lock()
	pending := connection.pending[message.RequestID]
	connection.pendingMu.Unlock()
	if pending == nil {
		return
	}
	event := hubResponseEvent{}
	switch message.Type {
	case hub.MessageResponseStart:
		event.start = &hubResponseStart{status: message.Status, header: message.Header}
	case hub.MessageResponseChunk:
		event.data = append([]byte(nil), message.Data...)
	case hub.MessageResponseEnd:
		event.end = true
	case hub.MessageResponseError:
		event.err = errors.New("node request failed")
	default:
		return
	}
	select {
	case pending.events <- event:
	default:
		select {
		case pending.failed <- errors.New("node response consumer is too slow"):
		default:
		}
		connection.socket.CloseNow()
	}
}

func (connection *hubNodeConnection) failPending(err error) {
	connection.pendingMu.Lock()
	pending := make([]*hubPendingRequest, 0, len(connection.pending))
	for id, request := range connection.pending {
		pending = append(pending, request)
		delete(connection.pending, id)
	}
	connection.pendingMu.Unlock()
	for _, request := range pending {
		select {
		case request.failed <- err:
		default:
		}
	}
}

func (s *Server) handleHubProxy(w http.ResponseWriter, r *http.Request) {
	nodeID, upstreamPath, ok := parseHubProxyPath(r.URL.Path)
	if !ok || !allowedHubRoute(r.Method, upstreamPath) {
		http.NotFound(w, r)
		return
	}
	if r.ContentLength > hubMaxRequestBytes {
		writeJSONError(w, http.StatusRequestEntityTooLarge, "request body is too large")
		return
	}
	s.hubConnectionsMu.RLock()
	connection := s.hubConnections[nodeID]
	s.hubConnectionsMu.RUnlock()
	if connection == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "computer is offline")
		return
	}
	requestID := uuid.NewString()
	requestContext := r.Context()
	cancelRequest := func() {}
	device, paired := pairedDeviceFromContext(requestContext)
	if paired {
		requestContext, cancelRequest = context.WithDeadline(requestContext, device.ExpiresAt)
		s.hubDeviceRequestsMu.Lock()
		active, activeErr := s.pairing.IsDeviceActive(requestContext, device.ID)
		if activeErr != nil || !active {
			s.hubDeviceRequestsMu.Unlock()
			cancelRequest()
			writeJSONError(w, http.StatusUnauthorized, "device pairing required")
			return
		}
		requests := s.hubDeviceRequests[device.ID]
		if requests == nil {
			requests = make(map[string]context.CancelFunc)
			s.hubDeviceRequests[device.ID] = requests
		}
		requests[requestID] = cancelRequest
		s.hubDeviceRequestsMu.Unlock()
	}
	defer func() {
		cancelRequest()
		if paired {
			s.hubDeviceRequestsMu.Lock()
			delete(s.hubDeviceRequests[device.ID], requestID)
			if len(s.hubDeviceRequests[device.ID]) == 0 {
				delete(s.hubDeviceRequests, device.ID)
			}
			s.hubDeviceRequestsMu.Unlock()
		}
	}()
	r = r.WithContext(requestContext)
	stopBodyWatch := make(chan struct{})
	defer close(stopBodyWatch)
	go func() {
		select {
		case <-requestContext.Done():
			_ = r.Body.Close()
		case <-stopBodyWatch:
		}
	}()
	pending := &hubPendingRequest{
		events: make(chan hubResponseEvent, 16),
		failed: make(chan error, 1),
	}
	connection.pendingMu.Lock()
	connection.pending[requestID] = pending
	connection.pendingMu.Unlock()
	defer func() {
		connection.pendingMu.Lock()
		delete(connection.pending, requestID)
		connection.pendingMu.Unlock()
	}()

	sendCtx, cancelSend := context.WithTimeout(r.Context(), 10*time.Second)
	err := connection.send(sendCtx, hub.WireMessage{
		Type:      hub.MessageRequestStart,
		RequestID: requestID,
		Method:    r.Method,
		Path:      upstreamPath,
		RawQuery:  r.URL.RawQuery,
		Header:    hubRequestHeaders(r.Header),
	})
	cancelSend()
	nodeRequestStarted := err == nil
	responseEnded := false
	defer func() {
		if !nodeRequestStarted || responseEnded {
			return
		}
		cancelCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		_ = connection.send(cancelCtx, hub.WireMessage{
			Type: hub.MessageRequestCancel, RequestID: requestID,
		})
		cancel()
	}()
	if err == nil {
		reader := io.LimitReader(r.Body, hubMaxRequestBytes+1)
		buffer := make([]byte, hubFrameBytes)
		var total int64
		for {
			read, readErr := reader.Read(buffer)
			if read > 0 {
				total += int64(read)
				if total > hubMaxRequestBytes {
					err = errors.New("request body is too large")
					break
				}
				sendCtx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
				err = connection.send(sendCtx, hub.WireMessage{
					Type: hub.MessageRequestChunk, RequestID: requestID, Data: buffer[:read],
				})
				cancel()
				if err != nil {
					break
				}
			}
			if errors.Is(readErr, io.EOF) {
				break
			}
			if readErr != nil {
				err = readErr
				break
			}
		}
	}
	if err == nil {
		sendCtx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		err = connection.send(sendCtx, hub.WireMessage{Type: hub.MessageRequestEnd, RequestID: requestID})
		cancel()
	}
	if err != nil {
		cancelContext, cancel := context.WithTimeout(context.Background(), time.Second)
		_ = connection.send(cancelContext, hub.WireMessage{
			Type: hub.MessageRequestCancel, RequestID: requestID,
		})
		cancel()
		if err.Error() == "request body is too large" {
			writeJSONError(w, http.StatusRequestEntityTooLarge, err.Error())
		} else {
			writeJSONError(w, http.StatusBadGateway, "computer connection failed")
		}
		return
	}

	startTimer := time.NewTimer(30 * time.Second)
	defer startTimer.Stop()
	started := false
	for {
		select {
		case <-r.Context().Done():
			cancelCtx, cancel := context.WithTimeout(context.Background(), time.Second)
			_ = connection.send(cancelCtx, hub.WireMessage{Type: hub.MessageRequestCancel, RequestID: requestID})
			cancel()
			return
		case <-startTimer.C:
			writeJSONError(w, http.StatusGatewayTimeout, "computer did not respond")
			return
		case failure := <-pending.failed:
			if !started {
				writeJSONError(w, http.StatusBadGateway, "computer connection failed")
			}
			_ = failure
			return
		case event := <-pending.events:
			if event.err != nil {
				if !started {
					writeJSONError(w, http.StatusBadGateway, "computer connection failed")
				}
				return
			}
			if event.start != nil {
				if started || event.start.status < 100 || event.start.status > 599 {
					writeJSONError(w, http.StatusBadGateway, "computer sent an invalid response")
					return
				}
				copyHubResponseHeaders(w.Header(), event.start.header)
				w.WriteHeader(event.start.status)
				started = true
				if !startTimer.Stop() {
					select {
					case <-startTimer.C:
					default:
					}
				}
				continue
			}
			if len(event.data) > 0 {
				if !started {
					writeJSONError(w, http.StatusBadGateway, "computer sent an invalid response")
					return
				}
				if _, err := w.Write(event.data); err != nil {
					return
				}
				if flusher, ok := w.(http.Flusher); ok {
					flusher.Flush()
				}
			}
			if event.end {
				responseEnded = true
				if !started {
					writeJSONError(w, http.StatusBadGateway, "computer sent an invalid response")
				}
				return
			}
		}
	}
}

func parseHubProxyPath(path string) (string, string, bool) {
	remainder := strings.TrimPrefix(path, "/_host/")
	separator := strings.IndexByte(remainder, '/')
	if separator <= 0 || separator == len(remainder)-1 {
		return "", "", false
	}
	nodeID := remainder[:separator]
	upstreamPath := remainder[separator:]
	if strings.Contains(nodeID, "..") || strings.Contains(upstreamPath, "//") || strings.Contains(upstreamPath, "/../") {
		return "", "", false
	}
	return nodeID, upstreamPath, true
}

func allowedHubRoute(method, path string) bool {
	if path == "/events" {
		return method == http.MethodGet
	}
	methods := map[string]string{
		"/api/sessions":           "GET",
		"/api/session":            "GET",
		"/api/new-session":        "POST",
		"/api/session-defaults":   "GET",
		"/api/models":             "GET",
		"/api/chat":               "POST",
		"/api/chat/cancel":        "POST",
		"/api/chat/queue":         "GET POST DELETE PATCH",
		"/api/worker-status":      "GET",
		"/api/set-model":          "POST",
		"/api/set-thinking-level": "POST",
		"/api/commands":           "GET",
		"/api/projects":           "GET POST",
		"/api/recent-locations":   "GET",
		"/api/files":              "GET",
		"/api/file":               "GET",
		"/api/fork-session":       "POST",
		"/api/clone-session":      "POST",
		"/api/rename-session":     "POST",
		"/api/label-session":      "POST",
		"/api/git/info":           "GET",
		"/api/git/diff":           "GET",
		"/api/git/rename-branch":  "POST",
		"/api/diff/reviews":       "GET POST DELETE",
		"/api/annotations":        "GET POST DELETE",
		"/api/scratchpad":         "GET POST",
		"/api/settings":           "GET POST",
		"/api/btw":                "GET",
		"/api/btw/new":            "POST",
		"/api/schedules":          "GET POST",
		"/api/schedule":           "GET POST DELETE",
		"/api/schedule/run":       "POST",
		"/api/schedule/runs":      "GET",
		"/api/version":            "GET",
	}
	allowed, found := methods[path]
	return found && strings.Contains(" "+allowed+" ", " "+method+" ")
}

func hubRequestHeaders(source http.Header) http.Header {
	result := make(http.Header)
	for _, name := range []string{"Accept", "Accept-Language", "Content-Type", "If-None-Match"} {
		if values := source.Values(name); len(values) > 0 {
			result[name] = append([]string(nil), values...)
		}
	}
	return result
}

func copyHubResponseHeaders(target, source http.Header) {
	blocked := map[string]struct{}{}
	for name, values := range source {
		if !strings.EqualFold(name, "Connection") {
			continue
		}
		for _, value := range values {
			for token := range strings.SplitSeq(value, ",") {
				if canonical := http.CanonicalHeaderKey(strings.TrimSpace(token)); canonical != "" {
					blocked[canonical] = struct{}{}
				}
			}
		}
	}
	for name, values := range source {
		canonical := http.CanonicalHeaderKey(name)
		if _, nominated := blocked[canonical]; nominated {
			continue
		}
		switch canonical {
		case "Connection", "Content-Length", "Keep-Alive", "Location", "Proxy-Authenticate", "Proxy-Authorization", "Proxy-Connection", "Refresh", "Set-Cookie", "Te", "Trailer", "Transfer-Encoding", "Upgrade":
			continue
		}
		for _, value := range values {
			target.Add(canonical, value)
		}
	}
}

func (s *Server) HubNodes(ctx context.Context) ([]hub.Node, error) {
	if s.hub == nil {
		return []hub.Node{}, nil
	}
	return s.hub.ListNodes(ctx)
}

func (s *Server) handleHubNode(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodDelete {
		w.Header().Set("Allow", http.MethodDelete)
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !isLoopbackRequestHost(r.Host) {
		writeJSONError(w, http.StatusForbidden, "hub nodes may only be administered locally")
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/hub/nodes/")
	if id == "" || strings.Contains(id, "/") || r.URL.RawQuery != "" {
		writeJSONError(w, http.StatusBadRequest, "invalid node id")
		return
	}
	revoked, err := s.hub.RevokeNode(r.Context(), id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "could not revoke hub node")
		return
	}
	if !revoked {
		writeJSONError(w, http.StatusNotFound, "hub node not found")
		return
	}
	s.hubConnectionsMu.Lock()
	connection := s.hubConnections[id]
	delete(s.hubConnections, id)
	s.hubConnectionsMu.Unlock()
	if connection != nil {
		_ = connection.socket.Close(websocket.StatusPolicyViolation, "node revoked")
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleHubNodes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !isLoopbackRequestHost(r.Host) {
		writeJSONError(w, http.StatusForbidden, "hub nodes may only be administered locally")
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	nodes, err := s.hub.ListNodes(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "hub nodes unavailable")
		return
	}
	statuses := make([]hubNodeStatus, 0, len(nodes))
	s.hubConnectionsMu.RLock()
	for _, node := range nodes {
		_, online := s.hubConnections[node.ID]
		statuses = append(statuses, hubNodeStatus{Node: node, Online: online})
	}
	s.hubConnectionsMu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{"nodes": statuses})
}

func (s *Server) handleHubEnrollments(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !isLoopbackRequestHost(r.Host) {
		writeJSONError(w, http.StatusForbidden, "hub enrollment codes may only be created locally")
		return
	}
	if r.URL.RawQuery != "" {
		writeJSONError(w, http.StatusBadRequest, "hub enrollment codes are not accepted in URLs")
		return
	}
	var request struct {
		ID    string `json:"id"`
		Label string `json:"label"`
	}
	if !decodeJSONBody(w, r, &request) {
		return
	}
	enrollment, err := s.hub.CreateEnrollment(r.Context(), request.ID, request.Label)
	if err != nil {
		if errors.Is(err, hub.ErrInvalidID) || errors.Is(err, hub.ErrInvalidLabel) {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "hub enrollment unavailable")
		return
	}
	writeJSON(w, http.StatusOK, enrollment)
}

func (s *Server) handleHubEnroll(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if err := s.hub.ConsumeEnrollmentAttempt(r.Context()); err != nil {
		if errors.Is(err, hub.ErrRateLimited) {
			w.Header().Set("Retry-After", "60")
			writeJSONError(w, http.StatusTooManyRequests, "too many hub enrollment attempts")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "hub enrollment unavailable")
		return
	}
	if r.URL.RawQuery != "" {
		writeJSONError(w, http.StatusBadRequest, "hub enrollment codes are not accepted in URLs")
		return
	}
	var request struct {
		Code string `json:"code"`
	}
	if !decodeJSONBody(w, r, &request) {
		return
	}
	node, err := s.hub.Redeem(r.Context(), request.Code)
	if err != nil {
		if errors.Is(err, hub.ErrInvalidCode) {
			writeJSONError(w, http.StatusUnauthorized, "invalid or expired enrollment code")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "hub enrollment unavailable")
		return
	}
	writeJSON(w, http.StatusOK, node)
}
