//go:build !linux && !darwin

package server

import "os"

func openFileForPreview(_, _ string) (*os.File, os.FileInfo, error) {
	return nil, nil, errFilePreviewUnavailable
}
