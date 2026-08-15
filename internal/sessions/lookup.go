package sessions

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type ResolvedSession struct {
	Session Session
	Path    string
}

var ErrSessionNotFound = errors.New("session not found")
var ErrInvalidSessionID = errors.New("invalid session id")

func ResolveByID(sessionsDir, id string) (ResolvedSession, error) {
	path, err := FindPathByID(sessionsDir, id)
	if err != nil {
		return ResolvedSession{}, err
	}
	sess, err := ParseFile(path, filepath.Base(filepath.Dir(path)), id)
	if err != nil {
		return ResolvedSession{}, err
	}
	return ResolvedSession{Session: sess, Path: path}, nil
}

// FindPathByID resolves a session filename without parsing its transcript.
func FindPathByID(sessionsDir, id string) (string, error) {
	if id == "" || filepath.Base(id) != id || filepath.Ext(id) != ".jsonl" {
		return "", ErrInvalidSessionID
	}
	entries, err := os.ReadDir(sessionsDir)
	if err != nil {
		return "", err
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		subDir := filepath.Join(sessionsDir, e.Name())
		subs, err := os.ReadDir(subDir)
		if err != nil {
			continue
		}
		for _, f := range subs {
			if !f.IsDir() && f.Name() == id && strings.HasSuffix(f.Name(), ".jsonl") {
				return filepath.Join(subDir, f.Name()), nil
			}
		}
	}
	return "", ErrSessionNotFound
}
