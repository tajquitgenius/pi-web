# Troubleshooting brief for an AI assistant

The user installed this fork with:

```bash
pi install git:github.com/tajquitgenius/pi-web
```

The package runs [`install.sh`](https://raw.githubusercontent.com/tajquitgenius/pi-web/main/install.sh), or `install.ps1` on Windows. Diagnose the actual failure before proposing changes. Show the evidence and ask before modifying the user's machine.

Expected runtime paths:

- Binary: `~/.pi/agent/bin/pi-web`
- Environment: `~/.config/pi-web/env`
- State: `~/.pi/agent/pi-web/pi-web-state.json`
- macOS service: [`com.pi-web.plist`](https://github.com/tajquitgenius/pi-web/blob/main/init/com.pi-web.plist)
- Linux user service: [`pi-web.service`](https://github.com/tajquitgenius/pi-web/blob/main/init/pi-web.service)

Useful checks:

```bash
~/.pi/agent/bin/pi-web --version
curl -i http://127.0.0.1:31415/
```

On macOS, inspect `launchctl print gui/$(id -u)/com.pi-web` and `/tmp/pi-web.error.log`. On Linux, inspect `systemctl --user status pi-web.service` and `journalctl --user -u pi-web.service`.

Remote access uses an externally managed HTTPS tunnel. `PI_WEB_PUBLIC_URL` declares its exact public origin but does not start the tunnel. Pi-web must remain bound to loopback. Check the separate `cloudflared` service, Cloudflare Access policy, DNS route, and `~/.config/pi-web/env`; do not add `--host 0.0.0.0` as a workaround.

See [`cloudflare-access.md`](cloudflare-access.md) for the intended topology and verification steps.
