package app

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"pi-web/internal/agentdir"
	"pi-web/internal/auth"
	"pi-web/internal/frontend"
	"pi-web/internal/rpc"
	"pi-web/internal/server"
	"pi-web/internal/sessions"
	"pi-web/internal/ui"
	"pi-web/internal/updater"
	"pi-web/internal/workers"
	"pi-web/web"
)

const defaultPort = "31415"
const tokenEnvVar = "PI_WEB_TOKEN"
const publicURLEnvVar = "PI_WEB_PUBLIC_URL"
const instanceNameEnvVar = "PI_WEB_INSTANCE_NAME"
const peersJSONEnvVar = "PI_WEB_PEERS_JSON"
const developmentEnvVar = "PI_WEB_DEV"

// Main runs the pi-web application. version is supplied by cmd/pi-web so
// release builds can set it with -ldflags "-X main.version=...".
func Main(version string) {
	port := flag.String("p", defaultPort, "port to listen on")
	hostOverride := flag.String("host", "", "host/IP to bind; defaults to 127.0.0.1")
	publicURLFlag := flag.String("public-url", os.Getenv(publicURLEnvVar), "externally managed absolute HTTPS origin")
	open := flag.Bool("o", false, "auto-open browser")
	insecure := flag.Bool("insecure", false, "allow non-loopback bind without "+tokenEnvVar+" (DANGEROUS)")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		os.Exit(0)
	}
	developmentMode := os.Getenv(developmentEnvVar) == "1"

	agentDir := agentdir.Path()
	if err := seedSoundsDir(agentDir); err != nil {
		fmt.Fprintf(os.Stderr, "failed to seed sounds directory: %v\n", err)
	}
	sessionsDir := filepath.Join(agentDir, "sessions")
	if _, err := os.Stat(sessionsDir); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "sessions directory not found: %s\n", sessionsDir)
		os.Exit(1)
	}

	bindHost := chooseBindHost(*hostOverride)
	publicURL, err := validatePublicURL(*publicURLFlag)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid public URL: %v\n", err)
		os.Exit(1)
	}
	if err := validatePublicBind(publicURL, bindHost); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
	hostContext, err := buildHostContext(os.Getenv(instanceNameEnvVar), publicURL, os.Getenv(peersJSONEnvVar))
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid host context: %v\n", err)
		os.Exit(1)
	}
	token := os.Getenv(tokenEnvVar)
	tokenRequired := token == "" && !isLoopbackHost(bindHost) && !*insecure
	if tokenRequired {
		fmt.Fprintf(os.Stderr,
			"refusing to bind %s without %s set: anyone reachable on this address could view sessions and drive pi.\n"+
				"  set %s=$(openssl rand -hex 16) to require a token, or pass --insecure to override.\n",
			bindHost, tokenEnvVar, tokenEnvVar)
		os.Exit(1)
	}
	authMiddleware := auth.New(token)
	authMiddleware.AllowHost(net.JoinHostPort(bindHost, *port))
	if publicURL != "" {
		authMiddleware.AllowHost(publicURL)
		authMiddleware.UseSecureCookiesForHost(publicURL)
	}
	if *insecure {
		authMiddleware.AllowAnyHost()
	}

	versionChecker := updater.New(version)

	var srv *server.Server
	manager := workers.NewManager(func(sessionID, sessionPath string) (workers.ChatWorker, error) {
		return rpc.NewPiWorkerWithStream(sessionPath, func(preview rpc.StreamPreview) {
			if srv != nil {
				srv.BroadcastChatPreview(sessionID, preview)
			}
		})
	})
	var srvErr error
	srv, srvErr = server.New(server.Deps{
		AgentDir:            agentDir,
		SessionsDir:         sessionsDir,
		Auth:                authMiddleware,
		PublicURL:           publicURL,
		ChatSender:          manager,
		Cache:               sessions.NewCache(),
		RenderExportSession: ui.RenderExportSessionPage,
		RenderAppShell:      ui.RenderAppShell,
		Models: func(ctx context.Context) (json.RawMessage, error) {
			return defaultModelsCache.get(ctx)
		},
		SessionDefaults:       sessionDefaultsProvider(defaultSessionDefaultsCache),
		Updater:               versionChecker,
		RunInstall:            runInstall,
		RunRestart:            runRestart,
		DisableBackgroundJobs: developmentMode,
	})
	if srvErr != nil {
		fmt.Fprintf(os.Stderr, "failed to initialize server: %v\n", srvErr)
		os.Exit(1)
	}

	ui.SetThemeProvider(srv.ThemeSetting)
	ui.SetFontProvider(srv.FontStyles)
	ui.SetHostContextProvider(func() ui.HostContext { return hostContext })

	mux := http.NewServeMux()
	srv.Register(mux)
	ui.RegisterPWAHandlers(mux)
	productBuilds := []struct {
		name        string
		fs          fs.FS
		entry       string
		assetBase   string
		assetPrefix string
		applyAssets func(frontend.Script)
	}{
		{
			name:        "desktop",
			fs:          web.DesktopDistFS(),
			entry:       frontend.DesktopEntry,
			assetBase:   "/static/desktop",
			assetPrefix: "/static/desktop/assets/",
			applyAssets: func(script frontend.Script) {
				ui.SetSurfaceAssets(ui.DesktopSurface, script.Path, script.Styles)
			},
		},
		{
			name:        "mobile",
			fs:          web.MobileDistFS(),
			entry:       frontend.MobileEntry,
			assetBase:   "/static/mobile",
			assetPrefix: "/static/mobile/assets/",
			applyAssets: func(script frontend.Script) {
				ui.SetSurfaceAssets(ui.MobileSurface, script.Path, script.Styles)
			},
		},
	}
	for _, build := range productBuilds {
		scripts, err := frontend.LoadScriptsAt(build.fs, build.assetBase, build.entry)
		if err != nil {
			fmt.Fprintf(os.Stderr, "WARNING: failed to load %s React product: %v (surface JS will be unavailable)\n", build.name, err)
			continue
		}
		for _, script := range scripts {
			build.applyAssets(script)
			mux.HandleFunc(script.Path, frontend.ServeJS(script.JS, true))
		}
		mux.HandleFunc(build.assetPrefix, frontend.ServeStaticAssetsAt(build.fs, build.assetPrefix))
	}

	addr := net.JoinHostPort(bindHost, *port)
	url := fmt.Sprintf("http://%s", net.JoinHostPort(bindHost, *port))
	fmt.Printf("Pi Sessions Viewer -> %s\n", url)
	if publicURL != "" {
		fmt.Printf("Public HTTPS -> %s\n", publicURL)
	}
	fmt.Printf("Serving from: %s\n", sessionsDir)
	if developmentMode {
		fmt.Println("Development mode: autonomous jobs disabled")
	}
	if authMiddleware.Enabled() {
		fmt.Println("Auth: enabled (set PI_WEB_TOKEN to require token)")
	} else {
		fmt.Printf("Auth: disabled — set %s to require a token for access.\n", tokenEnvVar)
	}

	stateFilePath, stateFile, err := writeStateFile(agentDir, developmentMode, bindHost, *port, publicURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
	defer func() {
		// Unlink while this process still owns the lock so an exiting instance
		// cannot remove a successor's newly written state file.
		_ = os.Remove(stateFilePath)
		_ = stateFile.Close()
	}()

	if *open {
		go func() {
			time.Sleep(300 * time.Millisecond)
			openBrowser(url)
		}()
	}

	warmModelsCache()
	warmSessionDefaultsCache()

	httpServer := &http.Server{
		Addr:              addr,
		Handler:           srv.HTTPHandler(mux),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		// WriteTimeout intentionally 0 — SSE streams are long-lived.
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go versionChecker.Start(ctx)

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
		srv.Shutdown()
		_ = manager.Close()
	}()

	serveErr := httpServer.ListenAndServe()
	if serveErr != nil && serveErr != http.ErrServerClosed {
		fmt.Fprintf(os.Stderr, "server error: %v\n", serveErr)
		os.Exit(1)
	}
}
