-- 0001_init.sql: OpsRadar initial schema

CREATE TABLE IF NOT EXISTS scans (
    id          TEXT PRIMARY KEY,
    cluster_name TEXT NOT NULL,
    started_at  DATETIME NOT NULL,
    finished_at DATETIME,
    status      TEXT NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS scan_targets (
    id             TEXT PRIMARY KEY,
    scan_id        TEXT NOT NULL REFERENCES scans(id),
    namespace      TEXT NOT NULL,
    deployment     TEXT NOT NULL,
    cpu_request_m  INTEGER NOT NULL DEFAULT 0,
    cpu_usage_m    INTEGER NOT NULL DEFAULT 0,
    mem_request_mi INTEGER NOT NULL DEFAULT 0,
    mem_usage_mi   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS findings (
    id              TEXT PRIMARY KEY,
    scan_target_id  TEXT NOT NULL REFERENCES scan_targets(id),
    kind            TEXT NOT NULL,
    severity        TEXT NOT NULL,
    title           TEXT NOT NULL,
    detail          TEXT NOT NULL DEFAULT '',
    suggestion      TEXT NOT NULL DEFAULT '',
    diff_patch      TEXT NOT NULL DEFAULT '',
    resolved_at     DATETIME
);

CREATE INDEX IF NOT EXISTS idx_scan_targets_scan_id  ON scan_targets(scan_id);
CREATE INDEX IF NOT EXISTS idx_findings_scan_target  ON findings(scan_target_id);
CREATE INDEX IF NOT EXISTS idx_findings_resolved_at  ON findings(resolved_at);
