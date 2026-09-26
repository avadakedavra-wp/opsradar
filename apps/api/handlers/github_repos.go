package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/opsradar/k8s-ops-radar/api/internal/agent"
)

// GitHubHandler holds the AI backend for repo scanning.
type GitHubHandler struct {
	backend agent.Backend
}

// RepoFinding is a single AI-generated finding for a repo.
type RepoFinding struct {
	Repo     string `json:"repo"`
	Severity string `json:"severity"` // critical | high | medium | low | info
	Category string `json:"category"` // Security | CI/CD | Quality | Dependencies | Documentation
	File     string `json:"file"`     // relative path, e.g. ".github/workflows/ci.yml"
	Title    string `json:"title"`
	Detail   string `json:"detail"`
	Fix      string `json:"fix"` // code snippet or command to fix
}

// ScanRepos handles POST /github/scan.
// Body: { "paths": ["/abs/path/to/repo", ...] }
func (h *GitHubHandler) ScanRepos(c *fiber.Ctx) error {
	var req struct {
		Paths []string `json:"paths"`
	}
	if err := c.BodyParser(&req); err != nil || len(req.Paths) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "paths required"})
	}

	// Do NOT impose a timeout here: the AI backend already bounds this single
	// Chat call with its own budget (BOB_TASK_TIMEOUT, default 3m) and returns a
	// clear timeout error. A tighter deadline here silently pre-empts that budget
	// — it was killing scans at 120s even though the backend allowed 180s, and
	// reported a misleading "timed out after 3m0s". Let the backend govern.
	ctx := c.Context()

	// Build rich context for each repo.
	var sb strings.Builder
	for _, p := range req.Paths {
		info := buildRepoInfo(p)
		sb.WriteString(fmt.Sprintf("\n## Repo: %s (%s)\n", info.Name, p))
		sb.WriteString(fmt.Sprintf("Branch: %s\n", info.Branch))
		sb.WriteString(fmt.Sprintf("Remote: %s\n", info.RemoteURL))
		sb.WriteString(fmt.Sprintf("Last commit: %s\n", info.LastCommit))
		sb.WriteString(fmt.Sprintf("Has .github: %v, Workflows: %d\n", info.HasDotGithub, info.Workflows))

		// Recent commits
		log := gitOut(p, "log", "--oneline", "-10")
		if log != "" {
			sb.WriteString("Recent commits:\n" + log + "\n")
		}

		// Workflow file names
		wfDir := filepath.Join(p, ".github", "workflows")
		if entries, err := os.ReadDir(wfDir); err == nil {
			sb.WriteString("Workflows: ")
			var wfs []string
			for _, e := range entries {
				if !e.IsDir() {
					wfs = append(wfs, e.Name())
				}
			}
			sb.WriteString(strings.Join(wfs, ", ") + "\n")
		}

		// Check common files
		for _, f := range []string{"README.md", "Dockerfile", "docker-compose.yml", ".env.example", "go.mod", "package.json", "Makefile"} {
			if _, err := os.Stat(filepath.Join(p, f)); err == nil {
				sb.WriteString("Has: " + f + "\n")
			}
		}

		// Show a workflow file if present (first one, first 60 lines)
		if entries, err := os.ReadDir(wfDir); err == nil && len(entries) > 0 {
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				content, err := os.ReadFile(filepath.Join(wfDir, e.Name()))
				if err == nil {
					lines := strings.Split(string(content), "\n")
					if len(lines) > 60 {
						lines = lines[:60]
					}
					sb.WriteString(fmt.Sprintf("\nWorkflow %s:\n```yaml\n%s\n```\n", e.Name(), strings.Join(lines, "\n")))
					break
				}
			}
		}

		// Inline real source code so the AI reviews actual code for smells & bugs,
		// not just config. Curated + capped server-side (see collectSourceFiles).
		if srcs := collectSourceFiles(p); len(srcs) > 0 {
			sb.WriteString(fmt.Sprintf("\nSource files for code review (%d, truncated):\n", len(srcs)))
			for _, f := range srcs {
				lang := strings.TrimPrefix(filepath.Ext(f.path), ".")
				sb.WriteString(fmt.Sprintf("\n### %s\n```%s\n%s\n```\n", f.path, lang, f.body))
			}
		}
	}

	prompt := `You are a staff-level engineer doing a rigorous code review plus a DevOps/security audit. Analyze ONLY the repository information and SOURCE FILES provided below — do NOT attempt to read files or access the filesystem; everything you need is inline. Return ONLY a valid JSON object — no markdown, no explanation, just raw JSON.

Prioritize REAL code findings from the source files over generic config advice. Be concise: return AT MOST the 12 most important findings per repo, highest severity first. Every finding must be specific and actionable — point to the exact file and, when possible, the symbol or line. Keep "detail" to 1-2 sentences and "fix" to a short, directly-usable snippet. Do NOT invent files you were not shown, and do NOT pad with speculative or low-value findings.

Schema:
{
  "findings": [
    {
      "repo": "<repo name>",
      "severity": "<critical|high|medium|low|info>",
      "category": "<Security|Bug|Code Quality|Performance|CI/CD|Dependencies|Container|Documentation>",
      "file": "<relative file path from the source files above, or empty string>",
      "title": "<short title, max 80 chars>",
      "detail": "<what's wrong and why it matters, 1-2 sentences; name the function/line when you can>",
      "fix": "<concrete corrected code snippet or command>"
    }
  ]
}

Review the SOURCE FILES for real issues:
- Bugs & correctness: nil/undefined derefs, unchecked errors, off-by-one, wrong conditionals, resource leaks (unclosed files/conns), goroutine/promise leaks, race conditions
- Security in code: injection (SQL/command/path), unsanitized input, hardcoded secrets/keys, weak crypto, missing authz checks, unsafe deserialization, SSRF
- Code smells: dead code, duplication, overly long functions, deep nesting, magic numbers, poor naming, swallowed errors, missing input validation, tight coupling
- Performance: N+1 queries, work in hot loops, unbounded memory/allocations, blocking calls on hot paths

Also audit config & delivery:
- Unpinned GitHub Actions (@SHA not @tag), missing CI test/lint steps, no branch protection
- Missing .gitignore/.dockerignore, secrets not ignored, no lockfile
- Dockerfile issues (root user, latest tag, no healthcheck), missing README/LICENSE

Return only the JSON. No other text.

Repositories:
` + sb.String()

	reply, err := h.backend.Chat(ctx, prompt, "")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	// Extract JSON from response (model may wrap it in ```json blocks)
	findings := extractFindings(reply)
	if len(findings) == 0 && strings.TrimSpace(reply) != "" {
		head := reply
		if len(head) > 600 {
			head = head[:600]
		}
		log.Printf("github scan: parsed 0 findings from a %d-char reply — head: %q", len(reply), head)
	}
	return c.JSON(fiber.Map{"findings": findings, "repos": req.Paths})
}

// LocalRepo is one git repository found on the local filesystem.
type LocalRepo struct {
	Path         string `json:"path"`
	Name         string `json:"name"`
	RemoteURL    string `json:"remote_url"`
	Branch       string `json:"branch"`
	LastCommit   string `json:"last_commit"`
	HasDotGithub bool   `json:"has_dot_github"` // .github/ directory present
	Workflows    int    `json:"workflows"`       // count of .github/workflows/*.yml
}

// ListLocalRepos scans a root directory (default: home) up to 3 levels deep
// for git repositories and returns metadata for each one found.
//
// Query params:
//   - root: absolute path to scan (default: $HOME)
func ListLocalRepos(c *fiber.Ctx) error {
	root := c.Query("root", homeDir())
	if root == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "root path required"})
	}
	repos := scanForRepos(root, 3)
	return c.JSON(fiber.Map{"repos": repos, "root": root})
}

func homeDir() string {
	h, _ := os.UserHomeDir()
	return h
}

func scanForRepos(root string, maxDepth int) []LocalRepo {
	var repos []LocalRepo
	walkRepos(root, 0, maxDepth, &repos)
	return repos
}

func walkRepos(path string, depth, maxDepth int, repos *[]LocalRepo) {
	if depth > maxDepth {
		return
	}
	// Hidden dirs (except at root) are skipped
	if depth > 0 && strings.HasPrefix(filepath.Base(path), ".") {
		return
	}

	gitDir := filepath.Join(path, ".git")
	if info, err := os.Stat(gitDir); err == nil && info.IsDir() {
		*repos = append(*repos, buildRepoInfo(path))
		return // don't recurse into a git repo
	}

	if depth == maxDepth {
		return
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		walkRepos(filepath.Join(path, e.Name()), depth+1, maxDepth, repos)
	}
}

func buildRepoInfo(path string) LocalRepo {
	remote := gitOut(path, "remote", "get-url", "origin")
	branch := gitOut(path, "branch", "--show-current")
	last := gitOut(path, "log", "-1", "--format=%h %s")

	ghDir := filepath.Join(path, ".github")
	hasDotGithub := false
	workflows := 0
	if info, err := os.Stat(ghDir); err == nil && info.IsDir() {
		hasDotGithub = true
		wfDir := filepath.Join(ghDir, "workflows")
		if entries, err := os.ReadDir(wfDir); err == nil {
			for _, e := range entries {
				if !e.IsDir() && (strings.HasSuffix(e.Name(), ".yml") || strings.HasSuffix(e.Name(), ".yaml")) {
					workflows++
				}
			}
		}
	}

	return LocalRepo{
		Path:         path,
		Name:         filepath.Base(path),
		RemoteURL:    remote,
		Branch:       branch,
		LastCommit:   last,
		HasDotGithub: hasDotGithub,
		Workflows:    workflows,
	}
}

// sourceFile is one human-written file inlined into the scan prompt for review.
type sourceFile struct {
	path string // path relative to the repo root
	body string // contents, possibly truncated
}

// collectSourceFiles walks a repo and returns a prioritized, size-capped set of
// human-written source files worth reviewing for code smells — deliberately
// skipping vendored deps, build output, lockfiles, generated code, and tests so
// the AI spends its budget on code the author actually owns. Caps keep the prompt
// small enough to stay well under the scan timeout.
func collectSourceFiles(root string) []sourceFile {
	const (
		maxFiles     = 10
		perFileBytes = 6 * 1024  // ~150 lines per file
		totalBytes   = 30 * 1024 // whole-repo code budget
	)
	skipDir := map[string]bool{
		"node_modules": true, "vendor": true, ".git": true, "dist": true,
		"build": true, ".next": true, "out": true, "target": true,
		"__pycache__": true, ".venv": true, "venv": true, "coverage": true,
		"testdata": true, "bin": true, "obj": true,
	}
	okExt := map[string]bool{
		".go": true, ".ts": true, ".tsx": true, ".js": true, ".jsx": true,
		".py": true, ".rb": true, ".java": true, ".rs": true, ".php": true,
		".c": true, ".cpp": true, ".cs": true, ".sh": true, ".tf": true, ".kt": true,
	}
	okName := map[string]bool{"Dockerfile": true, "Makefile": true}

	var files []sourceFile
	total := 0

	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if len(files) >= maxFiles || total >= totalBytes {
			return filepath.SkipAll
		}
		if d.IsDir() {
			base := d.Name()
			if path != root && (skipDir[base] || strings.HasPrefix(base, ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		name := d.Name()
		if !okExt[strings.ToLower(filepath.Ext(name))] && !okName[name] {
			return nil
		}
		// Skip generated / minified / test noise — low signal, high token cost.
		lower := strings.ToLower(name)
		switch {
		case strings.HasSuffix(lower, ".min.js"),
			strings.HasSuffix(lower, "_test.go"),
			strings.HasSuffix(lower, ".test.ts"), strings.HasSuffix(lower, ".test.tsx"),
			strings.HasSuffix(lower, ".spec.ts"), strings.HasSuffix(lower, ".spec.tsx"),
			strings.HasSuffix(lower, ".pb.go"), strings.HasSuffix(lower, ".gen.go"),
			strings.HasSuffix(lower, "_generated.go"):
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() > 512*1024 {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		body := string(data)
		if len(body) > perFileBytes {
			body = body[:perFileBytes] + "\n… (truncated)"
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			rel = name
		}
		files = append(files, sourceFile{path: rel, body: body})
		total += len(body)
		return nil
	})
	return files
}

// extractFindings pulls a JSON findings array out of an AI response that may
// include markdown fences or surrounding prose.
func extractFindings(raw string) []RepoFinding {
	// Strip ```json ... ``` fences if present
	s := raw
	if i := strings.Index(s, "```"); i != -1 {
		s = s[i:]
		s = strings.TrimPrefix(s, "```json")
		s = strings.TrimPrefix(s, "```")
		if j := strings.Index(s, "```"); j != -1 {
			s = s[:j]
		}
	}
	s = strings.TrimSpace(s)

	// Find first { to last }
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start == -1 || end == -1 || end < start {
		return nil
	}
	s = s[start : end+1]

	var result struct {
		Findings []RepoFinding `json:"findings"`
	}
	if err := json.Unmarshal([]byte(s), &result); err != nil {
		return nil
	}
	return result.Findings
}

// ApplyRepoFix handles POST /github/fix.
// It creates a branch in the local repo, writes the fix to the target file,
// commits, pushes, then opens a GitHub PR via the API.
//
// Body: { repo_path, file, fix, title, detail }
func (h *GitHubHandler) ApplyRepoFix(c *fiber.Ctx) error {
	var req struct {
		RepoPath string `json:"repo_path"` // absolute path on this machine
		File     string `json:"file"`      // relative path inside repo (may be empty)
		Fix      string `json:"fix"`
		Title    string `json:"title"`
		Detail   string `json:"detail"`
	}
	if err := c.BodyParser(&req); err != nil || req.RepoPath == "" || req.Fix == "" || req.Title == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "repo_path, fix, and title required"})
	}

	// Confirm it is a git repo.
	if _, err := os.Stat(filepath.Join(req.RepoPath, ".git")); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "not a git repository"})
	}

	// Always write a safe proposal file in .opsradar/ — never overwrite existing source files.
	// The AI fix text is instructional prose, not a ready-to-apply patch.
	slug := strings.ToLower(strings.NewReplacer(" ", "-", "/", "-", ":", "", ".", "").Replace(req.Title))
	if len(slug) > 40 {
		slug = slug[:40]
	}
	targetFile := fmt.Sprintf(".opsradar/fix-%s.md", slug)

	fileHint := ""
	if req.File != "" {
		fileHint = fmt.Sprintf("\n**Target file:** `%s`\n", req.File)
		// Append current file content so reviewer has full context.
		absTarget := filepath.Join(req.RepoPath, req.File)
		if raw, err := os.ReadFile(absTarget); err == nil {
			ext := strings.TrimPrefix(filepath.Ext(req.File), ".")
			fileHint += fmt.Sprintf("\n### Current content\n\n```%s\n%s\n```\n", ext, string(raw))
		}
	}
	req.Fix = fmt.Sprintf("# OpsRadar Fix: %s\n%s\n## Problem\n\n%s\n\n## Suggested change\n\n```\n%s\n```\n\n---\n*Generated by [OpsRadar](https://github.com/avadakedavra-wp/opsradar)*\n",
		req.Title, fileHint, req.Detail, req.Fix)

	// Branch name (reuse slug computed above, capped at 36 chars for git).
	branchSlug := slug
	if len(branchSlug) > 36 {
		branchSlug = branchSlug[:36]
	}
	branch := "opsradar/fix-" + branchSlug

	// 1. Create branch from current HEAD.
	if out, err := gitRun(req.RepoPath, "checkout", "-b", branch); err != nil {
		// Branch may already exist from a previous attempt; switch to it.
		if _, err2 := gitRun(req.RepoPath, "checkout", branch); err2 != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": fmt.Sprintf("create branch: %s / %s", err.Error(), out),
			})
		}
	}

	// 2. Write the fix to disk.
	abs := filepath.Join(req.RepoPath, targetFile)
	if mkErr := os.MkdirAll(filepath.Dir(abs), 0o755); mkErr != nil {
		_ = gitRun2(req.RepoPath, "checkout", "-") // restore branch
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "mkdir: " + mkErr.Error()})
	}
	if writeErr := os.WriteFile(abs, []byte(req.Fix), 0o644); writeErr != nil {
		_ = gitRun2(req.RepoPath, "checkout", "-")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "write file: " + writeErr.Error()})
	}

	// 3. Stage + commit.
	if _, err := gitRun(req.RepoPath, "add", targetFile); err != nil {
		_ = gitRun2(req.RepoPath, "checkout", "-")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "git add: " + err.Error()})
	}
	commitMsg := fmt.Sprintf("fix(%s): %s\n\nGenerated by OpsRadar", filepath.Base(targetFile), req.Title)
	if _, err := gitRun(req.RepoPath, "commit", "-m", commitMsg); err != nil {
		_ = gitRun2(req.RepoPath, "checkout", "-")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "git commit: " + err.Error()})
	}

	// 4. Push branch to origin.
	if out, err := gitRun(req.RepoPath, "push", "-u", "origin", branch); err != nil {
		_ = gitRun2(req.RepoPath, "checkout", "-")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("git push: %s — %s", err.Error(), out),
		})
	}

	// 5. Restore original branch (best-effort).
	_ = gitRun2(req.RepoPath, "checkout", "-")

	// 6. Open a GitHub PR via API.
	token := os.Getenv("GITHUB_TOKEN")
	remoteURL := gitOut(req.RepoPath, "remote", "get-url", "origin")
	ownerRepo := parseGitHubSlug(remoteURL)

	if token == "" || ownerRepo == "" {
		// No token / not a GitHub repo — return the branch name so the user
		// can open the PR manually.
		return c.JSON(fiber.Map{
			"ok":     true,
			"branch": branch,
			"pr_url": "",
			"note":   "set GITHUB_TOKEN to auto-open PRs; branch pushed to origin",
		})
	}

	prURL, err := createGitHubPR(c.Context(), token, ownerRepo, branch, req.Title, req.Detail)
	if err != nil {
		return c.JSON(fiber.Map{
			"ok":     true,
			"branch": branch,
			"pr_url": "",
			"note":   "branch pushed; PR creation failed: " + err.Error(),
		})
	}

	return c.JSON(fiber.Map{"ok": true, "branch": branch, "pr_url": prURL})
}

// parseGitHubSlug extracts "owner/repo" from ssh or https remote URLs.
func parseGitHubSlug(remote string) string {
	remote = strings.TrimSuffix(remote, ".git")
	// SSH: git@github.com:owner/repo
	if strings.HasPrefix(remote, "git@github.com:") {
		return strings.TrimPrefix(remote, "git@github.com:")
	}
	// HTTPS: https://github.com/owner/repo
	if i := strings.Index(remote, "github.com/"); i != -1 {
		return remote[i+len("github.com/"):]
	}
	return ""
}

// createGitHubPR opens a PR via the GitHub REST API.
func createGitHubPR(ctx context.Context, token, ownerRepo, branch, title, detail string) (string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/pulls", ownerRepo)

	// Determine the default branch to use as base.
	base := "main"

	body := map[string]string{
		"title": fmt.Sprintf("fix: %s", title),
		"head":  branch,
		"base":  base,
		"body":  fmt.Sprintf("**Finding:** %s\n\n%s\n\n---\n*Generated by [OpsRadar](https://github.com/avadakedavra-wp/opsradar)*", title, detail),
	}

	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(data)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		HTMLURL string `json:"html_url"`
		Number  int    `json:"number"`
		Message string `json:"message"` // GitHub error message
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("github %d: %s", resp.StatusCode, result.Message)
	}
	return result.HTMLURL, nil
}

// gitRun runs a git command in dir and returns combined output + error.
func gitRun(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// gitRun2 is gitRun discarding output (used for cleanup best-effort calls).
func gitRun2(dir string, args ...string) error {
	_, err := gitRun(dir, args...)
	return err
}

func gitOut(dir string, args ...string) string {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
