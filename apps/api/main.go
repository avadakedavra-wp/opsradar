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
	// Load credentials saved via the Settings UI / GitHub OAuth (~/.opsradar/.env)
	// into the environment FIRST, so the AI backend, GitHub PR creation, and API
	// key auth below all see them. Shell env still wins for any explicit override.
	if n := handlers.LoadStoredEnv(); n > 0 {
		log.Printf("loaded %d stored setting(s) from ~/.opsradar/.env", n)
	}

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

	agentBackend := selectAgentBackend()

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

	// Interactive pod exec runs over a WebSocket, registered on the raw app
	// because a browser WS handshake can't carry the X-API-Key header (it
	// self-authenticates via ?key= when OPS_RADAR_API_KEY is set).
	handlers.RegisterExecWebSocket(app, k8sMgr)

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

// selectAgentBackend picks the AI backend for scan analysis.
//
// Auto-detection order (AGENT_BACKEND=auto, the default):
//  1. ANTHROPIC_API_KEY set          → Claude API (direct SDK call)
//  2. `claude` CLI on PATH           → Claude CLI (uses claude.ai login auth)
//  3. `bob` CLI on PATH              → Bob Shell AI
//  4. nothing                        → return Claude API backend so callers
//     get a specific "no credentials" error rather than a nil-pointer panic.
//
// Force a specific backend with AGENT_BACKEND=claude|claude-cli|bob.
func selectAgentBackend() agent.Backend {
	bobBin := getEnv("BOB_BIN", "bob")
	claudeCLIBin := getEnv("CLAUDE_BIN", "claude")

	bobBackend := agent.NewBobBackend(bobBin)
	claudeCLIBackend := agent.NewClaudeCLIBackend(claudeCLIBin)
	claudeAPIBackend := agent.NewClaudeBackend(os.Getenv("ANTHROPIC_API_KEY"), os.Getenv("ANTHROPIC_MODEL"))

	switch getEnv("AGENT_BACKEND", "auto") {
	case "claude":
		if err := claudeAPIBackend.Ready(); err != nil {
			log.Printf("warning: AGENT_BACKEND=claude but %v", err)
		} else {
			log.Printf("agent backend: Claude API (forced)")
		}
		return claudeAPIBackend

	case "claude-cli":
		if err := claudeCLIBackend.Ready(); err != nil {
			log.Printf("warning: AGENT_BACKEND=claude-cli but %v", err)
		} else {
			log.Printf("agent backend: claude CLI (forced)")
		}
		return claudeCLIBackend

	case "bob":
		if err := bobBackend.Ready(); err != nil {
			log.Printf("warning: AGENT_BACKEND=bob but %v", err)
		} else {
			log.Printf("agent backend: bob CLI (forced)")
		}
		return bobBackend

	default: // "auto"
		if err := claudeAPIBackend.Ready(); err == nil {
			log.Printf("agent backend: Claude API (ANTHROPIC_API_KEY)")
			return claudeAPIBackend
		}
		if err := claudeCLIBackend.Ready(); err == nil {
			log.Printf("agent backend: claude CLI (~/.claude auth)")
			return claudeCLIBackend
		}
		if err := bobBackend.Ready(); err == nil {
			log.Printf("agent backend: bob CLI")
			return bobBackend
		}
		log.Printf("warning: no agent backend available — set ANTHROPIC_API_KEY, install claude CLI, or install bob")
		return claudeAPIBackend
	}
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
