# End-to-End Testing with Playwright

The `e2e/` project drives real browsers against an isolated, freshly built `pi-web` binary. It complements Vitest and Go tests with complete HTTP, browser, SSE, pairing, navigation, and chat flows.

E2E is separate from `make test` and `make check` because it requires installed browser binaries and starts its own temporary server.

## Quick start

```bash
make e2e-setup
make e2e

# focused runs
cd e2e
npx playwright test --project="Desktop Chrome"
npx playwright test --project="Mobile Safari"
npx playwright test tests/react-products.spec.ts
npx playwright test --headed --project="Desktop Chrome" --workers=1
npx playwright show-report
```

`make e2e` runs `make build` first. The tested binary therefore embeds fresh React desktop, React mobile, and static-export artifacts.

## Browser matrix

`e2e/playwright.config.ts` defines:

- Desktop Chrome at 1440×900
- Desktop Firefox
- Desktop Safari
- Mobile Chrome
- Mobile Safari using the iPhone 15 Pro profile
- iPad
- iPad landscape

Use Desktop Chrome and Mobile Safari for the cutover acceptance pass. Cross-browser runs remain available for broader qualification.

## Isolated harness

Global setup creates temporary state and session directories, installs a stub `pi`, starts the built binary on an isolated port, and waits for `/api/health`. Global teardown stops that process. The harness does not reuse, restart, or modify an installed pi-web service.

Shared fixtures in `e2e/lib/` provide session creation, chat interactions, and product-aware navigation. Tests should use user-visible roles, labels, and stable product selectors. Do not restore selectors that belonged to the removed live-Svelte application.

## Product and security coverage

The suite keeps focused coverage for:

- desktop and mobile React acceptance
- explicit desktop/mobile surface overrides and conservative automatic selection
- peer navigation
- public-device pairing and the complete production mux
- chat worker reuse and live updates
- static export/share behavior
- absence of the removed live-Svelte asset namespace
- rejection of credentials in query parameters

## Debugging

```bash
cd e2e
PWDEBUG=1 npx playwright test --project="Desktop Chrome" tests/react-products.spec.ts
npx playwright test --ui
```

On failure, inspect `e2e/test-results/` and the HTML report. Traces, screenshots, and videos are test artifacts and are ignored by Git.

For a visual acceptance checkpoint, capture fresh 1440×900 desktop and iPhone 15 Pro screenshots from the isolated harness, inspect them at full size, and store the review copies outside the repository.
