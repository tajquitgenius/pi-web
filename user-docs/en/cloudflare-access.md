# Remote access with Cloudflare Access

Use this setup to reach pi-web from another laptop or phone without exposing pi-web to the local network or Internet.

```text
Browser → Cloudflare Access → named tunnel → 127.0.0.1:31415 → pi-web
```

Remote pi-web access is equivalent to remote code execution as the operating-system user running Pi. Keep every origin on loopback, require Cloudflare Access on every published hostname, and make each connector validate the Access audience before forwarding a request.

## Host map

Each computer runs an independent pi-web process, tunnel, session directory, and Pi configuration.

| Instance | Public hostname | Host | Local origin | Pi-web auth mode |
|---|---|---|---|---|
| Main | `pi.tajwar.org` | DigitalOcean work-claw | `http://127.0.0.1:31415` | `pairing` |
| Work laptop | `work-pi.tajwar.org` | Managed Mac | `http://127.0.0.1:31415` | `external` |
| Personal, when deployed | `personal-pi.tajwar.org` | Personal computer | `http://127.0.0.1:31415` | operator choice |

`pi.tajwar.org` remains the Main host. Its existing phone pairing stays intact. `PI_WEB_PEERS_JSON` adds ordinary browser links between hosts; it does not aggregate sessions or copy credentials.

## One Access login across hosts

Protect the concrete hostnames with one multi-host self-hosted Access application. A shared application gives all listed hostnames one audience and lets Cloudflare issue their authorization cookies from one identity session.

Configure the application with:

- Public hostnames: `pi.tajwar.org` and `work-pi.tajwar.org`
- Optional future hostname: `personal-pi.tajwar.org`
- Eager redirect cookies: enabled
- Global, application, and policy session durations: 30 days
- One exact-email Allow policy
- No wildcard hostname
- No Bypass, Everyone, or service-token browser policy

Every connector must validate the shared audience before forwarding traffic. Sharing an audience is intentional here: it provides single sign-on across the listed pi-web hosts. Do not add unrelated applications to this Access app.

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
PI_WEB_PEERS_JSON='[{"label":"Work laptop","url":"https://work-pi.tajwar.org"},{"label":"Personal","url":"https://personal-pi.tajwar.org"}]'
```

Do not change Main to external mode merely to add a peer. Its existing paired phone remains valid when the Access application gains another hostname.

### Work laptop

```bash
PI_WEB_INSTANCE_NAME='Work laptop'
PI_WEB_PUBLIC_URL=https://work-pi.tajwar.org
PI_WEB_REMOTE_AUTH=external
PI_WEB_PEERS_JSON='[{"label":"Main","url":"https://pi.tajwar.org"},{"label":"Personal","url":"https://personal-pi.tajwar.org"}]'
```

### Optional personal computer

```bash
PI_WEB_INSTANCE_NAME='Personal'
PI_WEB_PUBLIC_URL=https://personal-pi.tajwar.org
PI_WEB_REMOTE_AUTH=external
PI_WEB_PEERS_JSON='[{"label":"Main","url":"https://pi.tajwar.org"},{"label":"Work laptop","url":"https://work-pi.tajwar.org"}]'
```

The matching templates live under [`deploy/cloudflare`](../../deploy/cloudflare). The macOS, Linux, and Windows service loaders read these variables on restart.

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

For every route:

- Enable **Protect with Access** and use the shared multi-host application's audience.
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
- An authenticated browser can move from Main to Work without another identity prompt.
- Main still reports paired-device authentication and retains existing devices.
- Work reports external authentication and never shows a pairing form.
- Requests with the wrong Host or mutation Origin receive `403`.
- Requests without a valid Access token are rejected by the connector.

## Cloudflare references

- [Authorization cookies and multi-domain applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/)
- [Session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
- [Publish a self-hosted application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Tunnel origin parameters and Protect with Access](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/)
