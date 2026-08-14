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
	secureCookieHosts map[string]struct{}
	allowAnyHost      bool
	enforceKnownHosts bool
}

func New(token string) *Middleware {
	return &Middleware{
		token:             strings.TrimSpace(token),
		allowedHosts:      make(map[string]struct{}),
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
	a.allowedHostsMu.Lock()
	for _, authority := range authorities {
		a.allowedHosts[authority] = struct{}{}
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
// Token sources (checked in order): for browser POSTs, form body first;
// otherwise query parameter, Authorization header, X-Pi-Token header, and
// cookie. When the token arrives via query or POST, a cookie is set and the
// browser is redirected to the same URL without the token, so the secret never
// appears in the address bar or browser history.
//
// When auth fails and the request appears to come from a browser (Accept
// header includes text/html), the middleware serves an HTML token prompt
// instead of a bare 401. API clients (no text/html in Accept) still receive
// a plain 401.
func (a *Middleware) Wrap(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.allowsHost(r.Host) {
			http.Error(w, "unrecognized host", http.StatusForbidden)
			return
		}
		if !allowsBrowserOrigin(r) {
			http.Error(w, "cross-origin request forbidden", http.StatusForbidden)
			return
		}
		if !a.Enabled() {
			h(w, r)
			return
		}

		got := ""
		fromQuery := false
		fromPost := false

		// Browser login form submissions should prefer the submitted token over
		// any stale token that may still be present in the URL query string.
		if r.Method == http.MethodPost && strings.Contains(r.Header.Get("Accept"), "text/html") {
			// ParseForm is idempotent; safe to call even if already parsed.
			r.ParseForm()
			if t := r.PostFormValue("token"); t != "" {
				got = t
				fromPost = true
			}
		}

		if got == "" {
			got, fromQuery = ExtractToken(r)
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

		// Token is valid. Set a cookie if it came from query or POST so
		// subsequent requests authenticate automatically.
		shouldSetCookie := fromQuery || fromPost
		if shouldSetCookie {
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

		// Redirect to a clean URL (no token in query or error flag) when
		// the token arrived via query or POST. This keeps the secret out
		// of the address bar and browser history.
		if fromQuery || fromPost {
			http.Redirect(w, r, cleanURL(r), http.StatusFound)
			return
		}

		h(w, r)
	}
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
func allowsBrowserOrigin(r *http.Request) bool {
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
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return false
	}
	if normalizeHostname(u.Host) != normalizeHostname(r.Host) {
		return false
	}
	originPort := u.Port()
	requestURL, err := url.Parse("//" + r.Host)
	if err != nil {
		return false
	}
	requestPort := requestURL.Port()
	defaultPort := "80"
	if u.Scheme == "https" {
		defaultPort = "443"
	}
	if originPort == "" {
		originPort = defaultPort
	}
	if requestPort == "" {
		requestPort = defaultPort
	}
	return originPort == requestPort
}

// cleanURL returns r.URL.Path with query string intact except for "token" and
// "error" parameters, which are stripped.
func cleanURL(r *http.Request) string {
	q := r.URL.Query()
	q.Del("token")
	q.Del("error")
	if len(q) == 0 {
		return r.URL.Path
	}
	return r.URL.Path + "?" + q.Encode()
}

// ExtractToken returns the candidate token and whether it came from the query
// string (in which case a cookie should be set).
func ExtractToken(r *http.Request) (string, bool) {
	if t := r.URL.Query().Get("token"); t != "" {
		return t, true
	}
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer "), false
	}
	if h := r.Header.Get("X-Pi-Token"); h != "" {
		return h, false
	}
	if c, err := r.Cookie(TokenCookieName); err == nil {
		return c.Value, false
	}
	return "", false
}
