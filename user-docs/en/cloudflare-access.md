# Remote access with Cloudflare Access

Use this setup when you need to reach pi-web from another laptop or a phone without installing a second VPN. Each computer makes an outbound connection to Cloudflare and continues to run pi-web only on loopback.

```text
Browser → Cloudflare Access → Cloudflare Tunnel → 127.0.0.1:31415 → pi-web
```

Cloudflare configuration and credentials remain outside pi-web. The application neither stores tunnel tokens nor supervises `cloudflared`.

## Before you begin

You need:

- A domain managed by Cloudflare
- A Cloudflare Zero Trust account
- Pi and this pi-web fork installed on the source computer
- Permission to run `cloudflared` on that computer

For a work computer, confirm that company policy permits remote access, Cloudflare Tunnel, and the AI providers used by Pi.

## 1. Configure pi-web

Create `~/.config/pi-web/env`:

```bash
PI_WEB_INSTANCE_NAME='Personal laptop'
PI_WEB_PUBLIC_URL=https://personal-pi.example.com
PI_WEB_PEERS_JSON='[{"label":"Work laptop","url":"https://work-pi.example.com"},{"label":"Cloud runner","url":"https://cloud-pi.example.com"}]'
PI_WEB_TOKEN=replace-with-a-random-token
```

Use straight single quotes around values containing spaces or JSON. The macOS, Linux, and Windows startup loaders remove one matching outer quote pair.

Generate the optional second-layer token with:

```bash
openssl rand -hex 24
```

The settings have distinct jobs:

- `PI_WEB_INSTANCE_NAME` identifies the current computer in the UI and browser title.
- `PI_WEB_PUBLIC_URL` declares the one exact HTTPS origin serving this instance. It does not start a tunnel.
- `PI_WEB_PEERS_JSON` supplies navigation links to your other independent instances.
- `PI_WEB_TOKEN` adds a second login after Cloudflare Access. The token is stored in an HTTPS-only cookie when you use the public hostname.

Restart pi-web:

```text
/pi-web restart
```

Do not add `--host 0.0.0.0`. Pi-web deliberately refuses a public URL when it is not bound to a loopback address.

## 2. Create the Access application first

In Cloudflare Zero Trust, create a self-hosted Access application for the exact hostname, such as `personal-pi.example.com`.

Create an Allow policy for your exact identity or a small group you control. Require your identity provider's MFA or Cloudflare's one-time PIN. Do not use an Everyone or Bypass rule.

Where available, enable **Protect with Access** for the tunnel and account-wide **Require Access protection**. This reduces the chance of publishing a tunnel route without its Access policy.

## 3. Create the named tunnel

Create a named, remotely managed Cloudflare Tunnel for this computer. Add one public hostname:

```text
personal-pi.example.com → http://127.0.0.1:31415
```

Preserve the browser's public Host header. Do not rewrite it to `localhost`; pi-web checks that browser Origin and Host agree.

Install the connector using the official command Cloudflare provides for your operating system, then run it as a service. Keep its tunnel token only in Cloudflare's service or credential storage.

Do not use a temporary Quick Tunnel for Pi access. Its public address changes and it does not provide the intended Access boundary.

## 4. Verify the boundary

Check all four paths:

1. `http://127.0.0.1:31415` works only on the source computer.
2. The public hostname rejects a signed-out browser at Cloudflare Access.
3. After Access login, pi-web asks for `PI_WEB_TOKEN` when that second layer is enabled.
4. Chat, streaming responses, images, and `/remote` work through the public hostname.

Also verify that no router, cloud firewall, or operating-system firewall exposes port `31415`.

## Work VPN compatibility

Cloudflare Tunnel uses an outbound connection instead of adding a private network interface or changing routes, so it usually coexists with corporate VPNs better than mesh VPN software.

Some work VPNs block QUIC. If the connector cannot remain connected, configure the official `cloudflared` service to use HTTP/2 transport and try again. If the company explicitly blocks tunnels or prohibits them, stop and use an approved access method rather than bypassing the restriction.

## Cloud hosts

Use the same topology on DigitalOcean or AWS. Run Pi and pi-web as a non-root user, install `cloudflared` as a service, and leave inbound application ports closed.

For a Linux user service that must survive logout and start at boot, enable lingering for the Pi user:

```bash
sudo loginctl enable-linger "$USER"
systemctl --user enable --now pi-web.service
```

Do not copy the user unit into `/etc/systemd/system`; it does not declare the user, home directory, or Pi agent directory required by a system-wide service.
