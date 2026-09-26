package handlers

import (
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
func (h *BobChatHandler) Chat(c *fiber.Ctx) error {
	var req struct {
		Message     string `json:"message"`
		ContextType string `json:"context_type"` // "cluster" | "namespace" | ""
		ContextID   string `json:"context_id"`   // namespace name, or empty for whole cluster
		K8sContext  string `json:"k8s_context"`  // kubeconfig context name
	}
	if err := c.BodyParser(&req); err != nil || req.Message == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "message required"})
	}

	// Build cluster context for the prompt when requested.
	clusterCtx := ""
	if h.k8s != nil && (req.ContextType == "cluster" || req.ContextType == "namespace") {
		client, err := h.k8s.ClientForContext(req.K8sContext)
		if err == nil {
			pods, err := client.ListPods(c.Context(), req.ContextID)
			if err == nil && len(pods) > 0 {
				clusterCtx = buildClusterContext(pods)
			}
			ha, err := client.GetHAAnalysis(c.Context())
			if err == nil && len(ha) > 0 {
				clusterCtx += "\nHA FINDINGS:\n"
				for _, f := range ha {
					clusterCtx += "- [" + f.Severity + "] " + f.Namespace + "/" + f.Deployment + ": " + f.Issue + "\n"
				}
			}
		}
	}

	reply, err := h.backend.Chat(c.Context(), req.Message, clusterCtx)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"reply": reply})
}

func buildClusterContext(pods []k8sinternal.PodInfo) string {
	counts := map[string]map[string]int{}
	for _, p := range pods {
		if counts[p.Namespace] == nil {
			counts[p.Namespace] = map[string]int{"total": 0, "running": 0, "pending": 0, "failed": 0}
		}
		counts[p.Namespace]["total"]++
		switch p.Phase {
		case "Running":
			counts[p.Namespace]["running"]++
		case "Pending":
			counts[p.Namespace]["pending"]++
		case "Failed":
			counts[p.Namespace]["failed"]++
		}
	}
	ctx := "CLUSTER POD SUMMARY:\n"
	for ns, c := range counts {
		ctx += "Namespace " + ns + ": " +
			"total=" + itoa(c["total"]) +
			" running=" + itoa(c["running"]) +
			" pending=" + itoa(c["pending"]) +
			" failed=" + itoa(c["failed"]) + "\n"
	}
	return ctx
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}
