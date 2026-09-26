# Architecture — OpsRadar

## Overview

OpsRadar is a three-tier system: a **Next.js dashboard**, a **Go/Fiber API**, and a set of **internal packages** that connect to Kubernetes, run Bob Shell subprocesses, persist findings to SQLite, and generate GitHub PRs.

```
┌─────────────────────────────────────────────────────┐
│                  Dashboard (Next.js 15)              │
│  /          /scan/[id]   /recommendations  /history  │
└──────────────────────┬──────────────────────────────┘
                       │ REST + SSE
┌──────────────────────▼──────────────────────────────┐
│                  API Layer (Go / Fiber)               │
│  POST /scan   GET /scan/:id/stream   GET /radar       │
│  GET /history  GET /recommendations  POST /pr/generate│
└──────┬────────────┬────────────┬────────────┬────────┘
       │            │            │            │
  ┌────▼───┐  ┌─────▼────┐ ┌────▼────┐ ┌────▼──────┐
  │K8s     │  │Bob Shell │ │SQLite   │ │GitHub API │
  │client- │  │subprocess│ │Store    │ │PR gen     │
  │go +    │  │(one per  │ │         │ │           │
  │metrics │  │namespace)│ │         │ │           │
  └────┬───┘  └──────────┘ └─────────┘ └───────────┘
       │
  ┌────▼──────────────────┐
  │ Real Cluster           │
  │ (GKE / EKS / AKS)     │
  │ + metrics-server       │
  └───────────────────────┘
```

---

## Component Details

### Dashboard (`apps/dashboard/`)

Next.js 15 App Router with TypeScript and Tailwind CSS.

| Page | Route | Purpose |
|---|---|---|
| Overview / Radar | `/` | Heatmap grid + scan trigger |
| Live Scan | `/scan/[id]` | SSE terminal-style log stream per subagent |
| Recommendations | `/recommendations` | Findings list with diff modal + PR button |
| History | `/history` | Timeline + Recharts severity trend graph |
| Docker | `/docker` | Local container table |

### API (`apps/api/`)

Go 1.22+ with Fiber v2. Stateless — all state in SQLite.

| Endpoint | Method | Description |
|---|---|---|
| `/scan` | POST | Start async scan, return `scan_id` immediately |
| `/scan/:id/stream` | GET | SSE stream of live Bob progress events |
| `/history` | GET | All scans with severity counts |
| `/recommendations` | GET | Findings for a scan (`?scan_id=`) |
| `/radar` | GET | Per-namespace severity for heatmap |
| `/pr/generate` | POST | Create GitHub PR from finding diff patch |
| `/findings/:id/resolve` | GET | Mark finding resolved (simulate post-merge) |
| `/docker` | GET | List local Docker containers |

### K8s Connector (`internal/k8s/`)

Uses `client-go` for Deployment manifests and `k8s.io/metrics` for live pod metrics. Tries in-cluster ServiceAccount first, falls back to `~/.kube/config`.

### Bob Shell Agent (`internal/agent/`)

- **`interface.go`** — `Backend` interface, `Task`, `Finding`, `Result`, `ProgressEvent` types
- **`bob.go`** — `BobBackend`: invokes `bob -p "<prompt>" --hide-intermediary-output --yolo` as subprocess; parses JSON array from stdout
- **`orchestrator.go`** — `RunParallel`: one goroutine per deployment task; emits `ProgressEvent` to SSE channel

**Prompt strategy:** The prompt explicitly instructs Bob to respond with a raw JSON array only. Long manifests are passed directly in the prompt string. Bob's `--hide-intermediary-output` flag ensures only the final response is in stdout.

### Store (`internal/store/`)

SQLite via `modernc.org/sqlite` (pure Go, no CGO). Schema: `scans` → `scan_targets` → `findings`. The `resolved_at` field on findings drives the Radar colour change after a PR is merged.

Interface is defined in `interface.go` — `PostgresStub` satisfies it for compile-time checking; full Postgres implementation is a post-hackathon task.

### PR Generator (`internal/pr/`)

Given a `finding_id`, fetches the `diff_patch` from SQLite and calls the GitHub REST API to:
1. Get the default branch SHA
2. Create a new branch `opsradar/fix-<finding-id>`
3. Commit the patch
4. Open a Pull Request

---

## Data Flow — Full Scan

```
User clicks "Scan Now"
  → POST /scan {cluster_name, namespace}
  → API creates scan record in SQLite (status=running)
  → API starts goroutine:
      → K8s connector lists Deployments + metrics
      → Creates scan_target records in SQLite
      → Builds agent.Task[] (one per deployment)
      → RunParallel fans out:
          goroutine 1: bob -p "analyse namespace-a/deploy-x ..." → parse JSON → store findings
          goroutine 2: bob -p "analyse namespace-b/deploy-y ..." → parse JSON → store findings
          goroutine N: ...
      → Each goroutine emits ProgressEvents to chan
  → SSE endpoint forwards ProgressEvents to browser
  → Dashboard terminal panels update in real time
  → Scan marked completed in SQLite
  → Radar heatmap refreshes
```

---

## RBAC (Least Privilege)

The scanner requires **read-only** access only. It never writes to the cluster. All remediation happens through PRs that humans review and merge.

```yaml
rules:
  - apiGroups: [""]
    resources: ["pods", "namespaces", "services"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets", "statefulsets", "daemonsets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["metrics.k8s.io"]
    resources: ["pods", "nodes"]
    verbs: ["get", "list"]
  # No secrets. No create/update/delete.
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Bob Shell via subprocess | No SDK available; `bob -p` non-interactive mode is stable and scriptable |
| `--hide-intermediary-output` | Ensures only final JSON is in stdout; eliminates thinking-step noise |
| JSON-only prompt instruction | Makes `parseFindings` robust; no regex parsing of markdown |
| One goroutine per deployment | Maximises parallelism; shows real concurrency in live stream demo |
| `resolved_at` field | Enables before/after Radar comparison in demo without a second scan |
| SQLite only | Zero-dependency persistence; interface allows Postgres swap post-hackathon |
| Pluggable `Backend` interface | Can swap Bob for another AI backend with a 1-file change |
