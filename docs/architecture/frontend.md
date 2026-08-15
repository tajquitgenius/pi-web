# Frontend Architecture

Pi-web ships two live React products and one isolated static-export renderer. Desktop and mobile share typed transport contracts, but they do not share product UI. Svelte is not part of any live route.

## Production artifacts

`npm --prefix web run build` removes old outputs and creates exactly three artifacts:

| Product | Entry | Output | Delivery |
|---|---|---|---|
| React desktop | `web/src/desktop/bootstrap.tsx` | `web/dist-desktop` | `/static/desktop/*` |
| React mobile | `web/src/mobile/bootstrap.tsx` | `web/dist-mobile` | `/static/mobile/*` |
| Static conversation export | `web/src/export/export-entry.js` | `web/dist-export/export.js` | Inlined into exported HTML |

`web/assets_embed.go` embeds the two live Vite outputs. `internal/frontend/assets.go` reads each manifest and registers its hashed entry, CSS, and chunks in a separate URL namespace. The export Vite config's `sync-embedded-export` `writeBundle` hook copies `web/dist-export/export.js` to `internal/ui/embedded/export/export.js`; the Makefile only invokes that npm build before compiling Go.

There is no generic `web/dist`, `/static/assets/*` namespace, live Svelte entry, or rollback shell.

## Secure PWA boundary

The live React shell is installable from the same origin. `internal/ui/pwa.go`
embeds the manifest, service worker, deterministic PNG icons, and a generic
offline document; the Go server serves them outside the session HTML render.
The static export remains a separate Svelte snapshot and never registers the
service worker.

The worker controls `/` but treats all live data as network-owned:

- navigation is always network-only, with only `/offline.html` as a generic
  fallback;
- Cache Storage may contain only hashed files under
  `/static/desktop/assets/` or `/static/mobile/assets/`, install metadata/icons,
  and that generic offline document;
- `/`, `/session`, `/api/`, `/events`, `/sounds/`, push, pairing, device, and all
  other user/session responses are excluded, including redirects and HTML
  responses returned for static-looking URLs;
- `skipWaiting()` and `clients.claim()` update the worker immediately because no
  user or session data is cached;
- one build fingerprint is derived from both products' hashed JavaScript and CSS
  paths, exposed at no-store `/app-build.json`, embedded in the live shell, and
  included in the worker's cache name;
- foreground `pageshow`, focus, and visibility transitions compare that
  fingerprint, request a worker update, and reload the network-owned shell when
  the deployed build differs. Requests have a bounded timeout, and session
  storage limits a persistent mismatch to one reload per target fingerprint;
- after a build check, paired clients send a protected observation containing
  only running/deployed fingerprints, product, and display mode. The server
  validates those fixed-shape values and logs `current` or `stale`; the public
  build endpoint never logs, and observations contain no IPs, cookies, device
  identifiers, pairing data, or user/session URLs.
  Worker registration uses `updateViaCache: 'none'`.

PWA metadata, `/app-build.json`, and hashed product assets are bootstrap-public so an unpaired
browser can reach `/pairing`; they still pass the exact Host/Origin boundary and
public-device gate, with the configured Cloudflare/access layer remaining the
outer security boundary.

## Live request flow

```txt
GET /, /session, /settings, or /pairing
  → server handler (pairing_routes.handlePairingShell delegates to handleAppShell)
  → ui.RenderAppShell(request, optional session bootstrap)
  → ui.SelectSurface(request)
       pi-web-surface=desktop → desktop
       pi-web-surface=mobile  → mobile
       auto/missing/invalid   → conservative user-agent classification
  → internal/ui/embedded/app.html
  → one React entry and its surface-owned CSS
```

The only supported surface cookie is `pi-web-surface=desktop|mobile|auto`. Mobile classification covers iPhone, iPad, mobile Android, and older mobile user agents; unknown agents fall back to desktop. Both React products can change the override through `web/src/live-shared/browser.ts`.

The Go shell owns values that must exist before React starts:

- theme and font boot data
- host identity and peer links
- an optional base64 session bootstrap
- the selected surface name
- service-worker registration

`GET /pairing` is a live app-shell request too: `pairing_routes.go`'s `handlePairingShell` delegates to `handleAppShell`, and surface selection then chooses the React product. Mobile owns its own `/pairing` screen; desktop has a separate Pi-owned pairing screen.

## React product ownership

`web/src/desktop/` owns the wide-screen product: its host rail, project and session sidebar, conversation, details pane, persistent composer, and new-task flow. The T3-derived layer is a presentation and interaction adaptation, not a port of T3's runtime.

`web/src/mobile/` owns a separate browser-mobile product for session lists, conversations, settings, and public-device pairing. It has its own routes, components, and CSS. It is not a responsive wrapper around desktop and must not import desktop components or styles. One app-owned navigation drawer links New task, Threads, Projects, Settings, stable Recents, and configured peer hosts; peer controls are absent when no peers are configured. A rightward swipe from the left edge opens it, and a leftward swipe closes it without intercepting vertical scrolling. Conversation runtime controls live in Tools, while navigation and thread actions are separate floating controls above the full-viewport transcript. The accessible thread title is not permanent visual chrome. The floating composer overlays the transcript, whose resting scroll position keeps the latest message unobstructed. The composer follows `VisualViewport` geometry against a pre-keyboard viewport baseline, including iOS modes where both layout and visual viewport heights shrink. It does not use a second keyboard-inset mechanism.

Both products are Pi-only at runtime. They use Pi session IDs and project paths, Pi model and thinking-level records, Pi JSONL entries, and one Pi RPC worker per session. Peer hosts remain independent links: a product can navigate to another pi-web host, but it never merges that host's sessions, workers, or credentials into the current product.

The exact T3 revision, upstream source families, and attributed target files are recorded in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

## PiWebClient is the live runtime seam

`web/src/live-shared/` is the only intended sharing boundary between the React products:

```txt
Desktop React ─┐
               ├─ PiWebClient ── typed HTTP/SSE requests
Mobile React ──┘    └─ getHostContext()
               ├─ browser.ts
               │     ├─ readSessionBootstrap()
               │     └─ surface-cookie helpers
               └─ release-refresh.ts
                     └─ foreground build-fingerprint comparison
                           │
                           ▼
                    pi-web HTTP API and SSE
                           │
                           ▼
                    one Pi RPC worker/session
```

`contracts.ts` defines Pi-owned wire shapes. `client.ts` implements `PiWebClient` and is the sole live HTTP/SSE transport: session listing and paging, session creation, model/default lookup, chat/cancel, worker status, model and thinking-level changes, SSE subscriptions, and device pairing. Product components do not call `fetch` or construct `EventSource` directly. `browser.ts` owns `readSessionBootstrap()` for the optional server-injected session payload and manages the surface override. `release-refresh.ts` handles one browser lifecycle concern outside product components: when a restored document returns to the foreground, it fetches `/app-build.json` with `cache: no-store`, compares the deployed fingerprint with the shell's embedded fingerprint, requests a service-worker update, and reloads only if they differ. `PiWebClient.getHostContext()` owns the host-context accessor; it does not own session bootstrap.

SSE remains a Pi-specific live primitive. The shared map covers global reload/new-session and per-session chat previews, worker snapshots/deltas, annotations, queue changes, and BTW changes. A reload causes a canonical session refetch; a chat preview is transient UI state, not a second conversation store.

Credentials never belong in URLs. Browser login posts the optional token and then uses the host-only cookie; programmatic clients may use `Authorization: Bearer` or `X-Pi-Token`. Any `token` query parameter is rejected.

## T3 goals translated into Pi capabilities

The React layer carries over user goals only when Pi can complete the action:

| User goal | Pi translation | Ownership boundary |
|---|---|---|
| Fixed workspace shell and project/thread navigation | Host rail, absolute project paths, Pi session IDs, local sidebar grouping and resizing | Desktop product; mobile has its own navigation |
| Draft-first new task | Resolve authoritative Pi defaults, create without waiting for the model catalog, and load models only if runtime controls open | `PiWebClient.getSessionDefaults`, `createSession`, and `sendChat` |
| Conversation timeline and composer | Render persisted and streamed text through one Markdown pipeline; keep thinking and tool calls/results in stable transcript positions; follow only while pinned | `getSession`, `sendChat`, cancel, and session SSE |
| Runtime controls | Pi model catalog, model selection, thinking levels, and explicit cancellation; `sendChat` starts a prompt while idle and is the Pi steer operation while a worker is running, where a surface exposes that action | Pi worker methods only |
| Running-session updates | Global and per-session Pi SSE topics | `PiWebClient.subscribe` |
| Host connections | Existing device pairing and top-level links to separately secured pi-web hosts | Pi-web auth and host context |

This table describes supported translations, not a promise of T3 feature parity. Pi-native pairing and isolated share export remain first-class product features. Schedules and push notifications are retained backend/Pi services; this frontend architecture does not claim corresponding React screens.

## Explicit exclusions

The adaptation must not reintroduce T3 concepts that Pi cannot support or that violate the runtime boundary. In particular, it excludes:

- T3 provider frameworks, provider instances, traits, `EnvironmentId`, runtime/interaction modes, provider approvals, structured user-input prompts, and plan/build acceptance protocols
- environment federation, SSH/WSL/cloud relay, worktree orchestration, hosted connection services, or cross-host session merging
- Electron webviews, browser automation/CDP, preview-port discovery, PTY terminals, Ghostty integration, or terminal process ownership
- multi-agent fleets, subagent spawning, agent approval workflows, and T3 orchestration state machines
- Clerk, provider credential collection, hosted pull-request backends, and source-control provider integrations

When a T3 surface depends on one of these concepts, preserve the user goal with a Pi action instead: show the current working-tree diff, send review notes as an ordinary Pi prompt, show an artifact or external link, or defer the surface. Do not create a Pi-shaped wrapper around an unsupported T3 protocol.

## Static export boundary

Static export is a separate render:

```txt
sessions.Session
  → internal/ui.RenderExportSessionPage
  → embedded/share-session.html
  → inline theme/session CSS
  → inline marked + highlight.js vendors
  → inline dist-export/export.js
  → self-contained HTML snapshot
```

The export entry reaches a small, read-only Svelte component graph under `web/src/components/session/`, plus focused modules under `web/src/session/{data,navigation,render,tree,ui}/` and shared icons, keyboard navigation, and navigation helpers. It has no React bootstrap, network client, fetch, SSE, chat composer, worker state, service worker, pairing flow, live annotations, or live-only chrome.

`web/src/export/export-boundary.test.js` walks relative imports from the export entry and rejects live-only module families. Go export tests also assert that the generated HTML is self-contained and does not expose live controls.

## Validation

- Vitest covers both React products, the shared client, and retained export modules.
- `npm --prefix web run typecheck` checks the React contracts.
- `npm --prefix web run knip` rejects unused frontend files and dependencies.
- Go embed tests reject unexpected artifact directories and legacy asset namespaces.
- Playwright runs the built binary across desktop and mobile browser projects.
