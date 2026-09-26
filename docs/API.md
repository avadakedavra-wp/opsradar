# API Reference

Base URL: `http://localhost:8080`

Auth: Set `X-API-Key: <value>` header if `OPS_RADAR_API_KEY` env var is configured. Omit in dev mode.

---

## POST /scan

Start a new cluster scan. Returns immediately with a `scan_id`. The scan runs asynchronously.

**Request**
```json
{
  "cluster_name": "my-cluster",
  "namespace": "default"
}
```
- `cluster_name` — label for the scan (any string)
- `namespace` — Kubernetes namespace to scan. Leave empty `""` to scan all namespaces.

**Response** `202 Accepted`
```json
{
  "scan_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

## GET /scan/:id/stream

Server-Sent Events stream of live progress from Bob Shell subagents.

**Headers returned**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Event format**
```
data: {"task_id":"abc123","namespace":"production","message":"▶ scanning production/api-server ...","done":false}

data: {"task_id":"abc123","namespace":"production","message":"[critical] Severe CPU over-provisioning","done":false}

data: {"task_id":"abc123","namespace":"production","message":"✔ done production/api-server — critical:1 warn:2 info:0","done":true}
```

Stream closes when all tasks are complete.

---

## GET /history

List all past scans with severity summary counts.

**Response** `200 OK`
```json
{
  "scans": [
    {
      "id": "550e8400-...",
      "cluster_name": "my-cluster",
      "started_at": "2026-09-25T10:00:00Z",
      "finished_at": "2026-09-25T10:02:30Z",
      "status": "completed",
      "critical": 3,
      "warn": 7,
      "info": 2
    }
  ]
}
```

---

## GET /recommendations?scan_id=

List all findings for a given scan, ordered by severity (critical first).

**Query params**
- `scan_id` (required) — UUID from `POST /scan`

**Response** `200 OK`
```json
{
  "findings": [
    {
      "id": "abc-123",
      "scan_target_id": "def-456",
      "kind": "resource-audit",
      "severity": "critical",
      "title": "Severe CPU over-provisioning",
      "detail": "CPU request is 4000m but actual usage is only 12m",
      "suggestion": "Reduce CPU request to 50m",
      "diff_patch": "--- a/deployment.yaml\n+++ ...",
      "namespace": "production",
      "deployment": "api-server"
    }
  ]
}
```

---

## GET /radar

Returns per-namespace severity aggregation from the most recent completed scan. Powers the heatmap.

**Response** `200 OK`
```json
{
  "radar": [
    { "namespace": "production", "critical": 2, "warn": 3, "info": 1 },
    { "namespace": "staging",    "critical": 0, "warn": 1, "info": 4 }
  ]
}
```

---

## POST /pr/generate

Create a GitHub Pull Request from a finding's diff patch.

**Request**
```json
{
  "finding_id": "abc-123"
}
```

**Response** `200 OK`
```json
{
  "pr_url": "https://github.com/org/repo/pull/42"
}
```

**Requirements**
- `GITHUB_TOKEN` env var must be set (PAT with `repo` scope)
- `GITHUB_REPO` env var must be set (e.g. `myorg/k8s-configs`)
- Finding must have a non-empty `diff_patch`

---

## GET /findings/:id/resolve

Mark a finding as resolved. Used to simulate a PR being merged during the demo. Sets `resolved_at` timestamp. After resolving, `/radar` will exclude this finding from severity counts.

**Response** `200 OK`
```json
{
  "resolved": true
}
```

---

## GET /docker

List local Docker containers.

**Response** `200 OK`
```json
{
  "containers": [
    {
      "id": "a1b2c3d4",
      "name": "ops-radar-api",
      "image": "ghcr.io/opsradar/api:latest",
      "status": "Up 2 hours",
      "created": "2026-09-25 10:00:00 +0000 UTC"
    }
  ]
}
```

---

## GET /health

Health check. No auth required.

**Response** `200 OK`
```json
{ "status": "ok" }
```
