package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"github.com/opsradar/k8s-ops-radar/api/handlers"
	"github.com/opsradar/k8s-ops-radar/api/middleware"
	"github.com/opsradar/k8s-ops-radar/api/internal/agent"
	"github.com/opsradar/k8s-ops-radar/api/internal/k8s"
	"github.com/opsradar/k8s-ops-radar/api/internal/pr"
	"github.com/opsradar/k8s-ops-radar/api/internal/store"
)

func main() {
	// Store
	dbPath := getEnv("STORE_PATH", "/data/ops-radar.db")
	db, err := store.Open(dbPath)
	if err != nil {
		log.Fatalf("failed to open store: %v", err)
	}
	defer db.Close()

	// K8s Client
	k8sClient, err := k8s.NewClient(os.Getenv("KUBECONFIG"))
	if err != nil {
		log.Printf("warning: k8s client init failed: %v — cluster features disabled", err)
	}

	// Bob Agent Backend
	bobBin := getEnv("BOB_BIN", "bob")
	agentBackend := agent.NewBobBackend(bobBin)

	// PR Generator
	prGen := pr.NewGenerator(
		os.Getenv("GITHUB_TOKEN"),
		os.Getenv("GITHUB_REPO"),
	)

	// Fiber App
	app := fiber.New(fiber.Config{AppName: "OpsRadar API v1"})
	app.Use(recover.New())
	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowHeaders: "Origin, Content-Type, Accept, X-API-Key",
	}))

	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	api := app.Group("/", middleware.APIKeyAuth())
	handlers.RegisterRoutes(api, db, k8sClient, agentBackend, prGen)

	port := getEnv("PORT", "8080")
	go func() {
		if err := app.Listen(":" + port); err != nil {
			log.Fatalf("server error: %v", err)
		}
	}()
	log.Printf("OpsRadar API listening on :%s", port)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("shutting down...")
	_ = app.Shutdown()
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
