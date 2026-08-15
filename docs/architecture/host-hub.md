# Main Host Hub

`pi.tajwar.org` is the single browser-facing PWA origin. Main owns the React shell, service worker, build identity, browser device pairing, and navigation. Work and Personal remain independent Pi hosts: each owns its sessions, Pi processes, settings, SQLite state, and provider credentials.

## Topology

```text
Work pi-web ────────┐
                    ├─ outbound authenticated WebSocket ─► Main hub ─► paired browser
Personal pi-web ────┘                                     pi.tajwar.org
```

Nodes connect out to Main, so Main does not need network access or reusable Cloudflare credentials for each node. Cloudflare Access may bypass only `/api/hub/*`; these routes retain exact Host/Origin validation and their own enrollment or node-credential checks. All ordinary browser routes remain behind Cloudflare Access and Main device pairing.

The installed app never navigates to a node origin. Main serves `/hosts/<node>/...` using its own shell. The typed client sends that screen's API and EventSource traffic through `/_host/<node>/...`.

## Enrollment

An operator runs `pi-web hub invite <id> [label]` on Main. Main creates a random single-use eight-character code that expires after five minutes and stores only its domain-separated HMAC digest. On the node, `pi-web node join https://pi.tajwar.org` reads the code from a hidden terminal prompt, redeems it in a JSON request body, and atomically stores the resulting 256-bit credential in `~/.pi/agent/pi-web-hub-node.json` with owner-only permissions (`0600` on Unix and a protected user-only DACL on Windows).

Codes and credentials are never accepted in URLs or logged. Public redemption attempts are globally limited to ten per minute. Node credentials are stored hash-only by Main, renew on an authenticated connection, expire after 90 inactive days, and can be revoked locally. Revocation closes the live node connection immediately.

## Relay protocol

One authenticated WebSocket multiplexes bounded HTTP request and response frames:

```text
browser /_host/work/api/session
  → Main pairing boundary
  → fail-closed method/path capability table
  → request_start / request_chunk / request_end
  → Work invokes its own loopback pi-web handler
  → response_start / response_chunk / response_end
  → Main streams the response to the browser
```

The same frame flow carries `/events`. Main flushes every response chunk, so session changes, running state, transcript updates, thinking, and tool calls remain live. Browser cancellation sends `request_cancel` to the node. Main never retries a mutation automatically.

Main strips browser credentials before relay. The node adds its optional local `PI_WEB_TOKEN` only inside the process. Hop-by-hop headers and `Set-Cookie` never cross back to the browser. Request bodies are streamed in bounded frames and capped at 32 MiB.

Pairing, device administration, build observations, metrics, update, and restart APIs are not relay capabilities. Adding a new upstream route requires an explicit method/path entry.

## Ownership and failure

A screen selects exactly one host. Main does not merge session IDs, recents, workers, credentials, or settings across hosts. A node outage returns `503 computer is offline`; Main remains available. Protocol mismatches close the node connection rather than guessing.

The service worker treats `/hosts/` and `/_host/` as network-owned. Main alone owns install metadata, hashed frontend assets, `/app-build.json`, and Cache Storage. Remote push subscriptions are not relayed; adding multi-host push requires a separate Main-owned notification design.
