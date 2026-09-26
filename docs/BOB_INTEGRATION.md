# Bob Shell Integration Guide

This document explains how OpsRadar uses Bob Shell for AI analysis.

---

## How It Works

OpsRadar invokes Bob Shell as a **subprocess** in non-interactive mode for each deployment it scans. Multiple Bob subprocesses run concurrently — one per deployment — and their live output is streamed to the dashboard.

### The Command

```bash
bob -p "<structured prompt>" --hide-intermediary-output --yolo
```

| Flag | Purpose |
|---|---|
| `-p "<prompt>"` | Non-interactive prompt mode |
| `--hide-intermediary-output` | Output ONLY the final response (no thinking steps) |
| `--yolo` | Auto-approve all tool calls (safe: Bob only reads context we provide) |

---

## Install Bob Shell

```bash
# macOS / Linux
curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash

# Verify
bob --version

# If not in PATH, add to shell profile:
export PATH="$HOME/.local/bin:$PATH"
```

Set the binary path in your environment if non-standard:
```bash
BOB_BIN=/path/to/bob docker compose up
```

---

## Prompt Design

Each prompt:
1. Provides the full Deployment YAML manifest
2. Provides live CPU and memory metrics
3. Specifies exactly what to look for
4. **Instructs Bob to respond with a raw JSON array only** — no markdown, no code fences

### Example Prompt (resource-audit)

```
You are a Kubernetes operations expert. Analyse the following Kubernetes Deployment manifest.

Deployment: production/api-server

--- MANIFEST YAML ---
apiVersion: apps/v1
kind: Deployment
...
--- END MANIFEST ---

Resource Metrics:
- CPU Request: 4000m | CPU Actual Usage: 12m
- Memory Request: 2048Mi | Memory Actual Usage: 128Mi

Find ALL issues in these categories:
1. Over-provisioning (CPU/Memory requests >> actual usage by >3x)
2. Missing or incorrect resource limits
3. Missing liveness or readiness probes
4. Unpinned image tags (e.g. "latest" or no digest)
5. Security issues (running as root, privileged containers, etc.)

IMPORTANT: Respond ONLY with a valid JSON array. No markdown, no explanation, no code fences.

Format:
[
  {
    "severity": "critical|warn|info",
    "title": "short title",
    "detail": "explanation",
    "suggestion": "how to fix",
    "diff_patch": "--- a/deployment.yaml\n+++ b/deployment.yaml\n..."
  }
]
```

### Expected Bob Response

```json
[
  {
    "severity": "critical",
    "title": "Severe CPU over-provisioning",
    "detail": "CPU request is 4000m but actual usage is only 12m — a 333x over-allocation wasting cluster resources.",
    "suggestion": "Reduce CPU request to 50m and limit to 200m based on observed usage.",
    "diff_patch": "--- a/deployment.yaml\n+++ b/deployment.yaml\n@@ -20,6 +20,6 @@\n         resources:\n           requests:\n-            cpu: \"4000m\"\n+            cpu: \"50m\"\n           limits:\n-            cpu: \"4000m\"\n+            cpu: \"200m\""
  },
  {
    "severity": "warn",
    "title": "Missing liveness probe",
    "detail": "No liveness probe defined. Kubernetes cannot detect if the container is deadlocked.",
    "suggestion": "Add a liveness probe with an appropriate httpGet or tcpSocket check.",
    "diff_patch": ""
  }
]
```

---

## Parsing Strategy

`parseFindings` in `internal/agent/bob.go` is tolerant — it finds the first `[` and last `]` in stdout and attempts to parse the JSON between them. This handles cases where Bob includes a small amount of text before the array despite `--hide-intermediary-output`.

---

## Parallel Execution

`RunParallel` in `internal/agent/orchestrator.go` launches one goroutine per deployment:

```go
for _, task := range tasks {
    go func(t Task) {
        // This spawns one `bob -p ...` subprocess
        result := backend.Run(ctx, t)
        // Emit progress events to SSE channel
        progressCh <- ProgressEvent{...}
    }(task)
}
```

On a cluster with 10 deployments, 10 Bob subprocesses run simultaneously. The dashboard shows 10 terminal panels updating in real time — this is the primary demo "wow factor".

---

## Timeouts and Error Handling

- Each Bob subprocess has a **3-minute timeout** (configurable via context)
- If Bob times out or returns a non-zero exit code, the task emits an error `ProgressEvent` and the scan continues for other deployments
- If Bob's output cannot be parsed as JSON, the finding list is empty (not a fatal error)
- The overall scan has a **10-minute timeout** regardless of individual task outcomes

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `bob: command not found` | Install Bob Shell: `curl -fsSL https://bob.ibm.com/download/bobshell.sh \| bash` |
| `bob` found but scan returns no findings | Check `BOB_BIN` env var; run `bob -p "hello" --hide-intermediary-output` manually |
| Bob returns markdown instead of JSON | The prompt instructs JSON — this may happen on first run; re-scan usually fixes it |
| Scan times out | Reduce namespace scope with `POST /scan {"namespace": "default"}` |
