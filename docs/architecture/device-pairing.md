# Device Pairing Backend

Cloudflare Access still authenticates people at the edge. Device pairing adds a persistent application credential after that check; it does not validate Cloudflare headers or manage the tunnel.

## Request boundary

```text
request
  → exact Host and same-origin mutation check
  → configured public Host?
      no  → existing local/token behavior
      yes → pairing bootstrap, status, or submission?
              yes → route handler
              no  → hash pi_device cookie and match an active device
                      valid   → existing route and optional PI_WEB_TOKEN check
                      invalid → 401 for APIs, /pairing redirect for pages
```

Pi-web identifies the public path by the exact `PI_WEB_PUBLIC_URL` authority. It identifies local administration by a literal loopback `Host` (`localhost`, `127.0.0.0/8`, or `::1`). It does not use `RemoteAddr` because the local Cloudflare Tunnel connector also connects from loopback, and it does not trust forwarded headers.

An unpaired request on the public Host can reach only:

- `POST /api/pair`
- `GET /api/pairing-status`
- `/pairing` and its static/PWA bootstrap assets

Other public APIs return `401`. Browser pages redirect to `/pairing` without copying the requested URL into the redirect. The complete mux, including static assets, sits behind the existing exact Host and browser Origin checks. Local development is unchanged when no public URL is configured.

## Credentials

A local operator creates an eight-character code with `POST /api/pairing-codes`. The alphabet omits `0`, `1`, `I`, and `O`. Each code expires after five minutes and can win one atomic SQLite update. Pi-web stores only an HMAC-SHA-256 digest; the 256-bit HMAC key lives at `~/.pi/agent/pi-web/device-pairing.key` with owner-only permissions. Redemption attempts are limited globally to 10 per minute and the database stores only their timestamps.

Successful redemption creates a 256-bit random device credential. The response sends it only in the host-only `pi_device` cookie:

- `HttpOnly`
- `SameSite=Lax`
- `Secure` on the configured public Host, but not on local HTTP
- 90-day `Expires` and `Max-Age`

SQLite stores only the credential's SHA-256 hash. Every authenticated request checks the database and updates `last_used_at`, so expiry and revocation take effect on the next request. The device record also keeps its label, creation time, expiry, and nullable revocation time.

Pairing codes and device credentials are never accepted from query parameters. Pairing responses do not set credential-bearing redirects, and the pairing code does not appear in QR routes or server logs.

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
