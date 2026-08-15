package ui

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

// Surface identifies one independently built React live application.
type Surface string

const (
	DesktopSurface Surface = "desktop"
	MobileSurface  Surface = "mobile"
)

type appAssets struct {
	script string
	styles []string
}

type appBuild struct {
	Fingerprint  string `json:"build"`
	DesktopAsset string `json:"desktopAsset"`
	MobileAsset  string `json:"mobileAsset"`
}

var surfaceAppAssets = map[Surface]appAssets{
	DesktopSurface: {script: "/static/desktop/assets/desktop.js"},
	MobileSurface:  {script: "/static/mobile/assets/mobile.js"},
}

// SetSurfaceAssets installs one React surface's hashed entrypoint and any CSS
// emitted by that surface's own build.
func SetSurfaceAssets(surface Surface, script string, styles []string) {
	if surface != DesktopSurface && surface != MobileSurface {
		return
	}
	surfaceAppAssets[surface] = appAssets{script: script, styles: append([]string(nil), styles...)}
}

func currentAppBuild() appBuild {
	hash := sha256.New()
	for _, surface := range []Surface{DesktopSurface, MobileSurface} {
		assets := surfaceAppAssets[surface]
		_, _ = fmt.Fprintf(hash, "%s\x00%s\x00", surface, assets.script)
		for _, style := range assets.styles {
			_, _ = fmt.Fprintf(hash, "%s\x00", style)
		}
	}
	fingerprint := hex.EncodeToString(hash.Sum(nil))[:16]
	return appBuild{
		Fingerprint:  fingerprint,
		DesktopAsset: surfaceAppAssets[DesktopSurface].script,
		MobileAsset:  surfaceAppAssets[MobileSurface].script,
	}
}
