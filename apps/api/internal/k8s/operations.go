package k8s

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/restmapper"
	"sigs.k8s.io/yaml"
)

// PodInfo is a lightweight pod summary for the cluster browser.
type PodInfo struct {
	Name        string   `json:"name"`
	Namespace   string   `json:"namespace"`
	ContextName string   `json:"context_name"`
	Phase       string   `json:"phase"`
	Ready       bool     `json:"ready"`
	Restarts    int32    `json:"restarts"`
	NodeName    string   `json:"node_name"`
	Images      []string `json:"images"`
	Containers  []string `json:"containers"`
	CreatedAt   string   `json:"created_at"`
}

// HAFinding is a high-availability issue found in a deployment.
type HAFinding struct {
	Namespace   string `json:"namespace"`
	Deployment  string `json:"deployment"`
	Issue       string `json:"issue"`
	Detail      string `json:"detail"`
	Severity    string `json:"severity"`
}

// ClientForContext returns the first Client matching contextName.
// An empty contextName returns the first available client.
func (m *Manager) ClientForContext(contextName string) (*Client, error) {
	for _, c := range m.Clients {
		if contextName == "" || c.ContextName == contextName {
			return c, nil
		}
	}
	return nil, fmt.Errorf("kubeconfig context %q not found", contextName)
}

// ListPods returns all pods in the given namespace (or all namespaces if empty).
func (c *Client) ListPods(ctx context.Context, namespace string) ([]PodInfo, error) {
	list, err := c.kube.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	pods := make([]PodInfo, 0, len(list.Items))
	for _, p := range list.Items {
		pods = append(pods, podInfo(&p, c.ContextName))
	}
	return pods, nil
}

func podInfo(p *corev1.Pod, contextName string) PodInfo {
	images := make([]string, 0, len(p.Spec.Containers))
	containers := make([]string, 0, len(p.Spec.Containers))
	var restarts int32
	for _, c := range p.Spec.Containers {
		images = append(images, c.Image)
		containers = append(containers, c.Name)
	}
	for _, cs := range p.Status.ContainerStatuses {
		restarts += cs.RestartCount
	}
	ready := false
	for _, cond := range p.Status.Conditions {
		if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
			ready = true
		}
	}
	created := ""
	if p.CreationTimestamp.Time != (time.Time{}) {
		created = p.CreationTimestamp.Time.UTC().Format(time.RFC3339)
	}
	return PodInfo{
		Name:        p.Name,
		Namespace:   p.Namespace,
		ContextName: contextName,
		Phase:       string(p.Status.Phase),
		Ready:       ready,
		Restarts:    restarts,
		NodeName:    p.Spec.NodeName,
		Images:      images,
		Containers:  containers,
		CreatedAt:   created,
	}
}

// GetPodLogs returns the last `lines` lines of logs for a pod/container.
func (c *Client) GetPodLogs(ctx context.Context, namespace, pod, container string, lines int64) (string, error) {
	opts := &corev1.PodLogOptions{TailLines: &lines}
	if container != "" {
		opts.Container = container
	}
	req := c.kube.CoreV1().Pods(namespace).GetLogs(pod, opts)
	rc, err := req.Stream(ctx)
	if err != nil {
		return "", err
	}
	defer rc.Close()
	var buf bytes.Buffer
	scanner := bufio.NewScanner(rc)
	for scanner.Scan() {
		buf.WriteString(scanner.Text())
		buf.WriteByte('\n')
	}
	return buf.String(), scanner.Err()
}

// RestartDeployment patches the pod template annotation to trigger a rollout.
func (c *Client) RestartDeployment(ctx context.Context, namespace, deployment string) error {
	patch := fmt.Sprintf(`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		time.Now().UTC().Format(time.RFC3339))
	_, err := c.kube.AppsV1().Deployments(namespace).Patch(ctx, deployment, types.MergePatchType, []byte(patch), metav1.PatchOptions{})
	return err
}

// ScaleDeployment sets the replica count on a deployment.
func (c *Client) ScaleDeployment(ctx context.Context, namespace, deployment string, replicas int32) error {
	scale, err := c.kube.AppsV1().Deployments(namespace).GetScale(ctx, deployment, metav1.GetOptions{})
	if err != nil {
		return err
	}
	scale.Spec.Replicas = replicas
	_, err = c.kube.AppsV1().Deployments(namespace).UpdateScale(ctx, deployment, scale, metav1.UpdateOptions{})
	return err
}

// DeletePod removes a pod (k8s will recreate it via the ReplicaSet controller).
func (c *Client) DeletePod(ctx context.Context, namespace, pod string) error {
	return c.kube.CoreV1().Pods(namespace).Delete(ctx, pod, metav1.DeleteOptions{})
}

// ApplyYAML applies a full Kubernetes YAML manifest using server-side apply.
func (c *Client) ApplyYAML(ctx context.Context, yamlDoc string) error {
	dyn, err := dynamic.NewForConfig(c.restCfg)
	if err != nil {
		return fmt.Errorf("dynamic client: %w", err)
	}

	// Map GVK → GVR using the server's API groups.
	gr, err := restmapper.GetAPIGroupResources(c.kube.Discovery())
	if err != nil {
		return fmt.Errorf("discover api groups: %w", err)
	}
	mapper := restmapper.NewDiscoveryRESTMapper(gr)

	jsonBytes, err := yaml.YAMLToJSON([]byte(yamlDoc))
	if err != nil {
		return fmt.Errorf("yaml→json: %w", err)
	}

	var obj unstructured.Unstructured
	if err := obj.UnmarshalJSON(jsonBytes); err != nil {
		return fmt.Errorf("unmarshal: %w", err)
	}

	gvk := schema.FromAPIVersionAndKind(obj.GetAPIVersion(), obj.GetKind())
	mapping, err := mapper.RESTMapping(gvk.GroupKind(), gvk.Version)
	if err != nil {
		return fmt.Errorf("rest mapping for %s: %w", gvk.Kind, err)
	}

	var ri dynamic.ResourceInterface
	if mapping.Scope.Name() == meta.RESTScopeNameNamespace {
		ns := obj.GetNamespace()
		if ns == "" {
			ns = "default"
		}
		ri = dyn.Resource(mapping.Resource).Namespace(ns)
	} else {
		ri = dyn.Resource(mapping.Resource)
	}

	data, _ := json.Marshal(obj.Object)
	_, err = ri.Apply(ctx, obj.GetName(), &obj, metav1.ApplyOptions{
		FieldManager: "opsradar",
		Force:        true,
	})
	_ = data
	return err
}

// ApplyPatch detects the diff_patch format and applies it appropriately:
//   - Full manifest (has apiVersion+kind)   → ApplyYAML directly
//   - Unified diff (starts with --- or @@)  → apply diff to live manifest then ApplyYAML
//   - Partial JSON/YAML fragment            → strategic merge patch onto the live deployment
func (c *Client) ApplyPatch(ctx context.Context, namespace, deployment, diffPatch string) error {
	patch := strings.TrimSpace(diffPatch)

	// Case 1: patch is a full Kubernetes manifest.
	if looksLikeFullManifest(patch) {
		return c.ApplyYAML(ctx, patch)
	}

	// For cases 2 and 3 we need the live deployment.
	dep, err := c.kube.AppsV1().Deployments(namespace).Get(ctx, deployment, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("get deployment: %w", err)
	}
	dep.ManagedFields = nil
	dep.ResourceVersion = ""
	dep.APIVersion = "apps/v1"
	dep.Kind = "Deployment"

	// Case 2: unified diff.
	if strings.HasPrefix(patch, "---") || strings.Contains(patch, "\n@@") {
		raw, err := yaml.Marshal(dep)
		if err != nil {
			return fmt.Errorf("marshal deployment: %w", err)
		}
		patched, err := applyUnifiedDiff(string(raw), patch)
		if err != nil {
			return fmt.Errorf("apply diff: %w", err)
		}
		return c.ApplyYAML(ctx, patched)
	}

	// Case 3: partial JSON/YAML fragment — build a strategic merge patch.
	mergePatch, err := buildFragmentPatch(patch, dep.Spec.Template.Spec.Containers)
	if err != nil {
		return fmt.Errorf("build merge patch: %w", err)
	}
	_, err = c.kube.AppsV1().Deployments(namespace).Patch(
		ctx, deployment, types.StrategicMergePatchType, mergePatch,
		metav1.PatchOptions{FieldManager: "opsradar"},
	)
	return err
}

// looksLikeFullManifest returns true when the patch string contains both apiVersion and kind.
func looksLikeFullManifest(s string) bool {
	lower := strings.ToLower(s)
	return strings.Contains(lower, "apiversion") && strings.Contains(lower, "kind")
}

// GetHAAnalysis scans all deployments across all namespaces for HA issues.
func (c *Client) GetHAAnalysis(ctx context.Context) ([]HAFinding, error) {
	nsList, err := c.kube.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	var findings []HAFinding
	for _, ns := range nsList.Items {
		depList, err := c.kube.AppsV1().Deployments(ns.Name).List(ctx, metav1.ListOptions{})
		if err != nil {
			continue
		}

		// Fetch all PDBs in this namespace once.
		pdbList, _ := c.kube.PolicyV1().PodDisruptionBudgets(ns.Name).List(ctx, metav1.ListOptions{})
		pdbTargets := map[string]bool{}
		if pdbList != nil {
			for _, pdb := range pdbList.Items {
				if pdb.Spec.Selector != nil {
					for _, dep := range depList.Items {
						if labelsMatch(dep.Spec.Selector.MatchLabels, pdb.Spec.Selector.MatchLabels) {
							pdbTargets[dep.Name] = true
						}
					}
				}
			}
		}

		for _, dep := range depList.Items {
			replicas := int32(1)
			if dep.Spec.Replicas != nil {
				replicas = *dep.Spec.Replicas
			}

			if replicas < 2 {
				findings = append(findings, HAFinding{
					Namespace:  ns.Name,
					Deployment: dep.Name,
					Issue:      "Single replica",
					Detail:     "Running with 1 replica — any pod eviction or node failure will cause downtime.",
					Severity:   "high",
				})
			}

			if !pdbTargets[dep.Name] && replicas >= 2 {
				findings = append(findings, HAFinding{
					Namespace:  ns.Name,
					Deployment: dep.Name,
					Issue:      "No PodDisruptionBudget",
					Detail:     "No PDB protects this deployment during voluntary disruptions (node drains, rolling upgrades).",
					Severity:   "medium",
				})
			}

			if dep.Spec.Template.Spec.Affinity == nil ||
				dep.Spec.Template.Spec.Affinity.PodAntiAffinity == nil {
				if replicas >= 2 {
					findings = append(findings, HAFinding{
						Namespace:  ns.Name,
						Deployment: dep.Name,
						Issue:      "No pod anti-affinity",
						Detail:     "Pods may be scheduled on the same node. A single node failure could take down all replicas.",
						Severity:   "low",
					})
				}
			}
		}
	}
	return findings, nil
}

// labelsMatch checks if all selector labels exist in podLabels.
func labelsMatch(podLabels, selector map[string]string) bool {
	for k, v := range selector {
		if podLabels[k] != v {
			return false
		}
	}
	return true
}

// applyUnifiedDiff applies a simplified unified diff to original text.
// buildFragmentPatch wraps a partial JSON/YAML fragment into a strategic merge
// patch for a Deployment. Fragments that have container-level keys (resources,
// env, livenessProbe, readinessProbe, command, args) are nested under the first
// container by name. Fragments with "spec" at root are used as-is.
func buildFragmentPatch(fragment string, containers []corev1.Container) ([]byte, error) {
	fragJSON, err := yaml.YAMLToJSON([]byte(fragment))
	if err != nil {
		return nil, fmt.Errorf("parse fragment: %w", err)
	}
	var frag map[string]interface{}
	if err := json.Unmarshal(fragJSON, &frag); err != nil {
		return nil, fmt.Errorf("unmarshal fragment: %w", err)
	}

	// Already a Deployment-level patch.
	if _, ok := frag["spec"]; ok {
		return fragJSON, nil
	}
	if _, ok := frag["metadata"]; ok {
		return fragJSON, nil
	}

	// Container-level keys: wrap under spec.template.spec.containers[name].
	firstName := ""
	if len(containers) > 0 {
		firstName = containers[0].Name
	}
	containerFrag := map[string]interface{}{"name": firstName}
	for k, v := range frag {
		containerFrag[k] = v
	}
	patch := map[string]interface{}{
		"spec": map[string]interface{}{
			"template": map[string]interface{}{
				"spec": map[string]interface{}{
					"containers": []interface{}{containerFrag},
				},
			},
		},
	}
	return json.Marshal(patch)
}

func applyUnifiedDiff(original, diff string) (string, error) {
	if strings.TrimSpace(diff) == "" {
		return original, nil
	}
	origLines := strings.Split(original, "\n")
	result := make([]string, 0, len(origLines))
	diffLines := strings.Split(diff, "\n")

	origIdx := 0
	i := 0
	for i < len(diffLines) {
		line := diffLines[i]

		if strings.HasPrefix(line, "---") || strings.HasPrefix(line, "+++") {
			i++
			continue
		}

		if strings.HasPrefix(line, "@@") {
			// Parse: @@ -start[,count] +start[,count] @@
			fields := strings.Fields(line)
			if len(fields) < 2 {
				i++
				continue
			}
			origSpec := strings.TrimPrefix(fields[1], "-")
			parts := strings.SplitN(origSpec, ",", 2)
			origStart, err := strconv.Atoi(parts[0])
			if err != nil {
				i++
				continue
			}
			// Copy unchanged lines up to the hunk.
			for origIdx < origStart-1 && origIdx < len(origLines) {
				result = append(result, origLines[origIdx])
				origIdx++
			}
			i++
			continue
		}

		if strings.HasPrefix(line, "+") {
			result = append(result, line[1:])
			i++
		} else if strings.HasPrefix(line, "-") {
			origIdx++
			i++
		} else if strings.HasPrefix(line, " ") {
			if origIdx < len(origLines) {
				result = append(result, origLines[origIdx])
				origIdx++
			}
			i++
		} else {
			i++
		}
	}
	// Append any remaining original lines.
	for origIdx < len(origLines) {
		result = append(result, origLines[origIdx])
		origIdx++
	}
	return strings.Join(result, "\n"), nil
}

// WorkloadInfo is a generic summary row for non-pod workload types.
type WorkloadInfo struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	Ready       string `json:"ready"`        // e.g. "2/3"
	UpToDate    int32  `json:"up_to_date"`
	Available   int32  `json:"available"`
	Replicas    int32  `json:"replicas"`
	Desired     int32  `json:"desired"`
	Image       string `json:"image"`        // first container image
	Age         string `json:"age"`
	Selector    string `json:"selector"`
}

func shortAge(t metav1.Time) string {
	if t.IsZero() {
		return "—"
	}
	d := time.Since(t.Time)
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
}

// ListDeployments returns deployment summaries for namespace (empty = all).
func (c *Client) ListDeployments(ctx context.Context, namespace string) ([]WorkloadInfo, error) {
	list, err := c.kube.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]WorkloadInfo, 0, len(list.Items))
	for _, d := range list.Items {
		image := ""
		if len(d.Spec.Template.Spec.Containers) > 0 {
			image = d.Spec.Template.Spec.Containers[0].Image
		}
		out = append(out, WorkloadInfo{
			Name:      d.Name,
			Namespace: d.Namespace,
			Ready:     fmt.Sprintf("%d/%d", d.Status.ReadyReplicas, d.Status.Replicas),
			UpToDate:  d.Status.UpdatedReplicas,
			Available: d.Status.AvailableReplicas,
			Replicas:  d.Status.Replicas,
			Image:     image,
			Age:       shortAge(d.CreationTimestamp),
		})
	}
	return out, nil
}

// ListDaemonSets returns daemonset summaries.
func (c *Client) ListDaemonSets(ctx context.Context, namespace string) ([]WorkloadInfo, error) {
	list, err := c.kube.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]WorkloadInfo, 0, len(list.Items))
	for _, d := range list.Items {
		image := ""
		if len(d.Spec.Template.Spec.Containers) > 0 {
			image = d.Spec.Template.Spec.Containers[0].Image
		}
		out = append(out, WorkloadInfo{
			Name:      d.Name,
			Namespace: d.Namespace,
			Desired:   d.Status.DesiredNumberScheduled,
			Available: d.Status.NumberAvailable,
			Ready:     fmt.Sprintf("%d/%d", d.Status.NumberReady, d.Status.DesiredNumberScheduled),
			Image:     image,
			Age:       shortAge(d.CreationTimestamp),
		})
	}
	return out, nil
}

// ListStatefulSets returns statefulset summaries.
func (c *Client) ListStatefulSets(ctx context.Context, namespace string) ([]WorkloadInfo, error) {
	list, err := c.kube.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]WorkloadInfo, 0, len(list.Items))
	for _, d := range list.Items {
		image := ""
		if len(d.Spec.Template.Spec.Containers) > 0 {
			image = d.Spec.Template.Spec.Containers[0].Image
		}
		out = append(out, WorkloadInfo{
			Name:      d.Name,
			Namespace: d.Namespace,
			Ready:     fmt.Sprintf("%d/%d", d.Status.ReadyReplicas, d.Status.Replicas),
			Replicas:  d.Status.Replicas,
			Image:     image,
			Age:       shortAge(d.CreationTimestamp),
		})
	}
	return out, nil
}

// ListReplicaSets returns replicaset summaries.
func (c *Client) ListReplicaSets(ctx context.Context, namespace string) ([]WorkloadInfo, error) {
	list, err := c.kube.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]WorkloadInfo, 0, len(list.Items))
	for _, d := range list.Items {
		// Skip replicasets owned by a deployment (they're implementation detail)
		if len(d.OwnerReferences) > 0 && d.OwnerReferences[0].Kind == "Deployment" {
			continue
		}
		image := ""
		if len(d.Spec.Template.Spec.Containers) > 0 {
			image = d.Spec.Template.Spec.Containers[0].Image
		}
		out = append(out, WorkloadInfo{
			Name:      d.Name,
			Namespace: d.Namespace,
			Ready:     fmt.Sprintf("%d/%d", d.Status.ReadyReplicas, d.Status.Replicas),
			Replicas:  d.Status.Replicas,
			Image:     image,
			Age:       shortAge(d.CreationTimestamp),
		})
	}
	return out, nil
}

// JobInfo is a summary of a batch Job.
type JobInfo struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	Completions string `json:"completions"` // "1/1"
	Duration    string `json:"duration"`
	Status      string `json:"status"` // Complete | Failed | Active
	Image       string `json:"image"`
	Age         string `json:"age"`
}

// ListJobs returns job summaries.
func (c *Client) ListJobs(ctx context.Context, namespace string) ([]JobInfo, error) {
	list, err := c.kube.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]JobInfo, 0, len(list.Items))
	for _, j := range list.Items {
		desired := int32(1)
		if j.Spec.Completions != nil {
			desired = *j.Spec.Completions
		}
		status := "Active"
		for _, cond := range j.Status.Conditions {
			if cond.Type == "Complete" && cond.Status == "True" {
				status = "Complete"
			} else if cond.Type == "Failed" && cond.Status == "True" {
				status = "Failed"
			}
		}
		dur := "—"
		if j.Status.StartTime != nil && j.Status.CompletionTime != nil {
			d := j.Status.CompletionTime.Sub(j.Status.StartTime.Time)
			dur = fmt.Sprintf("%ds", int(d.Seconds()))
		}
		image := ""
		if len(j.Spec.Template.Spec.Containers) > 0 {
			image = j.Spec.Template.Spec.Containers[0].Image
		}
		out = append(out, JobInfo{
			Name:        j.Name,
			Namespace:   j.Namespace,
			Completions: fmt.Sprintf("%d/%d", j.Status.Succeeded, desired),
			Duration:    dur,
			Status:      status,
			Image:       image,
			Age:         shortAge(j.CreationTimestamp),
		})
	}
	return out, nil
}

// CronJobInfo is a summary of a CronJob.
type CronJobInfo struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	Schedule    string `json:"schedule"`
	Suspend     bool   `json:"suspend"`
	Active      int    `json:"active"`
	LastRun     string `json:"last_run"`
	Age         string `json:"age"`
}

// ListCronJobs returns cronjob summaries.
func (c *Client) ListCronJobs(ctx context.Context, namespace string) ([]CronJobInfo, error) {
	list, err := c.kube.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]CronJobInfo, 0, len(list.Items))
	for _, cj := range list.Items {
		lastRun := "never"
		if cj.Status.LastScheduleTime != nil {
			lastRun = shortAge(*cj.Status.LastScheduleTime) + " ago"
		}
		out = append(out, CronJobInfo{
			Name:      cj.Name,
			Namespace: cj.Namespace,
			Schedule:  cj.Spec.Schedule,
			Suspend:   cj.Spec.Suspend != nil && *cj.Spec.Suspend,
			Active:    len(cj.Status.Active),
			LastRun:   lastRun,
			Age:       shortAge(cj.CreationTimestamp),
		})
	}
	return out, nil
}

// ListNamespaces returns all namespace names for the context.
func (c *Client) ListNamespaces(ctx context.Context) ([]string, error) {
	list, err := c.kube.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	names := make([]string, len(list.Items))
	for i, ns := range list.Items {
		names[i] = ns.Name
	}
	return names, nil
}

// ensure io is used
var _ io.Reader
