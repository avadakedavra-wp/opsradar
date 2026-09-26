package middleware

import (
	"os"

	"github.com/gofiber/fiber/v2"
)

// APIKeyAuth validates X-API-Key header. If OPS_RADAR_API_KEY is unset, auth is disabled (dev mode).
func APIKeyAuth() fiber.Handler {
	return func(c *fiber.Ctx) error {
		secret := os.Getenv("OPS_RADAR_API_KEY")
		if secret == "" {
			return c.Next() // dev mode — no auth
		}
		if c.Get("X-API-Key") != secret {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}
		return c.Next()
	}
}
