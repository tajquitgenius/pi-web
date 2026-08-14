# Architecture Documentation

This directory contains the architecture documentation for **pi-web**, a local web viewer for pi coding-agent sessions.

## Documents

| Document | Description |
|----------|-------------|
| [system-overview.md](./system-overview.md) | High-level system architecture, component diagram, and tech stack |
| [backend.md](./backend.md) | Go backend: packages, responsibilities, and key types |
| [frontend.md](./frontend.md) | Frontend architecture: embedded templates, Vite build, and vanilla JS |
| [data-flow.md](./data-flow.md) | Session file format, data model, and storage layout |

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Browser                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐  │
│  │  / (index)  │  │ /session?id │  │      SSE /events            │  │
│  │  vanilla JS │  │  Embedded   │  │   Live reload + status      │  │
│  │   (Vite)    │  │   HTML/CSS  │  │        updates              │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────────┘  │
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
│  │  Sessions  │ │  Workers   │ │   RPC      │ │  Share (gh)      │  │
│  │  (cache)   │ │  (manager) │ │  (pi CLI)  │ │  (gist create)   │  │
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

3. **Chat via RPC workers**: Each session gets a dedicated `pi --mode rpc` subprocess. Workers are cached and reaped after 10 minutes of idle time.

4. **Dual frontend strategy**:
   - **Index page** (`/`): Built with Vite + vanilla JS, served from embedded `web/dist`
   - **Session page** (`/session`): Server-rendered HTML shell with Vite-built session JS

5. **Security**: Remote deployments keep pi-web on loopback behind an external HTTPS tunnel. `PI_WEB_PUBLIC_URL` declares the exact allowed public origin, and `PI_WEB_TOKEN` provides optional defense in depth. Any direct non-loopback bind still requires the token.
