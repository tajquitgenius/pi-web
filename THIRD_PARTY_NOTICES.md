# Third-party notices

## T3 Code

Pi-web's live desktop React product is a Pi-only adaptation of interaction and layout patterns from [T3 Code](https://github.com/pingdotgg/t3code.git). The upstream source is pinned to revision `1add47b322ab1dfb5010bb363613650176b88088`.

### Upstream source families

The adaptation uses the following web-frontend families from that revision:

- `apps/web/src/components/{AppSidebarLayout,Sidebar,WorkspaceBreadcrumb}.tsx`: fixed shell, project and thread navigation, and workspace layout
- `apps/web/src/components/{ChatView,ChatMarkdown}.tsx`: conversation presentation and markdown interaction
- `apps/web/src/components/chat/{ChatComposer,MessagesTimeline}.tsx`: composer, timeline, and message-presentation patterns only
- `apps/web/src/routes/_chat*.tsx`: workspace and draft/new-task flow
- `apps/web/src/{modelSelection,session-logic,sidebarProjectGrouping}.ts`: local model, session, and sidebar interaction patterns
- `apps/web/src/components/CommandPalette.tsx`, `apps/web/src/components/CommandPalette.logic.ts`, and `apps/web/src/components/{CommandPaletteContent,CommandPaletteResults}.tsx`: command-palette search, keyboard navigation, grouping, and result presentation
- `apps/web/src/components/{RightPanelTabs,RightPanelSheet}.tsx` and `apps/web/src/components/preview/RightPanelResizeHandle.tsx`: right-panel tabs, open/close behavior, and resize affordance

The attribution applies to the Pi-web files that carry those adaptations:

- `web/src/desktop/DesktopApp.tsx`: fixed shell and route composition
- `web/src/desktop/Sidebar.tsx`: host rail, project sidebar, and session navigation
- `web/src/desktop/Conversation.tsx`: conversation and details panes; persistent Pi composer with model and thinking controls
- `web/src/desktop/NewTask.tsx`: Pi new-task workflow
- `web/src/desktop/desktop-model.ts`: local sidebar, session grouping, and model-selection helpers used by the adapted shell
- `web/src/desktop/desktop.css`: styles for those interaction and layout patterns

### Exact target/source mappings

These are pattern-level adaptations, not copies of T3 runtime code:

- `web/src/desktop/CommandPalette.tsx` is a substantial Pi adaptation of the command-palette interaction and result-list pattern in `apps/web/src/components/CommandPalette.tsx` and `apps/web/src/components/CommandPalette.logic.ts` (`filterCommandPaletteGroups`, `buildRootGroups`), with palette chrome and result-row patterns from `apps/web/src/components/CommandPaletteContent.tsx` (`CommandPaletteContent`) and `apps/web/src/components/CommandPaletteResults.tsx` (`CommandPaletteResults`). Its Pi action catalog, slash-command loading and sending, session data, and routing are Pi-original.
- `web/src/desktop/RightPanel.tsx` is a substantial Pi adaptation of the tabbed/keyboard right-panel presentation in `apps/web/src/components/RightPanelTabs.tsx` (`RightPanelTabs`), the right-side open/close boundary in `apps/web/src/components/RightPanelSheet.tsx` (`RightPanelSheet`), and the left-edge resize affordance in `apps/web/src/components/preview/RightPanelResizeHandle.tsx` (`RightPanelResizeHandle`). Its details, workspace-file preview, Git diff, scratchpad, and `PiWebClient` calls are Pi-original; T3 browser, terminal, agent, and pull-request surfaces are not included.

The mobile product is a separate Pi-owned composition under `web/src/mobile/`; it does not import the desktop product or these T3-derived files. `web/src/live-shared/` is also Pi-owned: it defines the `PiWebClient` seam and its HTTP/SSE contracts. The desktop and mobile pairing/settings screens, bootstrap entries, tests, static export, and Go backend are not T3-derived source.

`web/src/desktop/desktop-capabilities.ts` is Pi-original. Its file/diff/scratchpad/command schema normalizers and capability fallbacks have no T3 source mapping; in particular, it is not adapted from T3's unrelated `packages/client-runtime/src/platform/capabilities.ts` or `apps/mobile/src/features/agent-awareness/capabilities.ts`.

Pi-web does not copy or run T3's provider/runtime implementation. No source from T3's Electron host (`apps/desktop/src/**`), provider/environment/cloud/terminal/browser/agent families, generated tests, or unrelated packages is included in this attribution. See [`docs/architecture/frontend.md`](docs/architecture/frontend.md) for the Pi translations and explicit exclusions.

T3 Code is distributed under the MIT License:

> MIT License
>
> Copyright (c) 2026 T3 Tools Inc.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.
