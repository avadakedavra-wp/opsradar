# OpsRadar — Kubernetes Operations Intelligence

> IBM Bob 2.0 Hackathon Project · Sep 25–27 2026

OpsRadar scans your live Kubernetes cluster using Bob Shell AI, streams real-time findings to a dashboard, and generates GitHub PRs with concrete YAML fixes — all from a single command.

---

## Quickstart (3 commands)

```bash
# 1. Clone
git clone https://github.com/avadakedavra-wp/opsradar.git && cd opsradar

# 2. Configure
cp .env.example .env
# Edit .env — set BOB_BIN, GITHUB_TOKEN, GITHUB_REPO

# 3. Run
docker compose up
```

Open **http://localhost:3000** → click **Scan Now** → watch Bob analyse your cluster live.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Docker + Docker Compose | For local quickstart |
| `~/.kube/config` | Pointing at your target cluster |
| [Bob Shell](https://bob.ibm.com/download/bobshell.sh) installed | `curl -fsSL https://bob.ibm.com/download/bobshell.sh \| bash` |
| metrics-server on cluster | `kubectl top pods` must work |
| GitHub PAT | Scopes: `repo` — for PR generation |

### Install Bob Shell (required)

```bash
curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash
# Verify
bob --version
```

---

## Features

- **Radar Heatmap** — namespace × severity grid, live-updated after each scan
- **Parallel AI Analysis** — one Bob Shell subprocess per deployment, all running concurrently
- **Live Log Stream** — watch each subagent's progress in real time via SSE
- **Recommendations** — severity-ranked findings with full explanation and YAML diff
- **One-click PR Generation** — Bob's diff patch → GitHub branch → Pull Request automatically
- **History Timeline** — track severity trends across scans over time
- **Docker Tab** — inspect local containers
- **Helm Deploy** — install in-cluster with least-privilege read-only RBAC

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `BOB_BIN` | `bob` | Path to Bob Shell binary |
| `KUBECONFIG` | `~/.kube/config` | Path to kubeconfig |
| `STORE_PATH` | `/data/ops-radar.db` | SQLite database path |
| `GITHUB_TOKEN` | — | GitHub PAT for PR generation |
| `GITHUB_REPO` | — | `owner/repo` target for PRs |
| `OPS_RADAR_API_KEY` | — | API auth key (blank = dev mode, no auth) |
| `PORT` | `8080` | API server port |

---

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full technical design.

---

## Helm Install (in-cluster)

```bash
helm install ops-radar ./deploy/helm \
  --set rbac.scope=namespace \
  --set rbac.namespaces="{default,prod}" \
  --set bob.apiKeySecretRef=ops-radar-bob-credentials
```

**Required secret before install:**
```bash
kubectl create secret generic ops-radar-bob-credentials \
  --from-literal=BOB_API_KEY=<your-key>
```

---

## Demo Seed

Apply intentional issues to your cluster for demo purposes:
```bash
kubectl create namespace ops-radar-demo
kubectl apply -k seed/demo-cluster/
```

This deploys workloads with: over-provisioned resources, missing probes, unpinned image tags, and missing limits — all designed to trigger vivid Bob findings.

---

## Development

```bash
# API (Go)
cd apps/api && go run main.go

# Dashboard (Next.js)
cd apps/dashboard && npm run dev
```
