package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist all:dist-desktop all:dist-mobile
var liveBuilds embed.FS

func buildFS(directory string) fs.FS {
	sub, err := fs.Sub(liveBuilds, directory)
	if err != nil {
		panic(err)
	}
	return sub
}

// DistFS returns the retained Svelte live build. It remains embedded during the
// React cutover so the existing SPA can be restored without reconstructing it.
func DistFS() fs.FS {
	return buildFS("dist")
}

// DesktopDistFS returns the independently built React desktop surface.
func DesktopDistFS() fs.FS {
	return buildFS("dist-desktop")
}

// MobileDistFS returns the independently built React mobile surface.
func MobileDistFS() fs.FS {
	return buildFS("dist-mobile")
}
