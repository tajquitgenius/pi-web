//go:build linux || darwin

package server

import (
	"errors"
	"os"
	"strings"

	"golang.org/x/sys/unix"
)

func openFileForPreview(cwd, relativePath string) (*os.File, os.FileInfo, error) {
	rootFD, err := unix.Open(cwd, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, nil, classifyPreviewOpenError(err)
	}
	root := os.NewFile(uintptr(rootFD), cwd)
	if root == nil {
		_ = unix.Close(rootFD)
		return nil, nil, errFilePreviewUnavailable
	}
	defer root.Close()

	if rootInfo, err := root.Stat(); err != nil {
		return nil, nil, err
	} else if !rootInfo.IsDir() {
		return nil, nil, errFileNotRegular
	}

	currentFD := rootFD
	components := strings.Split(relativePath, "/")
	for index, component := range components {
		flags := unix.O_RDONLY | unix.O_CLOEXEC | unix.O_NOFOLLOW | unix.O_NONBLOCK
		if index < len(components)-1 {
			flags |= unix.O_DIRECTORY
		}
		nextFD, err := unix.Openat(currentFD, component, flags, 0)
		if currentFD != rootFD {
			_ = unix.Close(currentFD)
		}
		if err != nil {
			return nil, nil, classifyPreviewOpenError(err)
		}
		currentFD = nextFD
	}

	file := os.NewFile(uintptr(currentFD), relativePath)
	if file == nil {
		_ = unix.Close(currentFD)
		return nil, nil, errFilePreviewUnavailable
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, nil, err
	}
	if !info.Mode().IsRegular() {
		_ = file.Close()
		return nil, nil, errFileNotRegular
	}
	return file, info, nil
}

func classifyPreviewOpenError(err error) error {
	switch {
	case errors.Is(err, unix.ELOOP):
		return errFilePathInvalid
	case errors.Is(err, unix.ENOENT):
		return errFileNotFound
	case errors.Is(err, unix.ENOTDIR):
		return errFileNotRegular
	default:
		return err
	}
}
