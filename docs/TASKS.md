# OpsRadar — Task Breakdown

This document maps every implementation task to its GitHub Issue. Tasks are designed to be worked sequentially (each unlocks the next), but within each task the implementation steps are independent.

---

## Task 1 — Repo Scaffold & Toolchain
**GitHub Issue: #1**
**Status:** In Progress

### Intent
Create the full monorepo skeleton, Go module, Next.js app, and Docker Compose so every subsequent task has a working place to land code.

### Files
- `apps/api/` — Go module, go.mod, main.go
- `apps/dashboard/` — Next.js 15 App Router + TypeScript + Tailwind
- `deploy/docker-compose.yml` — mounts kubeconfig, sets env vars
- `Makefile` — dev/build/lint targets
- `.env.example` — all required env vars documented
- `docs/README.md`, `docs/ARCHITECTURE.md`

### Acceptance Criteria
- [ ] `docker compose up` starts both services without errors
- [ ] `GET /health` returns `{"status":"ok"}`
- [ ] Dashboard loads at `http://localhost:3000`
- [ ] `go build ./...` passes with no errors
- [ ] `npm run build` passes with no errors

---

## Task 2 — SQLite Store
**GitHub Issue: #2**
**Status:** Pending

### Intent
Implement the persistence layer so all other layers have a place to write scan data, findings, and radar state.

### Files
- `internal/store/migrations/0001_init.sql` — schema
- `internal/store/interface.go` — Store interface + types
- `internal/store/sqlite.go` — full implementation
- `internal/store/postgres_stub.go` — compile-time stub

### Schema
```sql
scans (id, cluster_name, started_at, finished_at, status)
scan_targets (id, scan_id, namespace, deployment, cpu/mem metrics)
findings (id, scan_target_id, kind, severity, title, detail, suggestion, diff_patch, resolved_at)
```

### Key Design
- `resolved_at` is nullable — NULL = open finding, SET = resolved after PR merge
- `GetRadar()` aggregates from latest completed scan only
- `ListScans()` joins severity counts in a single query

### Acceptance Criteria
- [ ] `store.Open("/tmp/test.db")` succeeds and runs migrations
- [ ] CreateScan → CreateScanTarget → CreateFinding → ListFindings returns correct data
- [ ] ResolveFinding sets `resolved_at`; GetRadar excludes resolved findings
- [ ] PostgresStub compiles without errors

---

## Task 3 — K8s Connector
**GitHub Issue: #3**
**Status:** Pending

### Intent
Connect to a real cluster, pull Deployment manifests and live metrics, assemble `ScanTarget` structs ready for Bob analysis.

### Files
- `internal/k8s/client.go` — clientset builder (in-cluster → kubeconfig fallback)
- `internal/k8s/scanner.go` — ListScanTargets, MetricsSnapshot
- `internal/k8s/rbac_check.go` — SelfSubjectAccessReview permission check

### Key Design
- Tries `rest.InClusterConfig()` first (for Helm deploy), falls back to `~/.kube/config`
- Removes `managedFields` from manifest YAML before passing to Bob (keeps prompt tight)
- Metrics fetch is non-fatal: if metrics-server is missing, `MetricsSnapshot` is zero-valued and Bob still analyses the manifest

### Acceptance Criteria
- [ ] `NewClient("")` connects using `~/.kube/config`
- [ ] `ListScanTargets(ctx, "")` returns at least one target against a real cluster
- [ ] Manifest YAML is valid and parseable
- [ ] `VerifyPermissions` returns nil on a properly-configured cluster
- [ ] Non-zero metrics when metrics-server is present

---

## Task 4 — Bob Shell Agent Layer
**GitHub Issue: #4**
**Status:** Pending

### Intent
Invoke Bob Shell as a subprocess with a structured prompt per deployment, parse JSON findings, and run all tasks in parallel with live progress streaming.

### Files
- `internal/agent/interface.go` — Backend interface, Task/Finding/Result/ProgressEvent types
- `internal/agent/bob.go` — BobBackend, buildPrompt, parseFindings
- `internal/agent/orchestrator.go` — RunParallel with goroutine fan-out

### Bob Shell Invocation
```bash
bob -p "<prompt instructing JSON output>" --hide-intermediary-output --yolo
```
- Prompt ends with: `Respond ONLY with a valid JSON array. No markdown, no code fences.`
- `parseFindings` extracts first `[...]` block from stdout — handles any stray text before the array
- Each goroutine emits start/per-finding/done `ProgressEvent`s to the SSE channel

### Prompt Categories
| Kind | What Bob checks |
|---|---|
| `resource-audit` | Over-provisioning, missing limits, missing probes, unpinned images, security issues |
| `security-review` | Security-only subset (stub for hackathon) |
| `doc-check` | Labels, annotations, documentation (stub for hackathon) |

### Acceptance Criteria
- [ ] `bob` binary found in PATH (Bob Shell must be installed)
- [ ] `BobBackend.Run` returns at least one finding for an under-configured deployment
- [ ] `parseFindings` correctly parses a JSON array from stdout with preceding text
- [ ] `RunParallel` with 3 tasks runs all 3 concurrently (check timing)
- [ ] ProgressEvents are emitted for start, each finding, and completion

---

## Task 5 — Go/Fiber API Layer
**GitHub Issue: #5**
**Status:** Pending

### Intent
Wire all internal packages into HTTP handlers. Implement SSE for live scan streaming. Connect PR generation to real GitHub API.

### Files
- `apps/api/main.go` — Fiber setup, graceful shutdown
- `apps/api/middleware/auth.go` — X-API-Key header validation
- `apps/api/handlers/routes.go` — route registration
- `apps/api/handlers/scan.go` — POST /scan, GET /scan/:id/stream
- `apps/api/handlers/history.go` — GET /history
- `apps/api/handlers/recommendations.go` — GET /recommendations, GET /radar, POST /pr/generate
- `apps/api/handlers/docker.go` — GET /docker
- `apps/api/handlers/types.go` — request/response structs
- `internal/pr/generator.go` — GitHub API PR creation

### SSE Design
- `POST /scan` launches goroutine, creates `chan ProgressEvent` registered in `sync.Map[scanID]`
- `GET /scan/:id/stream` looks up channel, forwards events as `data: <json>\n\n`
- Channel is closed and removed from map when scan completes

### PR Generation Flow
1. Fetch finding by ID from SQLite
2. Extract `diff_patch` field
3. GitHub API: get default branch SHA → create branch `opsradar/fix-<id>` → commit patch → open PR
4. Return PR URL to dashboard

### Acceptance Criteria
- [ ] `POST /scan` returns `scan_id` within 200ms (async)
- [ ] `GET /scan/:id/stream` delivers SSE events while scan runs
- [ ] `GET /radar` returns correct namespace aggregation
- [ ] `POST /pr/generate` opens a real PR on GitHub (verify in repo)
- [ ] Auth middleware rejects requests with wrong API key

---

## Task 6 — Next.js Dashboard
**GitHub Issue: #6**
**Status:** Pending

### Intent
Build the four core pages that demonstrate OpsRadar's value. Prioritise the live scan stream and radar heatmap as primary demo screens.

### Files
- `apps/dashboard/lib/api.ts` — typed fetch wrappers for all endpoints
- `apps/dashboard/app/page.tsx` — Overview / Radar
- `apps/dashboard/app/scan/[id]/page.tsx` — Live scan stream
- `apps/dashboard/app/recommendations/page.tsx` — Findings list
- `apps/dashboard/app/history/page.tsx` — Timeline + chart
- `apps/dashboard/app/docker/page.tsx` — Container table
- `apps/dashboard/components/RadarHeatmap.tsx`
- `apps/dashboard/components/ScanLogStream.tsx`
- `apps/dashboard/components/RecommendationCard.tsx`
- `apps/dashboard/components/HistoryTimeline.tsx`

### Demo-Critical Screens
1. **Live Scan (`/scan/[id]`)** — terminal panels per namespace, SSE updates, shows goroutines running in parallel
2. **Radar (`/`)** — heatmap goes red → green after PR merge + resolve

### Acceptance Criteria
- [ ] Clicking "Scan Now" triggers scan and navigates to `/scan/<id>`
- [ ] Terminal panels show live Bob log lines as they arrive
- [ ] Radar heatmap colours match finding severity
- [ ] "Generate PR" button opens a real PR URL
- [ ] History page shows line chart with at least 2 data points

---

## Task 7 — Helm Chart & In-Cluster Deploy
**GitHub Issue: #7**
**Status:** Pending

### Intent
Package OpsRadar as a Helm chart for production in-cluster deployment with least-privilege RBAC.

### Files
- `deploy/helm/Chart.yaml`
- `deploy/helm/values.yaml`
- `deploy/helm/templates/deployment.yaml`
- `deploy/helm/templates/service.yaml`
- `deploy/helm/templates/serviceaccount.yaml`
- `deploy/helm/templates/clusterrole.yaml` (scope=cluster)
- `deploy/helm/templates/clusterrolebinding.yaml` (scope=cluster)
- `deploy/helm/templates/role.yaml` (scope=namespace)
- `deploy/helm/templates/rolebinding.yaml` (scope=namespace)
- `deploy/helm/templates/pvc.yaml`
- `deploy/helm/templates/NOTES.txt`

### RBAC Design
- `scope: cluster` → ClusterRole + ClusterRoleBinding (default)
- `scope: namespace` → Role + RoleBinding per namespace in `rbac.namespaces[]`
- No `secrets` access. No `create/update/delete` verbs. Ever.

### Acceptance Criteria
- [ ] `helm lint deploy/helm` passes with no errors
- [ ] `helm install` creates SA, role, and binding correctly
- [ ] Pod starts and API responds to `/health`
- [ ] `scope=namespace` creates per-namespace roles only

---

## Task 8 — Seed Demo Cluster & E2E Validation
**GitHub Issue: #8**
**Status:** Pending

### Intent
Plant deliberate problems in the cluster for a vivid demo, then validate the full end-to-end flow from scan to PR.

### Files
- `seed/demo-cluster/over-provisioned.yaml` — 4000m CPU, no probes, `nginx:latest`
- `seed/demo-cluster/missing-limits.yaml` — no resource requests or limits
- `seed/demo-cluster/kustomization.yaml` — `kubectl apply -k` deploys all

### Issues Seeded (Bob must find all of these)
| Manifest | Issues |
|---|---|
| `over-provisioned.yaml` | CPU over-provisioned (4000m req vs ~10m actual), no liveness probe, no readiness probe, unpinned `nginx:latest` image |
| `missing-limits.yaml` | No resource requests, no resource limits, no probes |

### Full Demo Flow
```
kubectl apply -k seed/demo-cluster/    # plant bugs
docker compose up                       # start OpsRadar
open http://localhost:3000              # open dashboard
# click Scan Now → watch live stream → see findings
# click Generate PR → verify PR on GitHub
# GET /findings/:id/resolve             # simulate merge
# click Scan Now again → Radar goes green
```

### Acceptance Criteria
- [ ] Both seed manifests deploy successfully to `ops-radar-demo` namespace
- [ ] Bob finds at least 4 distinct issues from the seeded manifests
- [ ] PR is created on GitHub with a valid YAML diff
- [ ] After resolve, `/radar` shows 0 critical for affected namespace
- [ ] README demo walkthrough section is accurate
