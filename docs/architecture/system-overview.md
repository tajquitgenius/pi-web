# System Overview

## What pi-web Does

pi-web is a local HTTP server that lets you browse and interact with your pi coding-agent sessions in a web browser. It scans `~/.pi/agent/sessions/`, renders a dark-themed UI, and supports live-reloading, chat continuation, and session sharing.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Go 1.25+ |
| Frontend (live app) | Separate React desktop and mobile Vite builds selected per request; a Svelte 5 live build remains embedded during cutover |
| Shared live transport | Typed `PiWebClient` contracts for HTTP, host context, SSE, and future pairing operations |
| Static export | Independent Svelte IIFE rendered through Go `html/template`; self-contained and isolated from all live bundles |
| Styling | Surface-owned live CSS plus the existing multi-theme shell variables |
| Live Updates | Server-Sent Events (SSE) |
| Chat RPC | JSONL over stdin/stdout via `pi --mode rpc` |
| Session Storage | JSONL files on disk; pi-web creates new session files and appends `session_info` for browser rename |
| Local DB | SQLite (`~/.pi/agent/pi-web.sqlite`) for per-project scratchpads, per-session review annotations, project visibility prefs, server-backed user settings, and the btw scratch-chat registry |
| Auth | Token cookie/query/header (optional on localhost) |

## Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                 Browser                                   │
│                                                                           │
│   cookie + conservative UA classification                                 │
│                    │                                                      │
│          ┌─────────┴─────────┐                 ┌──────────────────────┐   │
│          ▼                   ▼                 │ PiWebClient          │   │
│   React desktop       React mobile             │ HTTP · host · SSE    │   │
│   / /session          / /session               └──────────────────────┘   │
│   /settings           /settings                            │              │
│          │                   │                              │              │
│          └─────────┬─────────┘                              │              │
│                    └────────────────────────────────────────┘              │
│   Retained separately: Svelte live SPA · self-contained Svelte export     │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                              HTTP Router                                  │
│                                                                           │
│   GET  /              →  handleIndex      (SPA shell)                    │
│   GET  /session       →  handleSession    (SPA shell)                    │
│   GET  /settings      →  handleSettingsPage (SPA shell)                  │
│   GET  /api/session   →  handleApiSession  (JSON)                        │
│   GET  /api/sessions  →  handleApiSessions (JSON list)                   │
│   POST /api/chat      →  handleChat        (multipart or JSON)           │
│   POST /api/chat/cancel → handleCancelChat                               │
│   POST /api/set-model →  handleSetModel                                  │
│   POST /api/set-thinking-level → handleSetThinkingLevel                  │
│   POST /api/new-session / fork-session / clone-session                   │
│   POST /api/rename-session → handleRenameSession                         │
│   POST /api/label-session → handleLabelSessionEntry                      │
│   GET  /api/models    →  handleAvailableModels                           │
│   GET  /api/commands  →  handleCommands       (slash-command palette)    │
│   GET  /api/worker-status → handleWorkerStatus                           │
│   GET  /api/btw / POST /api/btw/new → btw scratch-chats (SQLite, SSE)    │
│   GET  /api/files     →  handleApiFiles       (@mention autocomplete)    │
│   GET  /api/git/info  / POST /api/git/rename-branch                      │
│   GET  /api/git/diff → working-tree diff for the diff modal              │
│   GET/POST/DELETE /api/diff/reviews → diff review comments (SQLite)      │
│   GET/POST /api/scratchpad → scratchpad (SQLite)                         │
│   GET/POST/DELETE /api/annotations → review annotations (SQLite, SSE)    │
│   GET/POST /api/settings → user settings (SQLite, write-through cache)   │
│   GET/POST /api/projects → project visibility prefs (SQLite)             │
│   GET  /api/sounds  /  GET /sounds/…   (notification sounds)             │
│   POST /share         →  handleShare         (GitHub Gist)               │
│   GET  /events        →  handleEvents        (SSE)                       │
│   GET  /api/recent-locations → handleRecentLocations                     │
│   GET  /custom-themes.css → handleCustomThemes                           │
│   /api/push/{vapid,subscribe,unsubscribe}  (web-push, optional)         │
│   /api/{version,check-update,update,restart} (self-update, optional)    │
│   GET  /metrics / /api/metrics → worker metrics dashboard (gopsutil)    │
│   PWA: /manifest.webmanifest, /sw.js, /icon.svg, /cat.webm, …           │
│   GET  /static/{assets,desktop/assets,mobile/assets}/… → embedded builds │
│                                                                           │
│   All handlers wrapped with auth.Middleware (token check)                │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
         ▼                          ▼                          ▼
   ┌──────────┐            ┌──────────────┐           ┌──────────────┐
   │ Sessions │            │    Chat      │           │   File       │
   │  Cache   │            │   Workers    │           │  Watchers    │
   │          │            │              │           │              │
   │ LoadAll  │            │ Manager      │           │ fsnotify     │
   │ ParseFile│            │  ├─ worker   │           │  ├─ debounce │
   │ Resolve  │            │  ├─ reap     │           │  └─ fallback │
   │ Create   │            │  └─ status   │           │ polling      │
   └──────────┘            └──────────────┘           └──────────────┘
                                    │
                                    ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │                    External Processes                             │
   │                                                                   │
   │   pi --mode rpc          (per-session chat worker subprocess)     │
   │   gh gist create         (share session as private gist)          │
   │                                                                   │
   └──────────────────────────────────────────────────────────────────┘
```

## Network Binding

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   --host flag   │──────────────────────▶│  127.0.0.1      │
│   (override)    │                       │  (default)      │
└─────────────────┘                       └─────────────────┘
         │
         ▼
   Non-loopback →  PI_WEB_TOKEN required  (or --insecure)
   Loopback     →  Auth optional

`PI_WEB_PUBLIC_URL` or `--public-url` records an externally managed HTTPS
origin. When configured, pi-web must keep its bind host on loopback. The proxy
terminates TLS and forwards to the local HTTP listener while preserving the
public `Host` and `Origin`. pi-web neither runs the proxy nor trusts
proxy-specific headers.

The public URL must be an absolute HTTPS origin with no user information,
non-root path, query, or fragment. Its hostname is added to the auth host
allowlist and becomes the device-pairing boundary. Unpaired public requests can
load only the pairing bootstrap and submit or check pairing; paired requests
continue through the optional `PI_WEB_TOKEN` layer. Loopback Host values remain
locally trusted for code creation and device administration. Pi-web never uses
tunnel-forwarded headers to decide which side of this boundary a request uses.
See [Device Pairing Backend](device-pairing.md).

`PI_WEB_INSTANCE_NAME` and `PI_WEB_PEERS_JSON` supply the read-only multi-host
context embedded in the SPA shell; peer URLs follow the same HTTPS origin rules.
```

## Session Directory Layout

```
~/.pi/agent/
├── sessions/
│   ├── --project-name--/
│   │   ├── 2026-01-15T10-30-00.000Z_a1b2c3d4.jsonl
│   │   ├── 2026-01-15T11-00-00.000Z_e5f6g7h8.jsonl
│   │   └── …
│   └── --another--project--/
│       └── …
├── session-status/
│   ├── 2026-01-15T10-30-00.000Z_a1b2c3d4.jsonl   ← terminal writes here
│   └── …
├── pi-web.sqlite           ← app data + pairing code/device hashes + rate-limit timestamps
└── pi-web/
    ├── device-pairing.key      ← owner-only HMAC key for short pairing codes
    ├── pi-web-state.json       ← regular server state + lock
    ├── pi-web-state-dev.json   ← development state + lock (while running)
    ├── custom-themes.css       ← optional user custom theme
    ├── vapid.json          ← web-push VAPID keys (when push enabled)
    └── push-subs.json      ← web-push subscriptions (when push enabled)
```

## Project Visibility

Project filtering is an **opt-in master switch**, stored in the `app_settings`
SQLite table (`project_filter_enabled`, default **off**). Per-project enable
state lives in the `project_prefs` table. Both are server-side, so they sync
across devices. See `internal/server/projects.go`.

- **Filter off (default):** every session shows; new sessions (web- or
  terminal-created) appear immediately, exactly like before the feature existed.
- **Filter on:** the index only renders sessions whose project is **enabled** —
  an allowlist. Projects discovered after the table is first seeded default to
  hidden, so one-off folders stay out of view.
- **First seed** (empty `project_prefs`): every discovered project is enabled, so
  turning the filter on doesn't blank the homepage.
- **Registering** a folder path (`action: register`) pre-approves it so sessions
  that later land there show immediately, even before any session exists.
- Filtering is applied server-side in both `handleIndex` and `handleApiSessions`
  (no client flash) and is a no-op while the master switch is off. Manage via the
  index menu → **Manage Projects** (search, select/deselect-all, register, and the
  filter switch), backed by `GET/POST /api/projects`.

## Startup Order

1. Parse CLI flags (`-p`, `-host`, `-public-url`, `-o`, `-insecure`, `-version`) and detect internal `PI_WEB_DEV=1` development mode
2. Validate sessions directory exists
3. Determine the bind host and validate the optional public HTTPS origin and host context
4. Require loopback binding for a public origin; otherwise enforce auth for explicit non-loopback binds
5. Add the bind and public hostnames to the auth allowlist
6. Build `server.Deps` (renderers, cache, workers, auth, public URL)
7. Create `Server` → migrate pairing storage, load/create its HMAC key, then start watchers and sweepers
8. Register routes on `http.ServeMux`
9. Load Vite manifest and register static assets
10. Wrap the complete mux in the exact Host/Origin boundary and public device gate
11. Write and lock the regular state file, or `pi-web-state-dev.json` in development mode
12. Optionally open the local URL in a browser
13. Warm models cache (async)
14. Start `http.Server` with timeouts; graceful shutdown on `SIGINT`/`SIGTERM`

The internal development mode shares session files and SQLite data but disables
the autonomous scheduler, chat-queue drainer, auto-titler, and push delivery.
This allows `make dev` to run on port `31416` beside the installed server on
`31415` without duplicating background side effects. Regular release behavior
and its single-instance lock remain unchanged, and its state file stays
authoritative for `/web` and `/remote` discovery.
