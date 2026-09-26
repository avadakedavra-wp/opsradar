package handlers

import (
	"fmt"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/opsradar/k8s-ops-radar/api/internal/agent"
	k8sinternal "github.com/opsradar/k8s-ops-radar/api/internal/k8s"
)

// BobChatHandler handles the Ask Bob chat endpoint.
type BobChatHandler struct {
	backend agent.Backend
	k8s     *k8sinternal.Manager
}

// Chat handles POST /bob/chat.
//
// The cluster context Bob receives is tiered by what the client provides:
//
//  1. context_type = ""         → no k8s data, pure chat
//  2. context_type = "cluster"  → full telemetry: pod list + events + logs for
//     troubled pods (Failed / restarting / not-ready)
//  3. context_type = "pod"      → focused: logs + events for a specific pod
//  4. context_type = "namespace"→ telemetry scoped to that namespace
func (h *BobChatHandler) Chat(c *fiber.Ctx) error {
	var req struct {
		Message     string `json:"message"`
		ContextType string `json:"context_type"` // "" | "cluster" | "namespace" | "pod"
		ContextID   string `json:"context_id"`   // namespace, or "namespace/pod"
		K8sContext  string `json:"k8s_context"`  // kubeconfig context name
	}
	if err := c.BodyParser(&req); err != nil || req.Message == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "message required"})
	}

	clusterCtx := ""
	if h.k8s != nil && req.ContextType != "" {
		client, err := h.k8s.ClientForContext(req.K8sContext)
		if err == nil {
			clusterCtx = h.buildContext(c, client, req.ContextType, req.ContextID)
		}
	}

	reply, err := h.backend.Chat(c.Context(), req.Message, clusterCtx)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"reply": reply})
}

// buildContext gathers the right telemetry slice for the given context type.
func (h *BobChatHandler) buildContext(c *fiber.Ctx, client *k8sinternal.Client, ctxType, ctxID string) string {
	switch ctxType {

	case "pod":
		// ctxID = "namespace/pod-name"
		parts := strings.SplitN(ctxID, "/", 2)
		if len(parts) != 2 {
			return ""
		}
		ns, podName := parts[0], parts[1]
		return buildPodContext(c, client, ns, podName)

	case "namespace":
		tel := client.GetTelemetryContext(c.Context(), ctxID)
		return tel.Details

	default: // "cluster"
		tel := client.GetTelemetryContext(c.Context(), "")
		return tel.Details
	}
}

// buildPodContext fetches targeted telemetry for a single pod: full status,
// warning events, and last 100 log lines.
func buildPodContext(c *fiber.Ctx, client *k8sinternal.Client, namespace, podName string) string {
	var sb strings.Builder

	pods, err := client.ListPods(c.Context(), namespace)
	if err != nil {
		return "Could not list pods: " + err.Error()
	}

	var target *k8sinternal.PodInfo
	for i := range pods {
		if pods[i].Name == podName {
			target = &pods[i]
			break
		}
	}
	if target == nil {
		sb.WriteString(fmt.Sprintf("Pod %s/%s not found.\n", namespace, podName))
		return sb.String()
	}

	sb.WriteString(fmt.Sprintf("POD: %s/%s\n", target.Namespace, target.Name))
	sb.WriteString(fmt.Sprintf("  Phase:    %s\n", target.Phase))
	sb.WriteString(fmt.Sprintf("  Ready:    %v\n", target.Ready))
	sb.WriteString(fmt.Sprintf("  Restarts: %d\n", target.Restarts))
	sb.WriteString(fmt.Sprintf("  Node:     %s\n", target.NodeName))
	sb.WriteString(fmt.Sprintf("  Images:   %s\n", strings.Join(target.Images, ", ")))
	sb.WriteString(fmt.Sprintf("  Created:  %s\n\n", target.CreatedAt))

	// Events
	events, err := client.GetPodEvents(c.Context(), namespace, podName)
	if err == nil && len(events) > 0 {
		sb.WriteString("Events:\n")
		for _, e := range events {
			sb.WriteString(fmt.Sprintf("  [%s] %s ×%d — %s\n", e.Type, e.Reason, e.Count, e.Message))
		}
		sb.WriteString("\n")
	}

	// Logs — try current, fall back to previous (crashed container)
	var lines int64 = 100
	container := ""
	if len(target.Containers) > 0 {
		container = target.Containers[0]
	}
	logs, err := client.GetPodLogs(c.Context(), namespace, podName, container, lines)
	if err != nil || strings.TrimSpace(logs) == "" {
		// try previous termination
		logs, _ = client.GetPodLogs(c.Context(), namespace, podName, container, lines)
	}
	if strings.TrimSpace(logs) != "" {
		logLines := strings.Split(strings.TrimSpace(logs), "\n")
		sb.WriteString(fmt.Sprintf("Logs (last %d lines):\n", len(logLines)))
		for _, l := range logLines {
			sb.WriteString("  " + l + "\n")
		}
	}

	out := sb.String()
	if len(out) > 6000 {
		out = out[:6000] + "\n... [truncated]\n"
	}
	return out
}
