package hub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const connectorFrameBytes = 32 << 10

type Connector struct {
	HubURL     string
	Credential string
	LocalHost  string
	LocalToken string
	Handler    http.Handler
}

type connectorSession struct {
	socket     *websocket.Conn
	writeMu    sync.Mutex
	requestsMu sync.Mutex
	requests   map[string]*connectorRequest
}

type connectorRequest struct {
	body       *io.PipeWriter
	bodyEvents chan connectorBodyEvent
	cancel     context.CancelFunc
	failOnce   sync.Once
	requestID  string
	session    *connectorSession
}

type connectorBodyEvent struct {
	data []byte
	err  error
	end  bool
}

func (connector *Connector) Run(ctx context.Context) error {
	if connector.Handler == nil {
		return errors.New("hub connector requires a local handler")
	}
	if connector.Credential == "" {
		return errors.New("hub connector requires a credential")
	}
	connectURL, err := connectorWebSocketURL(connector.HubURL)
	if err != nil {
		return err
	}
	header := http.Header{"Authorization": {"Bearer " + connector.Credential}}
	socket, response, err := websocket.Dial(ctx, connectURL, &websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		if response != nil {
			return fmt.Errorf("connect to hub: status %d: %w", response.StatusCode, err)
		}
		return fmt.Errorf("connect to hub: %w", err)
	}
	defer socket.CloseNow()
	socket.SetReadLimit(1 << 20)
	session := &connectorSession{socket: socket, requests: make(map[string]*connectorRequest)}
	defer session.cancelRequests(errors.New("hub disconnected"))
	pingContext, stopPings := context.WithCancel(ctx)
	defer stopPings()
	go session.keepAlive(pingContext)
	for {
		_, data, err := socket.Read(ctx)
		if err != nil {
			return err
		}
		var message WireMessage
		if err := json.Unmarshal(data, &message); err != nil || message.Version != ProtocolVersion {
			_ = socket.Close(websocket.StatusUnsupportedData, "invalid hub protocol message")
			return errors.New("hub sent an invalid protocol message")
		}
		switch message.Type {
		case MessageRequestStart:
			session.startRequest(ctx, connector, message)
		case MessageRequestChunk:
			session.writeRequestBody(message.RequestID, message.Data)
		case MessageRequestEnd:
			session.closeRequestBody(message.RequestID, nil)
		case MessageRequestCancel:
			session.cancelRequest(message.RequestID)
		}
	}
}

func connectorWebSocketURL(raw string) (string, error) {
	hubURL, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || hubURL.Host == "" || hubURL.User != nil || hubURL.RawQuery != "" || hubURL.Fragment != "" {
		return "", errors.New("hub URL must be an absolute HTTP(S) origin")
	}
	switch hubURL.Scheme {
	case "https":
		hubURL.Scheme = "wss"
	case "http":
		hubURL.Scheme = "ws"
	default:
		return "", errors.New("hub URL must use HTTP or HTTPS")
	}
	if hubURL.Path != "" && hubURL.Path != "/" {
		return "", errors.New("hub URL must not include a path")
	}
	hubURL.Path = "/api/hub/connect"
	return hubURL.String(), nil
}

func (session *connectorSession) startRequest(parent context.Context, connector *Connector, message WireMessage) {
	if message.RequestID == "" || message.Method == "" || !strings.HasPrefix(message.Path, "/") || strings.Contains(message.Path, "//") {
		return
	}
	requestContext, cancel := context.WithCancel(parent)
	bodyReader, bodyWriter := io.Pipe()
	localURL := &url.URL{Scheme: "http", Host: connector.LocalHost, Path: message.Path, RawQuery: message.RawQuery}
	requestHeader := message.Header.Clone()
	if connector.LocalToken != "" {
		requestHeader.Set("X-Pi-Token", connector.LocalToken)
	}
	request := &http.Request{
		Method:        message.Method,
		URL:           localURL,
		Header:        requestHeader,
		Body:          bodyReader,
		Host:          connector.LocalHost,
		RequestURI:    localURL.RequestURI(),
		ContentLength: -1,
	}
	request = request.WithContext(requestContext)
	state := &connectorRequest{
		body:       bodyWriter,
		bodyEvents: make(chan connectorBodyEvent, 16),
		cancel:     cancel,
		requestID:  message.RequestID,
		session:    session,
	}
	session.requestsMu.Lock()
	if _, exists := session.requests[message.RequestID]; exists {
		session.requestsMu.Unlock()
		cancel()
		_ = bodyReader.Close()
		_ = bodyWriter.Close()
		return
	}
	session.requests[message.RequestID] = state
	session.requestsMu.Unlock()

	go state.writeBody(requestContext)
	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				_ = session.send(requestContext, WireMessage{
					Type: MessageResponseError, RequestID: message.RequestID, Error: "local handler failed",
				})
			}
			session.requestsMu.Lock()
			delete(session.requests, message.RequestID)
			session.requestsMu.Unlock()
			cancel()
			_ = bodyReader.Close()
		}()
		writer := &connectorResponseWriter{
			ctx: requestContext, session: session, requestID: message.RequestID, header: make(http.Header),
		}
		connector.Handler.ServeHTTP(writer, request)
		if writer.writeHeader(http.StatusOK) == nil {
			_ = session.send(requestContext, WireMessage{Type: MessageResponseEnd, RequestID: message.RequestID})
		}
	}()
}

func (request *connectorRequest) writeBody(ctx context.Context) {
	defer request.body.Close()
	for {
		select {
		case <-ctx.Done():
			_ = request.body.CloseWithError(ctx.Err())
			return
		case event := <-request.bodyEvents:
			if event.end {
				if event.err != nil {
					_ = request.body.CloseWithError(event.err)
				}
				return
			}
			if _, err := request.body.Write(event.data); err != nil {
				request.cancel()
				return
			}
		}
	}
}

func (session *connectorSession) request(requestID string) *connectorRequest {
	session.requestsMu.Lock()
	defer session.requestsMu.Unlock()
	return session.requests[requestID]
}

func (request *connectorRequest) failBody(reason string) {
	request.failOnce.Do(func() {
		request.cancel()
		_ = request.body.CloseWithError(errors.New(reason))
		go func() {
			_ = request.session.send(context.Background(), WireMessage{
				Type: MessageResponseError, RequestID: request.requestID, Error: reason,
			})
		}()
	})
}

func (session *connectorSession) writeRequestBody(requestID string, data []byte) {
	request := session.request(requestID)
	if request == nil || len(data) == 0 {
		return
	}
	event := connectorBodyEvent{data: append([]byte(nil), data...)}
	select {
	case request.bodyEvents <- event:
	default:
		request.failBody("request body consumer is too slow")
	}
}

func (session *connectorSession) closeRequestBody(requestID string, err error) {
	request := session.request(requestID)
	if request == nil {
		return
	}
	select {
	case request.bodyEvents <- connectorBodyEvent{err: err, end: true}:
	default:
		request.failBody("request body consumer is too slow")
	}
}

func (session *connectorSession) cancelRequest(requestID string) {
	session.requestsMu.Lock()
	request := session.requests[requestID]
	session.requestsMu.Unlock()
	if request != nil {
		request.cancel()
		_ = request.body.CloseWithError(context.Canceled)
	}
}

func (session *connectorSession) cancelRequests(err error) {
	session.requestsMu.Lock()
	requests := make([]*connectorRequest, 0, len(session.requests))
	for _, request := range session.requests {
		requests = append(requests, request)
	}
	clear(session.requests)
	session.requestsMu.Unlock()
	for _, request := range requests {
		request.cancel()
		_ = request.body.CloseWithError(err)
	}
}

func (session *connectorSession) keepAlive(ctx context.Context) {
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pingContext, cancel := context.WithTimeout(ctx, 10*time.Second)
			session.writeMu.Lock()
			err := session.socket.Ping(pingContext)
			session.writeMu.Unlock()
			cancel()
			if err != nil {
				session.socket.CloseNow()
				return
			}
		}
	}
}

func (session *connectorSession) send(ctx context.Context, message WireMessage) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	message.Version = ProtocolVersion
	encoded, err := json.Marshal(message)
	if err != nil {
		return err
	}
	writeContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	session.writeMu.Lock()
	defer session.writeMu.Unlock()
	if err := writeContext.Err(); err != nil {
		return err
	}
	return session.socket.Write(writeContext, websocket.MessageText, encoded)
}

type connectorResponseWriter struct {
	ctx       context.Context
	session   *connectorSession
	requestID string
	header    http.Header
	status    int
	started   bool
}

func (writer *connectorResponseWriter) Header() http.Header {
	return writer.header
}

func (writer *connectorResponseWriter) WriteHeader(status int) {
	_ = writer.writeHeader(status)
}

func (writer *connectorResponseWriter) writeHeader(status int) error {
	if writer.started {
		return nil
	}
	writer.started = true
	writer.status = status
	return writer.session.send(writer.ctx, WireMessage{
		Type: MessageResponseStart, RequestID: writer.requestID, Status: status, Header: writer.header.Clone(),
	})
}

func (writer *connectorResponseWriter) Write(data []byte) (int, error) {
	if err := writer.writeHeader(http.StatusOK); err != nil {
		return 0, err
	}
	written := 0
	for len(data) > 0 {
		size := min(len(data), connectorFrameBytes)
		if err := writer.session.send(writer.ctx, WireMessage{
			Type: MessageResponseChunk, RequestID: writer.requestID, Data: data[:size],
		}); err != nil {
			return written, err
		}
		written += size
		data = data[size:]
	}
	return written, nil
}

func (writer *connectorResponseWriter) Flush() {
	_ = writer.writeHeader(http.StatusOK)
}

var _ http.Flusher = (*connectorResponseWriter)(nil)
