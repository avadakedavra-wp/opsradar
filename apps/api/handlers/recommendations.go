package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/opsradar/k8s-ops-radar/api/internal/pr"
	"github.com/opsradar/k8s-ops-radar/api/internal/store"
)

// RecommendationsHandler handles /recommendations, /radar, /pr/generate, /findings/:id/resolve.
type RecommendationsHandler struct {
	db    store.Store
	prGen *pr.Generator
}

func (h *RecommendationsHandler) List(c *fiber.Ctx) error {
	scanID := c.Query("scan_id")
	if scanID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "scan_id required"})
	}
	findings, err := h.db.ListFindings(scanID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"findings": findings})
}

func (h *RecommendationsHandler) Radar(c *fiber.Ctx) error {
	radar, err := h.db.GetRadar()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"radar": radar})
}

func (h *RecommendationsHandler) GeneratePR(c *fiber.Ctx) error {
	var req GeneratePRRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	finding, err := h.db.GetFinding(req.FindingID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "finding not found"})
	}
	if finding.DiffPatch == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "finding has no diff patch"})
	}
	prURL, err := h.prGen.GeneratePR(c.Context(), finding)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"pr_url": prURL})
}

func (h *RecommendationsHandler) ResolveFinding(c *fiber.Ctx) error {
	if err := h.db.ResolveFinding(c.Params("id")); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"resolved": true})
}
