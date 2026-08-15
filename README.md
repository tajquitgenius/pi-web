<h1 align="center">pi-web</h1>

<p align="center">
A browser control surface for Pi sessions running on your laptops and cloud hosts.
</p>

<p align="center">
<a href="https://github.com/tajquitgenius/pi-web/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/tajquitgenius/pi-web/actions/workflows/ci.yml/badge.svg"></a>
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-0f766e"></a>
</p>

> [!NOTE]
> This is a focused fork of [ygncode/pi-web](https://github.com/ygncode/pi-web). It keeps the same runtime and data paths, so install it as a replacement rather than alongside upstream.

pi-web reads Pi's local session files and uses `pi --mode rpc` when you continue a conversation from the browser. Each installation owns only the sessions on that computer.

## What this fork adds

- Persistent computer identity on every session and workspace screen
- Two-click switching between personal, work, and cloud installations
- An active-first dashboard that separates running work from session history
- A conversation-first session view with collapsed metadata and context panels
- Larger, accessible mobile controls and readable system typography
- Generic HTTPS public-origin support for Cloudflare Tunnel or another trusted reverse proxy
- Loopback-only remote topology with exact Host and Origin validation
- GitHub-owned releases and updates that cannot silently reinstall upstream

## Architecture

```text
Phone / personal laptop / work laptop
                 │
          ordinary HTTPS
                 │
 Cloudflare Access (Google)
                 │
 pairing (Main) or external mode (peers)
                 │
       Cloudflare Tunnel
                 │
       127.0.0.1:31415
              pi-web
                 │
  local session files + Pi RPC workers
```

Run one independent installation per computer. `pi.tajwar.org` remains the canonical Main hub and links to every configured server, including the Work laptop at `work-pi.tajwar.org`. Each link performs a top-level navigation. Pi-web never aggregates sessions, sends cross-origin API requests, or shares credentials between hosts.

## Install

Install the current fork from Git. Pi remains an unpinned peer dependency. If upstream pi-web is already installed, remove it first; the two packages register the same commands and service and cannot coexist safely.

```bash
# Run this first only when migrating from upstream:
pi remove npm:@ygncode/pi-web

pi install git:github.com/tajquitgenius/pi-web
```

The package downloads the matching binary from this fork's GitHub release, configures startup, and registers `/web`, `/remote`, `/refresh`, and `/pi-web`.

Open the local interface at:

```text
http://127.0.0.1:31415
```

## Configure an instance

Create or edit `~/.config/pi-web/env` on each computer:

```bash
PI_WEB_INSTANCE_NAME='Main'
PI_WEB_PUBLIC_URL=https://pi.tajwar.org
PI_WEB_REMOTE_AUTH=pairing
PI_WEB_PEERS_JSON='[{"label":"Work laptop","url":"https://work-pi.tajwar.org"},{"label":"Personal","url":"https://personal-pi.tajwar.org"}]'
# Optional extra defense after Access:
# PI_WEB_TOKEN=replace-with-a-random-token
```

Use straight single quotes around values containing spaces or JSON. The macOS, Linux, and Windows startup loaders remove one matching outer quote pair.

Generate the optional second-layer token with:

```bash
openssl rand -hex 24
```

Restart pi-web after changing the file:

```text
/pi-web restart
```

`PI_WEB_PUBLIC_URL` does not create or manage a tunnel. It declares the exact HTTPS origin that your external tunnel serves, allowing pi-web to validate browser Host and Origin headers. Pi-web continues listening only on loopback.

Device pairing remains the default when `PI_WEB_REMOTE_AUTH` is unset or set to `pairing`. `PI_WEB_REMOTE_AUTH=external` disables the `pi_device` gate. Use it only when a trusted external proxy authenticates every remote request; that proxy becomes the sole remote access and revocation boundary.

See [Cloudflare Access setup](user-docs/en/cloudflare-access.md) for the recommended remote configuration.

## Commands

| Command | Purpose |
|---|---|
| `/web` | Open the current session on this computer |
| `/remote` | Show the configured public URL and QR code |
| `/refresh` | Pull browser-written messages into the terminal session |
| `/pi-web status` | Show local and public addresses |
| `/pi-web restart` | Reload service and environment configuration |
| `/pi-web update` | Update from this fork's unpinned Git source |

## Security boundary

A remote user can execute commands and modify files available to the operating-system user running Pi. Keep pi-web on `127.0.0.1` and require an exact-user policy in Cloudflare Access. Pairing mode adds per-device credentials and revocation. External mode deliberately removes that gate, so the authenticated tunnel becomes the sole remote boundary. `PI_WEB_TOKEN` remains optional defense in depth. Never publish port `31415` directly or use `--insecure` for remote access.

Cloudflare credentials do not belong in pi-web. Install and supervise `cloudflared` separately with Cloudflare's official service.

## Development

```bash
make setup
make test
make build
make check
```

Always use `make build`; the Go binary embeds the Vite frontend and static export bundle.

See [Third-party notices](THIRD_PARTY_NOTICES.md) for upstream attribution.
