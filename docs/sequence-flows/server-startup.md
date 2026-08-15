# Sequence Flow: Server Startup

This document traces the execution from `go run ./cmd/pi-web` to the first HTTP request.

## Sequence Diagram

```
┌──────┐   ┌────────┐   ┌──────────┐   ┌──────────┐   ┌─────────┐   ┌────────┐
│  OS  │   │  main  │   │  network │   │  server  │   │ workers │   │  auth  │
└──┬───┘   └───┬────┘   └────┬─────┘   └────┬─────┘   └────┬────┘   └───┬────┘
   │           │             │              │              │            │
   │  exec     │             │              │              │            │
   │──────────▶│             │              │              │            │
   │           │             │              │              │            │
   │           │─── flag.Parse() ──────────▶│              │            │
   │           │             │              │              │            │
   │           │─── os.Stat(sessionsDir) ──▶│              │            │
   │           │             │              │              │            │
   │           │─── chooseBindHost() ──────▶│              │            │
   │           │             │              │              │            │
   │           │◀─────────── host ──────────│              │            │
   │           │             │              │              │            │
   │           │─── os.Getenv(PI_WEB_TOKEN) │              │            │
   │           │             │              │              │            │
   │           │─── auth.New(token) ────────────────────────────────────▶│
   │           │             │              │              │            │
   │           │◀─────────── Middleware ────│              │            │
   │           │             │              │              │            │
   │           │─── server.New(deps) ──────▶│              │            │
   │           │             │              │              │            │
   │           │             │              ├─── go watchFiles() ───────▶│
   │           │             │              │              │            │
   │           │             │              ├─── go startSessionStatusWatcher()│
   │           │             │              │              │            │
   │           │             │              ├─── go runStatusSweeper() ─▶│
   │           │             │              │              │            │
   │           │◀────────── Server ─────────│              │            │
   │           │             │              │              │            │
   │           │─── srv.Register(mux) ─────▶│              │            │
   │           │             │              │              │            │
   │           │─── load React manifests ──▶│              │            │
   │           │             │              │              │            │
   │           │                                                          │
   │           │             │              │              │            │
   │           │─── mux.HandleFunc(/static/{desktop,mobile}/assets/…) ──▶│
   │           │             │              │              │            │
   │           │─── writeStateFile() ────────▶│              │            │
   │           │             │              │              │            │
   │           │─── warmModelsCache() ─────▶│              │            │
   │           │─── warmSessionDefaultsCache() ───────────▶│            │
   │           │             │              │              │            │
   │           │─── openBrowser(url) ──────▶│              │            │
   │           │   (if -o flag)             │              │            │
   │           │             │              │              │            │
   │           │─── http.ListenAndServe() ─▶│              │            │
   │           │             │              │              │            │
   │           │◀──────────── Blocks ───────│              │            │
```

## Step-by-Step

### 1. CLI Flag Parsing

```go
port := flag.String("p", "31415", "port to listen on")
hostOverride := flag.String("host", "", "host/IP to bind; defaults to 127.0.0.1")
publicURL := flag.String("public-url", os.Getenv("PI_WEB_PUBLIC_URL"), "externally managed absolute HTTPS origin")
open := flag.Bool("o", false, "auto-open browser")
insecure := flag.Bool("insecure", false, "allow non-loopback bind without PI_WEB_TOKEN")
developmentMode := os.Getenv("PI_WEB_DEV") == "1"
```

### 2. Agent & Sessions Directory

```go
agentDir := piAgentDir()  // respects PI_CODING_AGENT_DIR, falls back to ~/.pi/agent
sessionsDir := filepath.Join(agentDir, "sessions")
if _, err := os.Stat(sessionsDir); os.IsNotExist(err) {
    fmt.Fprintf(os.Stderr, "sessions directory not found: %s\n", sessionsDir)
    os.Exit(1)
}
```

`piAgentDir()` checks `PI_CODING_AGENT_DIR` first, then falls back to `~/.pi/agent`. Exits early if the sessions directory doesn't exist (the user hasn't run `pi` yet).

### 3. Host Selection

Priority:
1. `--host` flag (explicit override)
2. `127.0.0.1` (default)

`PI_WEB_PUBLIC_URL` supplies the default for `--public-url`; the flag can
override it. The value must be an absolute HTTPS origin with no user
information, non-root path, query, or fragment. If configured, the bind host
must be loopback even when `--insecure` is present.

pi-web records this origin but does not start an HTTPS tunnel or proxy. The
external proxy must terminate TLS and preserve the public `Host` and `Origin`.
pi-web does not trust proxy-specific headers.

### 4. Auth Enforcement

```go
if token == "" && !isLoopbackHost(bindHost) && !*insecure {
    fmt.Fprintf(os.Stderr, "refusing to bind %s without PI_WEB_TOKEN set…\n")
    os.Exit(1)
}
```

Non-loopback binds **require** `PI_WEB_TOKEN` to prevent unauthorized access over the network. Public HTTPS mode instead requires loopback and adds the public hostname to the auth allowlist. If optional token auth is also configured, login cookies created through the public hostname are marked `Secure`; local HTTP cookies are not.

### 5. Server Construction

```go
srv, err := server.New(server.Deps{
    AgentDir:      agentDir,
    SessionsDir:   sessionsDir,
    Auth:          authMiddleware,
    ChatSender:    workers.NewManager(func(sessionID, sessionPath string) (workers.ChatWorker, error) {
        return rpc.NewPiWorkerWithStream(sessionPath, func(preview rpc.StreamPreview) {
            if srv != nil {
                srv.BroadcastChatPreview(sessionID, preview)
            }
        })
    }),
    Cache:               sessions.NewCache(),
    RenderAppShell:      ui.RenderAppShell,
    RenderExportSession: ui.RenderExportSessionPage,
    Models:                func(ctx context.Context) (json.RawMessage, error) { … },
    DisableBackgroundJobs: developmentMode,
})
if err != nil { os.Exit(1) } // agent-dir / SQLite schema init failed
```

`server.New` returns an error and aborts startup if the agent directory or
SQLite schema (`initDB`) can't be initialized, rather than running with a
half-initialized database that fails opaquely on first use.

On success, server creation immediately spawns three background goroutines:

1. **`watchFiles()`** — watches `sessionsDir` for changes (fsnotify + polling fallback)
2. **`startSessionStatusWatcher()`** — watches `session-status/` for terminal activity
3. **`runStatusSweeper()`** — revalidates running status every second

### 6. Route Registration

All routes are wrapped with `auth.Wrap`:

```go
mux.HandleFunc("/", s.auth.Wrap(s.handleIndex))
mux.HandleFunc("/session", s.auth.Wrap(s.handleSession))
mux.HandleFunc("/api/chat", s.auth.Wrap(s.handleChat))
// … etc
```

### 7. Static Asset Loading

```go
builds := []productBuild{
    {web.DesktopDistFS(), frontend.DesktopEntry, "/static/desktop"},
    {web.MobileDistFS(), frontend.MobileEntry, "/static/mobile"},
}
for _, build := range builds {
    scripts, err := frontend.LoadScriptsAt(build.fs, build.assetBase, build.entry)
    // Register the hashed entrypoint, its surface-owned styles, and its chunks.
}
```

Each React Vite manifest resolves inside its own URL namespace, so desktop and mobile assets cannot collide.

### 8. State File

```go
writeStateFile(agentDir, developmentMode, bindHost, port, publicURL)
// regular → ~/.pi/agent/pi-web/pi-web-state.json
// PI_WEB_DEV=1 → ~/.pi/agent/pi-web/pi-web-state-dev.json
```

The regular state file remains the discovery target for the pi extension.
`make dev` sets the internal `PI_WEB_DEV=1` environment and uses its own state
file and lock, allowing the source checkout to share sessions and SQLite data
with the installed server on another port. Development mode disables
autonomous scheduling, queue draining, auto-titling, and push delivery to avoid
duplicate side effects. State files contain the development marker, PID, port,
host, normalized `publicUrl`, and start time, and are cleaned up on graceful
shutdown. The regular path still migrates the old `~/.pi/agent/pi-web-state.json` location on first run.

### 9. Model and Session Defaults Cache Warming

```go
warmModelsCache()          // async goroutine
warmSessionDefaultsCache() // async goroutine
```

`warmModelsCache` spawns `pi --mode rpc` once to fetch the model list, so the first session page load doesn't wait. Startup also calls `warmSessionDefaultsCache` in a goroutine to load the current provider, model, and thinking level without delaying HTTP readiness.

The session-defaults cache keeps successful results for five minutes and coalesces concurrent refreshes into one `ResolveSessionDefaults` call. It stores only fully validated results. RPC failures and missing or unknown model sentinels are not cached, so requests fail closed with unavailable defaults and a later request can retry.

### 10. Listen

```go
httpServer := &http.Server{
    Addr:              addr,
    Handler:           mux,
    ReadHeaderTimeout: 10 * time.Second,
    IdleTimeout:       120 * time.Second,
}
httpServer.ListenAndServe()
```

Blocks until interrupted. On `SIGINT`/`SIGTERM` the server performs a graceful shutdown (5s timeout) and calls `srv.Shutdown()` to stop background goroutines.
