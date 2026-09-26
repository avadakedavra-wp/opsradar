package handlers

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/opsradar/k8s-ops-radar/api/internal/agent"
	"github.com/opsradar/k8s-ops-radar/api/internal/k8s"
	"github.com/opsradar/k8s-ops-radar/api/internal/store"
)

var (
	scanChannelsMu sync.Mutex
	scanChannels   = map[string]chan agent.ProgressEvent{}
)

// ScanHandler handles /scan endpoints.
type ScanHandler struct {
	db      store.Store
	k8s     *k8s.Client
	backend agent.Backend
}

// StartScan handles POST /scan.
func (h *ScanHandler) StartScan(c *fiber.Ctx) error {
	var req StartScanRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	if req.ClusterName == "" {
		req.ClusterName = "default-cluster"
	}

	scanID := uuid.New().String()

	if err := h.db.CreateScan(store.Scan{
		ID:          scanID,
		ClusterName: req.ClusterName,
		StartedAt:   time.Now().UTC(),
		Status:      "running",
	}); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	progressCh := make(chan agent.ProgressEvent, 512)
	scanChannelsMu.Lock()
	scanChannels[scanID] = progressCh
	scanChannelsMu.Unlock()

	go func() {
		defer func() {
			scanChannelsMu.Lock()
			delete(scanChannels, scanID)
			scanChannelsMu.Unlock()
			close(progressCh)
		}()

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()

		if h.k8s == nil {
			progressCh <- agent.ProgressEvent{TaskID: scanID, Message: "K8s client unavailable", Done: true}
			_ = h.db.UpdateScan(scanID, "failed", time.Now().UTC())
			return
		}

		targets, err := h.k8s.ListScanTargets(ctx, req.Namespace)
		if err != nil {
			progressCh <- agent.ProgressEvent{TaskID: scanID, Message: "error: " + err.Error(), Done: true}
			_ = h.db.UpdateScan(scanID, "failed", time.Now().UTC())
			return
		}

		progressCh <- agent.ProgressEvent{
			TaskID:  scanID,
			Message: fmt.Sprintf("found %d deployments — starting parallel analysis...", len(targets)),
		}

		tasks := make([]agent.Task, 0, len(targets))
		targetRecords := make([]store.ScanTarget, 0, len(targets))

		for _, t := range targets {
			targetID := uuid.New().String()
			targetRecords = append(targetRecords, store.ScanTarget{
				ID:           targetID,
				ScanID:       scanID,
				Namespace:    t.Namespace,
				Deployment:   t.Deployment,
				CPURequestM:  t.Usage.CPURequestM,
				CPUUsageM:    t.Usage.CPUUsageM,
				MemRequestMi: t.Usage.MemRequestMi,
				MemUsageMi:   t.Usage.MemUsageMi,
			})
			tasks = append(tasks, agent.Task{
				ID:     targetID,
				Target: fmt.Sprintf("%s/%s", t.Namespace, t.Deployment),
				Kind:   agent.KindResourceAudit,
				Context: map[string]string{
					"manifest":       t.Manifest,
					"namespace":      t.Namespace,
					"deployment":     t.Deployment,
					"cpu_request_m":  fmt.Sprintf("%d", t.Usage.CPURequestM),
					"cpu_usage_m":    fmt.Sprintf("%d", t.Usage.CPUUsageM),
					"mem_request_mi": fmt.Sprintf("%d", t.Usage.MemRequestMi),
					"mem_usage_mi":   fmt.Sprintf("%d", t.Usage.MemUsageMi),
				},
			})
		}

		for _, tr := range targetRecords {
			if err := h.db.CreateScanTarget(tr); err != nil {
				log.Printf("warn: failed to persist scan target %s: %v", tr.ID, err)
			}
		}

		results := agent.RunParallel(ctx, h.backend, tasks, progressCh)

		for _, result := range results {
			if result.Err != nil {
				log.Printf("agent error task %s: %v", result.TaskID, result.Err)
				continue
			}
			for _, f := range result.Findings {
				if err := h.db.CreateFinding(store.Finding{
					ID:           uuid.New().String(),
					ScanTargetID: result.TaskID,
					Kind:         string(agent.KindResourceAudit),
					Severity:     f.Severity,
					Title:        f.Title,
					Detail:       f.Detail,
					Suggestion:   f.Suggestion,
					DiffPatch:    f.DiffPatch,
				}); err != nil {
					log.Printf("warn: failed to persist finding: %v", err)
				}
			}
		}

		_ = h.db.UpdateScan(scanID, "completed", time.Now().UTC())
		progressCh <- agent.ProgressEvent{TaskID: scanID, Message: "✅ scan completed", Done: true}
	}()

	return c.Status(fiber.StatusAccepted).JSON(StartScanResponse{ScanID: scanID})
}

// StreamScan handles GET /scan/:id/stream — SSE live stream.
func (h *ScanHandler) StreamScan(c *fiber.Ctx) error {
	scanID := c.Params("id")

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("Transfer-Encoding", "chunked")

	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		scanChannelsMu.Lock()
		ch, ok := scanChannels[scanID]
		scanChannelsMu.Unlock()

		if !ok {
			_, _ = fmt.Fprintf(w, "data: {\"message\":\"scan not found or already completed\",\"done\":true}\n\n")
			_ = w.Flush()
			return
		}

		for event := range ch {
			data, _ := json.Marshal(event)
			_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
			if err := w.Flush(); err != nil {
				return
			}
		}
		_, _ = fmt.Fprintf(w, "data: {\"message\":\"stream closed\",\"done\":true}\n\n")
		_ = w.Flush()
	})
	return nil
}
