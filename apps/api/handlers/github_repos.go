package handlers

import (
	"context"
	"encoding/json"
	"fmt"
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

	ctx, cancel := context.WithTimeout(c.Context(), 120*time.Second)
	defer cancel()

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
	}

	prompt := `You are a DevOps, security, and CI/CD expert. Analyze the following repositories and return ONLY a valid JSON object — no markdown, no explanation, just raw JSON.

Schema:
{
  "findings": [
    {
      "repo": "<repo name>",
      "severity": "<critical|high|medium|low|info>",
      "category": "<Security|CI/CD|Quality|Dependencies|Documentation|Container>",
      "file": "<relative file path or empty string>",
      "title": "<short title, max 80 chars>",
      "detail": "<explanation of the problem, 1-3 sentences>",
      "fix": "<concrete fix: a code snippet, yaml block, or shell command>"
    }
  ]
}

Check for every repo:
- Missing or misconfigured CI/CD workflows (.github/workflows)
- Unpinned GitHub Actions (use @SHA not @branch)
- Missing branch protection, no code review requirements
- Secrets or tokens that look hardcoded
- Missing .gitignore, .dockerignore
- Missing or empty README
- Missing Dockerfile / no container strategy
- Missing health checks in Docker/k8s
- Dependency files without lockfiles
- No test step in CI
- Large binary files or no .gitattributes
- Stale or single-commit repos with no meaningful history
- Missing LICENSE file

Return only the JSON. No other text.

Repositories:
` + sb.String()

	reply, err := h.backend.Chat(ctx, prompt, "")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	// Extract JSON from response (model may wrap it in ```json blocks)
	findings := extractFindings(reply)
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

func gitOut(dir string, args ...string) string {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
