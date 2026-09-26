-- 0002_scan_result_summary.sql: record an honest, specific outcome for every scan
-- instead of a single hardcoded "completed" status.

ALTER TABLE scans ADD COLUMN failed_tasks  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scans ADD COLUMN total_tasks   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scans ADD COLUMN error_summary TEXT    NOT NULL DEFAULT '';

-- Multi-context support: which kubeconfig context each target was scanned from.
ALTER TABLE scan_targets ADD COLUMN context_name TEXT NOT NULL DEFAULT '';

-- Generic local settings (GitHub OAuth token, chosen repo, active k8s context).
-- Single-user local tool: no per-viewer scoping needed.
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);
