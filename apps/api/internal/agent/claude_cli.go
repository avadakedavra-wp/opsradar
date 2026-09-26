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

// newCLICmd builds a `claude` print-mode command with tools disabled and the
// prompt fed via stdin. Two decisions matter here:
//   - --allowedTools "" disables ALL tools. Our prompts inline every bit of
//     context the model needs; without this the agentic CLI wanders off trying
//     to Read/Grep the filesystem (measured 69–180s+ and often timing out).
//     Disabling tools made the same call deterministic (~22s).
//   - the prompt goes on stdin, not argv: --allowedTools is variadic and would
//     otherwise swallow the prompt, and stdin sidesteps OS arg-length limits on
//     large multi-repo scan prompts.
func newCLICmd(ctx context.Context, bin, prompt string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, bin, "-p", "--allowedTools", "")
	cmd.Stdin = strings.NewReader(prompt)
	return cmd
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
	cmd := newCLICmd(taskCtx, c.bin, prompt)
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

	cmd := newCLICmd(chatCtx, c.bin, prompt)
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
