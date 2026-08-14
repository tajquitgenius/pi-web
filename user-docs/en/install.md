# Installation & Usage

## Features

### Remote control

- Continue any session from the browser with text or image attachments
- Start a brand-new session against any project path, right from the web UI
- In-browser model switching and thinking-level selector, per session
- Per-session worker status (idle / running / error) with auto-recovery on crash
- Multiple sessions run in parallel — kick off work in one, watch another stream
- Loopback-only remote access through an externally managed HTTPS tunnel
- Exact public Host and Origin validation with optional `PI_WEB_TOKEN` defense in depth
- Persistent computer identity and navigation links between independent installations

### Reading sessions

- Browse sessions across projects with filters, search, and full branch navigation
- Live incremental updates while pi is still running (via fsnotify; ~ms latency)
- Follow mode for tailing active sessions
- Deep links to individual messages
- Download a session as JSONL
- Share static snapshots as secret GitHub Gists
- `/web`, `/remote`, `/refresh`, `/pi-web token` and `/pi-web set-token` pi extensions for opening sessions, remote QR, session sync, and token management

## Requirements

- [Go](https://go.dev) 1.25+ (only for building from source)
- `pi` on your `PATH` for browser chat/model switching
- Optional: `gh` for sharing
- On Windows: pi needs a bash shell for its shell tool — [Git for Windows](https://git-scm.com/download/win) is enough (see pi's Windows docs)

## Install

### Pi package (recommended)

If `@ygncode/pi-web` is already installed, remove it first. The fork intentionally keeps the same commands, binary, service, and data paths, so the two packages cannot coexist safely.

```bash
# Run this first only when migrating from upstream:
pi remove npm:@ygncode/pi-web

pi install git:github.com/tajquitgenius/pi-web
```

The install command:
- Installs the current, unpinned fork from GitHub
- Runs the package `postinstall` script (`install.sh`, or `install.ps1` on Windows)
- Downloads the matching pi-web binary for the checked-out package version and platform from this fork's GitHub Releases
- Installs it to `~/.pi/agent/bin/pi-web` (`pi-web.exe` on Windows)
- Sets up auto-start on login (launchd on macOS, systemd on Linux, a Run-key launcher on Windows)
- Registers the `/web`, `/remote`, `/refresh`, `/pi-web token`, and `/pi-web set-token` pi commands

Session auto-titling is built into pi-web (not the extension) and configured on the `/settings` page. It's on by default: pi-web names sessions automatically using a free built-in word heuristic (no AI), re-titling on every new message. You can switch to titling once per session, and/or pick a model to write smarter titles instead of the heuristic.

On Linux, auto-start is configured as a user systemd service at `~/.config/systemd/user/pi-web.service`. The installer rewrites its `ExecStart` to the actual installed binary path. If user systemd is unavailable, run it manually with `~/.pi/agent/bin/pi-web -o`.

Then restart Pi or run `/reload`. Use `/web` for local access and `/remote` after configuring `PI_WEB_PUBLIC_URL`. Manage the optional second-layer token with `/pi-web token` and `/pi-web set-token`.

### Quick install (no build tools needed)

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tajquitgenius/pi-web/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/tajquitgenius/pi-web/main/install.ps1 | iex
```

This downloads the latest pi-web binary, installs it to `/usr/local/bin` (`~/.pi/agent/bin` on Windows), and sets up auto-start on login. No Go, Node, or pi required.

### Download binary

Pre-built binaries are attached to each [GitHub Release](https://github.com/tajquitgenius/pi-web/releases).

```bash
# macOS (Apple Silicon)
curl -L -o pi-web https://github.com/tajquitgenius/pi-web/releases/latest/download/pi-web-darwin-arm64
chmod +x pi-web

# macOS (Intel)
curl -L -o pi-web https://github.com/tajquitgenius/pi-web/releases/latest/download/pi-web-darwin-amd64
chmod +x pi-web

# Linux (amd64)
curl -L -o pi-web https://github.com/tajquitgenius/pi-web/releases/latest/download/pi-web-linux-amd64
chmod +x pi-web

# Linux (arm64)
curl -L -o pi-web https://github.com/tajquitgenius/pi-web/releases/latest/download/pi-web-linux-arm64
chmod +x pi-web
```

```powershell
# Windows (x64)
irm -OutFile pi-web.exe https://github.com/tajquitgenius/pi-web/releases/latest/download/pi-web-windows-amd64.exe

# Windows (ARM64)
irm -OutFile pi-web.exe https://github.com/tajquitgenius/pi-web/releases/latest/download/pi-web-windows-arm64.exe
```

Then move it to your PATH:

```bash
cp pi-web ~/.pi/agent/bin/
# or system-wide:
sudo cp pi-web /usr/local/bin/
```

### Build from source

```bash
git clone https://github.com/tajquitgenius/pi-web.git
cd pi-web
make build   # builds the Vite bundle, then embeds it into the Go binary

# optional: put it on PATH
cp pi-web ~/.pi/agent/bin/
```

The frontend bundle is embedded by `web/assets_embed.go`, so `go build` needs
`web/dist` to exist first. `make build` does both steps in order; if you build
by hand, run `npm --prefix web install && npm --prefix web run build` before
`go build ./cmd/pi-web`.

### Develop alongside an installed instance

Leave the installed instance running on port `31415`, then start the source
checkout in development mode:

```bash
make dev
```

Open `http://127.0.0.1:31416`. `make dev` sets the internal `PI_WEB_DEV=1`
development environment, so the source checkout shares sessions, settings, and
SQLite data with the installed instance while keeping a separate development
runtime lock and state file. Regular installed and manually launched instances
are unchanged and retain the original single-instance behavior.

To prevent duplicate autonomous work, development mode does not run the
schedule loop, chat-queue drainer, auto-titling, or push notifications. Direct
requests made through the development UI still work. Do not drive the same
chat session from both instances at once; each process has its own RPC worker
manager.

`make dev` requires [Air](https://github.com/air-verse/air) for Go hot reload:

```bash
go install github.com/air-verse/air@latest
```

`PI_WEB_DEV` is development harness plumbing, not a supported production
multi-instance mode.

## Uninstall

```bash
pi remove git:github.com/tajquitgenius/pi-web
```

This runs the package `preuninstall` script (`uninstall.sh`, or `uninstall.ps1`
on Windows), which stops the running instance and removes:

- the pi-web binary (`~/.pi/agent/bin/pi-web`, or `/usr/local/bin/pi-web` for standalone installs)
- the version file (`~/.pi/agent/pi-web-version`)
- the runtime state file (`~/.pi/agent/pi-web/pi-web-state.json`)
- the auto-start config (launchd plist on macOS, systemd user service on Linux, Run-key entry + launcher scripts on Windows)

Your data is preserved so a later reinstall picks up where you left off:
`~/.pi/agent/pi-web.sqlite`, `~/.pi/agent/pi-web-memory.sqlite`, your session
files under `~/.pi/agent/sessions/`, and `~/.config/pi-web/env` (including
`PI_WEB_TOKEN`). Remove those manually if you want a clean slate.

## Usage

```bash
# Start on the default port (31415)
pi-web

# Start and open a browser
pi-web -o

# Custom port
pi-web -p 8080

# Override bind host (loopback is unauthenticated by default)
pi-web --host 127.0.0.1

# Non-loopback bind requires a token — pi-web refuses to start otherwise
PI_WEB_TOKEN=$(openssl rand -hex 16) pi-web --host 192.168.1.50
```

By default, pi-web binds to `127.0.0.1`. An explicit non-loopback bind requires `PI_WEB_TOKEN`; `--insecure` exists only for temporary local testing.

## Remote Access

Keep pi-web on loopback and publish it through an externally managed HTTPS tunnel. Declare the exact browser origin with `PI_WEB_PUBLIC_URL`:

```bash
cat > ~/.config/pi-web/env <<'EOF'
PI_WEB_INSTANCE_NAME='Personal laptop'
PI_WEB_PUBLIC_URL=https://personal-pi.example.com
PI_WEB_PEERS_JSON='[{"label":"Work laptop","url":"https://work-pi.example.com"}]'
PI_WEB_TOKEN=replace-with-a-random-token
EOF
```

Use straight single quotes around values containing spaces or JSON. The startup loaders remove one matching outer quote pair.

Restart pi-web, then use `/remote` to show the public URL and QR code. The command never places the token in the URL.

`PI_WEB_PUBLIC_URL` must be an origin-only HTTPS URL: no path, query, fragment, credentials, or wildcard. When set, pi-web refuses a non-loopback bind and accepts browser traffic only for that hostname. It marks the token cookie Secure on the public host.

See [Remote access with Cloudflare Access](cloudflare-access.md) for the recommended tunnel and identity configuration.

> Remote pi-web access is equivalent to remote code execution as your operating-system user. Require an exact-user identity policy at the tunnel edge, keep the application token for defense in depth, and never publish port `31415` directly.

## Browser Chat

Open a session page and use the composer at the bottom to continue that exact session.

- `Enter` sends, `Shift+Enter` inserts a newline
- Drag-and-drop or paste images directly into the composer
- The model picker and thinking-level selector live in the header — changes apply to the underlying pi worker immediately
- Each active session gets its own dedicated `pi --mode rpc` worker, so different sessions don't block each other

## Sharing Sessions

Click **Share** on a session page to create a secret GitHub Gist.

Requirements:
- `gh` installed
- `gh auth login` completed

Sharing returns:
- the secret gist URL
- a preview URL at `https://pi.dev/session/#<gistId>`

Shared gists are snapshots and do not live-update.

## Auto-Start on Login

### macOS

```bash
cp init/com.pi-web.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.pi-web.plist
```

### Linux (systemd)

```bash
# Install the systemd user service
mkdir -p ~/.config/systemd/user
cp init/pi-web.service ~/.config/systemd/user/

# Optional: set your PI_WEB_TOKEN for non-loopback binds
# (or use /pi-web set-token <token> from inside pi)
mkdir -p ~/.config/pi-web
echo 'PI_WEB_TOKEN=your-token-here' > ~/.config/pi-web/env

# Enable and start
systemctl --user daemon-reload
systemctl --user enable --now pi-web.service

# Check status
systemctl --user status pi-web.service

# View logs
journalctl --user -u pi-web.service -f
```

> To keep the user service running after logout and start it at boot, enable lingering for that user with `sudo loginctl enable-linger "$USER"`. Do not copy this user unit into `/etc/systemd/system`; a system-wide service needs an explicit user and home-directory configuration.

### Windows

The installer configures this automatically, without needing admin rights: a
`pi-web` entry under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
launches `~/.config/pi-web/pi-web-start.vbs` at login, which starts the binary
hidden (no console window) after loading `~/.config/pi-web/env`
(`PI_WEB_TOKEN`, `PATH`, ...).

To manage it by hand:

```powershell
# Start / stop
wscript.exe "$HOME\.config\pi-web\pi-web-start.vbs"
taskkill /IM pi-web.exe /F

# Remove auto-start
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'pi-web'
```

There is no service supervision on Windows: if pi-web crashes it stays down
until the next login (launchd/systemd restart it automatically on the other
platforms).
