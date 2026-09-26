package handlers

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// ── helpers ──────────────────────────────────────────────────────────────────

func opsradarEnvPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".opsradar", ".env")
}

// readEnvFile parses ~/.opsradar/.env → map[KEY]value.
func readEnvFile() map[string]string {
	out := map[string]string{}
	f, err := os.Open(opsradarEnvPath())
	if err != nil {
		return out
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			k := strings.TrimSpace(parts[0])
			v := strings.TrimSpace(parts[1])
			// strip surrounding quotes if present
			if len(v) >= 2 && ((v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'')) {
				v = v[1 : len(v)-1]
			}
			out[k] = v
		}
	}
	return out
}

// writeEnvFile merges updates into ~/.opsradar/.env (creates the file if absent).
func writeEnvFile(updates map[string]string) error {
	path := opsradarEnvPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}

	existing := readEnvFile()
	for k, v := range updates {
		if v == "" {
			delete(existing, k)
		} else {
			existing[k] = v
		}
	}

	var sb strings.Builder
	sb.WriteString("# OpsRadar configuration — managed by the UI, stored only on this machine.\n\n")
	order := []string{
		"ANTHROPIC_API_KEY",
		"GITHUB_CLIENT_ID",
		"GITHUB_CLIENT_SECRET",
		"GITHUB_TOKEN",
		"GITHUB_REPO",
		"OPS_RADAR_API_KEY",
		"KUBECONFIG",
	}
	written := map[string]bool{}
	for _, k := range order {
		if v, ok := existing[k]; ok && v != "" {
			sb.WriteString(fmt.Sprintf("%s=%s\n", k, v))
			written[k] = true
		}
	}
	// any extra keys not in the canonical list
	for k, v := range existing {
		if !written[k] && v != "" {
			sb.WriteString(fmt.Sprintf("%s=%s\n", k, v))
		}
	}

	return os.WriteFile(path, []byte(sb.String()), 0o600)
}

// LoadStoredEnv loads ~/.opsradar/.env into the process environment at startup so
// credentials saved via the Settings UI / GitHub OAuth survive an API restart.
// Without this, saved values only lived in the running process (via os.Setenv on
// save) and were silently lost on every restart — e.g. GITHUB_TOKEN going missing
// so "Create PR" fell back to "set GITHUB_TOKEN". The shell environment wins:
// only keys not already set are populated, so explicit overrides still take effect.
func LoadStoredEnv() int {
	loaded := 0
	for k, v := range readEnvFile() {
		if v != "" && os.Getenv(k) == "" {
			os.Setenv(k, v)
			loaded++
		}
	}
	return loaded
}

// maskValue returns "•••••••••<last4>" for sensitive strings, full value otherwise.
func maskValue(v string) string {
	if len(v) <= 4 {
		return strings.Repeat("•", len(v))
	}
	return strings.Repeat("•", 6) + v[len(v)-4:]
}

// ── SettingEntry is what we send to the frontend ─────────────────────────────

type SettingEntry struct {
	Configured bool   `json:"configured"`
	Preview    string `json:"preview"`  // masked for sensitive keys
	Value      string `json:"value"`    // full value for non-sensitive keys
	Sensitive  bool   `json:"sensitive"` // tells the UI to use password inputs
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// GetSettings handles GET /settings
func GetSettings(c *fiber.Ctx) error {
	env := readEnvFile()

	sensitive := map[string]bool{
		"ANTHROPIC_API_KEY":   true,
		"GITHUB_CLIENT_SECRET": true,
		"GITHUB_TOKEN":        true,
		"OPS_RADAR_API_KEY":   true,
	}

	keys := []string{"ANTHROPIC_API_KEY", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_TOKEN", "GITHUB_REPO", "OPS_RADAR_API_KEY", "KUBECONFIG"}
	result := map[string]SettingEntry{}
	for _, k := range keys {
		v := env[k]
		e := SettingEntry{
			Configured: v != "",
			Sensitive:  sensitive[k],
		}
		if sensitive[k] {
			e.Preview = maskValue(v)
		} else {
			e.Value = v
		}
		result[k] = e
	}

	return c.JSON(fiber.Map{"settings": result})
}

// SaveSettings handles POST /settings
// Body: { "ANTHROPIC_API_KEY": "sk-ant-...", "GITHUB_TOKEN": "ghp_..." }
// Pass an empty string to remove a key.
func SaveSettings(c *fiber.Ctx) error {
	var updates map[string]string
	if err := c.BodyParser(&updates); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	// whitelist: only let the UI set known keys
	allowed := map[string]bool{
		"ANTHROPIC_API_KEY":    true,
		"GITHUB_CLIENT_ID":     true,
		"GITHUB_CLIENT_SECRET": true,
		"GITHUB_TOKEN":         true,
		"GITHUB_REPO":          true,
		"OPS_RADAR_API_KEY":    true,
		"KUBECONFIG":           true,
	}
	clean := map[string]string{}
	for k, v := range updates {
		if allowed[k] {
			clean[k] = strings.TrimSpace(v)
		}
	}
	if err := writeEnvFile(clean); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	// Reload into the current process so changes take effect without restart
	for k, v := range clean {
		if v == "" {
			os.Unsetenv(k)
		} else {
			os.Setenv(k, v)
		}
	}

	return c.JSON(fiber.Map{"ok": true})
}

// TestSetting handles POST /settings/test
// Body: { "key": "ANTHROPIC_API_KEY", "value": "sk-ant-..." }
func TestSetting(c *fiber.Ctx) error {
	var req struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if err := c.BodyParser(&req); err != nil || req.Key == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "key required"})
	}

	val := strings.TrimSpace(req.Value)
	if val == "" {
		// try the saved value
		env := readEnvFile()
		val = env[req.Key]
	}
	if val == "" {
		return c.JSON(fiber.Map{"ok": false, "message": "No value to test — save a value first."})
	}

	ctx, cancel := context.WithTimeout(c.Context(), 15*time.Second)
	defer cancel()

	switch req.Key {
	case "ANTHROPIC_API_KEY":
		ok, msg := testAnthropic(ctx, val)
		return c.JSON(fiber.Map{"ok": ok, "message": msg})
	case "GITHUB_TOKEN":
		ok, msg := testGitHubToken(ctx, val)
		return c.JSON(fiber.Map{"ok": ok, "message": msg})
	case "GITHUB_REPO":
		token := val
		env := readEnvFile()
		if t := env["GITHUB_TOKEN"]; t != "" {
			token = t
		}
		ok, msg := testGitHubRepo(ctx, token, val)
		return c.JSON(fiber.Map{"ok": ok, "message": msg})
	default:
		return c.JSON(fiber.Map{"ok": true, "message": "Saved — no automated test for this key."})
	}
}

func testAnthropic(ctx context.Context, key string) (bool, string) {
	payload := map[string]interface{}{
		"model":      "claude-haiku-4-5-20251001",
		"max_tokens": 10,
		"messages": []map[string]string{
			{"role": "user", "content": "reply with ok"},
		},
	}
	data, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.anthropic.com/v1/messages", strings.NewReader(string(data)))
	if err != nil {
		return false, err.Error()
	}
	req.Header.Set("x-api-key", key)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("content-type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, "Could not reach Anthropic API: " + err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 {
		return false, "Invalid API key — check that it starts with sk-ant-"
	}
	if resp.StatusCode >= 400 {
		return false, fmt.Sprintf("Anthropic API returned %d", resp.StatusCode)
	}
	return true, "Connected to Claude API"
}

func testGitHubToken(ctx context.Context, token string) (bool, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/user", nil)
	if err != nil {
		return false, err.Error()
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, "Could not reach GitHub API: " + err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 {
		return false, "Invalid token — check scopes (needs repo, workflow)"
	}
	var user struct {
		Login string `json:"login"`
	}
	json.NewDecoder(resp.Body).Decode(&user) //nolint:errcheck
	if user.Login != "" {
		return true, "Connected as @" + user.Login
	}
	return true, "GitHub token valid"
}

func testGitHubRepo(ctx context.Context, token, slug string) (bool, string) {
	if slug == "" {
		return false, "No repo set — format: owner/repo"
	}
	if !strings.Contains(slug, "/") {
		return false, "Format must be owner/repo"
	}
	url := fmt.Sprintf("https://api.github.com/repos/%s", slug)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, err.Error()
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, "Could not reach GitHub API: " + err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return false, fmt.Sprintf("Repo %q not found or no access", slug)
	}
	if resp.StatusCode >= 400 {
		return false, fmt.Sprintf("GitHub API %d", resp.StatusCode)
	}
	return true, fmt.Sprintf("Repo %s is accessible", slug)
}
