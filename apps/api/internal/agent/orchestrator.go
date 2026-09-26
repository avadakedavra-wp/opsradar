package agent

import (
	"context"
	"fmt"
	"sync"
)

// RunParallel fans out all tasks to the backend concurrently.
// ProgressEvents are written to progressCh as each task starts, produces findings, and completes.
// Returns all results once every goroutine finishes.
func RunParallel(ctx context.Context, backend Backend, tasks []Task, progressCh chan<- ProgressEvent) []Result {
	results := make([]Result, len(tasks))
	var wg sync.WaitGroup

	for i, task := range tasks {
		wg.Add(1)
		go func(idx int, t Task) {
			defer wg.Done()

			select {
			case <-ctx.Done():
				results[idx] = Result{TaskID: t.ID, Err: ctx.Err()}
				return
			default:
			}

			progressCh <- ProgressEvent{
				TaskID:  t.ID,
				Message: fmt.Sprintf("🔍 analysing %s (%s)...", t.Target, t.Kind),
			}

			result := backend.Run(t)
			results[idx] = result

			if result.Err != nil {
				progressCh <- ProgressEvent{
					TaskID:  t.ID,
					Message: fmt.Sprintf("❌ %s failed: %v", t.Target, result.Err),
				}
				return
			}

			for i := range result.Findings {
				f := result.Findings[i]
				progressCh <- ProgressEvent{
					TaskID:  t.ID,
					Message: fmt.Sprintf("[%s] %s — %s", f.Severity, t.Target, f.Title),
					Finding: &f,
				}
			}

			progressCh <- ProgressEvent{
				TaskID:  t.ID,
				Message: fmt.Sprintf("✅ %s done — %d finding(s)", t.Target, len(result.Findings)),
			}
		}(i, task)
	}

	wg.Wait()
	return results
}
