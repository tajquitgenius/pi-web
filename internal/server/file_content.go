package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxFilePreviewBytes     int64 = 1 << 20
	maxFilePreviewPathBytes       = 4096
)

var (
	errFilePathInvalid        = errors.New("invalid file path")
	errFileNotFound           = errors.New("file not found")
	errFileNotRegular         = errors.New("file is not regular")
	errFilePreviewUnavailable = errors.New("file preview unavailable")
)

type fileResponse struct {
	Path       string  `json:"path"`
	Kind       string  `json:"kind"`
	Content    *string `json:"content,omitempty"`
	Size       int64   `json:"size"`
	ModifiedAt string  `json:"modifiedAt"`
	Revision   string  `json:"revision"`
}

func (s *Server) handleApiFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	_, cwd, err := s.resolveSessionCwd(r.URL.Query().Get("id"))
	if err != nil {
		// A cached path can outlive a deleted session file. Treat that stale
		// path-index miss like the normal session-not-found error.
		if os.IsNotExist(err) {
			writeJSONError(w, http.StatusNotFound, "session not found")
			return
		}
		if resolveOrWriteError(w, err) {
			return
		}
	}

	relativePath, err := validateRelativeFilePath(r.URL.Query().Get("path"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid file path")
		return
	}

	f, info, err := openFileForPreview(cwd, relativePath)
	if err != nil {
		switch {
		case errors.Is(err, errFilePathInvalid), errors.Is(err, errFileNotRegular):
			writeJSONError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, errFileNotFound):
			writeJSONError(w, http.StatusNotFound, "file not found")
		case errors.Is(err, errFilePreviewUnavailable):
			writeJSONError(w, http.StatusNotImplemented, "file preview unavailable")
		default:
			writeJSONError(w, http.StatusInternalServerError, "could not access file")
		}
		return
	}

	if info.Size() > maxFilePreviewBytes {
		_ = f.Close()
		writeJSONError(w, http.StatusRequestEntityTooLarge, "file is too large")
		return
	}

	data, readErr := io.ReadAll(io.LimitReader(f, maxFilePreviewBytes+1))
	closeErr := f.Close()
	if readErr != nil || closeErr != nil {
		writeJSONError(w, http.StatusInternalServerError, "could not read file")
		return
	}
	if int64(len(data)) > maxFilePreviewBytes {
		writeJSONError(w, http.StatusRequestEntityTooLarge, "file is too large")
		return
	}

	checksum := sha256.Sum256(data)
	response := fileResponse{
		Path:       relativePath,
		Kind:       "text",
		Size:       info.Size(),
		ModifiedAt: info.ModTime().UTC().Format(time.RFC3339Nano),
		Revision:   hex.EncodeToString(checksum[:]),
	}
	if !isTextFile(data) {
		response.Kind = "binary"
	} else {
		content := string(data)
		response.Content = &content
	}
	writeJSON(w, http.StatusOK, response)
}

func isTextFile(data []byte) bool {
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return false
	}
	for _, b := range data {
		if (b < 0x09) || (b > 0x0d && b < 0x20) || b == 0x7f {
			return false
		}
	}
	return true
}

func validateRelativeFilePath(requested string) (string, error) {
	if len(requested) > maxFilePreviewPathBytes || requested == "" || strings.IndexByte(requested, 0) >= 0 {
		return "", errFilePathInvalid
	}
	if strings.HasPrefix(requested, "/") || strings.HasPrefix(requested, "\\") ||
		(filepath.IsAbs(requested) || isWindowsVolumePath(requested)) {
		return "", errFilePathInvalid
	}
	parts := strings.Split(requested, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.ContainsAny(part, "\\:") {
			return "", errFilePathInvalid
		}
	}
	cleaned := filepath.Clean(filepath.FromSlash(requested))
	if cleaned == "." || filepath.IsAbs(cleaned) {
		return "", errFilePathInvalid
	}
	return filepath.ToSlash(cleaned), nil
}

func isWindowsVolumePath(path string) bool {
	return len(path) >= 2 && path[1] == ':' &&
		((path[0] >= 'a' && path[0] <= 'z') || (path[0] >= 'A' && path[0] <= 'Z'))
}
