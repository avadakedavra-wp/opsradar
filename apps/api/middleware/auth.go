package middleware

import (
	"crypto/subtle"
	"os"

	"github.com/gofiber/fiber/v2"
)

// APIKeyAuth validates X-API-Key header. If OPS_RADAR_API_KEY is unset, auth
// is disabled (dev mode) — main.go logs a startup warning about this so it's
// never silently the case in a deployment someone forgot to configure.
func APIKeyAuth() fiber.Handler {
	return func(c *fiber.Ctx) error {
		secret := os.Getenv("OPS_RADAR_API_KEY")
		if secret == "" {
			return c.Next() // dev mode — no auth
		}
		given := c.Get("X-API-Key")
		// Constant-time compare: a plain != leaks timing information about
		// how many leading bytes of the key an attacker has guessed correctly.
		if len(given) != len(secret) || subtle.ConstantTimeCompare([]byte(given), []byte(secret)) != 1 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}
		return c.Next()
	}
}
