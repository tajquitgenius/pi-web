package ui

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

func TestAppShellPreservesPWAContract(t *testing.T) {
	old := surfaceAppAssets[DesktopSurface]
	SetSurfaceAssets(
		DesktopSurface,
		"/static/desktop/assets/desktop-test.js",
		[]string{"/static/desktop/assets/desktop-test.css"},
	)
	defer func() { surfaceAppAssets[DesktopSurface] = old }()

	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(&http.Cookie{Name: SurfaceCookieName, Value: "desktop"})
	var b strings.Builder
	if err := RenderAppShell(&b, req, ""); err != nil {
		t.Fatalf("RenderAppShell: %v", err)
	}
	html := b.String()
	for _, want := range []string{
		`<title>Pi Sessions</title>`,
		`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">`,
		`<link rel="icon" type="image/svg+xml" href="/icon.svg">`,
		`<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">`,
		`<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`,
		`<link rel="manifest" href="/manifest.webmanifest">`,
		`<meta name="application-name" content="Pi Sessions">`,
		`<meta name="theme-color" content="#0e0e13">`,
		`<meta name="mobile-web-app-capable" content="yes">`,
		`<meta name="apple-mobile-web-app-capable" content="yes">`,
		`<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`,
		`<meta name="apple-mobile-web-app-title" content="Pi Sessions">`,
		`<meta name="pi-web-theme"`,
		`navigator.windowControlsOverlay`,
		`<link rel="stylesheet" href="/custom-themes.css">`,
		`<style id="pi-web-fonts">`,
		`<link rel="stylesheet" href="/static/desktop/assets/desktop-test.css">`,
		`<div id="spa-root" data-pi-web-surface="desktop"></div>`,
		`<script type="module" src="/static/desktop/assets/desktop-test.js"></script>`,
		`navigator.serviceWorker.register('/sw.js',{scope:'/'})`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("app shell missing %q\n%s", want, html)
		}
	}
}

func TestAppShellInjectsEscapedHostContextJSON(t *testing.T) {
	old := hostContextProvider
	SetHostContextProvider(func() HostContext {
		return HostContext{
			InstanceName: `workstation</script><script>alert("x")</script>`,
			CurrentURL:   "https://current.example",
			Peers:        []HostPeer{{Label: "Peer & Co", URL: "https://peer.example:8443"}},
		}
	})
	defer func() { hostContextProvider = old }()

	var b strings.Builder
	if err := RenderAppShell(&b, httptest.NewRequest("GET", "/", nil), ""); err != nil {
		t.Fatalf("RenderAppShell: %v", err)
	}
	html := b.String()
	match := regexp.MustCompile(`<script id="pi-host-context" type="application/json">([^<]*)</script>`).FindStringSubmatch(html)
	if len(match) != 2 {
		t.Fatalf("host context script not found or contains unsafe markup: %s", html)
	}
	var got HostContext
	if err := json.Unmarshal([]byte(match[1]), &got); err != nil {
		t.Fatalf("host context is not valid JSON: %v", err)
	}
	if got.InstanceName != `workstation</script><script>alert("x")</script>` {
		t.Fatalf("instanceName = %q", got.InstanceName)
	}
	if got.CurrentURL != "https://current.example" || len(got.Peers) != 1 || got.Peers[0].URL != "https://peer.example:8443" {
		t.Fatalf("host context = %#v", got)
	}
	if strings.Contains(match[1], "</script>") {
		t.Fatal("host context JSON contains a literal closing script tag")
	}
}
