package store

import (
	"database/sql"
	_ "embed"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/0001_init.sql
var migration0001 string

//go:embed migrations/0002_scan_result_summary.sql
var migration0002 string

// migrations run in order, exactly once each, tracked in schema_migrations.
// Each entry's SQL must be safe to run standalone (not re-run on restart).
var migrations = []struct {
	version int
	sql     string
}{
	{1, migration0001},
	{2, migration0002},
}

type sqliteStore struct {
	db *sql.DB
}

// Open opens (or creates) the SQLite database at path and applies any
// migrations that haven't run yet.
func Open(path string) (Store, error) {
	db, err := sql.Open("sqlite", path+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("open sqlite %s: %w", path, err)
	}
	if err := runMigrations(db); err != nil {
		return nil, fmt.Errorf("run migrations: %w", err)
	}
	return &sqliteStore{db: db}, nil
}

// runMigrations applies each migration exactly once, tracked by version.
// Migration 0001 uses CREATE TABLE IF NOT EXISTS so it's idempotent even for
// databases created before this tracking table existed; later migrations
// (e.g. ALTER TABLE ADD COLUMN) are not safe to re-run, hence the tracking.
func runMigrations(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}
	for _, m := range migrations {
		var applied int
		if err := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, m.version).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %d: %w", m.version, err)
		}
		if applied > 0 {
			continue
		}
		if _, err := db.Exec(m.sql); err != nil {
			return fmt.Errorf("apply migration %d: %w", m.version, err)
		}
		if _, err := db.Exec(`INSERT INTO schema_migrations (version) VALUES (?)`, m.version); err != nil {
			return fmt.Errorf("record migration %d: %w", m.version, err)
		}
	}
	return nil
}

func (s *sqliteStore) Close() error { return s.db.Close() }

// CreateScan inserts a new scan record.
func (s *sqliteStore) CreateScan(sc Scan) error {
	_, err := s.db.Exec(
		`INSERT INTO scans (id, cluster_name, started_at, status) VALUES (?,?,?,?)`,
		sc.ID, sc.ClusterName, sc.StartedAt, sc.Status,
	)
	return err
}

// UpdateScan sets status and finished_at for a scan — used for early-exit
// failure paths (e.g. k8s unreachable) where there's no per-task tally yet.
func (s *sqliteStore) UpdateScan(id, status string, finishedAt time.Time) error {
	_, err := s.db.Exec(
		`UPDATE scans SET status=?, finished_at=? WHERE id=?`,
		status, finishedAt, id,
	)
	return err
}

// FinishScan records the real outcome of a scan that ran its tasks to
// completion: how many failed out of how many, and a short error summary.
// Callers must derive status from the actual failure count — see
// handlers/scan.go's classifyStatus — never hardcode "completed".
func (s *sqliteStore) FinishScan(id, status string, finishedAt time.Time, failedTasks, totalTasks int, errorSummary string) error {
	_, err := s.db.Exec(
		`UPDATE scans SET status=?, finished_at=?, failed_tasks=?, total_tasks=?, error_summary=? WHERE id=?`,
		status, finishedAt, failedTasks, totalTasks, errorSummary, id,
	)
	return err
}

// ListScans returns all scans with aggregated open-finding severity counts.
func (s *sqliteStore) ListScans() ([]ScanRow, error) {
	rows, err := s.db.Query(`
		SELECT
			sc.id, sc.cluster_name, sc.started_at, sc.finished_at, sc.status,
			sc.failed_tasks, sc.total_tasks, sc.error_summary,
			COALESCE(SUM(CASE WHEN f.severity='critical' AND f.resolved_at IS NULL THEN 1 ELSE 0 END),0),
			COALESCE(SUM(CASE WHEN f.severity='high'     AND f.resolved_at IS NULL THEN 1 ELSE 0 END),0),
			COALESCE(SUM(CASE WHEN f.severity='medium'   AND f.resolved_at IS NULL THEN 1 ELSE 0 END),0),
			COALESCE(SUM(CASE WHEN f.severity='low'      AND f.resolved_at IS NULL THEN 1 ELSE 0 END),0)
		FROM scans sc
		LEFT JOIN scan_targets st ON st.scan_id = sc.id
		LEFT JOIN findings f      ON f.scan_target_id = st.id
		GROUP BY sc.id
		ORDER BY sc.started_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []ScanRow
	for rows.Next() {
		var r ScanRow
		var finishedAt sql.NullTime
		if err := rows.Scan(
			&r.ID, &r.ClusterName, &r.StartedAt, &finishedAt, &r.Status,
			&r.FailedTasks, &r.TotalTasks, &r.ErrorSummary,
			&r.Critical, &r.High, &r.Medium, &r.Low,
		); err != nil {
			return nil, err
		}
		if finishedAt.Valid {
			r.FinishedAt = &finishedAt.Time
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// CreateScanTarget inserts a scan target.
func (s *sqliteStore) CreateScanTarget(t ScanTarget) error {
	_, err := s.db.Exec(
		`INSERT INTO scan_targets (id, scan_id, context_name, namespace, deployment, cpu_request_m, cpu_usage_m, mem_request_mi, mem_usage_mi)
		 VALUES (?,?,?,?,?,?,?,?,?)`,
		t.ID, t.ScanID, t.ContextName, t.Namespace, t.Deployment,
		t.CPURequestM, t.CPUUsageM, t.MemRequestMi, t.MemUsageMi,
	)
	return err
}

// GetScanTargetByID returns a single scan target by ID.
func (s *sqliteStore) GetScanTargetByID(id string) (ScanTarget, error) {
	var t ScanTarget
	err := s.db.QueryRow(
		`SELECT id, scan_id, context_name, namespace, deployment,
		        cpu_request_m, cpu_usage_m, mem_request_mi, mem_usage_mi
		 FROM scan_targets WHERE id=?`, id,
	).Scan(&t.ID, &t.ScanID, &t.ContextName, &t.Namespace, &t.Deployment,
		&t.CPURequestM, &t.CPUUsageM, &t.MemRequestMi, &t.MemUsageMi)
	return t, err
}

// CreateFinding inserts a finding.
func (s *sqliteStore) CreateFinding(f Finding) error {
	_, err := s.db.Exec(
		`INSERT INTO findings (id, scan_target_id, kind, severity, title, detail, suggestion, diff_patch)
		 VALUES (?,?,?,?,?,?,?,?)`,
		f.ID, f.ScanTargetID, f.Kind, f.Severity,
		f.Title, f.Detail, f.Suggestion, f.DiffPatch,
	)
	return err
}

// GetFinding returns a single finding by ID.
func (s *sqliteStore) GetFinding(id string) (Finding, error) {
	var f Finding
	var resolvedAt sql.NullTime
	err := s.db.QueryRow(
		`SELECT id, scan_target_id, kind, severity, title, detail, suggestion, diff_patch, resolved_at
		 FROM findings WHERE id=?`, id,
	).Scan(&f.ID, &f.ScanTargetID, &f.Kind, &f.Severity, &f.Title, &f.Detail, &f.Suggestion, &f.DiffPatch, &resolvedAt)
	if err != nil {
		return Finding{}, err
	}
	if resolvedAt.Valid {
		f.ResolvedAt = &resolvedAt.Time
	}
	return f, nil
}

// ListFindings returns all findings for every scan target in the given scan.
func (s *sqliteStore) ListFindings(scanID string) ([]Finding, error) {
	rows, err := s.db.Query(`
		SELECT f.id, f.scan_target_id, f.kind, f.severity, f.title, f.detail, f.suggestion, f.diff_patch, f.resolved_at
		FROM findings f
		JOIN scan_targets st ON st.id = f.scan_target_id
		WHERE st.scan_id = ?
		ORDER BY CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
	`, scanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []Finding
	for rows.Next() {
		var f Finding
		var resolvedAt sql.NullTime
		if err := rows.Scan(&f.ID, &f.ScanTargetID, &f.Kind, &f.Severity, &f.Title, &f.Detail, &f.Suggestion, &f.DiffPatch, &resolvedAt); err != nil {
			return nil, err
		}
		if resolvedAt.Valid {
			f.ResolvedAt = &resolvedAt.Time
		}
		results = append(results, f)
	}
	return results, rows.Err()
}

// ResolveFinding sets resolved_at on a finding.
func (s *sqliteStore) ResolveFinding(id string) error {
	_, err := s.db.Exec(`UPDATE findings SET resolved_at=? WHERE id=?`, time.Now().UTC(), id)
	return err
}

// GetRadar returns open-finding counts per namespace from the latest completed scan.
func (s *sqliteStore) GetRadar() ([]RadarRow, error) {
	rows, err := s.db.Query(`
		WITH latest AS (
			SELECT id FROM scans WHERE status IN ('completed', 'completed_with_errors') ORDER BY started_at DESC LIMIT 1
		)
		SELECT
			st.namespace,
			COALESCE(SUM(CASE WHEN f.severity='critical' THEN 1 ELSE 0 END),0),
			COALESCE(SUM(CASE WHEN f.severity='high'     THEN 1 ELSE 0 END),0),
			COALESCE(SUM(CASE WHEN f.severity='medium'   THEN 1 ELSE 0 END),0),
			COALESCE(SUM(CASE WHEN f.severity='low'      THEN 1 ELSE 0 END),0)
		FROM scan_targets st
		JOIN latest ON st.scan_id = latest.id
		LEFT JOIN findings f ON f.scan_target_id = st.id AND f.resolved_at IS NULL
		GROUP BY st.namespace
		ORDER BY st.namespace
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []RadarRow
	for rows.Next() {
		var r RadarRow
		if err := rows.Scan(&r.Namespace, &r.Critical, &r.High, &r.Medium, &r.Low); err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// GetSetting returns a stored setting value, or "" if unset.
func (s *sqliteStore) GetSetting(key string) (string, error) {
	var value string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key=?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return value, nil
}

// SetSetting upserts a setting value.
func (s *sqliteStore) SetSetting(key, value string) error {
	_, err := s.db.Exec(
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, value,
	)
	return err
}

// DeleteSetting removes a setting (e.g. disconnecting GitHub).
func (s *sqliteStore) DeleteSetting(key string) error {
	_, err := s.db.Exec(`DELETE FROM settings WHERE key=?`, key)
	return err
}
