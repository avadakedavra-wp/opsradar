// Package github detects the GitHub repository for a Kubernetes deployment
// and fetches its source manifests for Bob analysis.
//
// Detection order (first match wins):
//  1. Annotation: "github.com/repo"         (e.g. "myorg/myapp")
//  2. Annotation: "app.kubernetes.io/source-repo"
//  3. Annotation: "gitops.source.url"       (full HTTPS URL)
//  4. Container image host: ghcr.io/<org>/<repo>:...
//  5. Container image host: docker.io/<org>/<repo>:... (if org matches known GitHub orgs)
//
// Once a repo slug is known the GitHub API is used to:
//   - list files matching common k8s manifest patterns
//   - fetch and concatenate their raw content
package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// RepoInfo holds the detected GitHub repository for a deployment.
type RepoInfo struct {
	Owner   string // GitHub org/user
	Repo    string // repository name
	Slug    string // "owner/repo"
	FullURL string // https://github.com/owner/repo
	Source  string // how it was detected: "annotation", "image"
}

// ManifestResult holds fetched source manifests.
type ManifestResult struct {
	Repo     RepoInfo
	Files    []ManifestFile
	Combined string // all files concatenated, ready for Bob
}

// ManifestFile is one file fetched from GitHub.
type ManifestFile struct {
	Path    string
	Content string
}

// Detector detects GitHub repos from deployment metadata.
type Detector struct {
	token  string
	client *http.Client
}

// NewDetector creates a Detector. token is optional but required for private repos
// and to avoid rate limits.
func NewDetector(token string) *Detector {
	return &Detector{
		token:  token,
		client: &http.Client{Timeout: 15 * time.Second},
	}
}

// --- Annotation / image keys to check -------------------------------------

var repoAnnotations = []string{
	"github.com/repo",
	"app.kubernetes.io/source-repo",
	"gitops.source.url",
	"flux.weave.works/repo",
	"argocd.argoproj.io/app-source-repo",
}

// ghcrImageRe matches ghcr.io/owner/repo:tag
var ghcrImageRe = regexp.MustCompile(`^ghcr\.io/([^/]+)/([^/:]+)`)

// ghDockerHubRe matches docker.io/owner/repo:tag  (two-segment only)
var ghDockerHubRe = regexp.MustCompile(`^(?:docker\.io/)?([a-z0-9_.-]+)/([a-z0-9_.-]+)(?:[:@]|$)`)

// DetectRepo inspects annotations and container images to find the GitHub repo.
// Returns nil if no repo can be detected.
func DetectRepo(annotations map[string]string, images []string) *RepoInfo {
	// 1. Explicit annotations
	for _, key := range repoAnnotations {
		if val, ok := annotations[key]; ok && val != "" {
			slug := normaliseSlug(val)
			if slug != "" {
				return &RepoInfo{
					Slug:    slug,
					Owner:   strings.SplitN(slug, "/", 2)[0],
					Repo:    strings.SplitN(slug, "/", 2)[1],
					FullURL: "https://github.com/" + slug,
					Source:  "annotation:" + key,
				}
			}
		}
	}

	// 2. Container images
	for _, img := range images {
		if m := ghcrImageRe.FindStringSubmatch(img); m != nil {
			slug := m[1] + "/" + m[2]
			return &RepoInfo{
				Slug:    slug,
				Owner:   m[1],
				Repo:    m[2],
				FullURL: "https://github.com/" + slug,
				Source:  "image:ghcr",
			}
		}
	}

	return nil
}

// normaliseSlug turns a variety of inputs into "owner/repo".
// Accepts: "owner/repo", "https://github.com/owner/repo", "github.com/owner/repo"
func normaliseSlug(raw string) string {
	raw = strings.TrimSpace(raw)
	for _, prefix := range []string{
		"https://github.com/",
		"http://github.com/",
		"github.com/",
		"git@github.com:",
	} {
		if strings.HasPrefix(raw, prefix) {
			raw = strings.TrimPrefix(raw, prefix)
			break
		}
	}
	raw = strings.TrimSuffix(raw, ".git")
	parts := strings.Split(raw, "/")
	if len(parts) < 2 {
		return ""
	}
	return parts[0] + "/" + parts[1]
}

// --- GitHub manifest fetching ---------------------------------------------

// k8s manifest path patterns (matched by suffix or directory name)
var manifestPathPatterns = []string{
	"deploy/", "k8s/", "kubernetes/", "manifests/", "config/",
	"charts/", "helm/", ".helm/",
	"deployment.yaml", "deployment.yml",
	"k8s.yaml", "k8s.yml",
}

// FetchManifests fetches Kubernetes manifest files from the default branch of the repo.
func (d *Detector) FetchManifests(ctx context.Context, repo RepoInfo) (*ManifestResult, error) {
	// Get default branch
	defaultBranch, err := d.defaultBranch(ctx, repo.Slug)
	if err != nil {
		return nil, fmt.Errorf("get default branch for %s: %w", repo.Slug, err)
	}

	// Get the recursive tree
	files, err := d.findManifestFiles(ctx, repo.Slug, defaultBranch)
	if err != nil {
		return nil, fmt.Errorf("find manifest files in %s: %w", repo.Slug, err)
	}
	if len(files) == 0 {
		return &ManifestResult{Repo: repo}, nil
	}

	// Fetch content of each file (cap at 20 files, 200 KB total)
	result := &ManifestResult{Repo: repo}
	var totalBytes int
	for _, path := range files {
		if len(result.Files) >= 20 || totalBytes >= 200*1024 {
			break
		}
		content, err := d.rawFile(ctx, repo.Slug, defaultBranch, path)
		if err != nil {
			continue
		}
		result.Files = append(result.Files, ManifestFile{Path: path, Content: content})
		totalBytes += len(content)
	}

	// Combine all files with path headers
	var sb strings.Builder
	for _, f := range result.Files {
		sb.WriteString("# --- " + f.Path + " ---\n")
		sb.WriteString(f.Content)
		sb.WriteString("\n\n")
	}
	result.Combined = sb.String()
	return result, nil
}

func (d *Detector) defaultBranch(ctx context.Context, slug string) (string, error) {
	body, err := d.get(ctx, "https://api.github.com/repos/"+slug)
	if err != nil {
		return "main", nil // best-effort fallback
	}
	var repo struct {
		DefaultBranch string `json:"default_branch"`
	}
	if err := json.Unmarshal(body, &repo); err != nil || repo.DefaultBranch == "" {
		return "main", nil
	}
	return repo.DefaultBranch, nil
}

func (d *Detector) findManifestFiles(ctx context.Context, slug, branch string) ([]string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/git/trees/%s?recursive=1", slug, branch)
	body, err := d.get(ctx, url)
	if err != nil {
		return nil, err
	}

	var tree struct {
		Tree []struct {
			Path string `json:"path"`
			Type string `json:"type"`
		} `json:"tree"`
	}
	if err := json.Unmarshal(body, &tree); err != nil {
		return nil, err
	}

	var matches []string
	for _, node := range tree.Tree {
		if node.Type != "blob" {
			continue
		}
		if isManifestPath(node.Path) {
			matches = append(matches, node.Path)
		}
	}
	return matches, nil
}

func (d *Detector) rawFile(ctx context.Context, slug, branch, path string) (string, error) {
	url := fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s", slug, branch, path)
	body, err := d.get(ctx, url)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func (d *Detector) get(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if d.token != "" {
		req.Header.Set("Authorization", "Bearer "+d.token)
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("github %s: HTTP %d", url, resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

func isManifestPath(path string) bool {
	lower := strings.ToLower(path)
	if !strings.HasSuffix(lower, ".yaml") && !strings.HasSuffix(lower, ".yml") {
		return false
	}
	for _, pat := range manifestPathPatterns {
		if strings.Contains(lower, pat) {
			return true
		}
	}
	// also match any file that looks like a k8s manifest by name
	base := lower
	if idx := strings.LastIndex(lower, "/"); idx >= 0 {
		base = lower[idx+1:]
	}
	k8sNames := []string{
		"deployment", "service", "ingress", "configmap", "statefulset",
		"daemonset", "cronjob", "job", "hpa", "pvc", "k8s", "kustomize",
	}
	for _, name := range k8sNames {
		if strings.Contains(base, name) {
			return true
		}
	}
	return false
}
