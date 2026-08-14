package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist-desktop all:dist-mobile
var productBuilds embed.FS

func buildFS(directory string) fs.FS {
	sub, err := fs.Sub(productBuilds, directory)
	if err != nil {
		panic(err)
	}
	return sub
}

// DesktopDistFS returns the independently built React desktop surface.
func DesktopDistFS() fs.FS {
	return buildFS("dist-desktop")
}

// MobileDistFS returns the independently built React mobile surface.
func MobileDistFS() fs.FS {
	return buildFS("dist-mobile")
}
