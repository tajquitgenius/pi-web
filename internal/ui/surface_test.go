package ui

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSelectSurfaceCookieAndUserAgentPrecedence(t *testing.T) {
	desktopUA := "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/123 Safari/537.36"
	iphoneUA := "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
	ipadUA := "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
	androidPhoneUA := "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/123 Mobile Safari/537.36"
	androidTabletUA := "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 Chrome/123 Safari/537.36"

	tests := []struct {
		name   string
		cookie string
		ua     string
		want   Surface
	}{
		{name: "desktop override wins on phone", cookie: "desktop", ua: iphoneUA, want: DesktopSurface},
		{name: "mobile override wins on desktop", cookie: "mobile", ua: desktopUA, want: MobileSurface},
		{name: "auto classifies phone", cookie: "auto", ua: iphoneUA, want: MobileSurface},
		{name: "absent cookie classifies iPhone", ua: iphoneUA, want: MobileSurface},
		{name: "iPadOS desktop-shaped UA is mobile", ua: ipadUA, want: MobileSurface},
		{name: "Android phone is mobile", ua: androidPhoneUA, want: MobileSurface},
		{name: "Android tablet stays desktop", ua: androidTabletUA, want: DesktopSurface},
		{name: "desktop browser is desktop", ua: desktopUA, want: DesktopSurface},
		{name: "unknown UA stays desktop", ua: "curl/8.7.1", want: DesktopSurface},
		{name: "invalid cookie falls back to UA", cookie: "wide", ua: iphoneUA, want: MobileSurface},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/", nil)
			req.Header.Set("User-Agent", test.ua)
			if test.cookie != "" {
				req.AddCookie(&http.Cookie{Name: SurfaceCookieName, Value: test.cookie})
			}
			if got := SelectSurface(req); got != test.want {
				t.Fatalf("SelectSurface() = %q, want %q", got, test.want)
			}
		})
	}
}
