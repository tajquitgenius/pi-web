package ui

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

var legacyAppAssets = appAssets{script: "/static/assets/app.js"}

var surfaceAppAssets = map[Surface]appAssets{
	DesktopSurface: {script: "/static/desktop/assets/desktop.js"},
	MobileSurface:  {script: "/static/mobile/assets/mobile.js"},
}

// SetAppScriptPath retains the Svelte live build's startup path during cutover.
func SetAppScriptPath(path string) {
	legacyAppAssets.script = path
}

// SetSurfaceAssets installs one React surface's hashed entrypoint and any CSS
// emitted by that surface's own build.
func SetSurfaceAssets(surface Surface, script string, styles []string) {
	if surface != DesktopSurface && surface != MobileSurface {
		return
	}
	surfaceAppAssets[surface] = appAssets{script: script, styles: append([]string(nil), styles...)}
}
