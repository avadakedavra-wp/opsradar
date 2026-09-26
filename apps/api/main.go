package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"github.com/opsradar/k8s-ops-radar/api/handlers"
	"github.com/opsradar/k8s-ops-radar/api/internal/agent"
	"github.com/opsradar/k8s-ops-radar/api/internal/k8s"
	"github.com/opsradar/k8s-ops-radar/api/internal/pr"
	"github.com/opsradar/k8s-ops-radar/api/internal/store"
	"github.com/opsradar/k8s-ops-radar/api/middleware"
)

// shutdownGrace bounds how long we wait for in-flight scans to wrap up
// before closing the database out from under them.
const shutdownGrace = 30 * time.Second

func main() {
	// Store — defaults to a path under the user's home directory so the
	// binary just works when run directly (e.g. `./opsradar start` on a
	// laptop). Container/Helm deployments set STORE_PATH explicitly to a
	// mounted volume (e.g. /data/ops-radar.db) and this default never applies.
	dbPath := os.Getenv("STORE_PATH")
	if dbPath == "" {
		dbPath = defaultStorePath()
	}
	db, err := store.Open(dbPath)
	if err != nil {
		log.Fatalf("failed to open store at %s: %v", dbPath, err)
	}
	defer db.Close()
	log.Printf("store: %s", dbPath)

	// K8s — loads every context in the kubeconfig so a scan can target any of
	// them. A context that can't connect is skipped, not fatal (see
	// k8s.LoadAll) — cluster features are simply unavailable if none load.
	k8sMgr, err := k8s.LoadAll(os.Getenv("KUBECONFIG"))
	switch {
	case err != nil:
		log.Printf("warning: kubeconfig load failed: %v — cluster features disabled", err)
	case len(k8sMgr.Clients) == 0:
		log.Printf("warning: no reachable kubeconfig contexts found — cluster features disabled")
		k8sMgr = nil
	default:
		log.Printf("kubernetes: loaded context(s): %v", k8sMgr.ContextNames())
		checkCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		for ctxName, ferr := range k8sMgr.VerifyAll(checkCtx, "") {
			log.Printf("warning: context %q is missing permissions OpsRadar needs: %v", ctxName, ferr)
		}
		cancel()
	}

	// Bob Agent Backend
	bobBin := getEnv("BOB_BIN", "bob")
	agentBackend := agent.NewBobBackend(bobBin)
	if err := agentBackend.Ready(); err != nil {
		log.Printf("warning: %v — scans will fail until this is fixed", err)
	}

	// PR Generator
	prGen := pr.NewGenerator(
		os.Getenv("GITHUB_TOKEN"),
		os.Getenv("GITHUB_REPO"),
	)

	if os.Getenv("OPS_RADAR_API_KEY") == "" {
		log.Printf("SECURITY WARNING: OPS_RADAR_API_KEY is unset — every endpoint (including /docker) is unauthenticated")
	}

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

	// appCtx is cancelled on shutdown; every scan's timeout derives from it
	// so a SIGTERM cuts scans short (and they end up "failed", not silently
	// wedged) instead of racing app.Shutdown() -> db.Close() against a scan
	// still writing results. scanWG lets us actually wait for that to happen.
	appCtx, cancelApp := context.WithCancel(context.Background())
	var scanWG sync.WaitGroup

	api := app.Group("/", middleware.APIKeyAuth())
	handlers.RegisterRoutes(api, db, k8sMgr, agentBackend, prGen, appCtx, &scanWG)

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

	cancelApp() // tell in-flight scans to wrap up

	scansDone := make(chan struct{})
	go func() {
		scanWG.Wait()
		close(scansDone)
	}()
	select {
	case <-scansDone:
	case <-time.After(shutdownGrace):
		log.Printf("warning: scan(s) still running after %s grace period, shutting down anyway", shutdownGrace)
	}

	_ = app.Shutdown()
}

// defaultStorePath returns ~/.opsradar/ops-radar.db, creating the directory
// if needed. Falls back to a relative path if the home directory can't be
// determined (rare, but must never crash startup over it).
func defaultStorePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "./ops-radar.db"
	}
	dir := filepath.Join(home, ".opsradar")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "./ops-radar.db"
	}
	return filepath.Join(dir, "ops-radar.db")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
