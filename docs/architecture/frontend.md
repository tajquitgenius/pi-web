# Frontend Architecture

pi-web has two independent React live surfaces, a retained Svelte live SPA for the transition, and a separate Svelte static export. Desktop and mobile share transport contracts, not product UI.

## Live builds

The frontend build creates three embedded live outputs:

```txt
web/src/main.js                    ── Vite + Svelte ──▶ web/dist/
web/src/desktop/bootstrap.tsx      ── Vite + React  ──▶ web/dist-desktop/
web/src/mobile/bootstrap.tsx       ── Vite + React  ──▶ web/dist-mobile/
```

Each output has its own Vite manifest and asset namespace:

| Surface             | Manifest entry              | Embedded output    | Served assets              |
| ------------------- | --------------------------- | ------------------ | -------------------------- |
| Retained Svelte SPA | `src/main.js`               | `web/dist`         | `/static/assets/*`         |
| React desktop       | `src/desktop/bootstrap.tsx` | `web/dist-desktop` | `/static/desktop/assets/*` |
| React mobile        | `src/mobile/bootstrap.tsx`  | `web/dist-mobile`  | `/static/mobile/assets/*`  |

`web/assets_embed.go` embeds all three directories. At startup, `internal/frontend/assets.go` reads each manifest, validates its entry and stylesheet paths, and registers the hashed JS, CSS, and lazy chunks from that build. A filename emitted by one build cannot collide with a filename from another.

The React entries currently render route placeholders. They establish build, embedding, routing, and client boundaries without creating the desktop or mobile products.

## Surface selection

`internal/ui.SelectSurface` chooses the React shell for each browser request:

1. `pi-web-surface=desktop` selects desktop.
2. `pi-web-surface=mobile` selects mobile.
3. `pi-web-surface=auto`, an absent cookie, or an invalid value uses user-agent classification.

Classification is conservative. Known phones and iOS/iPadOS browsers select mobile. Android tablets, desktop browsers, bots, and unknown user agents select desktop. The cookie never changes host, auth, session, or credential boundaries.

Both surfaces retain these browser routes:

- `/`
- `/session?id=…`
- `/settings`

The Go server renders `internal/ui/embedded/app.html` for each route. It injects the chosen script, host context, optional session bootstrap, theme/font boot data, and PWA registration. Each React bundle owns its route rendering. The two bundles must not share layout, header, sidebar, composer, or CSS code.

## Shared live client

`web/src/live-shared/` contains the typed transport boundary used by both React surfaces:

```txt
React surface
  └─ PiWebClient
       ├─ HTTP JSON
       ├─ host-context bootstrap
       └─ EventSource
```

`PiWebClient` defines contracts for:

- session lists and paged session details
- new sessions with explicit provider, model, and thinking level
- session defaults and available models
- the current host and peer links
- global and per-session SSE topics
- pairing status and code submission
- paired-device listing and revocation

The client includes pairing request types and paths only. This foundation does not register pairing handlers, store pairing state, or change authentication.

The current Go backend does not yet expose `/api/session-defaults` or `/api/pairing/*`, and it does not yet consume the explicit model fields on `/api/new-session`. Product work must add those backend contracts before calling the corresponding client methods.

## Retained Svelte live SPA

The existing Svelte live application remains built and embedded at `web/dist`. `ui.RenderLegacyAppShell` keeps its complete shell and CSS renderable for rollback during the transition. Setting the separate transitional cookie `pi-web-svelte=1` serves that shell on the existing browser routes; it does not add a value to the `pi-web-surface` contract. React surface selection does not import Svelte live modules.

The retained app still owns the current production implementations under:

- `web/src/App.svelte`
- `web/src/routes/`
- `web/src/components/`
- `web/src/index/`, `web/src/session/`, `web/src/settings/`, and `web/src/shared/`

Remove this output only at final cutover, after the React products replace its live behavior.

## Static export remains isolated

Static export is not a live surface:

```txt
web/src/export/export-entry.js
  └─ vite.config.export.js
       └─ web/dist-export/export.js
            └─ internal/ui/embedded/export/export.js
```

`internal/ui/export.go` inlines that IIFE, its CSS, and vendored markdown/highlight runtimes into exported HTML. The export may reuse side-effect-free Svelte session rendering modules, but it must not import React bootstraps, `PiWebClient`, live SSE/chat code, or `/static/*` assets.

`TestExportBundleIsSelfContained` protects this boundary.

## Build and validation

`npm --prefix web run build` builds all three live outputs, then builds and copies the static export. `make build` always runs that frontend build before compiling Go because `//go:embed` requires every output.

`make check` also runs strict TypeScript checking, ESLint, Prettier, Knip, frontend tests, Go tests, the full frontend build, and Go vet.
