package store

import "time"

// Store is the persistence interface for OpsRadar.
type Store interface {
	// Scans
	CreateScan(s Scan) error
	UpdateScan(id, status string, finishedAt time.Time) error
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

	Close() error
}

// Scan represents a single scan run.
type Scan struct {
	ID          string
	ClusterName string
	StartedAt   time.Time
	FinishedAt  *time.Time
	Status      string
}

// ScanTarget is one deployment analysed within a scan.
type ScanTarget struct {
	ID            string
	ScanID        string
	Namespace     string
	Deployment    string
	CPURequestM   int
	CPUUsageM     int
	MemRequestMi  int
	MemUsageMi    int
}

// Finding is one issue found in a ScanTarget.
type Finding struct {
	ID           string    `json:"id"`
	ScanTargetID string    `json:"scan_target_id"`
	Kind         string    `json:"kind"`
	Severity     string    `json:"severity"`
	Title        string    `json:"title"`
	Detail       string    `json:"detail"`
	Suggestion   string    `json:"suggestion"`
	DiffPatch    string    `json:"diff_patch"`
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
