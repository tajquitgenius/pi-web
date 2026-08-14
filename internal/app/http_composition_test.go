package app

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"pi-web/internal/auth"
	"pi-web/internal/frontend"
	"pi-web/internal/pairing"
	"pi-web/internal/server"
	"pi-web/internal/sessions"
	"pi-web/internal/ui"
	"pi-web/web"
)

func TestProductionMuxPairingBootstrapAndSecurityComposition(t *testing.T) {
	agentDir := t.TempDir()
	sessionsDir := filepath.Join(agentDir, "sessions")
	if err := os.MkdirAll(sessionsDir, 0755); err != nil {
		t.Fatal(err)
	}

	authMiddleware := auth.New("extra-secret")
	authMiddleware.AllowHost("127.0.0.1:31415")
	authMiddleware.AllowHost("https://pi.example")
	authMiddleware.UseSecureCookiesForHost("https://pi.example")
	ui.SetHostContextProvider(func() ui.HostContext {
		return ui.HostContext{
			InstanceName: "Main hub",
			CurrentURL:   "https://pi.example",
			Peers: []ui.HostPeer{
				{Label: "Work laptop", URL: "https://work.example"},
			},
		}
	})

	srv, err := server.New(server.Deps{
		AgentDir:              agentDir,
		SessionsDir:           sessionsDir,
		Auth:                  authMiddleware,
		PublicURL:             "https://pi.example",
		Cache:                 sessions.NewCache(),
		RenderAppShell:        ui.RenderAppShell,
		DisableBackgroundJobs: true,
		Models: func(context.Context) (json.RawMessage, error) {
			return json.RawMessage(`{"models":[]}`), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(srv.Shutdown)

	mux := http.NewServeMux()
	srv.Register(mux)
	ui.RegisterPWAHandlers(mux)
	builds := []struct {
		fs          fs.FS
		entry       string
		assetBase   string
		assetPrefix string
		apply       func(frontend.Script)
	}{
		{
			fs:          web.DistFS(),
			entry:       frontend.AppEntry,
			assetBase:   "/static",
			assetPrefix: "/static/assets/",
			apply: func(script frontend.Script) {
				ui.SetAppScriptPath(script.Path)
			},
		},
		{
			fs:          web.DesktopDistFS(),
			entry:       frontend.DesktopEntry,
			assetBase:   "/static/desktop",
			assetPrefix: "/static/desktop/assets/",
			apply: func(script frontend.Script) {
				ui.SetSurfaceAssets(ui.DesktopSurface, script.Path, script.Styles)
			},
		},
		{
			fs:          web.MobileDistFS(),
			entry:       frontend.MobileEntry,
			assetBase:   "/static/mobile",
			assetPrefix: "/static/mobile/assets/",
			apply: func(script frontend.Script) {
				ui.SetSurfaceAssets(ui.MobileSurface, script.Path, script.Styles)
			},
		},
	}
	for _, build := range builds {
		scripts, err := frontend.LoadScriptsAt(build.fs, build.assetBase, build.entry)
		if err != nil {
			t.Fatal(err)
		}
		for _, script := range scripts {
			build.apply(script)
			mux.HandleFunc(script.Path, frontend.ServeJS(script.JS, true))
		}
		mux.HandleFunc(build.assetPrefix, frontend.ServeStaticAssetsAt(build.fs, build.assetPrefix))
	}
	handler := srv.HTTPHandler(mux)

	request := func(method, target string, configure func(*http.Request)) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, target, nil)
		if configure != nil {
			configure(req)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	desktopUA := "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/123 Safari/537.36"
	mobileUA := "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
	assetPattern := regexp.MustCompile(`(?:src|href)="([^"]+)"`)
	for _, tt := range []struct {
		name      string
		ua        string
		namespace string
	}{
		{name: "desktop", ua: desktopUA, namespace: "/static/desktop/assets/"},
		{name: "mobile", ua: mobileUA, namespace: "/static/mobile/assets/"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			page := request(http.MethodGet, "https://pi.example/pairing", func(req *http.Request) {
				req.Header.Set("User-Agent", tt.ua)
			})
			if page.Code != http.StatusOK {
				t.Fatalf("pairing page status = %d", page.Code)
			}
			html := page.Body.String()
			if !strings.Contains(html, `data-pi-web-surface="`+tt.name+`"`) {
				t.Fatalf("pairing shell did not select %s surface", tt.name)
			}
			for _, forbidden := range []string{"token=", "code=", "pi_device="} {
				if strings.Contains(html, forbidden) {
					t.Fatalf("pairing shell leaked credential-shaped URL data %q", forbidden)
				}
			}

			assets := make([]string, 0, 2)
			for _, match := range assetPattern.FindAllStringSubmatch(html, -1) {
				if strings.HasPrefix(match[1], tt.namespace) {
					assets = append(assets, match[1])
				}
			}
			if len(assets) < 2 {
				t.Fatalf("pairing shell assets = %#v, want JS and CSS in %s", assets, tt.namespace)
			}
			for _, asset := range assets {
				response := request(http.MethodGet, "https://pi.example"+asset, nil)
				if response.Code != http.StatusOK {
					t.Fatalf("asset %s status = %d", asset, response.Code)
				}
				contentType := response.Header().Get("Content-Type")
				if strings.HasSuffix(asset, ".js") && !strings.HasPrefix(contentType, "application/javascript") {
					t.Fatalf("JS asset %s Content-Type = %q", asset, contentType)
				}
				if strings.HasSuffix(asset, ".css") && !strings.HasPrefix(contentType, "text/css") {
					t.Fatalf("CSS asset %s Content-Type = %q", asset, contentType)
				}
			}
		})
	}

	for _, tt := range []struct {
		path        string
		contentType string
	}{
		{path: "/manifest.webmanifest", contentType: "application/manifest+json"},
		{path: "/sw.js", contentType: "application/javascript"},
		{path: "/icon.svg", contentType: "image/svg+xml"},
		{path: "/icon-maskable.svg", contentType: "image/svg+xml"},
		{path: "/pi-logo.svg", contentType: "image/svg+xml"},
	} {
		response := request(http.MethodGet, "https://pi.example"+tt.path, nil)
		if response.Code != http.StatusOK || !strings.HasPrefix(response.Header().Get("Content-Type"), tt.contentType) {
			t.Fatalf("GET %s = (%d, %q)", tt.path, response.Code, response.Header().Get("Content-Type"))
		}
	}

	for _, tt := range []struct {
		ua       string
		override string
		want     string
	}{
		{ua: desktopUA, override: "mobile", want: "/static/mobile/assets/"},
		{ua: mobileUA, override: "desktop", want: "/static/desktop/assets/"},
	} {
		page := request(http.MethodGet, "https://pi.example/pairing", func(req *http.Request) {
			req.Header.Set("User-Agent", tt.ua)
			req.AddCookie(&http.Cookie{Name: ui.SurfaceCookieName, Value: tt.override})
		})
		if !strings.Contains(page.Body.String(), tt.want) {
			t.Fatalf("surface override %s did not select %s", tt.override, tt.want)
		}
	}

	denied := request(http.MethodGet, "https://pi.example/api/sessions", nil)
	if denied.Code != http.StatusUnauthorized {
		t.Fatalf("unpaired protected API status = %d", denied.Code)
	}

	codeResponse := request(http.MethodPost, "http://127.0.0.1:31415/api/pairing-codes", nil)
	if codeResponse.Code != http.StatusCreated {
		t.Fatalf("pairing code status = %d, body = %s", codeResponse.Code, codeResponse.Body.String())
	}
	var code pairing.Code
	if err := json.Unmarshal(codeResponse.Body.Bytes(), &code); err != nil {
		t.Fatal(err)
	}
	pairBody, _ := json.Marshal(map[string]string{"code": code.Value, "label": "Browser"})
	pairReq := httptest.NewRequest(http.MethodPost, "https://pi.example/api/pair", strings.NewReader(string(pairBody)))
	pairReq.Header.Set("Content-Type", "application/json")
	pairReq.Header.Set("Origin", "https://pi.example")
	pairRec := httptest.NewRecorder()
	handler.ServeHTTP(pairRec, pairReq)
	if pairRec.Code != http.StatusCreated {
		t.Fatalf("pair status = %d, body = %s", pairRec.Code, pairRec.Body.String())
	}
	var deviceCookie *http.Cookie
	for _, cookie := range pairRec.Result().Cookies() {
		if cookie.Name == "pi_device" {
			deviceCookie = cookie
		}
	}
	if deviceCookie == nil {
		t.Fatal("pair response did not set device cookie")
	}

	pairedOnly := request(http.MethodGet, "https://pi.example/api/sessions", func(req *http.Request) {
		req.AddCookie(deviceCookie)
	})
	if pairedOnly.Code != http.StatusUnauthorized {
		t.Fatalf("paired request without optional token = %d, want 401", pairedOnly.Code)
	}
	composed := request(http.MethodGet, "https://pi.example/api/sessions", func(req *http.Request) {
		req.AddCookie(deviceCookie)
		req.Header.Set("X-Pi-Token", "extra-secret")
	})
	if composed.Code != http.StatusOK {
		t.Fatalf("paired + token API status = %d, body = %s", composed.Code, composed.Body.String())
	}

	hostileForwarded := request(http.MethodGet, "https://evil.example/api/pairing-status", func(req *http.Request) {
		req.Header.Set("Forwarded", "proto=https;host=pi.example")
		req.Header.Set("X-Forwarded-Host", "pi.example")
		req.Header.Set("X-Forwarded-Proto", "https")
	})
	if hostileForwarded.Code != http.StatusForbidden {
		t.Fatalf("hostile forwarded request status = %d, want 403", hostileForwarded.Code)
	}
	wrongScheme := request(http.MethodPost, "http://pi.example/api/pair", func(req *http.Request) {
		req.Header.Set("Origin", "http://pi.example")
		req.Header.Set("Forwarded", "proto=https;host=pi.example")
		req.Header.Set("X-Forwarded-Proto", "https")
	})
	if wrongScheme.Code != http.StatusForbidden {
		t.Fatalf("wrong-scheme public Origin status = %d, want 403", wrongScheme.Code)
	}
}
