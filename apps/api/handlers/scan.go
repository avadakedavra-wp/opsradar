package handlers

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
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
	k8s     *k8s.Manager
	backend agent.Backend

	// appCtx is cancelled on server shutdown; every scan's timeout is derived
	// from it so in-flight scans are cut short (and marked failed) instead of
	// racing a closed DB connection during shutdown. scanWG tracks them so
	// main.go can wait for them to actually stop.
	appCtx context.Context
	scanWG *sync.WaitGroup
}

func scanTimeout() time.Duration {
	if v := os.Getenv("BOB_SCAN_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	}
	return 10 * time.Minute
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

	// Fail fast, before creating any DB row, for conditions that would doom
	// every task anyway — this is what stops a broken dependency from
	// producing a scan that silently finds nothing and reports "completed".
	if h.k8s == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "kubernetes unavailable — check KUBECONFIG"})
	}
	if err := h.backend.Ready(); err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "agent backend unavailable: " + err.Error()})
	}

	rbacFailures := h.k8s.VerifyAll(c.Context(), req.ContextName)
	if blockingRBACFailure(h.k8s, req.ContextName, rbacFailures) {
		return c.Status(fiber.StatusPreconditionFailed).JSON(fiber.Map{
			"error":   "missing kubernetes permissions",
			"details": describeRBACFailures(rbacFailures),
		})
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

	h.scanWG.Add(1)
	go func() {
		defer h.scanWG.Done()
		defer func() {
			scanChannelsMu.Lock()
			delete(scanChannels, scanID)
			scanChannelsMu.Unlock()
			close(progressCh)
		}()

		ctx, cancel := context.WithTimeout(h.appCtx, scanTimeout())
		defer cancel()

		send := func(e agent.ProgressEvent) {
			select {
			case progressCh <- e:
			case <-ctx.Done():
			}
		}

		targets, err := h.k8s.ListScanTargets(ctx, req.ContextName, req.Namespace)
		if err != nil {
			send(agent.ProgressEvent{TaskID: scanID, Message: "error: " + err.Error(), Done: true})
			_ = h.db.UpdateScan(scanID, "failed", time.Now().UTC())
			return
		}

		send(agent.ProgressEvent{
			TaskID:  scanID,
			Message: fmt.Sprintf("found %d deployments — starting parallel analysis...", len(targets)),
		})
		if len(rbacFailures) > 0 {
			send(agent.ProgressEvent{
				TaskID:  scanID,
				Message: fmt.Sprintf("⚠️ skipping context(s) with missing permissions: %s", describeRBACFailures(rbacFailures)),
			})
		}

		tasks := make([]agent.Task, 0, len(targets))
		targetRecords := make([]store.ScanTarget, 0, len(targets))

		for _, t := range targets {
			targetID := uuid.New().String()
			targetRecords = append(targetRecords, store.ScanTarget{
				ID:           targetID,
				ScanID:       scanID,
				ContextName:  t.ContextName,
				Namespace:    t.Namespace,
				Deployment:   t.Deployment,
				CPURequestM:  t.Usage.CPURequestM,
				CPUUsageM:    t.Usage.CPUUsageM,
				MemRequestMi: t.Usage.MemRequestMi,
				MemUsageMi:   t.Usage.MemUsageMi,
			})
			tasks = append(tasks, agent.Task{
				ID:             targetID,
				Target:         fmt.Sprintf("%s/%s", t.Namespace, t.Deployment),
				Kind:           agent.KindResourceAudit,
				GitHubRepo:     t.GitHubRepo,
				SourceManifest: t.SourceManifest,
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

		status, failed, total, summary := classifyStatus(results, rbacFailures)
		if err := h.db.FinishScan(scanID, status, time.Now().UTC(), failed, total, summary); err != nil {
			log.Printf("warn: failed to finish scan %s: %v", scanID, err)
		}
		send(agent.ProgressEvent{
			TaskID:  scanID,
			Message: fmt.Sprintf("scan %s — %d/%d task(s) failed", status, failed, total),
			Done:    true,
		})
	}()

	return c.Status(fiber.StatusAccepted).JSON(StartScanResponse{ScanID: scanID})
}

// classifyStatus derives an honest terminal status from what actually
// happened during the scan — it must never return "completed" unless every
// task genuinely succeeded and no context was skipped for missing RBAC.
//
//   - "completed"              — every task succeeded, nothing skipped
//   - "completed_with_errors"  — some tasks failed, or a context was skipped,
//     but at least one thing succeeded
//   - "failed"                 — every task failed (or there were tasks to
//     run but none could be attempted)
func classifyStatus(results []agent.Result, rbacFailures map[string]error) (status string, failedCount, total int, summary string) {
	total = len(results)
	var errs []string
	for _, r := range results {
		if r.Err != nil {
			failedCount++
			errs = append(errs, fmt.Sprintf("%s: %v", r.TaskID, r.Err))
		}
	}
	degraded := len(rbacFailures) > 0
	for ctxName, err := range rbacFailures {
		errs = append(errs, fmt.Sprintf("context %s: %v", ctxName, err))
	}

	switch {
	case total == 0 && !degraded:
		status = "completed" // genuinely nothing to scan (e.g. empty namespace) — not a failure
	case total > 0 && failedCount == total:
		status = "failed"
	case failedCount > 0 || degraded:
		status = "completed_with_errors"
	default:
		status = "completed"
	}

	const maxSummary = 3
	if len(errs) > maxSummary {
		summary = strings.Join(errs[:maxSummary], "; ") + fmt.Sprintf("; and %d more", len(errs)-maxSummary)
	} else {
		summary = strings.Join(errs, "; ")
	}
	return status, failedCount, total, summary
}

// blockingRBACFailure decides whether missing permissions should stop the
// scan outright: either the one context the caller asked for is broken, or
// every loaded context is.
func blockingRBACFailure(mgr *k8s.Manager, contextFilter string, failures map[string]error) bool {
	if len(failures) == 0 {
		return false
	}
	if contextFilter != "" {
		return true // the single context requested is unusable
	}
	return len(failures) >= len(mgr.Clients) // every context is unusable
}

func describeRBACFailures(failures map[string]error) string {
	parts := make([]string, 0, len(failures))
	for ctxName, err := range failures {
		parts = append(parts, fmt.Sprintf("%s (%v)", ctxName, err))
	}
	return strings.Join(parts, ", ")
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
