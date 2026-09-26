package agent

import "github.com/opsradar/k8s-ops-radar/api/internal/github"

// TaskKind identifies the type of analysis to perform.
type TaskKind string

const (
	KindResourceAudit TaskKind = "resource-audit"
	KindSecurityReview TaskKind = "security-review"
	KindDocCheck       TaskKind = "doc-check"
)

// Task is a single unit of work sent to the agent backend.
type Task struct {
	ID             string
	Target         string // "namespace/deployment"
	Kind           TaskKind
	Context        map[string]string  // arbitrary k/v passed into the prompt
	GitHubRepo     *github.RepoInfo   // detected GitHub source (nil = no repo)
	SourceManifest string             // source YAML fetched from GitHub (empty = not available)
}

// Finding is one issue returned by the agent.
type Finding struct {
	Severity   string `json:"severity"`   // critical | high | medium | low
	Title      string `json:"title"`
	Detail     string `json:"detail"`
	Suggestion string `json:"suggestion"`
	DiffPatch  string `json:"diff_patch"`
}

// Result is the outcome of running one Task.
type Result struct {
	TaskID   string
	Findings []Finding
	Err      error
}

// ProgressEvent is emitted during a scan for SSE streaming.
type ProgressEvent struct {
	TaskID  string `json:"task_id,omitempty"`
	Message string `json:"message"`
	Finding *Finding `json:"finding,omitempty"`
	Done    bool   `json:"done,omitempty"`
}

// Backend is the interface for agent implementations.
type Backend interface {
	Run(task Task) Result
}
