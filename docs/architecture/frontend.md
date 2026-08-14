# Frontend Architecture

Pi-web ships two live React products and one isolated static-export renderer. Desktop and mobile share typed transport contracts, but they do not share product UI. Svelte is not part of any live route.

## Production artifacts

`npm --prefix web run build` removes old outputs and creates exactly three artifacts:

| Product | Entry | Output | Delivery |
|---|---|---|---|
| React desktop | `web/src/desktop/bootstrap.tsx` | `web/dist-desktop` | `/static/desktop/*` |
| React mobile | `web/src/mobile/bootstrap.tsx` | `web/dist-mobile` | `/static/mobile/*` |
| Static conversation export | `web/src/export/export-entry.js` | `web/dist-export/export.js` | Inlined into exported HTML |

`web/assets_embed.go` embeds the two live Vite outputs. `internal/frontend/assets.go` reads each manifest and registers its hashed entry, CSS, and chunks in a separate URL namespace. The Makefile copies `dist-export/export.js` to `internal/ui/embedded/export/export.js` before compiling Go.

There is no generic `web/dist`, `/static/assets/*` namespace, live Svelte entry, or rollback shell.

## Live request flow

```txt
GET /, /session, or /settings
  → server handler
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

## React product ownership

`web/src/desktop/` owns the wide-screen application, including its server rail, thread list, conversation, details pane, persistent composer, and new-task flow.

`web/src/mobile/` owns its navigation and screen composition for sessions, conversations, settings, and public-device pairing. Mobile is a separate product rather than a responsive wrapper around desktop.

The desktop interaction and layout patterns derived from T3 Code remain attributed in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

## Shared live boundary

`web/src/live-shared/` is the only intended sharing boundary between the React products:

```txt
Desktop React ─┐
               ├─ PiWebClient contracts
Mobile React ──┘    ├─ HTTP requests
                    ├─ host and peer bootstrap
                    ├─ session bootstrap parsing
                    ├─ SSE subscriptions
                    └─ surface-cookie helpers
```

`contracts.ts` defines the wire shapes. `client.ts` owns HTTP and SSE translation. `browser.ts` reads server-injected data and manages the surface override. Product components consume this boundary instead of importing one another.

Credentials never belong in URLs. Browser login posts the optional token and then uses the host-only cookie; programmatic clients may use `Authorization: Bearer` or `X-Pi-Token`. Any `token` query parameter is rejected.

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

The export entry reaches a small, read-only Svelte component graph under `web/src/components/session/`, plus focused modules under `web/src/session/{data,navigation,render,tree,ui}/` and shared icons, localization, keyboard navigation, and navigation helpers. It has no React bootstrap, network client, fetch, SSE, chat composer, worker state, service worker, pairing flow, live annotations, or live-only chrome.

`web/src/export/export-boundary.test.js` walks relative imports from the export entry and rejects live-only module families. Go export tests also assert that the generated HTML is self-contained and does not expose live controls.

## Validation

- Vitest covers both React products, the shared client, and retained export modules.
- `npm --prefix web run typecheck` checks the React contracts.
- `npm --prefix web run knip` rejects unused frontend files and dependencies.
- Go embed tests reject unexpected artifact directories and legacy asset namespaces.
- Playwright runs the built binary across desktop and mobile browser projects.
