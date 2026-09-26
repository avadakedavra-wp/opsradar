package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/opsradar/k8s-ops-radar/api/internal/agent"
	"github.com/opsradar/k8s-ops-radar/api/internal/k8s"
	"github.com/opsradar/k8s-ops-radar/api/internal/pr"
	"github.com/opsradar/k8s-ops-radar/api/internal/store"
)

// RegisterRoutes wires all handlers onto the given router group.
func RegisterRoutes(r fiber.Router, db store.Store, k8sClient *k8s.Client, backend agent.Backend, prGen *pr.Generator) {
	sh := &ScanHandler{db: db, k8s: k8sClient, backend: backend}
	hh := &HistoryHandler{db: db}
	rh := &RecommendationsHandler{db: db, prGen: prGen}
	dh := &DockerHandler{}

	r.Post("/scan", sh.StartScan)
	r.Get("/scan/:id/stream", sh.StreamScan)
	r.Get("/history", hh.List)
	r.Get("/recommendations", rh.List)
	r.Get("/radar", rh.Radar)
	r.Post("/pr/generate", rh.GeneratePR)
	r.Get("/findings/:id/resolve", rh.ResolveFinding)
	r.Get("/docker", dh.List)
}
