package handlers

import (
	"context"
	"sync"

	"github.com/gofiber/fiber/v2"
	"github.com/opsradar/k8s-ops-radar/api/internal/agent"
	"github.com/opsradar/k8s-ops-radar/api/internal/k8s"
	"github.com/opsradar/k8s-ops-radar/api/internal/pr"
	"github.com/opsradar/k8s-ops-radar/api/internal/store"
)

// RegisterRoutes wires all handlers onto the given router group.
//
// appCtx is the server's root context (cancelled on shutdown) and scanWG
// tracks in-flight scan goroutines, so main.go can wait for them to actually
// stop before closing the database — see ScanHandler.
func RegisterRoutes(r fiber.Router, db store.Store, k8sMgr *k8s.Manager, backend agent.Backend, prGen *pr.Generator, appCtx context.Context, scanWG *sync.WaitGroup) {
	sh := &ScanHandler{db: db, k8s: k8sMgr, backend: backend, appCtx: appCtx, scanWG: scanWG}
	hh := &HistoryHandler{db: db}
	rh := &RecommendationsHandler{db: db, prGen: prGen}
	dh := &DockerHandler{}

	r.Post("/scan", sh.StartScan)
	r.Get("/scan/:id/stream", sh.StreamScan)
	r.Get("/history", hh.List)
	r.Get("/recommendations", rh.List)
	r.Get("/radar", rh.Radar)
	r.Post("/pr/generate", rh.GeneratePR)
	// Mutates state (sets resolved_at) — must not be a GET (cacheable/
	// prefetchable, and semantically wrong for a state change).
	r.Post("/findings/:id/resolve", rh.ResolveFinding)
	r.Get("/docker", dh.List)
}
