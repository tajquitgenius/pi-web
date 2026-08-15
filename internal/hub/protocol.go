package hub

import "net/http"

const ProtocolVersion = 1

const (
	MessageRequestStart  = "request_start"
	MessageRequestChunk  = "request_chunk"
	MessageRequestEnd    = "request_end"
	MessageRequestCancel = "request_cancel"
	MessageResponseStart = "response_start"
	MessageResponseChunk = "response_chunk"
	MessageResponseEnd   = "response_end"
	MessageResponseError = "response_error"
)

type WireMessage struct {
	Version   int         `json:"version,omitempty"`
	Type      string      `json:"type"`
	RequestID string      `json:"requestId,omitempty"`
	Method    string      `json:"method,omitempty"`
	Path      string      `json:"path,omitempty"`
	RawQuery  string      `json:"rawQuery,omitempty"`
	Header    http.Header `json:"header,omitempty"`
	Status    int         `json:"status,omitempty"`
	Data      []byte      `json:"data,omitempty"`
	Error     string      `json:"error,omitempty"`
}
