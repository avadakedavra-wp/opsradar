package k8s

import (
	"context"
	"fmt"
	"sync"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"

	"github.com/opsradar/k8s-ops-radar/api/internal/github"
)

// --- Data model -----------------------------------------------------------

// DeploymentInfo is a single deployment within a namespace.
type DeploymentInfo struct {
	Name       string           `json:"name"`
	Namespace  string           `json:"namespace"`
	Replicas   int              `json:"replicas"`
	Ready      int              `json:"ready"`
	Images     []string         `json:"images"`
	Manifest   string           `json:"manifest,omitempty"` // cleaned YAML, omitted in radar view
	Usage      MetricsSnapshot  `json:"usage"`
	GitHubRepo *github.RepoInfo `json:"github_repo,omitempty"` // detected GitHub source
	// populated after Bob analysis
	FindingCount int    `json:"finding_count,omitempty"`
	MaxSeverity  string `json:"max_severity,omitempty"` // critical|high|medium|low|ok
}

// NamespaceInfo groups deployments within a namespace.
type NamespaceInfo struct {
	Name        string            `json:"name"`
	Deployments []*DeploymentInfo `json:"deployments"`
}

// ClusterSnapshot is a complete picture of one kubeconfig context.
type ClusterSnapshot struct {
	ContextName string           `json:"context_name"`
	ClusterName string           `json:"cluster_name"`
	Reachable   bool             `json:"reachable"`
	Error       string           `json:"error,omitempty"`
	Namespaces  []*NamespaceInfo `json:"namespaces"`
}

// MetricsSnapshot holds live CPU/memory for a deployment.
type MetricsSnapshot struct {
	CPURequestM  int `json:"cpu_request_m"`
	CPUUsageM    int `json:"cpu_usage_m"`
	MemRequestMi int `json:"mem_request_mi"`
	MemUsageMi   int `json:"mem_usage_mi"`
}

// ScanTarget is a flattened view for Bob analysis.
type ScanTarget struct {
	ContextName    string
	Namespace      string
	Deployment     string
	Manifest       string           // live k8s manifest (cleaned YAML)
	SourceManifest string           // source manifests fetched from GitHub (may be empty)
	GitHubRepo     *github.RepoInfo // detected GitHub source (may be nil)
	Usage          MetricsSnapshot
	Annotations    map[string]string
	Images         []string
}

// --- Manager scan ---------------------------------------------------------

// SnapshotAll scans every context concurrently and returns one ClusterSnapshot per context.
func (m *Manager) SnapshotAll(ctx context.Context) []ClusterSnapshot {
	results := make([]ClusterSnapshot, len(m.Clients))
	var wg sync.WaitGroup
	for i, c := range m.Clients {
		wg.Add(1)
		go func(idx int, client *Client) {
			defer wg.Done()
			results[idx] = client.Snapshot(ctx)
		}(i, c)
	}
	wg.Wait()
	return results
}

// ListScanTargets flattens all contexts into ScanTargets for Bob analysis.
func (m *Manager) ListScanTargets(ctx context.Context, contextFilter, namespaceFilter string) ([]ScanTarget, error) {
	var all []ScanTarget
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, c := range m.Clients {
		if contextFilter != "" && c.ContextName != contextFilter {
			continue
		}
		wg.Add(1)
		go func(client *Client) {
			defer wg.Done()
			targets, err := client.listScanTargets(ctx, namespaceFilter)
			if err != nil {
				return
			}
			mu.Lock()
			all = append(all, targets...)
			mu.Unlock()
		}(c)
	}
	wg.Wait()
	return all, nil
}

// --- Client scan ----------------------------------------------------------

// Snapshot fetches all namespaces and their deployments for this context.
func (c *Client) Snapshot(ctx context.Context) ClusterSnapshot {
	snap := ClusterSnapshot{
		ContextName: c.ContextName,
		ClusterName: c.ClusterName,
	}

	nsList, err := c.kube.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		snap.Error = err.Error()
		return snap
	}
	snap.Reachable = true

	for _, ns := range nsList.Items {
		nsInfo := &NamespaceInfo{Name: ns.Name}
		deployList, err := c.kube.AppsV1().Deployments(ns.Name).List(ctx, metav1.ListOptions{})
		if err != nil {
			continue
		}
		for i := range deployList.Items {
			d := &deployList.Items[i]
			info := deploymentInfo(d)
			info.Usage = c.metricsSnapshot(ctx, d)
			nsInfo.Deployments = append(nsInfo.Deployments, info)
		}
		snap.Namespaces = append(snap.Namespaces, nsInfo)
	}
	return snap
}

func (c *Client) listScanTargets(ctx context.Context, namespace string) ([]ScanTarget, error) {
	deployList, err := c.kube.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list deployments: %w", err)
	}
	targets := make([]ScanTarget, 0, len(deployList.Items))
	for i := range deployList.Items {
		d := &deployList.Items[i]
		manifest, err := cleanManifest(*d)
		if err != nil {
			manifest = fmt.Sprintf("# error serialising manifest: %v", err)
		}
		var images []string
		for _, cont := range d.Spec.Template.Spec.Containers {
			images = append(images, cont.Image)
		}
		targets = append(targets, ScanTarget{
			ContextName: c.ContextName,
			Namespace:   d.Namespace,
			Deployment:  d.Name,
			Manifest:    manifest,
			Usage:       c.metricsSnapshot(ctx, d),
			Annotations: d.Annotations,
			Images:      images,
			GitHubRepo:  github.DetectRepo(d.Annotations, images),
		})
	}
	return targets, nil
}

// --- helpers --------------------------------------------------------------

func deploymentInfo(d *appsv1.Deployment) *DeploymentInfo {
	info := &DeploymentInfo{
		Name:      d.Name,
		Namespace: d.Namespace,
		Replicas:  int(ptrInt32(d.Spec.Replicas)),
		Ready:     int(d.Status.ReadyReplicas),
	}
	for _, c := range d.Spec.Template.Spec.Containers {
		info.Images = append(info.Images, c.Image)
	}
	info.GitHubRepo = github.DetectRepo(d.Annotations, info.Images)
	return info
}

func cleanManifest(d appsv1.Deployment) (string, error) {
	d.ManagedFields = nil
	raw, err := yaml.Marshal(d)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func (c *Client) metricsSnapshot(ctx context.Context, d *appsv1.Deployment) MetricsSnapshot {
	snap := MetricsSnapshot{}
	for _, container := range d.Spec.Template.Spec.Containers {
		if req := container.Resources.Requests; req != nil {
			if cpu, ok := req[corev1.ResourceCPU]; ok {
				snap.CPURequestM += int(cpu.MilliValue())
			}
			if mem, ok := req[corev1.ResourceMemory]; ok {
				snap.MemRequestMi += int(mem.Value() / (1024 * 1024))
			}
		}
	}
	if c.metrics == nil {
		return snap
	}
	podMetrics, err := c.metrics.MetricsV1beta1().PodMetricses(d.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labelSelector(d),
	})
	if err != nil || podMetrics == nil {
		return snap
	}
	for _, pm := range podMetrics.Items {
		for _, cm := range pm.Containers {
			if cpu := cm.Usage[corev1.ResourceCPU]; !cpu.IsZero() {
				snap.CPUUsageM += int(cpu.MilliValue())
			}
			if mem := cm.Usage[corev1.ResourceMemory]; !mem.IsZero() {
				snap.MemUsageMi += int(mem.Value() / (1024 * 1024))
			}
		}
	}
	return snap
}

func labelSelector(d *appsv1.Deployment) string {
	if d.Spec.Selector == nil {
		return ""
	}
	var sel string
	for k, v := range d.Spec.Selector.MatchLabels {
		if sel != "" {
			sel += ","
		}
		sel += k + "=" + v
	}
	return sel
}

func ptrInt32(p *int32) int32 {
	if p == nil {
		return 1
	}
	return *p
}
