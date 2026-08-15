# Terminal Session Ownership

## Invariant

One Pi runtime may write a session JSONL file at a time.

```text
browser operation
      │
      ▼
terminalbridge.Router
      ├── connected terminal lease ──▶ active Pi TUI
      ├── reconnect heartbeat only ──▶ fail closed; do not start RPC
      └── no terminal ownership ─────▶ workers.Manager ──▶ pi --mode rpc
```

A terminal Pi and a pi-web RPC subprocess must never own the same session together. This avoids divergent in-memory session trees and interleaved JSONL writes.

## Ownership selection

Each operation selects its owner once:

1. Resolve the canonical session file.
2. If a validated terminal connection owns the session, send the operation there.
3. If no connection exists but a fresh terminal heartbeat does, reject the operation while the terminal reconnects.
4. Otherwise delegate to the RPC worker manager.

There is no terminal-to-RPC fallback after step 2. A dropped socket, timeout, or missing acknowledgement is ambiguous: the terminal may already have acted. Replaying through RPC or after reconnect could duplicate a prompt or mutation. A later, independent request can use RPC after terminal ownership is fully gone.

Queued prompts follow the same rule. The drainer keeps an item until the selected owner acknowledges it. An ambiguous terminal failure pauses the queue without removing or replaying the item.

## Terminal takeover

A terminal handshake is not published as ready until `workers.Manager.Release` finishes. Release is serialized with worker creation and reaping, closes the RPC worker, kills its child process when necessary, and waits for process exit. Only then can the terminal lease become visible.

A second terminal for the same session is rejected. It cannot replace a live owner.

The handshake also compares the terminal's session UUID and current leaf ID with the JSONL file. A stale terminal whose in-memory leaf is behind disk is rejected and told to quit and resume the session.

## Local security boundary

The terminal bridge is separate from the browser, Main hub, and node relay listeners:

- It binds a new ephemeral port on `127.0.0.1` for each pi-web process.
- `~/.pi/agent/pi-web/terminal-bridge.json` contains the port, process ID, protocol version, and a rotating random 256-bit token.
- The discovery file and containing directory are owner-only (`0600`/`0700` on Unix, user-only DACL on Windows).
- Authentication uses a WebSocket subprotocol, not a URL or loggable command argument.
- The server accepts only `GET /api/terminal/connect`, an exact loopback Host, no query string, no browser `Origin` or fetch metadata, and the expected token.
- Frames, prompt bodies, image data, identifiers, and error text are bounded.
- The main public HTTP mux does not register the terminal route.

Node credentials, browser cookies, pairing credentials, and Cloudflare headers are unrelated to this bridge and never enter it.

## Terminal extension lifecycle

The Pi extension activates only for persisted TUI sessions. It:

- writes a nonce-protected heartbeat before connecting;
- sends session ID, session UUID, current leaf, model, thinking level, and running state in its hello;
- routes prompt/image dispatch, abort, commands, model, thinking level, rename, and labels through public Pi extension APIs;
- updates status on agent, model, and thinking events;
- reconnects with bounded randomized backoff;
- clears ownership on session switch, shutdown, reload disposal, or graceful exit.

A process crash can leave a marker. The server treats it as reconnect quarantine only for a short TTL. Cleanup checks the marker nonce so an older extension instance cannot delete a newer owner's heartbeat.

The runtime uses a process-global singleton because Pi may discover both the package extension and a globally installed copy. Reloading or discovering a duplicate disposes the older copy before the newer one can connect.

## Acknowledgement meaning

`ExtensionAPI.sendUserMessage(...)` is publicly typed as `void`. Therefore a successful terminal prompt response means only that the bridge validated the request and synchronously invoked that API. It does not promise prompt preflight acceptance, provider credentials, or turn completion. Those later outcomes appear through normal Pi state and transcript updates.

This limitation is deliberate: ambiguity is reported rather than hidden, and an acknowledged or ambiguously delivered prompt is never replayed automatically.

## Recovery

If pi-web reports that a terminal session changed on disk, quit that Pi process and resume the session once. `/reload` reloads extensions; it does not import JSONL entries written externally into the terminal's in-memory session tree.

On normal bridge loss, leave the terminal open while it reconnects. pi-web will not start a competing RPC writer during the heartbeat window. To hand the session back to browser-owned RPC intentionally, close the terminal session and wait for ownership cleanup before submitting a new operation.
