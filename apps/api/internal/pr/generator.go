package pr

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/opsradar/k8s-ops-radar/api/internal/store"
)

// Generator creates GitHub PRs with fix patches.
type Generator struct {
	token  string
	repo   string // "owner/repo"
	client *http.Client
}

// NewGenerator creates a PR Generator.
func NewGenerator(token, repo string) *Generator {
	return &Generator{
		token:  token,
		repo:   repo,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

// GeneratePR creates a branch with the finding's diff patch and opens a PR.
// Returns the HTML URL of the created PR.
//
// NOTE on what this actually does today: it commits the raw unified diff as
// a new file under patches/opsradar-fix-<id>.patch — it does NOT apply the
// patch to the target manifest in the repo. The PR is a proposal for a human
// to review and apply, not an auto-fix. Idempotent: calling this twice for
// the same finding reuses the existing branch/file/PR instead of failing.
func (g *Generator) GeneratePR(ctx context.Context, f store.Finding) (string, error) {
	if g.token == "" || g.repo == "" {
		return "", fmt.Errorf("GITHUB_TOKEN and GITHUB_REPO must be set")
	}

	// 1. Get default branch SHA
	defaultBranch, sha, err := g.getDefaultBranchSHA(ctx)
	if err != nil {
		return "", fmt.Errorf("get default branch: %w", err)
	}

	// 2. Create branch (idempotent: reuse it if a previous call already
	// created it for this finding, instead of hard-failing on the second call)
	branchName := fmt.Sprintf("opsradar/fix-%s", shortID(f.ID))
	if err := g.createBranch(ctx, branchName, sha); err != nil && !isRefAlreadyExists(err) {
		return "", fmt.Errorf("create branch: %w", err)
	}

	// 3. Commit the patch as a file
	commitMsg := fmt.Sprintf("fix: %s", f.Title)
	if err := g.commitPatch(ctx, branchName, f, commitMsg); err != nil {
		return "", fmt.Errorf("commit patch: %w", err)
	}

	// 4. Open PR
	prURL, err := g.openPR(ctx, branchName, defaultBranch, f)
	if err != nil {
		return "", fmt.Errorf("open pr: %w", err)
	}
	return prURL, nil
}

func (g *Generator) getDefaultBranchSHA(ctx context.Context) (branch, sha string, err error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s", g.repo)
	body, err := g.githubGET(ctx, url)
	if err != nil {
		return "", "", err
	}
	var repo struct {
		DefaultBranch string `json:"default_branch"`
	}
	if err := json.Unmarshal(body, &repo); err != nil {
		return "", "", err
	}

	refURL := fmt.Sprintf("https://api.github.com/repos/%s/git/refs/heads/%s", g.repo, repo.DefaultBranch)
	refBody, err := g.githubGET(ctx, refURL)
	if err != nil {
		return "", "", err
	}
	var ref struct {
		Object struct {
			SHA string `json:"sha"`
		} `json:"object"`
	}
	if err := json.Unmarshal(refBody, &ref); err != nil {
		return "", "", err
	}
	return repo.DefaultBranch, ref.Object.SHA, nil
}

func (g *Generator) createBranch(ctx context.Context, name, sha string) error {
	url := fmt.Sprintf("https://api.github.com/repos/%s/git/refs", g.repo)
	payload := map[string]string{
		"ref": "refs/heads/" + name,
		"sha": sha,
	}
	_, err := g.githubPOST(ctx, url, payload)
	return err
}

func (g *Generator) commitPatch(ctx context.Context, branch string, f store.Finding, message string) error {
	// Encode the patch as a new file
	fileName := fmt.Sprintf("patches/opsradar-fix-%s.patch", shortID(f.ID))
	contentB64 := base64.StdEncoding.EncodeToString([]byte(f.DiffPatch))

	url := fmt.Sprintf("https://api.github.com/repos/%s/contents/%s", g.repo, fileName)
	payload := map[string]string{
		"message": message,
		"content": contentB64,
		"branch":  branch,
	}
	// If this file already exists on the branch (a retry of a previous call),
	// GitHub requires the existing blob's sha to overwrite it — otherwise it
	// 422s instead of just updating the content in place.
	if sha, err := g.existingFileSHA(ctx, fileName, branch); err == nil && sha != "" {
		payload["sha"] = sha
	}
	_, err := g.githubPOST(ctx, url, payload)
	return err
}

// existingFileSHA looks up the blob sha of a file already committed on a
// branch. A non-nil error (including "not found") just means "no existing
// file" to the caller — this is a best-effort lookup, not a hard dependency.
func (g *Generator) existingFileSHA(ctx context.Context, path, branch string) (string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/contents/%s?ref=%s", g.repo, path, branch)
	body, err := g.githubGET(ctx, url)
	if err != nil {
		return "", err
	}
	var file struct {
		SHA string `json:"sha"`
	}
	if err := json.Unmarshal(body, &file); err != nil {
		return "", err
	}
	return file.SHA, nil
}

func (g *Generator) openPR(ctx context.Context, head, base string, f store.Finding) (string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/pulls", g.repo)
	payload := map[string]string{
		"title": fmt.Sprintf("OpsRadar fix: %s", f.Title),
		"head":  head,
		"base":  base,
		"body":  fmt.Sprintf("**Finding:** %s\n\n**Detail:** %s\n\n**Suggestion:** %s\n\n---\n*Generated by OpsRadar*", f.Title, f.Detail, f.Suggestion),
	}
	body, err := g.githubPOST(ctx, url, payload)
	if err != nil {
		// A second GeneratePR call for the same finding will hit "A pull
		// request already exists" — look it up and return its URL instead
		// of failing, so retries are idempotent rather than erroring.
		if existingURL, findErr := g.findExistingPR(ctx, head); findErr == nil && existingURL != "" {
			return existingURL, nil
		}
		return "", err
	}
	var pr struct {
		HTMLURL string `json:"html_url"`
	}
	if err := json.Unmarshal(body, &pr); err != nil {
		return "", err
	}
	return pr.HTMLURL, nil
}

func (g *Generator) findExistingPR(ctx context.Context, head string) (string, error) {
	owner := strings.SplitN(g.repo, "/", 2)[0]
	url := fmt.Sprintf("https://api.github.com/repos/%s/pulls?head=%s:%s&state=all", g.repo, owner, head)
	body, err := g.githubGET(ctx, url)
	if err != nil {
		return "", err
	}
	var prs []struct {
		HTMLURL string `json:"html_url"`
	}
	if err := json.Unmarshal(body, &prs); err != nil {
		return "", err
	}
	if len(prs) == 0 {
		return "", fmt.Errorf("no existing PR found for head %s", head)
	}
	return prs[0].HTMLURL, nil
}

// shortID returns a short, branch/filename-safe prefix of a finding ID.
// Finding IDs are always uuid.New().String() today (36 chars) so this never
// takes the fallback branch, but a raw f.ID[:8] slice would panic outright if
// that ever changed — this can't.
func shortID(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}

// isRefAlreadyExists reports whether err is GitHub's response to creating a
// branch ref that's already there (a retried GeneratePR call).
func isRefAlreadyExists(err error) bool {
	return err != nil && strings.Contains(err.Error(), "Reference already exists")
}

func (g *Generator) githubGET(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	g.setHeaders(req)
	resp, err := g.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return readBody(resp)
}

func (g *Generator) githubPOST(ctx context.Context, url string, payload any) ([]byte, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, strings.NewReader(string(data)))
	if err != nil {
		return nil, err
	}
	// Use POST for refs/pulls, PUT for contents
	if strings.Contains(url, "/pulls") || strings.Contains(url, "/refs") {
		req.Method = http.MethodPost
	}
	g.setHeaders(req)
	resp, err := g.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return readBody(resp)
}

func (g *Generator) setHeaders(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+g.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
}

func readBody(resp *http.Response) ([]byte, error) {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("github API %d: %s", resp.StatusCode, body)
	}
	return body, nil
}
