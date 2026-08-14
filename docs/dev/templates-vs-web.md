# UI Rendering Boundaries

Pi-web has one Go-owned live shell, two React live products, and one independent static-export shell.

## Ownership table

| Layer | Owner | Purpose |
|---|---|---|
| `internal/ui/embedded/app.html` | Go | Minimal shell for every live browser route |
| `web/src/desktop/` | React | Desktop product |
| `web/src/mobile/` | React | Mobile product |
| `web/src/live-shared/` | TypeScript | Shared HTTP, SSE, host, bootstrap, and surface contracts |
| `internal/ui/embedded/share-session.html` | Go | Static conversation-export shell |
| `web/src/export/export-entry.js` | Svelte export graph | Read-only, self-contained snapshot runtime |
| `internal/ui/embedded/styles/theme.css` and `session.css` | Go embed | Styles retained for exported snapshots |

## Live shell

`internal/ui/spa_page.go` renders `embedded/app.html` for `/`, `/session`, and `/settings`. It selects one surface, injects host context and optional session bootstrap data, and references one hashed Vite entry:

```txt
request
  → ui.SelectSurface
  → desktop: /static/desktop/assets/desktop-*.js
     mobile:  /static/mobile/assets/mobile-*.js
  → <div id="spa-root">
  → React mounts
```

The shell also supplies theme/font boot code and service-worker registration. React owns all live page markup after mounting. There is no server-rendered live page body and no live Svelte route.

The asset map comes from the manifests embedded in `web/dist-desktop` and `web/dist-mobile`. Each build has its own namespace, so equally named chunks cannot collide.

## Session bootstrap

For `/session?id=…`, Go resolves the session and injects a base64 JSON payload in `#pi-session-bootstrap`. Both React products read it through `web/src/live-shared/browser.ts`. Subsequent updates and paged reads use the typed `PiWebClient` API.

The bootstrap is data, not HTML. Do not add product markup to the Go shell.

## Static export

`internal/ui/export.go` renders `embedded/share-session.html` with `IsLive` behavior removed by construction. It inlines:

- theme and session CSS
- base64 session data
- vendored `marked` and `highlight.js`
- the IIFE built from `web/src/export/export-entry.js`

The result has no server dependency and is suitable for a secret Gist. Its Svelte components are export-only. They must remain read-only and must not import the React client, fetch APIs, SSE, chat, pairing, or service-worker code.

## Build order

Always use `make build`. The required order is:

```txt
npm --prefix web run build
  → dist-desktop
  → dist-mobile
  → dist-export/export.js
copy export.js → internal/ui/embedded/export/export.js
go build ./cmd/pi-web
```

Running `go build` alone can embed stale or missing generated frontend files.

## Change checklist

When changing a live product:

1. Keep product UI in its desktop or mobile directory.
2. Put only wire-level sharing in `live-shared`.
3. Add the user-facing string through the live product's localization mechanism.
4. Test the affected product and the built binary.

When changing export:

1. Start from `export-entry.js` and keep its import closure read-only.
2. Preserve the self-contained Go render.
3. Run the export boundary, component, and Go HTML tests.
4. Confirm no live controls or network dependencies appear in the output.
