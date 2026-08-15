package terminalbridge

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

const DiscoveryFilename = "terminal-bridge.json"
const tokenBytes = 32

type Discovery struct {
	Version   int    `json:"version"`
	PID       int    `json:"pid"`
	Port      int    `json:"port"`
	Token     string `json:"token"`
	StartedAt string `json:"startedAt"`
}

type Bridge struct {
	Router     *Router
	server     *http.Server
	listener   net.Listener
	discovery  Discovery
	path       string
	closeOnce  sync.Once
	serveError chan error
}

func Start(agentDir, sessionsDir string, fallback Fallback) (*Bridge, error) {
	dir := filepath.Join(agentDir, "pi-web")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create terminal bridge directory: %w", err)
	}
	if err := requireRealDirectory(dir); err != nil {
		return nil, err
	}
	if err := secureBridgeDirectory(dir); err != nil {
		return nil, fmt.Errorf("secure terminal bridge directory: %w", err)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen for terminal bridge: %w", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	random := make([]byte, tokenBytes)
	if _, err := rand.Read(random); err != nil {
		listener.Close()
		return nil, fmt.Errorf("generate terminal bridge token: %w", err)
	}
	discovery := Discovery{
		Version:   protocolVersion,
		PID:       os.Getpid(),
		Port:      port,
		Token:     base64.RawURLEncoding.EncodeToString(random),
		StartedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	ownerDir := filepath.Join(dir, "terminal-owners")
	if err := os.MkdirAll(ownerDir, 0o700); err != nil {
		listener.Close()
		return nil, fmt.Errorf("create terminal owner directory: %w", err)
	}
	if err := requireRealDirectory(ownerDir); err != nil {
		listener.Close()
		return nil, err
	}
	if err := secureBridgeDirectory(ownerDir); err != nil {
		listener.Close()
		return nil, fmt.Errorf("secure terminal owner directory: %w", err)
	}
	path := filepath.Join(dir, DiscoveryFilename)
	if err := writeDiscovery(path, discovery); err != nil {
		listener.Close()
		return nil, err
	}
	router := NewRouter(sessionsDir, discovery.Token, fallback)
	router.authority = exactLoopbackAuthority(port)
	router.ownerDir = ownerDir
	server := &http.Server{
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	bridge := &Bridge{
		Router: router, server: server, listener: listener,
		discovery: discovery, path: path, serveError: make(chan error, 1),
	}
	go func() {
		err := server.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			bridge.serveError <- err
		}
		close(bridge.serveError)
	}()
	return bridge, nil
}

func (b *Bridge) Close(ctx context.Context) error {
	var result error
	b.closeOnce.Do(func() {
		result = errors.Join(b.Router.Close(), b.server.Shutdown(ctx))
		data, err := os.ReadFile(b.path)
		if err == nil {
			var current Discovery
			if json.Unmarshal(data, &current) == nil && current.Token == b.discovery.Token {
				result = errors.Join(result, os.Remove(b.path))
			}
		}
	})
	return result
}

func (b *Bridge) ServeErrors() <-chan error { return b.serveError }

func requireRealDirectory(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect terminal bridge directory: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return fmt.Errorf("terminal bridge path is not a real directory: %s", path)
	}
	return nil
}

func writeDiscovery(path string, discovery Discovery) error {
	data, err := json.Marshal(discovery)
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	file, err := os.CreateTemp(dir, ".terminal-bridge-*")
	if err != nil {
		return fmt.Errorf("create terminal bridge discovery: %w", err)
	}
	temporary := file.Name()
	remove := true
	defer func() {
		file.Close()
		if remove {
			os.Remove(temporary)
		}
	}()
	if err := secureBridgeFile(temporary); err != nil {
		return fmt.Errorf("secure terminal bridge discovery: %w", err)
	}
	if _, err := file.Write(data); err != nil {
		return fmt.Errorf("write terminal bridge discovery: %w", err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync terminal bridge discovery: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close terminal bridge discovery: %w", err)
	}
	if err := installBridgeFile(temporary, path); err != nil {
		return fmt.Errorf("install terminal bridge discovery: %w", err)
	}
	remove = false
	return nil
}

func parseDiscovery(data []byte) (Discovery, error) {
	var discovery Discovery
	if err := json.Unmarshal(data, &discovery); err != nil {
		return Discovery{}, err
	}
	decoded, err := base64.RawURLEncoding.DecodeString(discovery.Token)
	if discovery.Version != protocolVersion || discovery.PID < 1 || discovery.Port < 1 || discovery.Port > 65535 || err != nil || len(decoded) != tokenBytes {
		return Discovery{}, errors.New("invalid terminal bridge discovery")
	}
	return discovery, nil
}

func exactLoopbackAuthority(port int) string {
	return net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
}
