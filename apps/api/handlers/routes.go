package handlers

import (
	"context"
	"sync"

	"github.com/gofiber/fiber/v2"
	"github.com/opsradar/k8s-ops-radar/api/internal/agent"
	"github.com/opsradar/k8s-ops-radar/api/internal/k8s"
	"github.com/opsradar/k8s-ops-radar/api/internal/pr"
	"github.com/opsradar/k8s-ops-radar/api/internal/store"
)

// RegisterRoutes wires all handlers onto the given router group.
func RegisterRoutes(r fiber.Router, db store.Store, k8sMgr *k8s.Manager, backend agent.Backend, prGen *pr.Generator, appCtx context.Context, scanWG *sync.WaitGroup) {
	sh := &ScanHandler{db: db, k8s: k8sMgr, backend: backend, appCtx: appCtx, scanWG: scanWG}
	hh := &HistoryHandler{db: db}
	rh := &RecommendationsHandler{db: db, prGen: prGen}
	dh := &DockerHandler{}
	kh := &K8sHandler{k8s: k8sMgr, db: db}
	bh := &BobChatHandler{backend: backend, k8s: k8sMgr}
	gh := &GitHubHandler{backend: backend}

	r.Post("/scan", sh.StartScan)
	r.Get("/scan/:id/stream", sh.StreamScan)
	r.Get("/history", hh.List)
	r.Get("/recommendations", rh.List)
	r.Get("/radar", rh.Radar)
	r.Post("/pr/generate", rh.GeneratePR)
	r.Post("/findings/:id/resolve", rh.ResolveFinding)
	r.Get("/docker", dh.List)

	// Kubernetes operations
	r.Get("/k8s/contexts", kh.ListContexts)
	r.Get("/k8s/namespaces", kh.ListNamespaces)
	r.Get("/k8s/pods", kh.ListPods)
	r.Get("/k8s/pods/:namespace/:pod/logs", kh.GetPodLogs)
	r.Post("/k8s/deployments/restart", kh.RestartDeployment)
	r.Post("/k8s/deployments/scale", kh.ScaleDeployment)
	r.Delete("/k8s/pods/:namespace/:pod", kh.DeletePod)
	r.Post("/k8s/apply", kh.ApplyYAML)
	r.Post("/k8s/findings/:id/apply", kh.ApplyFinding)
	r.Get("/k8s/ha-analysis", kh.GetHAAnalysis)
	r.Get("/k8s/deployments", kh.ListDeployments)
	r.Get("/k8s/daemonsets", kh.ListDaemonSets)
	r.Get("/k8s/statefulsets", kh.ListStatefulSets)
	r.Get("/k8s/replicasets", kh.ListReplicaSets)
	r.Get("/k8s/jobs", kh.ListJobs)
	r.Get("/k8s/cronjobs", kh.ListCronJobs)

	// Settings — read/write ~/.opsradar/.env
	r.Get("/settings", GetSettings)
	r.Post("/settings", SaveSettings)
	r.Post("/settings/test", TestSetting)

	// Ask Bob
	r.Post("/bob/chat", bh.Chat)

	// GitHub local repos + AI scan + auto-fix PR
	r.Get("/github/repos", ListLocalRepos)
	r.Post("/github/scan", gh.ScanRepos)
	r.Post("/github/fix", gh.ApplyRepoFix)

	// GitHub OAuth App flow
	r.Get("/github/oauth/start", GitHubOAuthStart)
	r.Get("/github/oauth/callback", GitHubOAuthCallback)
	r.Get("/github/oauth/status", GitHubOAuthStatus)
}
