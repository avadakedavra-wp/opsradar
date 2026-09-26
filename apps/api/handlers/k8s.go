package handlers

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	k8sinternal "github.com/opsradar/k8s-ops-radar/api/internal/k8s"
	"github.com/opsradar/k8s-ops-radar/api/internal/store"
)

func isDialError(err error) bool {
	s := err.Error()
	return strings.Contains(s, "connection refused") || strings.Contains(s, "dial tcp") || strings.Contains(s, "no route to host")
}

// K8sHandler handles direct Kubernetes operation endpoints.
type K8sHandler struct {
	k8s *k8sinternal.Manager
	db  store.Store
}

// ListPods handles GET /k8s/pods?context=X&namespace=Y
func (h *K8sHandler) ListPods(c *fiber.Ctx) error {
	contextName := c.Query("context", "")
	namespace := c.Query("namespace", "")

	client, err := h.k8s.ClientForContext(contextName)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	pods, err := client.ListPods(c.Context(), namespace)
	if err != nil {
		// Cluster unreachable — return empty list with a warning instead of 500
		// so the dashboard degrades gracefully.
		if isDialError(err) {
			return c.JSON(fiber.Map{"pods": []interface{}{}, "warning": "cluster unreachable: " + err.Error()})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"pods": pods})
}

// GetPodLogs handles GET /k8s/pods/:namespace/:pod/logs?context=X&container=Y&lines=200
func (h *K8sHandler) GetPodLogs(c *fiber.Ctx) error {
	namespace := c.Params("namespace")
	pod := c.Params("pod")
	contextName := c.Query("context", "")
	container := c.Query("container", "")
	lines := c.QueryInt("lines", 200)
	if lines > 1000 {
		lines = 1000
	}

	client, err := h.k8s.ClientForContext(contextName)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	logs, err := client.GetPodLogs(c.Context(), namespace, pod, container, int64(lines))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"logs": logs, "pod": pod, "namespace": namespace})
}

// RestartDeployment handles POST /k8s/deployments/restart
func (h *K8sHandler) RestartDeployment(c *fiber.Ctx) error {
	var req struct {
		Context    string `json:"context"`
		Namespace  string `json:"namespace"`
		Deployment string `json:"deployment"`
	}
	if err := c.BodyParser(&req); err != nil || req.Namespace == "" || req.Deployment == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "namespace and deployment required"})
	}

	client, err := h.k8s.ClientForContext(req.Context)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	if err := client.RestartDeployment(c.Context(), req.Namespace, req.Deployment); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true, "message": "rollout restart triggered"})
}

// ScaleDeployment handles POST /k8s/deployments/scale
func (h *K8sHandler) ScaleDeployment(c *fiber.Ctx) error {
	var req struct {
		Context    string `json:"context"`
		Namespace  string `json:"namespace"`
		Deployment string `json:"deployment"`
		Replicas   int32  `json:"replicas"`
	}
	if err := c.BodyParser(&req); err != nil || req.Namespace == "" || req.Deployment == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "namespace, deployment, and replicas required"})
	}
	if req.Replicas < 0 || req.Replicas > 50 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "replicas must be 0–50"})
	}

	client, err := h.k8s.ClientForContext(req.Context)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	if err := client.ScaleDeployment(c.Context(), req.Namespace, req.Deployment, req.Replicas); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true, "message": "scaled", "replicas": req.Replicas})
}

// DeletePod handles DELETE /k8s/pods/:namespace/:pod?context=X
func (h *K8sHandler) DeletePod(c *fiber.Ctx) error {
	namespace := c.Params("namespace")
	pod := c.Params("pod")
	contextName := c.Query("context", "")

	client, err := h.k8s.ClientForContext(contextName)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	if err := client.DeletePod(c.Context(), namespace, pod); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true, "message": "pod deleted"})
}

// ApplyYAML handles POST /k8s/apply
func (h *K8sHandler) ApplyYAML(c *fiber.Ctx) error {
	var req struct {
		Context string `json:"context"`
		YAML    string `json:"yaml"`
	}
	if err := c.BodyParser(&req); err != nil || req.YAML == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "yaml required"})
	}

	client, err := h.k8s.ClientForContext(req.Context)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	if err := client.ApplyYAML(c.Context(), req.YAML); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true, "message": "applied"})
}

// ApplyFinding handles POST /k8s/findings/:id/apply — applies a finding's diff patch.
func (h *K8sHandler) ApplyFinding(c *fiber.Ctx) error {
	finding, err := h.db.GetFinding(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "finding not found"})
	}
	if finding.DiffPatch == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "finding has no diff patch"})
	}

	// Look up the scan target to get namespace + deployment.
	target, err := h.db.GetScanTargetByID(finding.ScanTargetID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "scan target not found"})
	}

	contextName := c.Query("context", target.ContextName)
	client, err := h.k8s.ClientForContext(contextName)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	if err := client.ApplyPatch(c.Context(), target.Namespace, target.Deployment, finding.DiffPatch); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true, "message": "patch applied"})
}

// GetHAAnalysis handles GET /k8s/ha-analysis?context=X
func (h *K8sHandler) GetHAAnalysis(c *fiber.Ctx) error {
	contextName := c.Query("context", "")
	client, err := h.k8s.ClientForContext(contextName)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	findings, err := client.GetHAAnalysis(c.Context())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"findings": findings})
}

// ListContexts handles GET /k8s/contexts — returns all loaded kubeconfig contexts.
func (h *K8sHandler) ListContexts(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"contexts": h.k8s.ContextNames()})
}

// ListNamespaces handles GET /k8s/namespaces?context=X
func (h *K8sHandler) ListNamespaces(c *fiber.Ctx) error {
	contextName := c.Query("context", "")
	client, err := h.k8s.ClientForContext(contextName)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	names, err := client.ListNamespaces(c.Context())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"namespaces": names})
}

// listWorkload is a helper that resolves context+namespace and calls fn, returning JSON under the given key.
func (h *K8sHandler) listWorkload(c *fiber.Ctx, key string, fn func(*k8sinternal.Client) (interface{}, error)) error {
	contextName := c.Query("context", "")
	namespace := c.Query("namespace", "")
	client, err := h.k8s.ClientForContext(contextName)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	data, err := fn(client)
	if err != nil {
		if isDialError(err) {
			return c.JSON(fiber.Map{key: []interface{}{}, "warning": "cluster unreachable: " + err.Error()})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	_ = namespace // used by fn via closure capture — kept for documentation
	return c.JSON(fiber.Map{key: data})
}

// ListDeployments handles GET /k8s/deployments?context=X&namespace=Y
func (h *K8sHandler) ListDeployments(c *fiber.Ctx) error {
	contextName := c.Query("context", "")
	namespace := c.Query("namespace", "")
	client, err := h.k8s.ClientForContext(contextName)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	data, err := client.ListDeployments(c.Context(), namespace)
	if err != nil {
		if isDialError(err) {
			return c.JSON(fiber.Map{"workloads": []interface{}{}, "warning": "cluster unreachable"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"workloads": data})
}

// ListDaemonSets handles GET /k8s/daemonsets?context=X&namespace=Y
func (h *K8sHandler) ListDaemonSets(c *fiber.Ctx) error {
	contextName := c.Query("context", "")
	namespace := c.Query("namespace", "")
	client, err := h.k8s.ClientForContext(contextName)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	data, err := client.ListDaemonSets(c.Context(), namespace)
	if err != nil {
		if isDialError(err) {
			return c.JSON(fiber.Map{"workloads": []interface{}{}, "warning": "cluster unreachable"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"workloads": data})
}

// ListStatefulSets handles GET /k8s/statefulsets?context=X&namespace=Y
func (h *K8sHandler) ListStatefulSets(c *fiber.Ctx) error {
	contextName := c.Query("context", "")
	namespace := c.Query("namespace", "")
	client, err := h.k8s.ClientForContext(contextName)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	data, err := client.ListStatefulSets(c.Context(), namespace)
	if err != nil {
		if isDialError(err) {
			return c.JSON(fiber.Map{"workloads": []interface{}{}, "warning": "cluster unreachable"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"workloads": data})
}

// ListReplicaSets handles GET /k8s/replicasets?context=X&namespace=Y
func (h *K8sHandler) ListReplicaSets(c *fiber.Ctx) error {
	contextName := c.Query("context", "")
	namespace := c.Query("namespace", "")
	client, err := h.k8s.ClientForContext(contextName)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	data, err := client.ListReplicaSets(c.Context(), namespace)
	if err != nil {
		if isDialError(err) {
			return c.JSON(fiber.Map{"workloads": []interface{}{}, "warning": "cluster unreachable"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"workloads": data})
}

// ListJobs handles GET /k8s/jobs?context=X&namespace=Y
func (h *K8sHandler) ListJobs(c *fiber.Ctx) error {
	contextName := c.Query("context", "")
	namespace := c.Query("namespace", "")
	client, err := h.k8s.ClientForContext(contextName)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	data, err := client.ListJobs(c.Context(), namespace)
	if err != nil {
		if isDialError(err) {
			return c.JSON(fiber.Map{"jobs": []interface{}{}, "warning": "cluster unreachable"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"jobs": data})
}

// ListCronJobs handles GET /k8s/cronjobs?context=X&namespace=Y
func (h *K8sHandler) ListCronJobs(c *fiber.Ctx) error {
	contextName := c.Query("context", "")
	namespace := c.Query("namespace", "")
	client, err := h.k8s.ClientForContext(contextName)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	data, err := client.ListCronJobs(c.Context(), namespace)
	if err != nil {
		if isDialError(err) {
			return c.JSON(fiber.Map{"cronjobs": []interface{}{}, "warning": "cluster unreachable"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"cronjobs": data})
}
