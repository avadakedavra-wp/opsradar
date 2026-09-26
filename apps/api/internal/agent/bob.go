package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// defaultTaskTimeout bounds how long a single bob invocation may run before
// it's killed and counted as a failed task. Configurable via BOB_TASK_TIMEOUT
// (a Go duration string, e.g. "90s") since analysis time varies with manifest
// size and the LLM backing bob.
const defaultTaskTimeout = 3 * time.Minute

// BobBackend invokes the `bob` CLI to analyse a deployment.
type BobBackend struct {
	bobBin      string // path/name of the bob executable
	taskTimeout time.Duration
}

// NewBobBackend creates a BobBackend using the given binary name/path.
func NewBobBackend(bobBin string) *BobBackend {
	if bobBin == "" {
		bobBin = "bob"
	}
	return &BobBackend{bobBin: bobBin, taskTimeout: taskTimeoutFromEnv()}
}

func taskTimeoutFromEnv() time.Duration {
	if v := os.Getenv("BOB_TASK_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	}
	return defaultTaskTimeout
}

// Ready reports whether the bob binary can actually be found on PATH.
func (b *BobBackend) Ready() error {
	if _, err := exec.LookPath(b.bobBin); err != nil {
		return fmt.Errorf("bob binary %q not found: %w", b.bobBin, err)
	}
	return nil
}

// Run builds a structured prompt, invokes bob, and parses the JSON findings.
// The subprocess is bound to both the caller's ctx and a per-task timeout, so
// a hung `bob` process can never block a scan indefinitely.
func (b *BobBackend) Run(ctx context.Context, task Task) Result {
	taskCtx, cancel := context.WithTimeout(ctx, b.taskTimeout)
	defer cancel()

	prompt := buildPrompt(task)

	cmd := exec.CommandContext(taskCtx, b.bobBin,
		"-p", prompt,
		"--hide-intermediary-output",
		"--yolo",
	)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if taskCtx.Err() == context.DeadlineExceeded {
		return Result{
			TaskID: task.ID,
			Err:    fmt.Errorf("bob timed out after %s", b.taskTimeout),
		}
	}
	if err != nil {
		return Result{
			TaskID: task.ID,
			Err:    fmt.Errorf("bob exited with error: %w\nstderr: %s", err, stderr.String()),
		}
	}

	findings, err := parseFindings(stdout.String())
	if err != nil {
		return Result{
			TaskID: task.ID,
			Err:    fmt.Errorf("parse findings: %w\noutput: %s", err, stdout.String()),
		}
	}
	return Result{TaskID: task.ID, Findings: findings}
}

// buildPrompt constructs the Bob prompt for the given task.
func buildPrompt(task Task) string {
	ctx := task.Context

	base := fmt.Sprintf(`You are a Kubernetes operations expert. Analyse the following Kubernetes Deployment and identify ALL issues.

Deployment: %s
Namespace:  %s

--- MANIFEST ---
%s
--- END MANIFEST ---

Live metrics (millicores / MiB):
  CPU request: %s m   CPU actual usage: %s m
  Mem request: %s Mi  Mem actual usage: %s Mi

`,
		ctx["deployment"], ctx["namespace"],
		ctx["manifest"],
		ctx["cpu_request_m"], ctx["cpu_usage_m"],
		ctx["mem_request_mi"], ctx["mem_usage_mi"],
	)

	if task.GitHubRepo != nil {
		base += fmt.Sprintf("Detected source repository: %s (%s)\n\n", task.GitHubRepo.Slug, task.GitHubRepo.FullURL)
		if task.SourceManifest != "" {
			base += "--- SOURCE MANIFEST (from repo, may differ from live cluster state) ---\n" +
				task.SourceManifest +
				"\n--- END SOURCE MANIFEST ---\n\n"
		}
	}

	switch task.Kind {
	case KindResourceAudit:
		base += `Check for ALL of the following problems:
- CPU over-provisioning (request >> actual usage by >5x)
- Memory over-provisioning
- Missing resource requests or limits
- Missing liveness probe
- Missing readiness probe
- Unpinned image tag (using :latest or no tag)
- Security issues (privileged containers, runAsRoot, hostNetwork, etc.)

`
	case KindSecurityReview:
		base += `Focus ONLY on security issues: privileged containers, runAsRoot, capabilities, hostNetwork, hostPID, etc.

`
	case KindDocCheck:
		base += `Focus ONLY on missing labels, annotations, and documentation best practices.

`
	}

	base += `For each issue found, produce a JSON object with fields:
  "severity": one of "critical", "high", "medium", "low"
  "title": short one-line title
  "detail": explanation of the problem
  "suggestion": how to fix it
  "diff_patch": a valid unified diff (--- a/deployment.yaml +++ b/deployment.yaml) fixing the issue, or "" if not applicable

Respond ONLY with a valid JSON array of these objects. No markdown, no code fences.`

	return base
}

// parseFindings extracts the first JSON array from bob's stdout.
// Handles any stray text or log lines before the array.
func parseFindings(output string) ([]Finding, error) {
	start := strings.Index(output, "[")
	end := strings.LastIndex(output, "]")
	if start == -1 || end == -1 || end <= start {
		// bob returned no findings (empty output is valid for clean deployments)
		return []Finding{}, nil
	}
	jsonSlice := output[start : end+1]
	var findings []Finding
	if err := json.Unmarshal([]byte(jsonSlice), &findings); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return findings, nil
}
