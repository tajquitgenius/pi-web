package pairing

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

type pairingTestClock struct {
	unix atomic.Int64
}

func newPairingTestClock(now time.Time) *pairingTestClock {
	clock := &pairingTestClock{}
	clock.unix.Store(now.Unix())
	return clock
}

func (c *pairingTestClock) Now() time.Time {
	return time.Unix(c.unix.Load(), 0).UTC()
}

func (c *pairingTestClock) Advance(d time.Duration) {
	c.unix.Add(int64(d / time.Second))
}

func newPairingTestStore(t *testing.T, clock *pairingTestClock) (*Store, *sql.DB) {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	for _, ddl := range []string{CodesTableDDL, DevicesTableDDL, AttemptsTableDDL, AttemptsIndexDDL} {
		if _, err := db.Exec(ddl); err != nil {
			db.Close()
			t.Fatalf("create pairing schema: %v", err)
		}
	}
	store, err := NewStore(db, bytes.Repeat([]byte{0x5a}, CredentialBytes), clock.Now)
	if err != nil {
		db.Close()
		t.Fatalf("NewStore: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return store, db
}

func TestPairingCodeIsHumanFriendlyExpiringAndHMACOnly(t *testing.T) {
	clock := newPairingTestClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	store, db := newPairingTestStore(t, clock)

	code, err := store.CreateCode(context.Background())
	if err != nil {
		t.Fatalf("CreateCode: %v", err)
	}
	if len(code.Value) != CodeLength {
		t.Fatalf("code length = %d, want %d", len(code.Value), CodeLength)
	}
	for _, char := range code.Value {
		if !bytes.ContainsRune([]byte(codeAlphabet), char) {
			t.Fatalf("code %q contains ambiguous or unsupported character %q", code.Value, char)
		}
	}
	if got, want := code.ExpiresAt, clock.Now().Add(CodeLifetime); !got.Equal(want) {
		t.Fatalf("expiresAt = %s, want %s", got, want)
	}

	var persisted []byte
	if err := db.QueryRow(`SELECT code_hmac FROM pairing_codes`).Scan(&persisted); err != nil {
		t.Fatalf("read code_hmac: %v", err)
	}
	if len(persisted) != sha256.Size {
		t.Fatalf("persisted code digest length = %d, want %d", len(persisted), sha256.Size)
	}
	if bytes.Contains(persisted, []byte(code.Value)) || string(persisted) == code.Value {
		t.Fatal("plaintext pairing code was persisted")
	}
}

func TestPairingCodeExpiresAndCannotBeReused(t *testing.T) {
	ctx := context.Background()
	t.Run("expires at five minutes", func(t *testing.T) {
		clock := newPairingTestClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
		store, _ := newPairingTestStore(t, clock)
		code, err := store.CreateCode(ctx)
		if err != nil {
			t.Fatalf("CreateCode: %v", err)
		}
		clock.Advance(CodeLifetime)
		if _, _, err := store.Redeem(ctx, code.Value, "Phone"); !errors.Is(err, ErrInvalidCode) {
			t.Fatalf("Redeem expired code error = %v, want ErrInvalidCode", err)
		}
	})

	t.Run("single use", func(t *testing.T) {
		clock := newPairingTestClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
		store, _ := newPairingTestStore(t, clock)
		code, err := store.CreateCode(ctx)
		if err != nil {
			t.Fatalf("CreateCode: %v", err)
		}
		if _, _, err := store.Redeem(ctx, code.Value, "Phone"); err != nil {
			t.Fatalf("first Redeem: %v", err)
		}
		if _, _, err := store.Redeem(ctx, code.Value, "Second phone"); !errors.Is(err, ErrInvalidCode) {
			t.Fatalf("second Redeem error = %v, want ErrInvalidCode", err)
		}
	})
}

func TestConcurrentPairingRedemptionHasOneWinner(t *testing.T) {
	clock := newPairingTestClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	store, db := newPairingTestStore(t, clock)
	code, err := store.CreateCode(context.Background())
	if err != nil {
		t.Fatalf("CreateCode: %v", err)
	}

	const contenders = 8
	start := make(chan struct{})
	results := make(chan error, contenders)
	var wg sync.WaitGroup
	for range contenders {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, _, err := store.Redeem(context.Background(), code.Value, "Phone")
			results <- err
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	winners := 0
	for err := range results {
		if err == nil {
			winners++
			continue
		}
		if !errors.Is(err, ErrInvalidCode) {
			t.Errorf("losing redemption error = %v, want ErrInvalidCode", err)
		}
	}
	if winners != 1 {
		t.Fatalf("successful redemptions = %d, want 1", winners)
	}
	var devices int
	if err := db.QueryRow(`SELECT COUNT(*) FROM paired_devices`).Scan(&devices); err != nil {
		t.Fatalf("count devices: %v", err)
	}
	if devices != 1 {
		t.Fatalf("persisted devices = %d, want 1", devices)
	}
}

func TestDeviceCredentialIsHashedExpiresAndRevokesImmediately(t *testing.T) {
	ctx := context.Background()
	clock := newPairingTestClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	store, db := newPairingTestStore(t, clock)
	code, err := store.CreateCode(ctx)
	if err != nil {
		t.Fatalf("CreateCode: %v", err)
	}
	credential, device, err := store.Redeem(ctx, code.Value, "Personal phone")
	if err != nil {
		t.Fatalf("Redeem: %v", err)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(credential)
	if err != nil || len(decoded) != CredentialBytes {
		t.Fatalf("credential has %d decoded bytes and error %v, want %d bytes", len(decoded), err, CredentialBytes)
	}
	var persisted []byte
	if err := db.QueryRow(`SELECT credential_hash FROM paired_devices WHERE id = ?`, device.ID).Scan(&persisted); err != nil {
		t.Fatalf("read credential hash: %v", err)
	}
	wantHash := sha256.Sum256([]byte(credential))
	if !bytes.Equal(persisted, wantHash[:]) {
		t.Fatal("database does not contain the credential SHA-256 hash")
	}
	if bytes.Contains(persisted, []byte(credential)) || string(persisted) == credential {
		t.Fatal("plaintext device credential was persisted")
	}
	if ok, err := store.Authenticate(ctx, credential); err != nil || !ok {
		t.Fatalf("Authenticate before revoke = (%v, %v), want (true, nil)", ok, err)
	}
	if revoked, err := store.RevokeDevice(ctx, device.ID); err != nil || !revoked {
		t.Fatalf("RevokeDevice = (%v, %v), want (true, nil)", revoked, err)
	}
	if ok, err := store.Authenticate(ctx, credential); err != nil || ok {
		t.Fatalf("Authenticate after revoke = (%v, %v), want (false, nil)", ok, err)
	}

	devices, err := store.ListDevices(ctx)
	if err != nil {
		t.Fatalf("ListDevices: %v", err)
	}
	if len(devices) != 1 || devices[0].RevokedAt == nil {
		t.Fatalf("devices = %#v, want one record with revokedAt", devices)
	}

	code, err = store.CreateCode(ctx)
	if err != nil {
		t.Fatalf("CreateCode for expiration: %v", err)
	}
	credential, _, err = store.Redeem(ctx, code.Value, "Tablet")
	if err != nil {
		t.Fatalf("Redeem for expiration: %v", err)
	}
	clock.Advance(CredentialLifetime)
	if ok, err := store.Authenticate(ctx, credential); err != nil || ok {
		t.Fatalf("Authenticate expired credential = (%v, %v), want (false, nil)", ok, err)
	}
}

func TestPairingAttemptsArePersistentlyRateLimited(t *testing.T) {
	clock := newPairingTestClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	store, _ := newPairingTestStore(t, clock)
	for i := 0; i < maxRedemptionAttempts; i++ {
		if err := store.ConsumeRedemptionAttempt(context.Background()); err != nil {
			t.Fatalf("attempt %d: %v", i+1, err)
		}
	}
	if err := store.ConsumeRedemptionAttempt(context.Background()); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("attempt beyond limit error = %v, want ErrRateLimited", err)
	}
	clock.Advance(redemptionAttemptWindow)
	if err := store.ConsumeRedemptionAttempt(context.Background()); err != nil {
		t.Fatalf("attempt after window: %v", err)
	}
}

func TestPairingCodeKeyPersistsWithOwnerOnlyPermissions(t *testing.T) {
	dir := t.TempDir()
	first, err := LoadOrCreateCodeKey(dir)
	if err != nil {
		t.Fatalf("LoadOrCreateCodeKey: %v", err)
	}
	second, err := LoadOrCreateCodeKey(dir)
	if err != nil {
		t.Fatalf("second LoadOrCreateCodeKey: %v", err)
	}
	if !bytes.Equal(first, second) || len(first) != CredentialBytes {
		t.Fatal("pairing key was not persisted as 256 stable random bits")
	}
	info, err := os.Stat(filepath.Join(dir, "pi-web", CodeKeyFilename))
	if err != nil {
		t.Fatalf("stat pairing key: %v", err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("pairing key permissions = %o, want 600", info.Mode().Perm())
	}
}
