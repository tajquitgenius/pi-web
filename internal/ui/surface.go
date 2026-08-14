package ui

import (
	"net/http"
	"strings"
)

const (
	SurfaceCookieName      = "pi-web-surface"
	LegacySvelteCookieName = "pi-web-svelte"
)

// SelectSurface applies an explicit desktop/mobile cookie first. The auto value,
// an absent cookie, and an invalid value all use the same conservative UA check.
func useLegacySvelte(r *http.Request) bool {
	cookie, err := r.Cookie(LegacySvelteCookieName)
	return err == nil && cookie.Value == "1"
}

func SelectSurface(r *http.Request) Surface {
	if cookie, err := r.Cookie(SurfaceCookieName); err == nil {
		switch cookie.Value {
		case string(DesktopSurface):
			return DesktopSurface
		case string(MobileSurface):
			return MobileSurface
		case "auto":
			// Continue to user-agent classification.
		}
	}
	return classifyUserAgent(r.UserAgent())
}

func classifyUserAgent(userAgent string) Surface {
	ua := strings.ToLower(userAgent)
	if strings.Contains(ua, "iphone") ||
		strings.Contains(ua, "ipod") ||
		strings.Contains(ua, "ipad") ||
		strings.Contains(ua, "windows phone") ||
		strings.Contains(ua, "iemobile") ||
		strings.Contains(ua, "blackberry") ||
		strings.Contains(ua, "bb10") ||
		strings.Contains(ua, "opera mini") ||
		(strings.Contains(ua, "android") && strings.Contains(ua, "mobile")) ||
		(strings.Contains(ua, "macintosh") && strings.Contains(ua, "mobile/")) {
		return MobileSurface
	}
	return DesktopSurface
}
