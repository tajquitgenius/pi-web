//go:build !windows

package terminalbridge

import "os"

func secureBridgeDirectory(path string) error { return os.Chmod(path, 0o700) }
func secureBridgeFile(path string) error      { return os.Chmod(path, 0o600) }
func installBridgeFile(source, destination string) error {
	return os.Rename(source, destination)
}
