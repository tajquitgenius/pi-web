//go:build linux || darwin

package server

import (
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestHandleApiFileRejectsFIFOWithoutBlocking(t *testing.T) {
	s, cwd := newFilesTestServer(t)
	fifoPath := filepath.Join(cwd, "pipe")
	if err := unix.Mkfifo(fifoPath, 0o600); err != nil {
		t.Skipf("FIFO unsupported: %v", err)
	}

	result := make(chan int, 1)
	go func() {
		result <- getFile(t, s, "pipe").Code
	}()
	select {
	case status := <-result:
		if status != 400 {
			t.Fatalf("status = %d; want 400 for a FIFO", status)
		}
	case <-time.After(time.Second):
		t.Fatal("FIFO preview blocked")
	}
}

func TestOpenFileForPreviewReadsOpenedFileAfterReplacement(t *testing.T) {
	_, cwd := newFilesTestServer(t)
	path := filepath.Join(cwd, "notes.txt")
	if err := os.WriteFile(path, []byte("original"), 0o644); err != nil {
		t.Fatal(err)
	}

	file, info, err := openFileForPreview(cwd, "notes.txt")
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() != int64(len("original")) {
		_ = file.Close()
		t.Fatalf("opened size = %d; want %d", info.Size(), len("original"))
	}

	replaced := path + ".old"
	if err := os.Rename(path, replaced); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("replacement"), 0o644); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}

	data, readErr := io.ReadAll(file)
	closeErr := file.Close()
	if readErr != nil || closeErr != nil {
		t.Fatalf("read opened file: read=%v close=%v", readErr, closeErr)
	}
	if string(data) != "original" {
		t.Fatalf("opened content = %q; want original", data)
	}
}
