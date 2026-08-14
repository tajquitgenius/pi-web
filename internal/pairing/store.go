package pairing

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

const (
	CodeLength              = 8
	CodeLifetime            = 5 * time.Minute
	CredentialLifetime      = 90 * 24 * time.Hour
	CredentialBytes         = 32
	maxRedemptionAttempts   = 10
	redemptionAttemptWindow = time.Minute
	codeAlphabet            = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
)

const CodesTableDDL = `CREATE TABLE IF NOT EXISTS pairing_codes (
	id          TEXT PRIMARY KEY,
	code_hmac   BLOB NOT NULL UNIQUE,
	created_at  INTEGER NOT NULL,
	expires_at  INTEGER NOT NULL,
	redeemed_at INTEGER
)`

const DevicesTableDDL = `CREATE TABLE IF NOT EXISTS paired_devices (
	id              TEXT PRIMARY KEY,
	credential_hash BLOB NOT NULL UNIQUE,
	label           TEXT NOT NULL,
	created_at      INTEGER NOT NULL,
	last_used_at    INTEGER NOT NULL,
	expires_at      INTEGER NOT NULL,
	revoked_at      INTEGER
)`

const AttemptsTableDDL = `CREATE TABLE IF NOT EXISTS pairing_redemption_attempts (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	attempted_at INTEGER NOT NULL
)`

const AttemptsIndexDDL = `CREATE INDEX IF NOT EXISTS idx_pairing_redemption_attempts_time
	ON pairing_redemption_attempts(attempted_at)`

var (
	ErrInvalidCode  = errors.New("invalid or expired pairing code")
	ErrInvalidLabel = errors.New("invalid device label")
	ErrRateLimited  = errors.New("too many pairing attempts")
)

type Code struct {
	Value     string    `json:"code"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type Device struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt time.Time  `json:"lastUsedAt"`
	ExpiresAt  time.Time  `json:"expiresAt"`
	RevokedAt  *time.Time `json:"revokedAt"`
}

type AuthenticatedDevice struct {
	ID        string
	ExpiresAt time.Time
}

type Store struct {
	db      *sql.DB
	codeKey []byte
	now     func() time.Time
}

func NewStore(db *sql.DB, codeKey []byte, now func() time.Time) (*Store, error) {
	if db == nil {
		return nil, errors.New("pairing store requires a database")
	}
	if len(codeKey) < CredentialBytes {
		return nil, errors.New("pairing code key must contain at least 256 bits")
	}
	if now == nil {
		now = time.Now
	}
	return &Store{db: db, codeKey: append([]byte(nil), codeKey...), now: now}, nil
}

func (s *Store) CreateCode(ctx context.Context) (Code, error) {
	now := s.now().UTC()
	for range 4 {
		raw := make([]byte, CodeLength)
		if _, err := rand.Read(raw); err != nil {
			return Code{}, fmt.Errorf("generate pairing code: %w", err)
		}
		for i := range raw {
			raw[i] = codeAlphabet[int(raw[i])&31]
		}
		value := string(raw)
		digest := s.codeDigest(value)
		id, err := uuid.NewRandom()
		if err != nil {
			return Code{}, fmt.Errorf("generate pairing code id: %w", err)
		}
		expiresAt := now.Add(CodeLifetime)
		_, err = s.db.ExecContext(ctx,
			`INSERT INTO pairing_codes (id, code_hmac, created_at, expires_at) VALUES (?, ?, ?, ?)`,
			id.String(), digest, now.Unix(), expiresAt.Unix())
		if err == nil {
			return Code{Value: value, ExpiresAt: expiresAt}, nil
		}
		if !isUniqueConstraint(err) {
			return Code{}, fmt.Errorf("store pairing code: %w", err)
		}
	}
	return Code{}, errors.New("generate unique pairing code")
}

func (s *Store) ConsumeRedemptionAttempt(ctx context.Context) error {
	now := s.now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin pairing rate-limit transaction: %w", err)
	}
	defer tx.Rollback()

	cutoff := now.Add(-redemptionAttemptWindow).Unix()
	if _, err := tx.ExecContext(ctx, `DELETE FROM pairing_redemption_attempts WHERE attempted_at <= ?`, cutoff); err != nil {
		return fmt.Errorf("prune pairing attempts: %w", err)
	}
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM pairing_redemption_attempts`).Scan(&count); err != nil {
		return fmt.Errorf("count pairing attempts: %w", err)
	}
	if count >= maxRedemptionAttempts {
		return ErrRateLimited
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO pairing_redemption_attempts (attempted_at) VALUES (?)`, now.Unix()); err != nil {
		return fmt.Errorf("record pairing attempt: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit pairing attempt: %w", err)
	}
	return nil
}

func (s *Store) Redeem(ctx context.Context, rawCode, rawLabel string) (string, Device, error) {
	label := strings.TrimSpace(rawLabel)
	if label == "" || utf8.RuneCountInString(label) > 80 || strings.IndexFunc(label, unicode.IsControl) >= 0 {
		return "", Device{}, ErrInvalidLabel
	}
	code := strings.ToUpper(strings.TrimSpace(rawCode))
	if len(code) != CodeLength {
		return "", Device{}, ErrInvalidCode
	}
	for _, c := range code {
		if !strings.ContainsRune(codeAlphabet, c) {
			return "", Device{}, ErrInvalidCode
		}
	}

	credentialBytes := make([]byte, CredentialBytes)
	if _, err := rand.Read(credentialBytes); err != nil {
		return "", Device{}, fmt.Errorf("generate device credential: %w", err)
	}
	credential := base64.RawURLEncoding.EncodeToString(credentialBytes)
	credentialHash := sha256.Sum256([]byte(credential))
	deviceID, err := uuid.NewRandom()
	if err != nil {
		return "", Device{}, fmt.Errorf("generate device id: %w", err)
	}
	now := s.now().UTC()
	expiresAt := now.Add(CredentialLifetime)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", Device{}, fmt.Errorf("begin pairing redemption: %w", err)
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE pairing_codes
		SET redeemed_at = ?
		WHERE code_hmac = ? AND redeemed_at IS NULL AND expires_at > ?`,
		now.Unix(), s.codeDigest(code), now.Unix())
	if err != nil {
		return "", Device{}, fmt.Errorf("redeem pairing code: %w", err)
	}
	redeemed, err := result.RowsAffected()
	if err != nil {
		return "", Device{}, fmt.Errorf("read pairing redemption result: %w", err)
	}
	if redeemed != 1 {
		return "", Device{}, ErrInvalidCode
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO paired_devices
		(id, credential_hash, label, created_at, last_used_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		deviceID.String(), credentialHash[:], label, now.Unix(), now.Unix(), expiresAt.Unix()); err != nil {
		return "", Device{}, fmt.Errorf("store paired device: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", Device{}, fmt.Errorf("commit pairing redemption: %w", err)
	}

	return credential, Device{
		ID:         deviceID.String(),
		Label:      label,
		CreatedAt:  now,
		LastUsedAt: now,
		ExpiresAt:  expiresAt,
	}, nil
}

func (s *Store) AuthenticateDevice(ctx context.Context, credential string) (AuthenticatedDevice, bool, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(credential)
	if err != nil || len(decoded) != CredentialBytes {
		return AuthenticatedDevice{}, false, nil
	}
	digest := sha256.Sum256([]byte(credential))
	now := s.now().UTC().Unix()
	var device AuthenticatedDevice
	var expiresAt int64
	err = s.db.QueryRowContext(ctx, `UPDATE paired_devices
		SET last_used_at = ?
		WHERE credential_hash = ? AND revoked_at IS NULL AND expires_at > ?
		RETURNING id, expires_at`, now, digest[:], now).Scan(&device.ID, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return AuthenticatedDevice{}, false, nil
	}
	if err != nil {
		return AuthenticatedDevice{}, false, fmt.Errorf("authenticate paired device: %w", err)
	}
	device.ExpiresAt = time.Unix(expiresAt, 0).UTC()
	return device, true, nil
}

func (s *Store) Authenticate(ctx context.Context, credential string) (bool, error) {
	_, matched, err := s.AuthenticateDevice(ctx, credential)
	return matched, err
}

func (s *Store) IsDeviceActive(ctx context.Context, id string) (bool, error) {
	if id == "" {
		return false, nil
	}
	var active bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM paired_devices
		WHERE id = ? AND revoked_at IS NULL AND expires_at > ?
	)`, id, s.now().UTC().Unix()).Scan(&active)
	if err != nil {
		return false, fmt.Errorf("check paired device: %w", err)
	}
	return active, nil
}

func (s *Store) ListDevices(ctx context.Context) ([]Device, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, label, created_at, last_used_at, expires_at, revoked_at
		FROM paired_devices ORDER BY created_at DESC, id`)
	if err != nil {
		return nil, fmt.Errorf("list paired devices: %w", err)
	}
	defer rows.Close()

	devices := make([]Device, 0)
	for rows.Next() {
		var device Device
		var createdAt, lastUsedAt, expiresAt int64
		var revokedAt sql.NullInt64
		if err := rows.Scan(&device.ID, &device.Label, &createdAt, &lastUsedAt, &expiresAt, &revokedAt); err != nil {
			return nil, fmt.Errorf("scan paired device: %w", err)
		}
		device.CreatedAt = time.Unix(createdAt, 0).UTC()
		device.LastUsedAt = time.Unix(lastUsedAt, 0).UTC()
		device.ExpiresAt = time.Unix(expiresAt, 0).UTC()
		if revokedAt.Valid {
			revoked := time.Unix(revokedAt.Int64, 0).UTC()
			device.RevokedAt = &revoked
		}
		devices = append(devices, device)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate paired devices: %w", err)
	}
	return devices, nil
}

func (s *Store) RevokeDevice(ctx context.Context, id string) (bool, error) {
	result, err := s.db.ExecContext(ctx,
		`UPDATE paired_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
		s.now().UTC().Unix(), id)
	if err != nil {
		return false, fmt.Errorf("revoke paired device: %w", err)
	}
	revoked, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read device revocation result: %w", err)
	}
	return revoked == 1, nil
}

func (s *Store) codeDigest(code string) []byte {
	mac := hmac.New(sha256.New, s.codeKey)
	_, _ = mac.Write([]byte(code))
	return mac.Sum(nil)
}

func isUniqueConstraint(err error) bool {
	return strings.Contains(strings.ToLower(err.Error()), "unique constraint")
}
