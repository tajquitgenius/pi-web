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

The React entries render the complete desktop and mobile products. The products keep separate layouts and styling while sharing the live transport and browser bootstrap boundary.

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
- pairing status, local code creation, and public code submission
- paired-device listing and revocation
- session bootstrap parsing and the surface-override cookie

The Go server implements these contracts. New sessions persist explicit provider-account aliases, model IDs, and thinking levels before direct worker startup. Source-session defaults come from the persisted JSONL even when no worker is alive.

Go sends `reload` and `new-session` as default-message data. It sends `chat-preview`, `status-snapshot`, `status-delta`, `annotations`, `queue`, and `btw-changed` as named events. The shared client maps each wire event once and exposes typed payloads to both products.

## Desktop interaction attribution

The desktop shell, server rail and thread sidebar, conversation/details panes, persistent runtime composer, and new-task workflow use interaction and layout patterns from T3 Code. The exact source revision, component mapping, and full upstream MIT license are recorded in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

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
