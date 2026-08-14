# Remote access with Cloudflare Access

Use this setup to reach pi-web from another laptop or a phone without adding a VPN. Each computer makes an outbound connection to Cloudflare and continues to run pi-web only on loopback.

```text
Browser → exact-host Google Access → device pairing → named tunnel → 127.0.0.1:31415 → one pi-web instance
```

Cloudflare configuration and credentials remain outside pi-web. Pi-web neither stores tunnel credentials nor supervises `cloudflared`.

> Remote pi-web access is equivalent to remote code execution as the operating-system user running Pi. Require the exact-user Google policy in Cloudflare Access and pi-web's per-device pairing. `PI_WEB_TOKEN` is an optional third gate. Never expose port `31415` directly.

## Keep every instance independent

The canonical Main hub and every peer deployment must have separate boundaries:

| Instance | Public hostname | Named tunnel | Local origin |
|---|---|---|---|
| Main hub (work-claw) | `pi.tajwar.org` | `pi-web-main` | `http://127.0.0.1:31415` |
| Personal | `personal.pi.tajwar.org` | `pi-web-personal` | `http://127.0.0.1:31415` |
| Work laptop | `work.pi.tajwar.org` | `pi-web-work` | `http://127.0.0.1:31415` |
| Cloud | `cloud.pi.tajwar.org` | `pi-web-cloud` | `http://127.0.0.1:31415` |

Each row represents a different computer or cloud user environment. Do not share a tunnel, Pi credentials, optional pi-web token, session directory, or state database. `PI_WEB_PEERS_JSON` creates ordinary browser links; it does not enable host-to-host API calls or share authentication. The Main hub shows its own work-claw sessions and links to the peers. It does not aggregate or copy their sessions.

`pi.tajwar.org` remains a first-class pi-web host, never a redirect. Stage its move to the always-on work-claw server separately. Do not change the live Access application, DNS record, tunnel route, connector, or pi-web process until that target is ready and a cutover is approved. One pi-web process accepts only the exact hostname in `PI_WEB_PUBLIC_URL`.

## Use four exact Access applications

Create one self-hosted Access application for each exact hostname. Do not use one `*.pi.tajwar.org` application.

A wildcard application would work, but it creates one security boundary for every matching first-level subdomain. Cloudflare assigns one audience (`aud`) tag to that application, so all four connectors would accept JWTs for the same audience. A future matching hostname could also inherit that boundary. Wildcard subdomains cannot receive Access's eager authorization cookies because Cloudflare does not know the concrete hostnames in advance.

Exact applications are safer:

- Each hostname has its own application token, cookie, and audience tag.
- **Protect with Access** on each tunnel route can validate only that host's audience.
- A token issued for one app fails audience validation on every other connector.
- A mistaken route or policy change has a smaller blast radius.
- Each host can be revoked or tested without changing the other two.

The four applications may reuse one exact-email policy. Reusing the policy centralizes the allowlist without merging the applications or JWT audiences.

## Before you begin

You need:

- Administrative access to the `tajwar.org` Cloudflare zone and Zero Trust account
- Permission to configure a Google identity provider in Cloudflare Access
- Pi and this pi-web fork installed separately on each source host
- Interactive access to each source host to install the connector service
- Approval to run Pi, its AI providers, pi-web, and Cloudflare Tunnel on any managed work computer

A dashboard administrator can complete this runbook without creating an API token. The remotely managed tunnel installation command contains a connector credential. Run that command only on its intended host; do not paste it into tickets, chat, shell transcripts, or this repository.

## Staged deployment runbook

Complete one new hostname at a time. Create its Access application before publishing its tunnel route so the route is never intentionally public.

### 1. Record the working deployment without changing it

Before adding resources, record the current owner and names of the `pi.tajwar.org` Access application, DNS record, tunnel, and connector service. Confirm `https://pi.tajwar.org` still works from an authorized browser. Treat those resources as read-only during this deployment.

### 2. Configure Google identity

In **Cloudflare Zero Trust → Settings → Authentication → Login methods**, add or select Google. The Google integration may authenticate personal Gmail and Google Workspace accounts; the Access policy below decides which identities can enter.

For each new application:

- Enable only the Google login method.
- Enable instant authentication when Cloudflare offers it for a single identity provider.
- Do not enable One-time PIN, Bypass, Everyone, or a service-token policy for browser access.

A managed Google Workspace tenant may block the OAuth application even when the email is allowed by Cloudflare. Confirm that each work account is permitted by its Workspace administrator rather than weakening the Access policy.

### 3. Create the exact allow policy

Create a reusable Allow policy named `pi-web exact Google users`. Set its policy session duration to **30 days** (shown as one month or `720h` in some Cloudflare interfaces). Add only these exact email addresses with the **Emails** selector:

```text
taj@sonazine.com
taj.sangha@quitgenius.com
tajsangha27@gmail.com
taj@digithera.ai
taj.sangha@pelagohealth.com
```

Use exact addresses, not email-domain rules. Cloudflare ORs the entries in an Include group. Do not add a broader Include rule that would make the exact list ineffective.

Use Cloudflare's policy tester for all five allowed addresses and at least one address that must be denied.

### 4. Create four exact self-hosted applications

Create these self-hosted applications under **Access controls → Applications**:

| Application name | Public hostname | Session duration | Policy |
|---|---|---|---|
| `pi-web main` | `pi.tajwar.org` | 30 days | `pi-web exact Google users` |
| `pi-web personal` | `personal.pi.tajwar.org` | 30 days | `pi-web exact Google users` |
| `pi-web work` | `work.pi.tajwar.org` | 30 days | `pi-web exact Google users` |
| `pi-web cloud` | `cloud.pi.tajwar.org` | 30 days | `pi-web exact Google users` |

For each application:

1. Enter the exact hostname with no wildcard or path.
2. Select only Google and attach the exact-email Allow policy.
3. Set the application session duration to 30 days. Keep the policy duration at 30 days too; a shorter policy duration overrides the application duration.
4. Leave CORS and cross-origin API access disabled. The hosts navigate to one another as top-level pages.
5. Record the application's audience tag for the matching tunnel route. An audience tag is an identifier, not a credential, but it should still be managed as deployment configuration rather than hard-coded into pi-web.

Cloudflare also has a global session duration. It controls how often the identity provider prompts again, while the application or policy duration controls that application's JWT. Set the global duration according to the wider Zero Trust account policy; do not weaken other applications merely to reach 30 days here.

### 5. Configure each pi-web host

On each source host, copy the matching nonsecret template from [`deploy/cloudflare`](https://github.com/tajquitgenius/pi-web/tree/main/deploy/cloudflare):

- [`main.pi-web.env.example`](https://github.com/tajquitgenius/pi-web/blob/main/deploy/cloudflare/main.pi-web.env.example)
- [`personal.pi-web.env.example`](https://github.com/tajquitgenius/pi-web/blob/main/deploy/cloudflare/personal.pi-web.env.example)
- [`work.pi-web.env.example`](https://github.com/tajquitgenius/pi-web/blob/main/deploy/cloudflare/work.pi-web.env.example)
- [`cloud.pi-web.env.example`](https://github.com/tajquitgenius/pi-web/blob/main/deploy/cloudflare/cloud.pi-web.env.example)

Save the result as `~/.config/pi-web/env` and never commit the resulting file. Cloudflare Access and device pairing are the required public gates. If you also choose to set `PI_WEB_TOKEN`, generate a different value on each host:

```bash
openssl rand -hex 24
```

The reciprocal settings are:

```text
# Main hub (always-on work-claw server)
PI_WEB_INSTANCE_NAME='Main'
PI_WEB_PUBLIC_URL=https://pi.tajwar.org
PI_WEB_PEERS_JSON='[{"label":"Work laptop","url":"https://work.pi.tajwar.org"},{"label":"Personal","url":"https://personal.pi.tajwar.org"},{"label":"Cloud","url":"https://cloud.pi.tajwar.org"}]'

# Personal
PI_WEB_INSTANCE_NAME='Personal'
PI_WEB_PUBLIC_URL=https://personal.pi.tajwar.org
PI_WEB_PEERS_JSON='[{"label":"Main","url":"https://pi.tajwar.org"},{"label":"Work laptop","url":"https://work.pi.tajwar.org"},{"label":"Cloud","url":"https://cloud.pi.tajwar.org"}]'

# Work laptop
PI_WEB_INSTANCE_NAME='Work laptop'
PI_WEB_PUBLIC_URL=https://work.pi.tajwar.org
PI_WEB_PEERS_JSON='[{"label":"Main","url":"https://pi.tajwar.org"},{"label":"Personal","url":"https://personal.pi.tajwar.org"},{"label":"Cloud","url":"https://cloud.pi.tajwar.org"}]'

# Cloud
PI_WEB_INSTANCE_NAME='Cloud'
PI_WEB_PUBLIC_URL=https://cloud.pi.tajwar.org
PI_WEB_PEERS_JSON='[{"label":"Main","url":"https://pi.tajwar.org"},{"label":"Personal","url":"https://personal.pi.tajwar.org"},{"label":"Work laptop","url":"https://work.pi.tajwar.org"}]'
```

Use straight single quotes around values containing spaces or JSON. The macOS, Linux, and Windows startup loaders remove one matching outer quote pair.

Restart pi-web only on the new target host:

```text
/pi-web restart
```

Do not add `--host 0.0.0.0`. Pi-web deliberately refuses a public URL when it is not bound to a loopback address. Do not copy Pi provider credentials or an optional `PI_WEB_TOKEN` between hosts.

From each host's local interface, create a one-time pairing code for every remote browser. The code expires after five minutes and can be used once. The resulting device credential lasts 90 days unless you revoke it sooner. Revocation closes that device's open event streams and removes its push subscriptions; other paired devices continue.

### 6. Create one named tunnel per host

In **Zero Trust → Networks → Connectors → Cloudflare Tunnels**, create the matching remotely managed tunnel from the table above. On the intended source host only, install the connector with the command Cloudflare displays. Do not reuse one tunnel's installation command on another host.

Add exactly one published application route to each tunnel:

```text
pi.tajwar.org          → http://127.0.0.1:31415
personal.pi.tajwar.org → http://127.0.0.1:31415
work.pi.tajwar.org     → http://127.0.0.1:31415
cloud.pi.tajwar.org    → http://127.0.0.1:31415
```

For each route:

- Enable **Protect with Access** and select or confirm the audience tag of the matching exact Access application.
- Leave **HTTP Host Header** empty. Rewriting it to `localhost` breaks pi-web's exact Host check.
- Leave **HTTP2 connection** to the origin disabled. The origin is plain HTTP on loopback. This setting is different from the connector's HTTP/2 transport to Cloudflare.
- Do not add another origin, load balancer, wildcard route, or catch-all route.

If Cloudflare created the DNS record as part of the published route, confirm that the record names only the new hostname. Do not edit the `pi.tajwar.org` record.

### 7. Force connector transport to HTTP/2

Set the connector-to-Cloudflare transport to HTTP/2 on every host. This uses outbound TCP and avoids VPNs that block QUIC over UDP. It is not the origin's **HTTP2 connection** option.

For a remotely managed tunnel, add `--protocol http2` to the installed `cloudflared tunnel ... run` service command before `run`, or set the documented `TUNNEL_TRANSPORT_PROTOCOL=http2` environment variable in the service. Do not expose or replace the existing connector credential while editing the service.

On Linux, a nonsecret systemd override is provided at [`cloudflared-http2.systemd.conf.example`](https://github.com/tajquitgenius/pi-web/blob/main/deploy/cloudflare/cloudflared-http2.systemd.conf.example):

```bash
sudo systemctl edit cloudflared.service
# Add the contents of the example, then:
sudo systemctl restart cloudflared.service
sudo systemctl status cloudflared.service
```

On macOS, follow Cloudflare's run-parameter instructions for `com.cloudflare.cloudflared`: unload the generated plist, add `--protocol` and `http2` as separate `ProgramArguments` before `run`, reload it, and start it. Preserve file ownership and permissions. On Windows, add `--protocol http2` before `run` in the service `ImagePath` as Cloudflare documents.

Do not edit or restart a connector serving the existing `pi.tajwar.org` deployment. If a target machine already runs that connector service, stop here and plan a separate machine or an approved cutover; Cloudflare's standard service installer supports only one `cloudflared` service per machine.

## Verification checklist

Verify each new host before treating it as deployed. A failure on a new host is not a reason to alter the working `pi.tajwar.org` deployment.

### Local and network boundary

- [ ] `http://127.0.0.1:31415` works on the source host.
- [ ] The listener is `127.0.0.1:31415`, not `0.0.0.0`, a LAN address, or a public address.
- [ ] No router rule, security group, cloud firewall, or operating-system firewall exposes inbound port `31415`.
- [ ] The tunnel has one healthy connector and one exact published hostname route.
- [ ] Connector status or logs report HTTP/2 as the selected edge transport.
- [ ] `https://pi.tajwar.org` still works and its Cloudflare resources are unchanged.

### Access denial and identity

- [ ] With Wi-Fi disabled on a phone, open each hostname over cellular data in a signed-out private window. Cloudflare Access must appear before pi-web.
- [ ] A Google account outside the allowlist is denied.
- [ ] Cloudflare's policy tester allows all five listed addresses and denies an unlisted address.
- [ ] After an allowed Google login, pi-web requires a valid paired-device cookie before protected pages or APIs load.
- [ ] If that host has the optional `PI_WEB_TOKEN`, pairing succeeds first and the token prompt appears as the additional gate.
- [ ] Revoking device A closes A's existing SSE stream and suppresses its pushes while device B continues.
- [ ] An expired device can neither open protected APIs nor keep an SSE or push channel.
- [ ] The Access application and policy both show a 30-day session.

### JWT and connector validation

- [ ] Each Access application displays a different audience tag.
- [ ] Each tunnel route has **Protect with Access** enabled and lists only its matching application's audience tag.
- [ ] Decode a new application's JWT locally in browser developer tools without copying the token elsewhere. Its `aud` must match that exact application, and `exp - iat` should reflect the configured 30-day policy.
- [ ] Before launch, prove the connector check on a new host: temporarily configure that new route to expect one of the other new applications' audience tags, confirm a valid browser session is rejected at the connector, then immediately restore the correct audience and confirm access. Never run this negative test on `pi.tajwar.org`.

### Independent-host behavior

- [ ] Main prominently links to Work laptop, Personal, and Cloud; each peer links back to Main and to the other configured hosts.
- [ ] `pi.tajwar.org` renders the Main hub and is not an HTTP or client-side redirect.
- [ ] Following a peer link performs top-level navigation and passes through that host's own Access application and device pairing.
- [ ] Browser network tools show no host-to-host API calls, copied sessions, shared service tokens, or credentials in peer URLs.
- [ ] Sessions, Pi credentials, optional pi-web tokens, device credentials, and tunnel connector credentials remain independent between hosts.

### Work device and VPN

- [ ] The employer has approved Cloudflare Tunnel, remote command execution, Pi, and every configured AI provider on the managed device.
- [ ] The approved Google Workspace account can complete the Google OAuth flow.
- [ ] While connected to the corporate VPN, `cloudflared` remains connected over HTTP/2 and the work hostname can stream a response.
- [ ] No WARP client, route change, split-tunnel exception, or firewall bypass was added for this deployment.
- [ ] If policy or network controls prohibit the tunnel, stop and use an approved access method.

## Cloud hosts

Run Pi, pi-web, and `cloudflared` as a non-root user. Leave inbound application ports closed. For a Linux user service that must survive logout and start at boot, enable lingering for the Pi user:

```bash
sudo loginctl enable-linger "$USER"
systemctl --user enable --now pi-web.service
```

Do not copy the pi-web user unit into `/etc/systemd/system`; it does not declare the user, home directory, or Pi agent directory required by a system-wide service.

## Cloudflare references

- [Publish a self-hosted application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Access application paths and wildcards](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
- [Access authorization cookies](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/)
- [Access session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
- [Tunnel origin parameters and Protect with Access](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/)
- [`cloudflared` tunnel run parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)
