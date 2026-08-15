package app

import (
	"context"
	"sync"
	"time"

	"pi-web/internal/rpc"
	"pi-web/internal/sessions"
)

const (
	sessionDefaultsCacheTTL     = 5 * time.Minute
	sessionDefaultsResolveLimit = 10 * time.Second
)

type sessionDefaultsCacheEntry struct {
	defaults rpc.SessionDefaults
	at       time.Time
}

type sessionDefaultsCacheCall struct {
	done     chan struct{}
	defaults rpc.SessionDefaults
	err      error
}

type sessionDefaultsCache struct {
	mu      sync.Mutex
	entry   *sessionDefaultsCacheEntry
	pending *sessionDefaultsCacheCall
	resolve func(context.Context) (rpc.SessionDefaults, error)
	now     func() time.Time
	ttl     time.Duration
}

func newSessionDefaultsCache(resolve func(context.Context) (rpc.SessionDefaults, error)) *sessionDefaultsCache {
	return &sessionDefaultsCache{
		resolve: resolve,
		now:     time.Now,
		ttl:     sessionDefaultsCacheTTL,
	}
}

func (c *sessionDefaultsCache) get(ctx context.Context) (rpc.SessionDefaults, error) {
	c.mu.Lock()
	if c.entry != nil && c.now().Sub(c.entry.at) < c.ttl {
		defaults := c.entry.defaults
		c.mu.Unlock()
		return defaults, nil
	}
	if c.pending != nil {
		call := c.pending
		c.mu.Unlock()
		select {
		case <-call.done:
			if call.err != nil {
				return rpc.SessionDefaults{}, call.err
			}
			return call.defaults, nil
		case <-ctx.Done():
			return rpc.SessionDefaults{}, ctx.Err()
		}
	}
	call := &sessionDefaultsCacheCall{done: make(chan struct{})}
	c.pending = call
	c.mu.Unlock()

	go c.resolveCall(call)
	select {
	case <-call.done:
		if call.err != nil {
			return rpc.SessionDefaults{}, call.err
		}
		return call.defaults, nil
	case <-ctx.Done():
		return rpc.SessionDefaults{}, ctx.Err()
	}
}

func (c *sessionDefaultsCache) resolveCall(call *sessionDefaultsCacheCall) {
	fetchCtx, cancel := context.WithTimeout(context.Background(), sessionDefaultsResolveLimit)
	defaults, err := c.resolve(fetchCtx)
	cancel()

	c.mu.Lock()
	call.defaults, call.err = defaults, err
	if err == nil {
		c.entry = &sessionDefaultsCacheEntry{defaults: defaults, at: c.now()}
	}
	if c.pending == call {
		c.pending = nil
	}
	close(call.done)
	c.mu.Unlock()
}

func sessionDefaultsProvider(cache *sessionDefaultsCache) func(context.Context) (sessions.InitialSettings, error) {
	return func(ctx context.Context) (sessions.InitialSettings, error) {
		defaults, err := cache.get(ctx)
		if err != nil {
			return sessions.InitialSettings{}, err
		}
		return sessions.InitialSettings{
			ModelProvider: defaults.ModelProvider,
			ModelID:       defaults.ModelID,
			ThinkingLevel: defaults.ThinkingLevel,
		}, nil
	}
}

func warmSessionDefaultsCache() {
	warmSessionDefaultsCacheFor(defaultSessionDefaultsCache)
}

func warmSessionDefaultsCacheFor(cache *sessionDefaultsCache) {
	go func() {
		_, _ = cache.get(context.Background())
	}()
}

var defaultSessionDefaultsCache = newSessionDefaultsCache(rpc.ResolveSessionDefaults)
