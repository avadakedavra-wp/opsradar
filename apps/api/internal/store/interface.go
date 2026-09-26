package store

import "time"

// Store is the persistence interface for OpsRadar.
type Store interface {
	// Scans
	CreateScan(s Scan) error
	// UpdateScan is for early-exit failure paths (e.g. k8s unreachable) where
	// there's no per-task result to summarise yet.
	UpdateScan(id, status string, finishedAt time.Time) error
	// FinishScan records the real outcome of a completed scan run: how many
	// tasks failed out of how many, plus a short summary — so "completed"
	// always means what it says instead of hiding per-task errors.
	FinishScan(id, status string, finishedAt time.Time, failedTasks, totalTasks int, errorSummary string) error
	ListScans() ([]ScanRow, error)

	// ScanTargets
	CreateScanTarget(t ScanTarget) error

	// Findings
	CreateFinding(f Finding) error
	GetFinding(id string) (Finding, error)
	ListFindings(scanID string) ([]Finding, error)
	ResolveFinding(id string) error

	// Radar
	GetRadar() ([]RadarRow, error)

	// Settings (generic key/value; backs GitHub connection + k8s context choice)
	GetSetting(key string) (string, error) // returns "", nil if unset
	SetSetting(key, value string) error
	DeleteSetting(key string) error

	Close() error
}

// Scan represents a single scan run.
//
// Status is one of:
//   - "running"               — in progress
//   - "completed"              — every task succeeded
//   - "completed_with_errors"  — some tasks failed, some succeeded
//   - "failed"                 — every task failed, or the scan couldn't start
//
// It must never read "completed" unless FailedTasks == 0 — see handlers/scan.go.
type Scan struct {
	ID           string     `json:"id"`
	ClusterName  string     `json:"cluster_name"`
	StartedAt    time.Time  `json:"started_at"`
	FinishedAt   *time.Time `json:"finished_at,omitempty"`
	Status       string     `json:"status"`
	FailedTasks  int        `json:"failed_tasks"`
	TotalTasks   int        `json:"total_tasks"`
	ErrorSummary string     `json:"error_summary,omitempty"`
}

// ScanTarget is one deployment analysed within a scan.
type ScanTarget struct {
	ID           string `json:"id"`
	ScanID       string `json:"scan_id"`
	ContextName  string `json:"context_name,omitempty"` // kubeconfig context this target was scanned from
	Namespace    string `json:"namespace"`
	Deployment   string `json:"deployment"`
	CPURequestM  int    `json:"cpu_request_m"`
	CPUUsageM    int    `json:"cpu_usage_m"`
	MemRequestMi int    `json:"mem_request_mi"`
	MemUsageMi   int    `json:"mem_usage_mi"`
}

// Finding is one issue found in a ScanTarget.
type Finding struct {
	ID           string     `json:"id"`
	ScanTargetID string     `json:"scan_target_id"`
	Kind         string     `json:"kind"`
	Severity     string     `json:"severity"`
	Title        string     `json:"title"`
	Detail       string     `json:"detail"`
	Suggestion   string     `json:"suggestion"`
	DiffPatch    string     `json:"diff_patch"`
	ResolvedAt   *time.Time `json:"resolved_at,omitempty"`
}

// ScanRow is returned by ListScans — includes aggregated severity counts.
type ScanRow struct {
	Scan
	Critical int `json:"critical"`
	High     int `json:"high"`
	Medium   int `json:"medium"`
	Low      int `json:"low"`
}

// RadarRow aggregates open findings per namespace for the heatmap.
type RadarRow struct {
	Namespace string `json:"namespace"`
	Critical  int    `json:"critical"`
	High      int    `json:"high"`
	Medium    int    `json:"medium"`
	Low       int    `json:"low"`
}
