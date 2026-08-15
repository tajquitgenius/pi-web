# Remote access with Cloudflare Access

Use this setup to reach pi-web from another laptop or phone without exposing pi-web to the local network or Internet.

```text
Browser → Cloudflare Access → named tunnel → 127.0.0.1:31415 → pi-web
```

Remote pi-web access is equivalent to remote code execution as the operating-system user running Pi. Keep every origin on loopback and require Cloudflare Access on every published hostname. Work and Personal connectors validate the Access audience; Main relies on the edge applications plus pi-web's pairing or hub-machine authentication because its narrow `/api/hub/*` Bypass cannot carry an Access JWT.

## Host map

Each computer runs an independent pi-web process, tunnel, session directory, and Pi configuration.

| Instance | Public hostname | Host | Local origin | Pi-web auth mode |
|---|---|---|---|---|
| Main | `pi.tajwar.org` | DigitalOcean work-claw | `http://127.0.0.1:31415` | `pairing` |
| Work laptop | `work-pi.tajwar.org` | Managed Mac | `http://127.0.0.1:31415` | `external` |
| Personal, when deployed | `personal-pi.tajwar.org` | Personal computer | `http://127.0.0.1:31415` | operator choice |

`pi.tajwar.org` is the Main hub and the only installed PWA origin. Its existing phone pairing stays intact. Work and Personal connect outbound to Main as enrolled nodes. Main presents one selected host at a time under `/hosts/<id>/`; it does not aggregate sessions or copy Pi credentials.

## One Access login across hosts

Protect the concrete hostnames with one multi-host self-hosted Access application. A shared application gives all listed hostnames one audience and lets Cloudflare issue their authorization cookies from one identity session.

Configure the application with:

- Public hostnames: `pi.tajwar.org` and `work-pi.tajwar.org`
- Optional future hostname: `personal-pi.tajwar.org`
- Eager redirect cookies: enabled
- Global, application, and policy session durations: 30 days
- One exact-email Allow policy
- No wildcard hostname
- No Bypass, Everyone, or service-token policy for browser routes

Create one additional path-scoped Access application for `pi.tajwar.org/api/hub/*` with a Bypass policy. This is not a browser trust bypass: pi-web accepts `/api/hub/enroll` only with a random five-minute single-use code and `/api/hub/connect` only with a 256-bit enrolled-node credential. All hub administration remains loopback-only, and every other Main route remains behind the exact-email policy plus device pairing. A Cloudflare rate-limit rule for this path is recommended.

Work and Personal connectors must validate the shared audience before forwarding traffic. Main is the deliberate exception described below because connector-side validation would also reject its path-scoped hub Bypass. Sharing an audience is intentional here: it provides single sign-on across the listed browser hosts. Do not add unrelated applications to this Access app.

## Choose the pi-web gate per host

Cloudflare Access always authenticates the person at the edge. `PI_WEB_REMOTE_AUTH` decides whether pi-web adds its own device credential.

### Pairing mode

```text
PI_WEB_REMOTE_AUTH=pairing
```

Pairing is the default when the variable is absent. It adds the `pi_device` cookie, 90-day renewal, and per-device revocation. Main uses this mode so existing phone authentication continues unchanged.

### External mode

```text
PI_WEB_REMOTE_AUTH=external
```

External mode accepts a request after the connector and pi-web's exact Host/Origin boundary. It does not issue or require `pi_device`. Use it only when Cloudflare Access protects every route and the connector validates the correct audience.

In external mode, Cloudflare is the sole remote authentication and revocation boundary. Pi-web cannot revoke one browser independently, and active SSE or web-push subscriptions are not tied to a paired-device record.

## Configure each host

Store host settings in `~/.config/pi-web/env`. Never commit the resulting file.

### Main on DigitalOcean

```bash
PI_WEB_INSTANCE_NAME='Main'
PI_WEB_PUBLIC_URL=https://pi.tajwar.org
PI_WEB_REMOTE_AUTH=pairing
PI_WEB_HUB=1
```

Do not change Main to external mode merely to add a peer. Its existing paired phone remains valid when the Access application gains another hostname.

### Work laptop

```bash
PI_WEB_INSTANCE_NAME='Work laptop'
PI_WEB_PUBLIC_URL=https://work-pi.tajwar.org
PI_WEB_REMOTE_AUTH=external
```

### Optional personal computer

```bash
PI_WEB_INSTANCE_NAME='Personal'
PI_WEB_PUBLIC_URL=https://personal-pi.tajwar.org
PI_WEB_REMOTE_AUTH=external
```

The matching templates live in the repository's [`deploy/cloudflare` directory](https://github.com/tajquitgenius/pi-web/tree/main/deploy/cloudflare). The macOS, Linux, and Windows service loaders read these variables on restart.

## Enroll Work and Personal with Main

Enrollment has no per-node Cloudflare service token or copied browser credential.

On Main:

```bash
pi-web hub invite work 'Work laptop'
```

On Work, enter the displayed code at the hidden prompt:

```bash
pi-web node join https://pi.tajwar.org
```

Repeat with `personal` and `Personal` on the personal computer. The node command stores its credential automatically in `~/.pi/agent/pi-web-hub-node.json` with owner-only permissions (`0600` on Unix and a protected user-only DACL on Windows). Restart that node's pi-web service once. It then reconnects to Main automatically and appears inside the Main PWA. The code expires after five minutes, can be used once, and is never accepted in a command argument or URL.

`PI_WEB_TOKEN` is optional defense in depth in either mode. Generate a different value on each host if you use it:

```bash
openssl rand -hex 24
```

Restart pi-web after changing the environment:

```text
/pi-web restart
```

Pi-web refuses external mode unless `PI_WEB_PUBLIC_URL` is an absolute HTTPS origin and the server binds to loopback. Never add `--host 0.0.0.0` or publish port `31415` directly.

## Configure one tunnel per host

Each computer needs its own named tunnel and connector credential. Add one published route to each tunnel:

```text
pi.tajwar.org          → http://127.0.0.1:31415
work-pi.tajwar.org     → http://127.0.0.1:31415
personal-pi.tajwar.org → http://127.0.0.1:31415  # only when deployed
```

For the Work and Personal routes:

- Enable **Protect with Access** and use the shared multi-host application's audience.

For Main, leave connector-side **Protect with Access** disabled. Main's path-scoped Bypass application does not issue an Access JWT, so connector-side audience validation would reject `/api/hub/*` before pi-web could authenticate the enrollment code or node credential. The two edge Access applications remain the route boundary: the exact-email policy protects every browser path, while only `/api/hub/*` bypasses Access and reaches pi-web's machine authentication.

For every route:

- Leave **HTTP Host Header** empty; rewriting it to `localhost` breaks the exact Host check.
- Keep origin HTTP/2 disabled because the loopback origin uses plain HTTP.
- Force the connector-to-Cloudflare transport to HTTP/2 when the network blocks QUIC.
- Keep the catch-all route at `http_status:404`.

Do not copy one tunnel credential to another host. Tunnel credentials and Pi credentials remain machine-specific even though the Access application is shared.

## Verification

Check each host before relying on it remotely:

- `http://127.0.0.1:31415` returns `200` locally.
- The listener is loopback-only.
- The named tunnel reports healthy HTTP/2 connections.
- A signed-out private browser reaches Cloudflare Access before pi-web.
- An unlisted identity is denied.
- Work and Personal report online in Main after their outbound node connections start.
- `/hosts/work/` and `/hosts/personal/` remain under `pi.tajwar.org` without iOS browser chrome.
- Main still reports paired-device authentication and retains existing devices.
- Work and Personal session, running-state, transcript, thinking, and tool events update through the relayed SSE stream.
- Requests with the wrong Host or mutation Origin receive `403`.
- Main browser routes without a valid Access session are rejected by the edge Access application; Work and Personal requests without a valid Access token are also rejected by their connectors.
- Main's `/api/hub/*` path reaches pi-web without an Access JWT and rejects missing or invalid enrollment/node credentials.

## Cloudflare references

- [Authorization cookies and multi-domain applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/)
- [Session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
- [Publish a self-hosted application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Tunnel origin parameters and Protect with Access](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/)
