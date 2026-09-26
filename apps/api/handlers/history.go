package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/opsradar/k8s-ops-radar/api/internal/store"
)

// HistoryHandler handles /history.
type HistoryHandler struct{ db store.Store }

func (h *HistoryHandler) List(c *fiber.Ctx) error {
	scans, err := h.db.ListScans()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"scans": scans})
}
