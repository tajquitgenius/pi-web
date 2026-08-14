package ui

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"html/template"
	"io"
	"net/http"
	"strings"
)

//go:embed embedded/app.html
var appTmplStr string

var appTmpl = template.Must(template.New("app").Parse(appTmplStr))

type HostPeer struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

type HostContext struct {
	InstanceName string     `json:"instanceName"`
	CurrentURL   string     `json:"currentUrl"`
	Peers        []HostPeer `json:"peers"`
}

var hostContextProvider = func() HostContext {
	return HostContext{Peers: []HostPeer{}}
}

// SetHostContextProvider installs the read-only multi-host context injected
// into every SPA shell.
func SetHostContextProvider(fn func() HostContext) {
	if fn != nil {
		hostContextProvider = fn
	}
}

func legacyAppStylesheets() template.HTML {
	return template.HTML("<style>\n" + liveThemeCss + "\n" + indexCSS + "\n" + settingsCSS + "\n" + schedulesCSS + "\n" + liveSessionCss + "\n" + liveMenuCss + "\n" + livePaletteCss + "\n</style>")
}

func appAssetLinks(assets appAssets) template.HTML {
	var links strings.Builder
	links.WriteString(`<link rel="modulepreload" href="`)
	links.WriteString(template.HTMLEscapeString(assets.script))
	links.WriteString(`">`)
	for _, stylesheet := range assets.styles {
		links.WriteString(`<link rel="stylesheet" href="`)
		links.WriteString(template.HTMLEscapeString(stylesheet))
		links.WriteString(`">`)
	}
	return template.HTML(links.String())
}

// RenderAppShell selects and renders one React live surface for this request.
// Session bootstrap data and host context stay in the server-owned shell so the
// two products can share transport contracts without sharing product UI.
func RenderAppShell(w io.Writer, r *http.Request, bootstrap string) error {
	if useLegacySvelte(r) {
		return RenderLegacyAppShell(w, bootstrap)
	}
	surface := SelectSurface(r)
	return renderAppShell(w, string(surface), surfaceAppAssets[surface], bootstrap, "")
}

// RenderLegacyAppShell keeps the existing Svelte SPA renderable until final
// cutover. It is intentionally separate from React surface selection.
func RenderLegacyAppShell(w io.Writer, bootstrap string) error {
	return renderAppShell(w, "svelte", legacyAppAssets, bootstrap, legacyAppStylesheets())
}

func renderAppShell(w io.Writer, surface string, assets appAssets, bootstrap string, styles template.HTML) error {
	hostContext := hostContextProvider()
	if hostContext.Peers == nil {
		hostContext.Peers = []HostPeer{}
	}
	hostContextJSON, err := json.Marshal(hostContext)
	if err != nil {
		return err
	}
	// encoding/json escapes HTML-significant characters, so this remains valid
	// JSON without permitting a value to close the script element.
	hostContextTag := template.HTML(`<script id="pi-host-context" type="application/json">` + string(hostContextJSON) + `</script>`)
	bootstrapTag := template.HTML("")
	if bootstrap != "" {
		// base64 only (A-Za-z0-9+/=), so it cannot break out of the script tag.
		bootstrapTag = template.HTML(`<script id="pi-session-bootstrap" type="application/json">` + template.HTMLEscapeString(bootstrap) + `</script>`)
	}
	scriptSrc := template.HTMLEscapeString(assets.script)
	data := struct {
		LiveDocumentStart template.HTML
		ThemeBoot         template.HTML
		HostContext       template.HTML
		Bootstrap         template.HTML
		Surface           string
		AppScript         template.HTML
		ServiceWorker     template.HTML
		LiveDocumentEnd   template.HTML
	}{
		LiveDocumentStart: template.HTML(renderLiveDocumentStart(liveDocumentData{
			Title:   "pi-web",
			Preload: appAssetLinks(assets),
			Styles:  styles,
		})),
		ThemeBoot:       liveThemeBootScript(),
		HostContext:     hostContextTag,
		Bootstrap:       bootstrapTag,
		Surface:         surface,
		AppScript:       template.HTML(`<script type="module" src="` + scriptSrc + `"></script>`),
		ServiceWorker:   liveServiceWorkerScript(),
		LiveDocumentEnd: liveDocumentEnd(),
	}
	var buf bytes.Buffer
	if err := appTmpl.Execute(&buf, data); err != nil {
		return err
	}
	_, err = w.Write(buf.Bytes())
	return err
}
