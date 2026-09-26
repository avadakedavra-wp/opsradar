package store

import (
	"database/sql"
	_ "embed"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/0001_init.sql
var initSQL string

type sqliteStore struct {
	db *sql.DB
}

// Open opens (or creates) the SQLite database at path and runs migrations.
func Open(path string) (Store, error) {
	db, err := sql.Open("sqlite", path+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("open sqlite %s: %w", path, err)
	}
	if _, err := db.Exec(initSQL); err != nil {
		return nil, fmt.Errorf("run migrations: %w", err)
	}
	return &sqliteStore{db: db}, nil
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

// UpdateScan sets status and finished_at for a scan.
func (s *sqliteStore) UpdateScan(id, status string, finishedAt time.Time) error {
	_, err := s.db.Exec(
		`UPDATE scans SET status=?, finished_at=? WHERE id=?`,
		status, finishedAt, id,
	)
	return err
}

// ListScans returns all scans with aggregated open-finding severity counts.
func (s *sqliteStore) ListScans() ([]ScanRow, error) {
	rows, err := s.db.Query(`
		SELECT
			sc.id, sc.cluster_name, sc.started_at, sc.finished_at, sc.status,
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
		`INSERT INTO scan_targets (id, scan_id, namespace, deployment, cpu_request_m, cpu_usage_m, mem_request_mi, mem_usage_mi)
		 VALUES (?,?,?,?,?,?,?,?)`,
		t.ID, t.ScanID, t.Namespace, t.Deployment,
		t.CPURequestM, t.CPUUsageM, t.MemRequestMi, t.MemUsageMi,
	)
	return err
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
			SELECT id FROM scans WHERE status='completed' ORDER BY started_at DESC LIMIT 1
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
