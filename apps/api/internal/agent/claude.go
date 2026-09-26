package agent

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// defaultClaudeModel is used when ANTHROPIC_MODEL isn't set. Opus 5 per this
// project's own default policy for AI-application work — override via
// ANTHROPIC_MODEL for a cheaper tier (e.g. "claude-sonnet-5") on large scans.
const defaultClaudeModel = "claude-opus-5"

// ClaudeBackend calls the Claude API directly to analyse a deployment.
//
// This exists because the `bob` CLI this project was originally built
// around has no working install source available to us (the Dockerfile's
// install URL 404s, and we have no access to IBM's actual Bob Shell
// binary) — so scans using BobBackend can never produce real findings.
// ClaudeBackend is a real, working alternative: same Task/Result contract,
// same prompt, an actual LLM call instead of a missing external binary.
type ClaudeBackend struct {
	client      anthropic.Client
	model       string
	taskTimeout time.Duration
}

// NewClaudeBackend creates a ClaudeBackend. apiKey may be empty to let the
// SDK resolve credentials itself (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,
// an `ant auth login` profile, or Workload Identity Federation) — see Ready().
func NewClaudeBackend(apiKey, model string) *ClaudeBackend {
	var opts []option.RequestOption
	if apiKey != "" {
		opts = append(opts, option.WithAPIKey(apiKey))
	}
	if model == "" {
		model = defaultClaudeModel
	}
	return &ClaudeBackend{
		client:      anthropic.NewClient(opts...),
		model:       model,
		taskTimeout: taskTimeoutFromEnv(),
	}
}

// Ready is a best-effort heuristic, not an authoritative check — the SDK's
// real credential resolution chain (API key -> auth token -> OAuth profile
// -> WIF) is richer than this. It exists to fail fast with a clear message
// in the common case (no credentials at all) rather than let every task
// fail individually with an opaque API error.
func (b *ClaudeBackend) Ready() error {
	if os.Getenv("ANTHROPIC_API_KEY") == "" && os.Getenv("ANTHROPIC_AUTH_TOKEN") == "" {
		return fmt.Errorf("no Claude credentials found (set ANTHROPIC_API_KEY, or run `ant auth login`)")
	}
	return nil
}

// Run builds the same structured prompt BobBackend uses, sends it to Claude,
// and parses the JSON findings from the response text.
func (b *ClaudeBackend) Run(ctx context.Context, task Task) Result {
	taskCtx, cancel := context.WithTimeout(ctx, b.taskTimeout)
	defer cancel()

	prompt := buildPrompt(task)

	resp, err := b.client.Messages.New(taskCtx, anthropic.MessageNewParams{
		Model:     anthropic.Model(b.model),
		MaxTokens: 8000,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(prompt)),
		},
	})
	if err != nil {
		return Result{TaskID: task.ID, Err: fmt.Errorf("claude API: %w", err)}
	}

	if resp.StopReason == anthropic.StopReasonRefusal {
		return Result{TaskID: task.ID, Err: fmt.Errorf("claude declined to analyse this deployment (category: %s)", resp.StopDetails.Category)}
	}

	var text strings.Builder
	for _, block := range resp.Content {
		if tb, ok := block.AsAny().(anthropic.TextBlock); ok {
			text.WriteString(tb.Text)
		}
	}

	findings, err := parseFindings(text.String())
	if err != nil {
		return Result{TaskID: task.ID, Err: fmt.Errorf("parse findings: %w\noutput: %s", err, text.String())}
	}
	return Result{TaskID: task.ID, Findings: findings}
}
