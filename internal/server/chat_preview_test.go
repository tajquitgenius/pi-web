package server

import (
	"strings"
	"testing"

	"pi-web/internal/rpc"
)

func TestBroadcastChatPreviewSendsNamedSSEToSession(t *testing.T) {
	s, err := New(Deps{AgentDir: t.TempDir()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer s.Shutdown()
	client := s.addClient("a.jsonl")
	defer s.removeClient(client)

	s.BroadcastChatPreview("a.jsonl", rpc.StreamPreview{Content: "hello\nworld", Done: false})

	select {
	case msg := <-client.ch:
		if !strings.HasPrefix(msg, "event: chat-preview\ndata: ") {
			t.Fatalf("msg = %q", msg)
		}
		if !strings.Contains(msg, `"content":"hello\nworld"`) {
			t.Fatalf("content was not JSON escaped in msg = %q", msg)
		}
	default:
		t.Fatalf("expected chat-preview broadcast")
	}
}

func TestBroadcastChatPreviewCompletionDisplacesOlderEventWhenQueueIsFull(t *testing.T) {
	s, err := New(Deps{AgentDir: t.TempDir()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer s.Shutdown()
	client := s.addClient("a.jsonl")
	defer s.removeClient(client)

	for i := 0; i < cap(client.ch); i++ {
		s.broadcast("a.jsonl", "status-delta")
	}
	s.BroadcastChatPreview("a.jsonl", rpc.StreamPreview{Content: "complete", Done: true})

	foundCompletion := false
	for i := 0; i < cap(client.ch); i++ {
		msg := <-client.ch
		if strings.Contains(msg, `"content":"complete"`) && strings.Contains(msg, `"done":true`) {
			foundCompletion = true
		}
	}
	if !foundCompletion {
		t.Fatal("completed chat preview was dropped from a full client queue")
	}
}

func TestBroadcastChatPreviewDoesNotSendToGlobalTopic(t *testing.T) {
	s, err := New(Deps{AgentDir: t.TempDir()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer s.Shutdown()
	client := s.addClient(globalSessID)
	defer s.removeClient(client)

	s.BroadcastChatPreview("a.jsonl", rpc.StreamPreview{Content: "secret", Done: false})

	select {
	case msg := <-client.ch:
		t.Fatalf("global client received chat preview: %q", msg)
	default:
	}
}
