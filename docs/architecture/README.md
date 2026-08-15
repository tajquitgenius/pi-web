# Architecture Documentation

This directory contains the architecture documentation for **pi-web**, a local web viewer for pi coding-agent sessions.

## Documents

| Document                                                           | Description                                                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [system-overview.md](./system-overview.md)                         | High-level system architecture, component diagram, and tech stack                                    |
| [backend.md](./backend.md)                                         | Go backend: packages, responsibilities, and key types                                                |
| [device-pairing.md](./device-pairing.md)                           | Public device gate, credentials, local administration, and SQLite storage                            |
| [host-hub.md](./host-hub.md)                                       | Main's same-origin Work/Personal node enrollment, relay, and streaming boundary                      |
| [terminal-ownership.md](./terminal-ownership.md)                    | Single terminal-or-RPC runtime ownership, local bridge security, and failure semantics               |
| [frontend.md](./frontend.md)                                       | Frontend architecture: React products, typed client, and isolated static export                      |
| [data-flow.md](./data-flow.md)                                     | Session file format, data model, and storage layout                                                  |
| [../pi-product-expansion-plan.md](../pi-product-expansion-plan.md) | Approved minimal plan for models, extension services, Agents, Discuss, BTW, mobile PWA, and Electron |

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Browser                                    │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐ │
│  │ React desktop    │  │ React mobile     │  │ SSE /events       │ │
│  │ / /session      │  │ / /session      │  │ reload + status   │ │
│  │ /settings        │  │ /settings        │  │ updates           │ │
│  └──────────────────┘  └──────────────────┘  └───────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ HTTP
┌─────────────────────────────────────────────────────────────────────┐
│                        pi-web HTTP Server                            │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────────┐  │
│  │   Auth     │ │  Handlers  │ │   SSE      │ │  File Watcher    │  │
│  │Middleware  │ │  (server)  │ │ (events)   │ │ (fsnotify/poll)  │  │
│  └────────────┘ └────────────┘ └────────────┘ └──────────────────┘  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────────┐  │
│  │  Sessions  │ │ Terminal   │ │ RPC fallback│ │  Share (gh)      │  │
│  │  (cache)   │ │  bridge    │ │  (pi CLI)  │ │  (gist create)   │  │
│  └────────────┘ └────────────┘ └────────────┘ └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ filesystem
┌─────────────────────────────────────────────────────────────────────┐
│                    ~/.pi/agent/sessions/                             │
│         Project dirs  →  JSONL session files                         │
│         (--name--)        (timestamp_uuid.jsonl)                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

1. **Append-only session metadata**: pi-web reads from `~/.pi/agent/sessions/` and avoids rewriting session history. New sessions can be created via the web UI, and browser rename appends a `session_info` metadata line to the existing JSONL file.

2. **Live updates via SSE**: The browser opens an EventSource connection. The server watches session files via `fsnotify` (with polling fallback) and pushes `reload` events; session pages fetch `/api/session` to reconcile canonical JSONL entries. Browser chat can also receive best-effort `chat-preview` SSE events before JSONL reconciliation.

3. **One runtime owner per session**: An active terminal Pi owns its session through the authenticated terminal bridge. Only sessions without a terminal lease may use a dedicated `pi --mode rpc` subprocess. Ownership transfer waits for the old RPC process to exit, and ambiguous terminal delivery never falls back or replays. See [Terminal Session Ownership](terminal-ownership.md).

4. **Separate live products and export**:
   - **Desktop and mobile**: Independent React/Vite outputs selected by cookie or conservative user-agent classification
   - **Static export**: A separate self-contained Svelte bundle with no live-server dependency

5. **Security**: Remote deployments keep pi-web on loopback behind an external HTTPS tunnel. `PI_WEB_PUBLIC_URL` declares the exact public origin and activates persistent device pairing there; `PI_WEB_TOKEN` remains optional defense in depth. Any direct non-loopback bind still requires the token.

6. **Main host hub**: `pi.tajwar.org` owns the installed PWA and browser pairing. Work and Personal connect outbound as independently owned nodes; Main relays only explicitly allowed live API and SSE traffic under same-origin host paths.
