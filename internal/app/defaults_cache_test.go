package app

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"pi-web/internal/rpc"
	"pi-web/internal/sessions"
)

type observedDoneContext struct {
	context.Context
	observed chan struct{}
	once     sync.Once
}

func (c *observedDoneContext) Done() <-chan struct{} {
	c.once.Do(func() { close(c.observed) })
	return c.Context.Done()
}

func TestSessionDefaultsCacheCoalescesConcurrentLoads(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	want := rpc.SessionDefaults{
		ModelProvider: "openai-codex-secondary",
		ModelID:       "gpt-5.6-sol",
		ThinkingLevel: "high",
	}
	cache := newSessionDefaultsCache(func(context.Context) (rpc.SessionDefaults, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return want, nil
	})

	first := make(chan rpc.SessionDefaults, 1)
	firstErr := make(chan error, 1)
	go func() {
		got, err := cache.get(context.Background())
		first <- got
		firstErr <- err
	}()
	<-started

	second := make(chan rpc.SessionDefaults, 1)
	secondErr := make(chan error, 1)
	secondContext := &observedDoneContext{
		Context:  context.Background(),
		observed: make(chan struct{}),
	}
	go func() {
		got, err := cache.get(secondContext)
		second <- got
		secondErr <- err
	}()
	select {
	case <-secondContext.observed:
	case <-time.After(time.Second):
		t.Fatal("second caller did not join the in-flight resolution")
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("resolver calls before release = %d, want 1", got)
	}

	close(release)
	for i, result := range []struct {
		defaults <-chan rpc.SessionDefaults
		err      <-chan error
	}{
		{defaults: first, err: firstErr},
		{defaults: second, err: secondErr},
	} {
		if err := <-result.err; err != nil {
			t.Fatalf("call %d error = %v", i, err)
		}
		if got := <-result.defaults; got != want {
			t.Fatalf("call %d defaults = %#v, want %#v", i, got, want)
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("resolver calls = %d, want 1", got)
	}
}

func TestSessionDefaultsCacheLeaderHonorsCancellationWhileSharedLoadContinues(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	want := rpc.SessionDefaults{ModelProvider: "provider", ModelID: "model", ThinkingLevel: "high"}
	cache := newSessionDefaultsCache(func(context.Context) (rpc.SessionDefaults, error) {
		close(started)
		<-release
		return want, nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := cache.get(ctx)
		result <- err
	}()
	<-started
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("leader error = %v, want context canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("leader remained blocked after cancellation")
	}

	close(release)
	got, err := cache.get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("cached defaults = %#v, want %#v", got, want)
	}
}

func TestSessionDefaultsCacheRefreshesAfterTTL(t *testing.T) {
	now := time.Unix(100, 0)
	var calls atomic.Int32
	cache := newSessionDefaultsCache(func(context.Context) (rpc.SessionDefaults, error) {
		call := calls.Add(1)
		return rpc.SessionDefaults{
			ModelProvider: "provider",
			ModelID:       fmt.Sprintf("model-%d", call),
			ThinkingLevel: "high",
		}, nil
	})
	cache.now = func() time.Time { return now }

	first, err := cache.get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if first.ModelProvider != "provider" || first.ModelID != "model-1" || first.ThinkingLevel != "high" {
		t.Fatalf("first defaults = %#v", first)
	}

	now = now.Add(sessionDefaultsCacheTTL - time.Nanosecond)
	fresh, err := cache.get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if fresh != first {
		t.Fatalf("fresh defaults = %#v, want cached %#v", fresh, first)
	}

	now = now.Add(time.Nanosecond)
	refreshed, err := cache.get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.ModelID != "model-2" {
		t.Fatalf("refreshed defaults = %#v, want model-2", refreshed)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("resolver calls = %d, want 2", got)
	}
}

func TestSessionDefaultsCacheDoesNotPoisonCacheOnFailure(t *testing.T) {
	wantErr := errors.New("pi unavailable")
	var calls atomic.Int32
	want := rpc.SessionDefaults{
		ModelProvider: "provider",
		ModelID:       "model",
		ThinkingLevel: "medium",
	}
	cache := newSessionDefaultsCache(func(context.Context) (rpc.SessionDefaults, error) {
		if calls.Add(1) == 1 {
			return rpc.SessionDefaults{ModelProvider: "partial"}, wantErr
		}
		return want, nil
	})

	if _, err := cache.get(context.Background()); !errors.Is(err, wantErr) {
		t.Fatalf("first error = %v, want %v", err, wantErr)
	}
	got, err := cache.get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("retry defaults = %#v, want %#v", got, want)
	}
	if calls.Load() != 2 {
		t.Fatalf("resolver calls = %d, want 2", calls.Load())
	}
}

func TestSessionDefaultsProviderUsesCachedResolver(t *testing.T) {
	var calls atomic.Int32
	cache := newSessionDefaultsCache(func(context.Context) (rpc.SessionDefaults, error) {
		calls.Add(1)
		return rpc.SessionDefaults{
			ModelProvider: "openai-codex-secondary",
			ModelID:       "gpt-5.6-sol",
			ThinkingLevel: "high",
		}, nil
	})
	provider := sessionDefaultsProvider(cache)
	want := sessions.InitialSettings{
		ModelProvider: "openai-codex-secondary",
		ModelID:       "gpt-5.6-sol",
		ThinkingLevel: "high",
	}

	first, err := provider(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	second, err := provider(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if first != want || second != want {
		t.Fatalf("provider results = %#v and %#v, want %#v", first, second, want)
	}
	if calls.Load() != 1 {
		t.Fatalf("resolver calls = %d, want 1", calls.Load())
	}
}

func TestWarmSessionDefaultsCacheStartsInBackground(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	cache := newSessionDefaultsCache(func(context.Context) (rpc.SessionDefaults, error) {
		calls.Add(1)
		close(started)
		<-release
		return rpc.SessionDefaults{
			ModelProvider: "provider",
			ModelID:       "model",
			ThinkingLevel: "high",
		}, nil
	})

	returned := make(chan struct{})
	go func() {
		warmSessionDefaultsCacheFor(cache)
		close(returned)
	}()
	select {
	case <-returned:
	case <-time.After(time.Second):
		t.Fatal("warming the defaults cache blocked the caller")
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("defaults cache was not prewarmed")
	}

	close(release)
	if _, err := cache.get(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("resolver calls = %d, want 1", calls.Load())
	}
}
