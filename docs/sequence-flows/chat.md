# Sequence Flow: Chat Message

This flow covers a user typing a message (with optional image attachment) in the session page chat composer and sending it.

## Sequence Diagram

```
┌─────────┐   ┌─────────┐   ┌────────────┐   ┌──────────────┐   ┌─────────────┐   ┌──────────┐
│ Browser │   │  Server │   │  sessions  │   │    chat      │   │   workers   │   │  pi rpc  │
│         │   │         │   │  (resolve) │   │  (request)   │   │  (manager)  │   │ (worker) │
└────┬────┘   └────┬────┘   └─────┬──────┘   └──────┬───────┘   └──────┬──────┘   └────┬─────┘
     │             │              │                  │                  │               │
     │ POST /api/chat?id=abc
     │ (multipart: message + images)
     │────────────▶│              │                  │                  │               │
     │             │              │                  │                  │               │
     │             │─── ResolveByID ────────────────▶│                  │               │
     │             │              │                  │                  │               │
     │             │◀───────────── Session + Path ────│                  │               │
     │             │              │                  │                  │               │
     │             │─── Check ChatAvailable ──────────│                  │               │
     │             │   (return 409 if disabled)       │                  │               │
     │             │              │                  │                  │               │
     │             │─── chat.ParseRequest(r) ────────▶│                  │               │
     │             │              │                  │                  │               │
     │             │              │─── ParseMultipartForm               │               │
     │             │              │─── Extract text + image files       │               │
     │             │              │─── Validate size / mime type        │               │
     │             │              │─── base64 encode images             │               │
     │             │              │                  │                  │               │
     │             │◀───────────── chat.Request ──────│                  │               │
     │             │   {Message, Images}               │                  │               │
     │             │              │                  │                  │               │
     │             │─── chatSender.Send(ctx, id, path, req) ──────────▶│               │
     │             │              │                  │                  │               │
     │             │              │                  │                  ├─── workerFor(id, path)
     │             │              │                  │                  │               │
     │             │              │                  │                  ├─── Get existing?
     │             │              │                  │                  │   ┌─ yes ─┐   │
     │             │              │                  │                  │   ▼       │   │
     │             │              │                  │                  │  use it   │   │
     │             │              │                  │                  │   │       │   │
     │             │              │                  │                  │   └───┬───┘   │
     │             │              │                  │                  │       │       │
     │             │              │                  │                  │   no  │       │
     │             │              │                  │                  │   ▼   │       │
     │             │              │                  │                  │─── factory(id, path)──▶│
     │             │              │                  │                  │       │       │
     │             │              │                  │                  │       │─── exec.Command("pi", "--mode", "rpc")
     │             │              │                  │                  │       │─── Start()
     │             │              │                  │                  │       │─── switch_session RPC
     │             │              │                  │                  │       │─── goroutines: consume stdout, wait
     │             │              │                  │                  │       │
     │             │              │                  │                  │◀────── ChatWorker ─│
     │             │              │                  │                  │               │
     │             │              │                  │                  ├─── worker.Prompt(ctx, chatReq)
     │             │              │                  │                  │               │
     │             │              │                  │                  │               ├─── touch() (update idle tracking)
     │             │              │                  │                  │               │
     │             │              │                  │                  │               ├─── BuildPromptCommand(id, chat, streaming)
     │             │              │                  │                  │               │
     │             │              │                  │                  │               ├─── sendAndAwait(ctx, cmd)
     │             │              │                  │                  │               │
     │             │              │                  │                  │               │─── Write JSONL to stdin
     │             │              │                  │                  │               │
     │             │              │                  │                  │               │─── Block on pending channel
     │             │              │                  │                  │               │
     │             │              │                  │                  │               │◀── consume() goroutine
     │             │              │                  │                  │               │    reads stdout line-by-line
     │             │              │                  │                  │               │    matches response by id
     │             │              │                  │                  │               │
     │             │              │                  │                  │               │─── Response arrives
     │             │              │                  │                  │               │─── status → idle
     │             │              │                  │                  │               │
     │             │              │                  │                  │◀────────────── nil
     │             │              │                  │                  │               │
     │             │◀───────────── nil ──────────────│                  │               │
     │             │              │                  │                  │               │
     │◀──────────── {ok: true, status: "accepted"} ─│                  │               │
     │             │              │                  │                  │               │
     │             │              │                  │                  │               │
     │             │              │                  │                  │               │
     │ GET /api/worker-status?id=abc
     │────────────▶│              │                  │                  │               │
     │             │─── computeRunningStatus ─────────────────────────▶│               │
     │             │              │                  │                  │               │
     │             │              │                  │                  ├─── Status()
     │             │              │                  │                  │   (may return running)
     │             │              │                  │                  │               │
     │◀──────────── {state: "running", model: "…", thinkingLevel: "…"} ─│                  │               │
     │             │              │                  │                  │               │
     │             │              │                  │                  │               │
     │  [Later]    │              │                  │                  │               │
     │  SSE: agent_end
     │◀──────────── event: reload ──────────────────────────────────────────────────────│
     │             │              │                  │                  │               │
     │  (browser reconciles from `/api/session`; interim assistant text may have appeared earlier via `chat-preview` SSE)
```

## Step-by-Step

### 1. User Submits Chat

Browser sends a `multipart/form-data` POST:

```
POST /api/chat?id=2026-01-15T10-30-00.000Z_a1b2c3d4.jsonl
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="message"

Hello, can you refactor this function?
------WebKitFormBoundary
Content-Disposition: form-data; name="images"; filename="screenshot.png"
Content-Type: image/png

<binary data>
------WebKitFormBoundary--
```

### 2. Request Parsing

`chat.ParseRequest`:

1. Sets `MaxBytesReader` (32 MB default)
2. Calls `ParseMultipartForm`
3. Extracts `message` text field
4. For each `images` file:
   - Read with `io.LimitReader` (10 MB per image)
   - Validate size
   - Detect MIME type (`http.DetectContentType`)
   - Reject non-image types
   - Base64 encode
5. Validate at least one of message or images is present

### 3. Worker Resolution

After parsing succeeds, the server registers the send as server-owned
background work and immediately returns `202 Accepted`. The task uses the
server lifecycle context: graceful shutdown cancels an in-flight RPC wait and
waits for the task to exit before closing shared resources.

`workers.Manager.workerFor(sessionID, sessionPath)`:

```
Lock mutex
  Check existing worker for sessionID
    If exists and not error → return it
    If exists and error → close and delete
Unlock mutex

Create new worker: factory(sessionID, sessionPath)
  → rpc.NewPiWorkerWithStream(sessionPath, streamSink)

Lock mutex
  Double-check no race winner created one
  Store new worker
Unlock mutex

Return worker
```

### 4. RPC Prompt Command

`piRPCWorker.Prompt` builds and sends:

```json
{"id":"req-1","type":"prompt","message":"Hello, can you refactor this function?","images":[{"type":"image","data":"iVBORw0…","mimeType":"image/png"}],"streamingBehavior":"steer"}
```

If the worker is already in `running` state, `streamingBehavior` is `"steer"` to steer an ongoing stream instead of starting a new turn.

### 5. Response Handling

The `consume()` goroutine reads JSONL lines from `pi`'s stdout:

```
{"type":"response","id":"req-1","success":true}
```

It matches by `id` and delivers to the waiting `pending` channel. The worker then updates its status to `idle`.

### 6. Streaming Events

While the AI is generating, `pi` may emit stream events:

```
{"type":"message_update", …}
{"type":"message_update", …}
{"type":"message_end"}
{"type":"turn_end"}
{"type":"agent_end"}
```

These update `lastStreamActivity` so `Status()` continues to report `running` until the stream completes.

### 7. Error Handling

| Error | Response |
|-------|----------|
| Empty request | 400 `{"error": "message or image required"}` |
| Image too large | 413 `{"error": "image attachment too large"}` |
| Unsupported image type | 415 `{"error": "only image attachments are supported"}` |
| Session not found | 404 `{"error": "not found"}` |
| Chat disabled | 409 `{"error": "This session can be viewed, but chat is disabled because its working directory no longer exists."}` |
| RPC failure | 500 `{"error": "…"}` |

### 8. Worker Lifecycle

After 10 minutes of idle time (no user-initiated actions), the reaper goroutine closes idle workers to free resources.

### 9. Cancelling a Chat

`POST /api/chat/cancel?id=<id>` aborts the running worker, removes the terminal's session-status file, broadcasts a `reload` event, and returns `{"ok": true, "status": "cancelled"}`.

### 10. Model Switch Side Effect

`handleSetModel` updates the worker model via RPC. On success, the worker automatically refreshes its thinking level (`refreshThinkingLevel`) so the UI stays consistent.

### 11. Server queue API

The server still owns persistent queue state and its autonomous drainer:

- `GET /api/chat/queue?id=<sessionID>` → `{items, paused}`
- `POST /api/chat/queue?id=<sessionID>` with `{message, displayText}`
- `DELETE /api/chat/queue?id=<sessionID>&position=N`
- `PATCH /api/chat/queue?id=<sessionID>` with `{paused}`

Queue mutations broadcast a named `queue` SSE event. The React products in this beta do not expose the removed live-Svelte steering and queue panel.

---

**E2E coverage:** `e2e/tests/react-products.spec.ts` drives chat through both React products with the stub `pi` worker in `e2e/lib/stub-pi/pi`. See [docs/dev/e2e-testing.md](../dev/e2e-testing.md).
