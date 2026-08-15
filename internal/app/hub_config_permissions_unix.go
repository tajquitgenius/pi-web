//go:build !windows

package app

import "os"

func secureHubCredentialFile(path string) error {
	return os.Chmod(path, 0600)
}

func installHubCredentialFile(source, destination string) error {
	return os.Rename(source, destination)
}
