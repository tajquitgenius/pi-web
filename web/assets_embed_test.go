package web_test

import (
	"io/fs"
	"strings"
	"testing"

	"pi-web/internal/frontend"
	"pi-web/web"
)

func TestEmbeddedLiveBuildsHaveIndependentEntrypoints(t *testing.T) {
	tests := []struct {
		name      string
		buildFS   fs.FS
		entry     string
		assetBase string
	}{
		{name: "svelte", buildFS: web.DistFS(), entry: frontend.AppEntry, assetBase: "/static"},
		{name: "desktop", buildFS: web.DesktopDistFS(), entry: frontend.DesktopEntry, assetBase: "/static/desktop"},
		{name: "mobile", buildFS: web.MobileDistFS(), entry: frontend.MobileEntry, assetBase: "/static/mobile"},
	}

	seen := make(map[string]string)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			scripts, err := frontend.LoadScriptsAt(test.buildFS, test.assetBase, test.entry)
			if err != nil {
				t.Fatalf("LoadScriptsAt: %v", err)
			}
			if len(scripts) != 1 || scripts[0].JS == "" {
				t.Fatalf("scripts = %#v, want one non-empty entry", scripts)
			}
			if !strings.HasPrefix(scripts[0].Path, test.assetBase+"/assets/") {
				t.Fatalf("script path = %q, want namespace %q", scripts[0].Path, test.assetBase)
			}
			if owner, exists := seen[scripts[0].Path]; exists {
				t.Fatalf("script path %q collides with %s build", scripts[0].Path, owner)
			}
			seen[scripts[0].Path] = test.name
		})
	}
}
