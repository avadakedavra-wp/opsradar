# Development Guide

## Prerequisites

```bash
# Required
go 1.22+
node 20+
docker + docker compose
kubectl (with valid ~/.kube/config)

# Required for AI features
curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash
```

---

## Local Setup

```bash
git clone https://github.com/avadakedavra-wp/opsradar.git
cd opsradar

# Copy and edit environment variables
cp .env.example .env
```

Edit `.env`:
```bash
BOB_BIN=bob                          # or full path if not in PATH
KUBECONFIG=/Users/yourname/.kube/config
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
GITHUB_REPO=yourorg/your-k8s-configs
OPS_RADAR_API_KEY=                   # leave blank for dev (no auth)
```

---

## Running Locally (without Docker)

### API (Go)

```bash
cd apps/api
go run main.go
# API available at http://localhost:8080
```

### Dashboard (Next.js)

```bash
cd apps/dashboard
npm install
npm run dev
# Dashboard available at http://localhost:3000
```

---

## Running with Docker Compose

```bash
docker compose up --build
```

Both services start. API is at `:8080`, dashboard at `:3000`.

---

## Project Structure

```
opsradar/
├── apps/
│   ├── api/                    # Go / Fiber API server
│   │   ├── main.go
│   │   ├── handlers/           # HTTP handlers
│   │   ├── middleware/         # Auth middleware
│   │   └── go.mod
│   └── dashboard/              # Next.js 15 App Router
│       ├── app/                # Pages (App Router)
│       ├── components/         # Shared components
│       └── lib/api.ts          # API client
├── internal/                   # Shared Go packages
│   ├── agent/                  # Bob Shell integration
│   │   ├── interface.go        # Backend interface
│   │   ├── bob.go              # BobBackend implementation
│   │   └── orchestrator.go     # Parallel runner
│   ├── k8s/                    # Kubernetes connector
│   │   ├── client.go
│   │   └── scanner.go
│   ├── store/                  # SQLite persistence
│   │   ├── interface.go
│   │   ├── sqlite.go
│   │   └── migrations/
│   └── pr/                     # GitHub PR generator
│       └── generator.go
├── deploy/
│   ├── helm/                   # Helm chart
│   └── docker-compose.yml
├── seed/
│   └── demo-cluster/           # Intentionally broken manifests
└── docs/                       # This documentation
```

---

## Running Tests

```bash
# Unit tests (no cluster required)
cd apps/api && go test ./...

# Integration tests (requires live cluster)
cd apps/api && go test ./... -tags integration
```

---

## Building Docker Images

```bash
# API
docker build -f apps/api/Dockerfile -t opsradar-api .

# Dashboard
docker build -f apps/dashboard/Dockerfile -t opsradar-dashboard .
```

---

## Applying Demo Seed to Cluster

```bash
kubectl create namespace ops-radar-demo
kubectl apply -k seed/demo-cluster/
kubectl get deployments -n ops-radar-demo
```

This deploys workloads with intentional issues for demo purposes.

---

## Linting

```bash
# Go
cd apps/api && go vet ./...

# Next.js
cd apps/dashboard && npm run lint

# Helm
helm lint deploy/helm
```

---

## Common Issues

| Issue | Fix |
|---|---|
| `bob: command not found` | Install Bob Shell: `curl -fsSL https://bob.ibm.com/download/bobshell.sh \| bash` |
| `dial tcp: connection refused` | Check `~/.kube/config` points to a running cluster |
| `metrics.k8s.io not available` | Install metrics-server: `kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml` |
| SQLite locked | Only one process should write — check for duplicate API instances |
| PR generation fails | Verify `GITHUB_TOKEN` has `repo` scope and `GITHUB_REPO` is correct format `owner/repo` |
