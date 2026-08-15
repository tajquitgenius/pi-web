package auth

import (
	"crypto/subtle"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"pi-web/internal/ui"
)

const TokenCookieName = "pi_token"

type Middleware struct {
	token             string
	allowedHostsMu    sync.RWMutex
	allowedHosts      map[string]struct{}
	allowedSchemes    map[string]string
	secureCookieHosts map[string]struct{}
	allowAnyHost      bool
	enforceKnownHosts bool
}

func New(token string) *Middleware {
	return &Middleware{
		token:             strings.TrimSpace(token),
		allowedHosts:      make(map[string]struct{}),
		allowedSchemes:    make(map[string]string),
		secureCookieHosts: make(map[string]struct{}),
	}
}

func (a *Middleware) Enabled() bool {
	return a.token != ""
}

// UseSecureCookiesForHost marks login cookies HTTPS-only when a request uses
// the configured public authority. Local HTTP login remains usable.
func (a *Middleware) UseSecureCookiesForHost(hostOrURL string) {
	authorities := normalizeAuthorities(hostOrURL)
	if len(authorities) == 0 {
		return
	}
	a.allowedHostsMu.Lock()
	for _, authority := range authorities {
		a.secureCookieHosts[authority] = struct{}{}
	}
	a.allowedHostsMu.Unlock()
}

// AllowHost adds an exact Host authority or absolute origin that requests may
// use and activates Host allowlist enforcement. A non-default port remains part
// of the identity, so allowing host:8443 does not also allow host:9443.
func (a *Middleware) AllowHost(hostOrURL string) {
	authorities := normalizeAuthorities(hostOrURL)
	if len(authorities) == 0 {
		return
	}
	expectedScheme := ""
	if u, err := url.Parse(strings.TrimSpace(hostOrURL)); err == nil &&
		(u.Scheme == "http" || u.Scheme == "https") && u.Host != "" {
		expectedScheme = u.Scheme
	}
	a.allowedHostsMu.Lock()
	for _, authority := range authorities {
		a.allowedHosts[authority] = struct{}{}
		if expectedScheme != "" {
			a.allowedSchemes[authority] = expectedScheme
		}
	}
	a.enforceKnownHosts = true
	a.allowedHostsMu.Unlock()
}

// AllowAnyHost preserves the explicitly unsafe --insecure non-loopback mode.
func (a *Middleware) AllowAnyHost() {
	a.allowedHostsMu.Lock()
	a.allowAnyHost = true
	a.enforceKnownHosts = true
	a.allowedHostsMu.Unlock()
}

// Wrap returns a handler that enforces the token check when auth is enabled.
//
// Token sources (checked in order): browser login form body, Authorization
// header, X-Pi-Token header, and cookie. Credentials in query parameters are
// rejected at the request boundary. A valid form submission sets an HttpOnly
// cookie and redirects to the same credential-free URL.
//
// When auth fails and the request appears to come from a browser (Accept
// header includes text/html), the middleware serves an HTML token prompt
// instead of a bare 401. API clients (no text/html in Accept) still receive
// a plain 401.
func (a *Middleware) Wrap(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if !a.allowsBoundary(w, r) {
			return
		}
		if !a.Enabled() {
			h(w, r)
			return
		}

		got := ""
		fromPost := false

		if r.Method == http.MethodPost && strings.Contains(r.Header.Get("Accept"), "text/html") {
			// ParseForm is idempotent; safe to call even if already parsed.
			r.ParseForm()
			if t := r.PostFormValue("token"); t != "" {
				got = t
				fromPost = true
			}
		}

		if got == "" {
			got = ExtractToken(r)
		}

		if subtle.ConstantTimeCompare([]byte(got), []byte(a.token)) != 1 {
			if strings.Contains(r.Header.Get("Accept"), "text/html") {
				// Invalid login attempt — redirect with error flag so
				// the prompt shows "Invalid token".
				if fromPost {
					target := cleanURL(r)
					if strings.Contains(target, "?") {
						target += "&error=1"
					} else {
						target += "?error=1"
					}
					http.Redirect(w, r, target, http.StatusFound)
					return
				}
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.WriteHeader(http.StatusUnauthorized)
				themeCookie := ""
				if c, err := r.Cookie("pi-web-theme"); err == nil {
					themeCookie = c.Value
				}
				ui.RenderAuthPrompt(w, themeCookie)
				return
			}
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		// A valid browser form submission becomes an HttpOnly cookie so
		// subsequent requests authenticate automatically.
		if fromPost {
			http.SetCookie(w, &http.Cookie{
				Name:     TokenCookieName,
				Value:    got,
				Path:     "/",
				HttpOnly: true,
				Secure:   a.usesSecureCookies(r.Host),
				SameSite: http.SameSiteLaxMode,
				MaxAge:   30 * 24 * 60 * 60,
			})
		}

		// Redirect after a form submission so refreshing cannot resubmit it.
		if fromPost {
			http.Redirect(w, r, cleanURL(r), http.StatusFound)
			return
		}

		h(w, r)
	}
}

// WrapBoundary applies exact Host and browser Origin validation without
// requiring the optional PI_WEB_TOKEN. It protects public bootstrap assets and
// the device-pairing endpoints that must be reachable before login.
func (a *Middleware) WrapBoundary(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.allowsBoundary(w, r) {
			return
		}
		h.ServeHTTP(w, r)
	})
}

func (a *Middleware) allowsBoundary(w http.ResponseWriter, r *http.Request) bool {
	if _, hasTokenQuery := r.URL.Query()["token"]; hasTokenQuery {
		http.Error(w, "credentials are not accepted in URLs", http.StatusBadRequest)
		return false
	}
	if !a.allowsHost(r.Host) {
		http.Error(w, "unrecognized host", http.StatusForbidden)
		return false
	}
	if !a.allowsBrowserOrigin(r) {
		http.Error(w, "cross-origin request forbidden", http.StatusForbidden)
		return false
	}
	return true
}

func (a *Middleware) usesSecureCookies(rawHost string) bool {
	authority := normalizeAuthority(rawHost)
	a.allowedHostsMu.RLock()
	_, ok := a.secureCookieHosts[authority]
	a.allowedHostsMu.RUnlock()
	return ok
}

func (a *Middleware) allowsHost(rawHost string) bool {
	authority := normalizeAuthority(rawHost)
	a.allowedHostsMu.RLock()
	if a.allowAnyHost {
		a.allowedHostsMu.RUnlock()
		return true
	}
	_, ok := a.allowedHosts[authority]
	enforceKnownHosts := a.enforceKnownHosts
	a.allowedHostsMu.RUnlock()
	if enforceKnownHosts {
		return ok
	}

	// Auth middleware constructed outside the application historically accepted
	// any Host when a token was enabled. Without an explicit allowlist, retain
	// that compatibility and otherwise permit only loopback for tokenless use.
	if a.Enabled() {
		return true
	}
	host := normalizeHostname(rawHost)
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func normalizeAuthorities(hostOrURL string) []string {
	authority := normalizeAuthority(hostOrURL)
	if authority == "" {
		return nil
	}
	result := []string{authority}
	value := strings.TrimSpace(hostOrURL)
	if !strings.Contains(value, "://") {
		return result
	}
	u, err := url.Parse(value)
	if err != nil {
		return result
	}
	port := u.Port()
	if (strings.EqualFold(u.Scheme, "https") && (port == "" || port == "443")) ||
		(strings.EqualFold(u.Scheme, "http") && (port == "" || port == "80")) {
		defaultPort := "443"
		if strings.EqualFold(u.Scheme, "http") {
			defaultPort = "80"
		}
		result = append(result, net.JoinHostPort(strings.TrimSuffix(strings.ToLower(u.Hostname()), "."), defaultPort))
	}
	return result
}

func normalizeAuthority(hostOrURL string) string {
	value := strings.TrimSpace(hostOrURL)
	if value == "" {
		return ""
	}
	hasScheme := strings.Contains(value, "://")
	if !hasScheme {
		value = "//" + value
	}
	u, err := url.Parse(value)
	if err != nil || u.Hostname() == "" {
		return ""
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	port := u.Port()
	if hasScheme && ((strings.EqualFold(u.Scheme, "https") && port == "443") || (strings.EqualFold(u.Scheme, "http") && port == "80")) {
		port = ""
	}
	if port == "" {
		return host
	}
	return net.JoinHostPort(host, port)
}

func normalizeHostname(hostOrURL string) string {
	value := strings.TrimSpace(hostOrURL)
	if value == "" {
		return ""
	}
	if !strings.Contains(value, "://") {
		value = "//" + value
	}
	u, err := url.Parse(value)
	if err != nil {
		return ""
	}
	return strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
}

// allowsBrowserOrigin rejects cross-origin browser mutations even when token
// auth is disabled for localhost. Browsers attach Origin to unsafe requests;
// non-browser clients such as curl generally do not, so local automation stays
// compatible. Sec-Fetch-Site covers browser requests that omit Origin.
func (a *Middleware) allowsBrowserOrigin(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}

	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return !strings.EqualFold(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")), "cross-site")
	}
	if origin == "null" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil ||
		(u.Scheme != "http" && u.Scheme != "https") ||
		u.Host == "" ||
		u.User != nil ||
		u.Path != "" ||
		u.RawQuery != "" ||
		u.Fragment != "" {
		return false
	}

	expectedScheme := "http"
	authority := normalizeAuthority(r.Host)
	a.allowedHostsMu.RLock()
	configuredScheme := a.allowedSchemes[authority]
	a.allowedHostsMu.RUnlock()
	if configuredScheme != "" {
		expectedScheme = configuredScheme
	} else if r.TLS != nil {
		expectedScheme = "https"
	}
	if u.Scheme != expectedScheme {
		return false
	}
	return normalizeAuthority(origin) == normalizeAuthority(expectedScheme+"://"+r.Host)
}

// cleanURL returns r.URL.Path with the transient login error flag removed.
func cleanURL(r *http.Request) string {
	q := r.URL.Query()
	q.Del("error")
	if len(q) == 0 {
		return r.URL.Path
	}
	return r.URL.Path + "?" + q.Encode()
}

// ExtractToken returns a candidate from credential-bearing headers or the
// HttpOnly browser cookie. Query parameters are rejected by allowsBoundary.
func ExtractToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	if h := r.Header.Get("X-Pi-Token"); h != "" {
		return h
	}
	if c, err := r.Cookie(TokenCookieName); err == nil {
		return c.Value
	}
	return ""
}
