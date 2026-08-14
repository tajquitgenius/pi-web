package web_test

import (
	"io/fs"
	"path"
	"strings"
	"testing"

	"pi-web/internal/frontend"
	"pi-web/web"
)

func TestEmbeddedReactProductsHaveIndependentEntrypoints(t *testing.T) {
	tests := []struct {
		name      string
		buildFS   fs.FS
		entry     string
		assetBase string
	}{
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

func TestEmbeddedReactProductsContainNoSourceMapsOrLegacyLiveReferences(t *testing.T) {
	for name, buildFS := range map[string]fs.FS{
		"desktop": web.DesktopDistFS(),
		"mobile":  web.MobileDistFS(),
	} {
		t.Run(name, func(t *testing.T) {
			err := fs.WalkDir(buildFS, ".", func(assetPath string, entry fs.DirEntry, walkErr error) error {
				if walkErr != nil {
					return walkErr
				}
				if entry.IsDir() {
					return nil
				}
				if path.Ext(assetPath) == ".map" {
					t.Fatalf("embedded source map: %s", assetPath)
				}
				data, err := fs.ReadFile(buildFS, assetPath)
				if err != nil {
					return err
				}
				for _, forbidden := range []string{"src/main.js", "App.svelte", "pi-web-svelte", "/static/assets/"} {
					if strings.Contains(string(data), forbidden) {
						t.Fatalf("%s contains removed live reference %q", assetPath, forbidden)
					}
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}
