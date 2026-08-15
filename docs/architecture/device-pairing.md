# Device Pairing Backend

Device pairing is the default public authentication mode. Set `PI_WEB_REMOTE_AUTH=external` only when a trusted proxy authenticates every remote request before it reaches pi-web. Pi-web does not validate proxy headers, tokens, or tunnel credentials.

## Request boundary

```text
request
  → exact Host and same-origin mutation check
  → configured public Host?
      no  → existing local/token behavior
      yes → PI_WEB_REMOTE_AUTH=external?
              yes → existing route and optional PI_WEB_TOKEN check
              no  → pairing bootstrap, status, or submission?
                      yes → route handler
                      no  → hash pi_device cookie and match an active device
                              valid   → existing route and optional PI_WEB_TOKEN check
                              invalid → 401 for APIs, /pairing redirect for pages
```

External mode requires an HTTPS `PI_WEB_PUBLIC_URL` and a loopback bind. Pi-web identifies the public path by that exact HTTPS authority. Browser mutations must match that scheme as well as its host and port. Loopback HTTP rejects an HTTPS Origin for the same host. Pi-web identifies local administration by a literal loopback `Host` (`localhost`, `127.0.0.0/8`, or `::1`). It does not use `RemoteAddr` because the local Cloudflare Tunnel connector also connects from loopback, and it never trusts forwarded headers.

In the default pairing mode, an unpaired request on the public Host can reach only:

- `POST /api/pair`
- `GET /api/pairing-status`
- `/pairing` and its static/PWA bootstrap assets

In the default pairing mode, other public APIs return `401`. Browser pages redirect to `/pairing` without copying the requested URL into the redirect. The complete mux, including static assets, sits behind the exact Host and browser Origin checks. Notification files under `/sounds/` require the same optional token as protected APIs after pairing. Local development is unchanged when no public URL is configured. In external mode, the exact Host and Origin boundary remains in force, but public requests do not need `pi_device`. Pairing status reports that the request is authenticated without claiming it is paired. Unbound SSE streams and push subscriptions remain available because the external proxy owns remote admission and revocation.

## Credentials

A local operator creates an eight-character code with `POST /api/pairing-codes`. The alphabet omits `0`, `1`, `I`, and `O`. Each code expires after five minutes and can win one atomic SQLite update. Pi-web stores only an HMAC-SHA-256 digest; the 256-bit HMAC key lives at `~/.pi/agent/pi-web/device-pairing.key` with owner-only permissions. Redemption attempts are limited globally to 10 per minute and the database stores only their timestamps.

Successful redemption creates a 256-bit random device credential. The response sends it only in the host-only `pi_device` cookie:

- `HttpOnly`
- `SameSite=Lax`
- `Secure` on the configured public Host, but not on local HTTP
- 90-day `Expires` and `Max-Age` inactivity window

SQLite stores only the credential's SHA-256 hash. Every protected request checks the database, while successful 2xx application/API use updates `last_used_at` and rolls `expires_at` forward by another 90 days. The browser receives the same random credential with the renewed cookie expiry, so an actively used device does not need periodic re-pairing; 90 days without successful use still expires it. The device record also keeps its label, creation time, expiry, and nullable revocation time. The SQLite database file is enforced at owner-only `0600` permissions on every startup.

In pairing mode, public SSE streams and web-push subscriptions carry the authenticated device ID. Revocation closes that device's open streams immediately and deletes its subscriptions without affecting another device. An SSE stream closes at credential expiry, and push delivery rechecks the device before every send. Legacy push records had no device ID: local-only installations mark them as local, while public installations delete the ambiguous records and let an opted-in browser safely post its existing subscription again.

Pairing codes and device credentials are never accepted from query parameters. Pairing responses do not set credential-bearing redirects, and the pairing code does not appear in QR routes or server logs.

Hub-node enrollment is a separate machine identity described in [host-hub.md](./host-hub.md). Main still authenticates every browser with its ordinary paired-device cookie. A node credential can connect only to the hub transport and cannot administer browser devices or impersonate a browser pairing record.

## Local API

Code creation and device administration require a literal loopback Host. They bypass the optional `PI_WEB_TOKEN` because the local browser is the trust source for pairing administration.

| Route | Method | Access | Result |
|---|---|---|---|
| `/api/pairing-codes` | POST | Loopback | Creates one five-minute code |
| `/api/pair` | POST | Public pairing surface or loopback | Redeems `{code, label}` and sets the cookie |
| `/api/devices` | GET | Loopback | Lists device metadata, never credential hashes |
| `/api/devices/{id}` | DELETE | Loopback | Soft-revokes one device immediately |
| `/api/pairing-status` | GET | Public pairing surface or loopback | Reports whether this request is paired |

## SQLite schema

Startup creates four objects in the existing `~/.pi/agent/pi-web.sqlite` database:

- `pairing_codes`: HMAC digest, creation, expiry, redemption time
- `paired_devices`: credential hash, label, creation, last use, expiry, revocation
- `pairing_redemption_attempts`: rate-limit timestamps
- `idx_pairing_redemption_attempts_time`: expiry-window cleanup index

These are additive `CREATE TABLE/INDEX IF NOT EXISTS` migrations. They use the server's existing single SQLite connection, so code redemption and device creation commit as one transaction and concurrent redemption has one winner.
