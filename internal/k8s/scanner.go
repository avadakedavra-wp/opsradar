package k8s

import (
	"context"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"
)

// MetricsSnapshot holds live CPU/memory usage for a deployment.
type MetricsSnapshot struct {
	CPURequestM   int // millicores from spec
	CPUUsageM     int // millicores live (0 if metrics-server unavailable)
	MemRequestMi  int // MiB from spec
	MemUsageMi    int // MiB live (0 if metrics-server unavailable)
}

// ScanTarget represents a single deployment ready for Bob analysis.
type ScanTarget struct {
	Namespace  string
	Deployment string
	Manifest   string // cleaned YAML (no managedFields)
	Usage      MetricsSnapshot
}

// ListScanTargets returns one ScanTarget per Deployment in the given namespace (all namespaces if "").
func (c *Client) ListScanTargets(ctx context.Context, namespace string) ([]ScanTarget, error) {
	deployList, err := c.kube.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list deployments: %w", err)
	}

	targets := make([]ScanTarget, 0, len(deployList.Items))
	for _, d := range deployList.Items {
		manifest, err := cleanManifest(d)
		if err != nil {
			manifest = fmt.Sprintf("# error serialising manifest: %v", err)
		}
		target := ScanTarget{
			Namespace:  d.Namespace,
			Deployment: d.Name,
			Manifest:   manifest,
			Usage:      c.metricsSnapshot(ctx, d),
		}
		targets = append(targets, target)
	}
	return targets, nil
}

// cleanManifest serialises a Deployment to YAML after stripping managedFields.
func cleanManifest(d appsv1.Deployment) (string, error) {
	d.ManagedFields = nil
	raw, err := yaml.Marshal(d)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// metricsSnapshot fetches live pod metrics and aggregates to deployment level.
// Returns zero-valued snapshot if metrics-server is unavailable.
func (c *Client) metricsSnapshot(ctx context.Context, d appsv1.Deployment) MetricsSnapshot {
	snap := MetricsSnapshot{}

	// Pull spec requests
	for _, container := range d.Spec.Template.Spec.Containers {
		if req := container.Resources.Requests; req != nil {
			if cpu, ok := req["cpu"]; ok {
				snap.CPURequestM += int(cpu.MilliValue())
			}
			if mem, ok := req["memory"]; ok {
				snap.MemRequestMi += int(mem.Value() / (1024 * 1024))
			}
		}
	}

	if c.metrics == nil {
		return snap
	}

	// Pull live pod metrics
	podMetrics, err := c.metrics.MetricsV1beta1().PodMetricses(d.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labelSelector(d),
	})
	if err != nil || podMetrics == nil {
		return snap
	}

	for _, pm := range podMetrics.Items {
		for _, cm := range pm.Containers {
			if cpu := cm.Usage["cpu"]; !cpu.IsZero() {
				snap.CPUUsageM += int(cpu.MilliValue())
			}
			if mem := cm.Usage["memory"]; !mem.IsZero() {
				snap.MemUsageMi += int(mem.Value() / (1024 * 1024))
			}
		}
	}
	return snap
}

// labelSelector builds a simple selector string from the Deployment's pod template labels.
func labelSelector(d appsv1.Deployment) string {
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
