package hub

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
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
	credentialBytes         = 32
	maxEnrollmentAttempts   = 10
	enrollmentAttemptWindow = time.Minute
	codeAlphabet            = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
)

var (
	ErrInvalidCode  = errors.New("invalid or expired enrollment code")
	ErrInvalidID    = errors.New("invalid node id")
	ErrInvalidLabel = errors.New("invalid node label")
	ErrRateLimited  = errors.New("too many hub enrollment attempts")
	nodeIDPattern   = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$`)
)

const schema = `
CREATE TABLE IF NOT EXISTS hub_enrollment_codes (
    id          TEXT PRIMARY KEY,
    node_id     TEXT NOT NULL,
    node_label  TEXT NOT NULL,
    code_hmac   BLOB NOT NULL UNIQUE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    redeemed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_hub_enrollment_codes_node ON hub_enrollment_codes(node_id);
CREATE TABLE IF NOT EXISTS hub_enrollment_attempts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_enrollment_attempts_time ON hub_enrollment_attempts(attempted_at);
CREATE TABLE IF NOT EXISTS hub_nodes (
    id              TEXT PRIMARY KEY,
    label           TEXT NOT NULL,
    credential_hash BLOB NOT NULL UNIQUE,
    created_at      INTEGER NOT NULL,
    last_seen_at    INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    revoked_at      INTEGER
);`

type Enrollment struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type NodeCredential struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Credential string `json:"credential"`
}

type Node struct {
	ID        string    `json:"id"`
	Label     string    `json:"label"`
	LastSeen  time.Time `json:"lastSeenAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type Store struct {
	db      *sql.DB
	codeKey []byte
	now     func() time.Time
}

func NewStore(db *sql.DB, codeKey []byte, now func() time.Time) (*Store, error) {
	if db == nil {
		return nil, errors.New("hub store requires a database")
	}
	if len(codeKey) < credentialBytes {
		return nil, errors.New("hub code key must contain at least 256 bits")
	}
	if now == nil {
		now = time.Now
	}
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("initialize hub schema: %w", err)
	}
	return &Store{db: db, codeKey: append([]byte(nil), codeKey...), now: now}, nil
}

func (s *Store) CreateEnrollment(ctx context.Context, rawID, rawLabel string) (Enrollment, error) {
	id := strings.TrimSpace(rawID)
	label := strings.TrimSpace(rawLabel)
	if id == "main" || !nodeIDPattern.MatchString(id) {
		return Enrollment{}, ErrInvalidID
	}
	if label == "" || utf8.RuneCountInString(label) > 80 || strings.IndexFunc(label, unicode.IsControl) >= 0 {
		return Enrollment{}, ErrInvalidLabel
	}
	now := s.now().UTC()
	if _, err := s.db.ExecContext(ctx,
		`UPDATE hub_enrollment_codes SET redeemed_at = ? WHERE node_id = ? AND redeemed_at IS NULL`,
		now.Unix(), id); err != nil {
		return Enrollment{}, fmt.Errorf("invalidate prior hub enrollment: %w", err)
	}
	for range 4 {
		code, err := randomCode()
		if err != nil {
			return Enrollment{}, err
		}
		expiresAt := now.Add(CodeLifetime)
		_, err = s.db.ExecContext(ctx, `INSERT INTO hub_enrollment_codes
			(id, node_id, node_label, code_hmac, created_at, expires_at)
			VALUES (?, ?, ?, ?, ?, ?)`, uuid.NewString(), id, label, s.codeDigest(code), now.Unix(), expiresAt.Unix())
		if err == nil {
			return Enrollment{Code: code, ExpiresAt: expiresAt}, nil
		}
	}
	return Enrollment{}, errors.New("generate unique hub enrollment code")
}

func (s *Store) ConsumeEnrollmentAttempt(ctx context.Context) error {
	now := s.now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin hub enrollment rate limit: %w", err)
	}
	defer tx.Rollback()
	cutoff := now.Add(-enrollmentAttemptWindow).Unix()
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM hub_enrollment_attempts WHERE attempted_at <= ?`, cutoff); err != nil {
		return fmt.Errorf("prune hub enrollment attempts: %w", err)
	}
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM hub_enrollment_attempts`).Scan(&count); err != nil {
		return fmt.Errorf("count hub enrollment attempts: %w", err)
	}
	if count >= maxEnrollmentAttempts {
		return ErrRateLimited
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO hub_enrollment_attempts (attempted_at) VALUES (?)`, now.Unix()); err != nil {
		return fmt.Errorf("record hub enrollment attempt: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit hub enrollment attempt: %w", err)
	}
	return nil
}

func (s *Store) Redeem(ctx context.Context, rawCode string) (NodeCredential, error) {
	code := strings.ToUpper(strings.TrimSpace(rawCode))
	if len(code) != CodeLength {
		return NodeCredential{}, ErrInvalidCode
	}
	for _, char := range code {
		if !strings.ContainsRune(codeAlphabet, char) {
			return NodeCredential{}, ErrInvalidCode
		}
	}
	now := s.now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return NodeCredential{}, fmt.Errorf("begin hub enrollment: %w", err)
	}
	defer tx.Rollback()
	var enrollmentID, nodeID, label string
	err = tx.QueryRowContext(ctx, `SELECT id, node_id, node_label FROM hub_enrollment_codes
		WHERE code_hmac = ? AND redeemed_at IS NULL AND expires_at > ?`, s.codeDigest(code), now.Unix()).
		Scan(&enrollmentID, &nodeID, &label)
	if errors.Is(err, sql.ErrNoRows) {
		return NodeCredential{}, ErrInvalidCode
	}
	if err != nil {
		return NodeCredential{}, fmt.Errorf("lookup hub enrollment: %w", err)
	}
	result, err := tx.ExecContext(ctx, `UPDATE hub_enrollment_codes SET redeemed_at = ?
		WHERE id = ? AND redeemed_at IS NULL`, now.Unix(), enrollmentID)
	if err != nil {
		return NodeCredential{}, fmt.Errorf("consume hub enrollment: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return NodeCredential{}, ErrInvalidCode
	}
	rawCredential := make([]byte, credentialBytes)
	if _, err := rand.Read(rawCredential); err != nil {
		return NodeCredential{}, fmt.Errorf("generate hub node credential: %w", err)
	}
	credential := base64.RawURLEncoding.EncodeToString(rawCredential)
	digest := sha256.Sum256([]byte(credential))
	expiresAt := now.Add(CredentialLifetime).Unix()
	_, err = tx.ExecContext(ctx, `INSERT INTO hub_nodes
		(id, label, credential_hash, created_at, last_seen_at, expires_at, revoked_at)
		VALUES (?, ?, ?, ?, ?, ?, NULL)
		ON CONFLICT(id) DO UPDATE SET label = excluded.label,
		credential_hash = excluded.credential_hash, created_at = excluded.created_at,
		last_seen_at = excluded.last_seen_at, expires_at = excluded.expires_at, revoked_at = NULL`,
		nodeID, label, digest[:], now.Unix(), now.Unix(), expiresAt)
	if err != nil {
		return NodeCredential{}, fmt.Errorf("store hub node: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return NodeCredential{}, fmt.Errorf("commit hub enrollment: %w", err)
	}
	return NodeCredential{ID: nodeID, Label: label, Credential: credential}, nil
}

func (s *Store) AuthenticateNode(ctx context.Context, credential string) (Node, bool, error) {
	if credential == "" {
		return Node{}, false, nil
	}
	digest := sha256.Sum256([]byte(credential))
	now := s.now().UTC()
	var node Node
	newExpiry := now.Add(CredentialLifetime)
	err := s.db.QueryRowContext(ctx, `UPDATE hub_nodes SET last_seen_at = ?, expires_at = ?
		WHERE credential_hash = ? AND revoked_at IS NULL AND expires_at > ?
		RETURNING id, label`, now.Unix(), newExpiry.Unix(), digest[:], now.Unix()).
		Scan(&node.ID, &node.Label)
	if errors.Is(err, sql.ErrNoRows) {
		return Node{}, false, nil
	}
	if err != nil {
		return Node{}, false, fmt.Errorf("authenticate and renew hub node: %w", err)
	}
	node.LastSeen = now
	node.ExpiresAt = newExpiry
	return node, true, nil
}

func (s *Store) RevokeNode(ctx context.Context, id string) (bool, error) {
	now := s.now().UTC()
	result, err := s.db.ExecContext(ctx,
		`UPDATE hub_nodes SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, now.Unix(), id)
	if err != nil {
		return false, fmt.Errorf("revoke hub node: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read revoked hub node count: %w", err)
	}
	return affected == 1, nil
}

func (s *Store) ListNodes(ctx context.Context) ([]Node, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, label, last_seen_at, expires_at FROM hub_nodes
		WHERE revoked_at IS NULL ORDER BY label COLLATE NOCASE, id`)
	if err != nil {
		return nil, fmt.Errorf("list hub nodes: %w", err)
	}
	defer rows.Close()
	nodes := make([]Node, 0)
	for rows.Next() {
		var node Node
		var lastSeenUnix, expiresUnix int64
		if err := rows.Scan(&node.ID, &node.Label, &lastSeenUnix, &expiresUnix); err != nil {
			return nil, fmt.Errorf("scan hub node: %w", err)
		}
		node.LastSeen = time.Unix(lastSeenUnix, 0).UTC()
		node.ExpiresAt = time.Unix(expiresUnix, 0).UTC()
		nodes = append(nodes, node)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate hub nodes: %w", err)
	}
	return nodes, nil
}

func (s *Store) codeDigest(code string) []byte {
	mac := hmac.New(sha256.New, s.codeKey)
	_, _ = mac.Write([]byte("pi-web:hub-enrollment:"))
	_, _ = mac.Write([]byte(code))
	return mac.Sum(nil)
}

func randomCode() (string, error) {
	raw := make([]byte, CodeLength)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate hub enrollment code: %w", err)
	}
	for i := range raw {
		raw[i] = codeAlphabet[int(raw[i])&31]
	}
	return string(raw), nil
}
