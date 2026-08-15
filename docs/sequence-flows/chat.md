# Sequence Flow: Chat Message

This flow covers a browser prompt with optional image attachments. The central rule is that one runtime owns the session: a connected Pi terminal, or an RPC worker, never both.

## Owner selection

```text
Browser                 Server              Terminal router        Pi TUI / RPC manager
   │ POST /api/chat        │                       │                         │
   ├──────────────────────▶│                       │                         │
   │                       ├─ resolve session      │                         │
   │                       ├─ parse and validate   │                         │
   │                       ├─ Send(id,path,chat) ─▶│                         │
   │                       │                       │                         │
   │                       │       terminal connected?                      │
   │                       │                       ├─ yes: request ─────────▶ Pi TUI
   │                       │                       │       sendUserMessage()
   │                       │                       │◀─ dispatch ACK ─────────│
   │                       │                       │                         │
   │                       │       no terminal or heartbeat?                │
   │                       │                       ├─ yes: fallback.Send ───▶ RPC manager
   │                       │                       │                         ├─ get/create worker
   │                       │                       │                         └─ Prompt()
   │                       │◀─ owner admitted ─────│                         │
   │◀─ 202 accepted ───────│                       │                         │
```

A fresh terminal heartbeat without a live socket is reconnect quarantine, not permission to start RPC. A terminal request that times out or loses its connection is ambiguous and returns an error. That operation is never replayed through RPC or on reconnect.

## 1. Parse the request

The browser sends `multipart/form-data`:

```http
POST /api/chat?id=2026-01-15T10-30-00.000Z_a1b2c3d4.jsonl
Content-Type: multipart/form-data; boundary=...

message=Hello, can you refactor this function?
images=<optional binary image files>
```

`chat.ParseRequest`:

1. Applies the 32 MiB request limit.
2. Extracts the text and image parts.
3. Limits each image to 10 MiB and the image count to six.
4. Detects the MIME type and rejects non-images.
5. Base64-encodes accepted images.
6. Requires text or at least one image.

The terminal protocol and extension apply their own bounded frame, decoded body, identifier, and aggregate-image checks.

## 2. Admit the prompt

`handleChat` calls `chatSender.Send` before returning HTTP 202. This admission boundary matters:

- **Terminal owner:** The router sends one request and waits for the extension's response. The extension validates the payload and synchronously calls `pi.sendUserMessage(content, {deliverAs: "steer"})` before acknowledging.
- **RPC owner:** `workers.Manager` returns an existing healthy worker or creates `pi --mode rpc --session <path>`, then sends the RPC prompt command.

The HTTP response is:

```json
{"ok":true,"status":"accepted"}
```

For terminal Pi, this means synchronous extension API dispatch, not provider preflight acceptance or turn completion. The public extension API returns `void`, so later failures are visible only through Pi's normal status and transcript events.

## 3. Terminal takeover ordering

Before accepting a terminal hello, the router validates the session filename, UUID, and current leaf. It then calls `workers.Manager.Release` for that session.

```text
block new RPC creation
    └─ close RPC worker
          └─ kill process if needed
                └─ wait for process exit
                      └─ publish terminal ready
```

A duplicate terminal is rejected. A terminal whose leaf is behind the JSONL file is rejected and must quit and resume before it can own the session.

## 4. Streaming and canonical state

Both owners write normal Pi JSONL entries. The server's file watcher broadcasts reload events, and the browser refetches `/api/session` to reconcile the canonical transcript. Best-effort `chat-preview` events may show assistant text earlier.

Terminal state events update model, thinking level, and idle/running status without consulting stale RPC or status-file state. RPC workers continue to emit their existing streaming events and status snapshots.

Running state does not change session recency ordering; persisted session activity remains authoritative.

## 5. Errors

| Condition | Result |
|---|---|
| Empty request | 400 `message or image required` |
| Image too large | 413 `image attachment too large` |
| Unsupported image | 415 `only image attachments are supported` |
| Session not found | 404 `not found` |
| Chat disabled | 409 with the session's disabled reason |
| Terminal reconnect quarantine | 409 `terminal owner is reconnecting` |
| Terminal stale behind disk | 409; quit and resume the terminal session |
| Terminal rejection | 409 or 500, depending on the classified owner error |
| Terminal timeout or disconnect | 504/502; no fallback or replay |
| RPC failure | 500 |

## 6. Cancellation and controls

Cancellation, command discovery, model selection, thinking level, rename, labels, and worker status use the same owner-selection rule. Once a request selects the terminal, it cannot fall through to RPC on failure.

Model and thinking controls call Pi's public extension APIs in terminal-owned sessions. RPC-owned sessions use their existing worker methods.

## 7. Queue behavior

The server owns persistent queue state:

- `GET /api/chat/queue?id=<sessionID>`
- `POST /api/chat/queue?id=<sessionID>`
- `DELETE /api/chat/queue?id=<sessionID>&position=N`
- `PATCH /api/chat/queue?id=<sessionID>`

The drainer serializes each session and keeps the head item until its selected owner acknowledges it. An ambiguous terminal failure pauses draining without removing or replaying the item. Queue changes broadcast the `queue` SSE event.

## 8. RPC lifecycle

Fallback workers are reaped after ten idle minutes. Creation, release, and reaping are serialized per session. Worker close waits for the child process to exit so a terminal cannot become ready while the RPC process can still write.

See [Terminal Session Ownership](../architecture/terminal-ownership.md) for the security and failure model.
