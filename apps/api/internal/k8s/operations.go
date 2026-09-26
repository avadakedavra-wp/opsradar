package k8s

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/remotecommand"
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

// PodEvent is a warning or normal event for a pod.
type PodEvent struct {
	Type    string `json:"type"`    // Warning | Normal
	Reason  string `json:"reason"`  // OOMKilled, BackOff, Pulled, ...
	Message string `json:"message"`
	Count   int32  `json:"count"`
	Age     string `json:"age"`
}

// GetPodEvents returns the most recent events for a specific pod.
func (c *Client) GetPodEvents(ctx context.Context, namespace, podName string) ([]PodEvent, error) {
	list, err := c.kube.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{
		FieldSelector: "involvedObject.name=" + podName,
	})
	if err != nil {
		return nil, err
	}
	events := make([]PodEvent, 0, len(list.Items))
	for _, e := range list.Items {
		events = append(events, PodEvent{
			Type:    e.Type,
			Reason:  e.Reason,
			Message: e.Message,
			Count:   e.Count,
			Age:     shortAge(e.LastTimestamp),
		})
	}
	return events, nil
}

// TelemetryContext bundles real pod data for Bob's diagnostic context.
type TelemetryContext struct {
	Summary  string // one-liner per pod
	Details  string // full context string ready to inject into the AI prompt
}

// GetTelemetryContext gathers pod list, events, and logs for troubled pods.
// It is intentionally capped so the AI context stays under ~6 KB.
func (c *Client) GetTelemetryContext(ctx context.Context, namespace string) TelemetryContext {
	pods, err := c.ListPods(ctx, namespace)
	if err != nil {
		return TelemetryContext{Summary: "cluster unreachable: " + err.Error()}
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("CLUSTER SNAPSHOT (%d pods", len(pods)))
	if namespace != "" {
		sb.WriteString(" in namespace " + namespace)
	}
	sb.WriteString(")\n\n")

	// Phase counts
	counts := map[string]int{}
	for _, p := range pods {
		counts[p.Phase]++
	}
	sb.WriteString(fmt.Sprintf("Status: %d running, %d pending, %d failed, %d succeeded\n\n",
		counts["Running"], counts["Pending"], counts["Failed"], counts["Succeeded"]))

	// Identify troubled pods: Failed phase, CrashLoop, or high restarts
	var troubled []PodInfo
	for _, p := range pods {
		if p.Phase == "Failed" || p.Phase == "Pending" || p.Restarts >= 1 || !p.Ready {
			troubled = append(troubled, p)
		}
	}

	// Sort: Failed first, then by restart count descending
	for i := 0; i < len(troubled)-1; i++ {
		for j := i + 1; j < len(troubled); j++ {
			pi, pj := troubled[i], troubled[j]
			iScore := restartScore(pi)
			jScore := restartScore(pj)
			if jScore > iScore {
				troubled[i], troubled[j] = troubled[j], troubled[i]
			}
		}
	}

	const maxPods = 4
	if len(troubled) > maxPods {
		troubled = troubled[:maxPods]
	}

	if len(troubled) == 0 {
		sb.WriteString("All pods are Running and Ready — no issues detected.\n")
	} else {
		sb.WriteString(fmt.Sprintf("TROUBLED PODS (%d):\n\n", len(troubled)))
		for _, p := range troubled {
			sb.WriteString(fmt.Sprintf("─── %s/%s ───\n", p.Namespace, p.Name))
			sb.WriteString(fmt.Sprintf("  Phase: %s | Ready: %v | Restarts: %d\n", p.Phase, p.Ready, p.Restarts))
			sb.WriteString(fmt.Sprintf("  Images: %s\n", strings.Join(p.Images, ", ")))

			// Events (warnings only)
			events, err := c.GetPodEvents(ctx, p.Namespace, p.Name)
			if err == nil {
				var warnings []string
				for _, e := range events {
					if e.Type == "Warning" {
						warnings = append(warnings, fmt.Sprintf("    [%s ×%d] %s", e.Reason, e.Count, e.Message))
					}
				}
				if len(warnings) > 0 {
					if len(warnings) > 5 {
						warnings = warnings[len(warnings)-5:]
					}
					sb.WriteString("  Warning Events:\n")
					for _, w := range warnings {
						sb.WriteString(w + "\n")
					}
				}
			}

			// Logs (last 60 lines from first container)
			container := ""
			if len(p.Containers) > 0 {
				container = p.Containers[0]
			}
			var lines int64 = 60
			logs, err := c.GetPodLogs(ctx, p.Namespace, p.Name, container, lines)
			if err == nil && strings.TrimSpace(logs) != "" {
				logLines := strings.Split(strings.TrimSpace(logs), "\n")
				// keep last 40 lines to cap context
				if len(logLines) > 40 {
					logLines = logLines[len(logLines)-40:]
				}
				sb.WriteString(fmt.Sprintf("  Logs (last %d lines, container: %s):\n", len(logLines), container))
				for _, l := range logLines {
					sb.WriteString("    " + l + "\n")
				}
			} else if err != nil {
				// Try with previous termination logs (pod may have already crashed)
				opts := &corev1.PodLogOptions{TailLines: &lines, Previous: true}
				if container != "" {
					opts.Container = container
				}
				req := c.kube.CoreV1().Pods(p.Namespace).GetLogs(p.Name, opts)
				if rc, e2 := req.Stream(ctx); e2 == nil {
					defer rc.Close()
					var buf bytes.Buffer
					scanner := bufio.NewScanner(rc)
					for scanner.Scan() {
						buf.WriteString("    " + scanner.Text() + "\n")
					}
					if buf.Len() > 0 {
						sb.WriteString(fmt.Sprintf("  Previous container logs:\n%s", buf.String()))
					}
				}
			}
			sb.WriteString("\n")
		}
	}

	full := sb.String()
	// Hard cap: truncate to 6000 chars to stay within reasonable AI context size
	if len(full) > 6000 {
		full = full[:6000] + "\n... [truncated for context size]\n"
	}

	return TelemetryContext{
		Summary: fmt.Sprintf("%d pods, %d running, %d troubled", len(pods), counts["Running"], len(troubled)),
		Details: full,
	}
}

func restartScore(p PodInfo) int {
	score := int(p.Restarts) * 10
	if p.Phase == "Failed" {
		score += 100
	}
	if !p.Ready {
		score += 20
	}
	return score
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

// kindToGVR maps the resource kinds OpsRadar surfaces to their group/version/resource.
// A fixed table is deliberate: it's the exact set the Cluster page lists, and avoids
// fragile discovery round-trips just to render a YAML view.
var kindToGVR = map[string]schema.GroupVersionResource{
	"Pod":                     {Group: "", Version: "v1", Resource: "pods"},
	"ConfigMap":               {Group: "", Version: "v1", Resource: "configmaps"},
	"Secret":                  {Group: "", Version: "v1", Resource: "secrets"},
	"Service":                 {Group: "", Version: "v1", Resource: "services"},
	"Deployment":              {Group: "apps", Version: "v1", Resource: "deployments"},
	"DaemonSet":               {Group: "apps", Version: "v1", Resource: "daemonsets"},
	"StatefulSet":             {Group: "apps", Version: "v1", Resource: "statefulsets"},
	"ReplicaSet":              {Group: "apps", Version: "v1", Resource: "replicasets"},
	"Job":                     {Group: "batch", Version: "v1", Resource: "jobs"},
	"CronJob":                 {Group: "batch", Version: "v1", Resource: "cronjobs"},
	"Ingress":                 {Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"},
	"HorizontalPodAutoscaler": {Group: "autoscaling", Version: "v2", Resource: "horizontalpodautoscalers"},
}

// execResizeQueue adapts a channel of terminal sizes to
// remotecommand.TerminalSizeQueue. Next blocks until a resize arrives and
// returns nil (ending the queue) once the channel is closed.
type execResizeQueue struct {
	ch <-chan remotecommand.TerminalSize
}

func (q *execResizeQueue) Next() *remotecommand.TerminalSize {
	size, ok := <-q.ch
	if !ok {
		return nil
	}
	return &size
}

// ExecStream runs cmd in a pod container over SPDY, wiring stdin/stdout and an
// optional terminal-resize channel. With tty=true, stderr is merged into stdout
// (the kubelet requires stderr be unset for TTY sessions).
func (c *Client) ExecStream(
	ctx context.Context,
	namespace, pod, container string,
	cmd []string,
	stdin io.Reader,
	stdout, stderr io.Writer,
	tty bool,
	resize <-chan remotecommand.TerminalSize,
) error {
	req := c.kube.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(pod).
		Namespace(namespace).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: container,
			Command:   cmd,
			Stdin:     stdin != nil,
			Stdout:    stdout != nil,
			Stderr:    !tty && stderr != nil,
			TTY:       tty,
		}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(c.restCfg, "POST", req.URL())
	if err != nil {
		return fmt.Errorf("init exec: %w", err)
	}

	opts := remotecommand.StreamOptions{
		Stdin:  stdin,
		Stdout: stdout,
		Tty:    tty,
	}
	if !tty {
		opts.Stderr = stderr
	}
	if tty && resize != nil {
		opts.TerminalSizeQueue = &execResizeQueue{ch: resize}
	}
	return executor.StreamWithContext(ctx, opts)
}

// GetResourceYAML fetches a single resource and returns its manifest as YAML.
// namespace may be empty for cluster-scoped kinds. Noisy server-managed fields
// (managedFields) are stripped so the output reads like `kubectl get -o yaml`.
func (c *Client) GetResourceYAML(ctx context.Context, kind, namespace, name string) (string, error) {
	gvr, ok := kindToGVR[kind]
	if !ok {
		return "", fmt.Errorf("unsupported kind %q", kind)
	}

	dyn, err := dynamic.NewForConfig(c.restCfg)
	if err != nil {
		return "", fmt.Errorf("dynamic client: %w", err)
	}

	var ri dynamic.ResourceInterface
	if namespace != "" {
		ri = dyn.Resource(gvr).Namespace(namespace)
	} else {
		ri = dyn.Resource(gvr)
	}

	obj, err := ri.Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}

	// Trim server-side clutter that obscures the real spec.
	unstructured.RemoveNestedField(obj.Object, "metadata", "managedFields")
	unstructured.RemoveNestedField(obj.Object, "metadata", "generation")
	unstructured.RemoveNestedField(obj.Object, "metadata", "resourceVersion")

	data, err := yaml.Marshal(obj.Object)
	if err != nil {
		return "", fmt.Errorf("marshal yaml: %w", err)
	}
	return string(data), nil
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
//   - Legacy unified diff (--- or @@)        → rejected with an actionable error
//   - Strategic merge patch fragment (JSON)  → strategic merge patch onto the live deployment
func (c *Client) ApplyPatch(ctx context.Context, namespace, deployment, diffPatch string) error {
	patch := strings.TrimSpace(diffPatch)

	// Case 1: patch is a full Kubernetes manifest.
	if looksLikeFullManifest(patch) {
		return c.ApplyYAML(ctx, patch)
	}

	// Case 2: legacy unified diff. We no longer generate these — Bob now emits a
	// strategic merge patch. A fuzzy, line-addressed diff written against an
	// idealized manifest cannot be applied reliably to the live object's own
	// serialization (line numbers and context never align), so applying it either
	// corrupts the manifest or fails with a cryptic YAML error. Fail honestly with
	// an actionable message instead.
	if strings.HasPrefix(patch, "---") || strings.Contains(patch, "\n@@") {
		return fmt.Errorf("this finding uses a legacy diff format that can't be applied safely — re-run the scan to regenerate an applyable patch")
	}

	// Case 3: strategic merge patch fragment. We need the live deployment only to
	// resolve the container name when the fragment is container-level.
	dep, err := c.kube.AppsV1().Deployments(namespace).Get(ctx, deployment, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("get deployment: %w", err)
	}
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

	// Bare Deployment.spec-level keys (e.g. {"replicas":2}) — wrap under spec,
	// NOT under a container, or a strategic merge would corrupt the pod template.
	specLevel := map[string]bool{
		"replicas": true, "strategy": true, "selector": true, "minReadySeconds": true,
		"revisionHistoryLimit": true, "paused": true, "progressDeadlineSeconds": true,
	}
	for k := range frag {
		if specLevel[k] {
			return json.Marshal(map[string]interface{}{"spec": frag})
		}
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
