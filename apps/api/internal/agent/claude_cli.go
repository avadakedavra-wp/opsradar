package agent

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// ClaudeCLIBackend delegates to the `claude` CLI (Claude Code) in print mode.
// It uses whatever auth the user already has configured — no ANTHROPIC_API_KEY
// required if they have run `claude` interactively at least once.
type ClaudeCLIBackend struct {
	bin     string
	timeout time.Duration
}

// NewClaudeCLIBackend creates a ClaudeCLIBackend using the given binary name.
func NewClaudeCLIBackend(bin string) *ClaudeCLIBackend {
	if bin == "" {
		bin = "claude"
	}
	return &ClaudeCLIBackend{bin: bin, timeout: taskTimeoutFromEnv()}
}

// Ready reports whether the claude binary is on PATH.
func (c *ClaudeCLIBackend) Ready() error {
	if _, err := exec.LookPath(c.bin); err != nil {
		return fmt.Errorf("claude CLI %q not found on PATH: %w", c.bin, err)
	}
	return nil
}

// Run analyses a deployment by invoking `claude -p <prompt>` and parsing
// the JSON findings from stdout.
func (c *ClaudeCLIBackend) Run(ctx context.Context, task Task) Result {
	taskCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	prompt := buildPrompt(task)
	cmd := exec.CommandContext(taskCtx, c.bin, "-p", prompt)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if taskCtx.Err() == context.DeadlineExceeded {
		return Result{TaskID: task.ID, Err: fmt.Errorf("claude CLI timed out after %s", c.timeout)}
	}
	if err != nil {
		return Result{TaskID: task.ID, Err: fmt.Errorf("claude CLI: %w\nstderr: %s", err, stderr.String())}
	}

	findings, err := parseFindings(stdout.String())
	if err != nil {
		return Result{TaskID: task.ID, Err: fmt.Errorf("parse findings: %w\noutput: %s", err, stdout.String())}
	}
	return Result{TaskID: task.ID, Findings: findings}
}

// Chat answers a free-form question using `claude -p <prompt>`.
func (c *ClaudeCLIBackend) Chat(ctx context.Context, message, clusterContext string) (string, error) {
	chatCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	prompt := message
	if clusterContext != "" {
		prompt = "You are a Kubernetes operations expert embedded in OpsRadar. Use the following live cluster context to answer the question.\n\n" +
			"CLUSTER CONTEXT:\n" + clusterContext + "\n\nQUESTION: " + message +
			"\n\nAnswer clearly and concisely. Focus on actionable advice for the platform engineer."
	}

	cmd := exec.CommandContext(chatCtx, c.bin, "-p", prompt)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if chatCtx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("claude CLI timed out after %s", c.timeout)
	}
	if err != nil {
		return "", fmt.Errorf("claude CLI: %w\nstderr: %s", err, stderr.String())
	}
	return strings.TrimSpace(stdout.String()), nil
}
