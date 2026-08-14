package pairing

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const CodeKeyFilename = "device-pairing.key"

func LoadOrCreateCodeKey(agentDir string) ([]byte, error) {
	dir := filepath.Join(agentDir, "pi-web")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("create pairing key directory: %w", err)
	}
	path := filepath.Join(dir, CodeKeyFilename)

	for {
		key, err := os.ReadFile(path)
		if err == nil {
			if len(key) != CredentialBytes {
				return nil, fmt.Errorf("pairing code key has invalid length: %s", path)
			}
			if err := os.Chmod(path, 0600); err != nil {
				return nil, fmt.Errorf("secure pairing code key: %w", err)
			}
			return key, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("read pairing code key: %w", err)
		}

		key = make([]byte, CredentialBytes)
		if _, err := rand.Read(key); err != nil {
			return nil, fmt.Errorf("generate pairing code key: %w", err)
		}
		file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("create pairing code key: %w", err)
		}
		written, writeErr := file.Write(key)
		if writeErr == nil && written != len(key) {
			writeErr = io.ErrShortWrite
		}
		if writeErr == nil {
			writeErr = file.Sync()
		}
		closeErr := file.Close()
		if writeErr != nil {
			_ = os.Remove(path)
			return nil, fmt.Errorf("write pairing code key: %w", writeErr)
		}
		if closeErr != nil {
			_ = os.Remove(path)
			return nil, fmt.Errorf("close pairing code key: %w", closeErr)
		}
		return key, nil
	}
}
