package agent

import (
	"context"
	"fmt"
	"sync"
)

// RunParallel fans out all tasks to the backend concurrently.
// ProgressEvents are written to progressCh as each task starts, produces findings, and completes.
// Returns all results once every goroutine finishes.
//
// Every send to progressCh is guarded against ctx cancellation. Without this,
// a goroutine can block forever on an unbuffered/full channel if nothing is
// reading it (e.g. the SSE client disconnected), which would leave the scan
// stuck at "running" forever since wg.Wait() below would never return.
func RunParallel(ctx context.Context, backend Backend, tasks []Task, progressCh chan<- ProgressEvent) []Result {
	results := make([]Result, len(tasks))
	var wg sync.WaitGroup

	send := func(e ProgressEvent) {
		select {
		case progressCh <- e:
		case <-ctx.Done():
		}
	}

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

			send(ProgressEvent{
				TaskID:  t.ID,
				Message: fmt.Sprintf("🔍 analysing %s (%s)...", t.Target, t.Kind),
			})

			result := backend.Run(ctx, t)
			results[idx] = result

			if result.Err != nil {
				send(ProgressEvent{
					TaskID:  t.ID,
					Message: fmt.Sprintf("❌ %s failed: %v", t.Target, result.Err),
				})
				return
			}

			for i := range result.Findings {
				f := result.Findings[i]
				send(ProgressEvent{
					TaskID:  t.ID,
					Message: fmt.Sprintf("[%s] %s — %s", f.Severity, t.Target, f.Title),
					Finding: &f,
				})
			}

			send(ProgressEvent{
				TaskID:  t.ID,
				Message: fmt.Sprintf("✅ %s done — %d finding(s)", t.Target, len(result.Findings)),
			})
		}(i, task)
	}

	wg.Wait()
	return results
}
