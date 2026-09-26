package k8s

import (
	"fmt"
	"os"
	"strings"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	metricsv1beta1 "k8s.io/metrics/pkg/client/clientset/versioned"
)

// Client wraps clientsets for a single kubeconfig context.
type Client struct {
	ContextName string
	ClusterName string
	kube        kubernetes.Interface
	metrics     metricsv1beta1.Interface
	restCfg     *rest.Config
}

// Manager holds clients for every context in the kubeconfig.
type Manager struct {
	Clients []*Client // one per kubeconfig context
}

// kubeconfigPath returns the resolved kubeconfig file path.
func kubeconfigPath(override string) string {
	if override != "" {
		return expandHome(override)
	}
	if v := os.Getenv("KUBECONFIG"); v != "" {
		return expandHome(v)
	}
	return os.Getenv("HOME") + "/.kube/config"
}

// expandHome expands a leading "~/" to $HOME. Neither the OS nor Go's file
// APIs do shell-style tilde expansion, so a literal "~/.kube/config" (an easy
// thing to type by habit, and what this project's own .env.example used to
// default to) would otherwise fail to open as a real path.
func expandHome(path string) string {
	if !strings.HasPrefix(path, "~/") {
		return path
	}
	home := os.Getenv("HOME")
	if home == "" {
		return path
	}
	return home + path[1:]
}

// LoadAll reads the kubeconfig and builds a Client for every context.
// Contexts that fail to connect are logged but not fatal — the Manager
// is returned with whatever clients could be built.
func LoadAll(kubeconfigOverride string) (*Manager, error) {
	path := kubeconfigPath(kubeconfigOverride)

	rawCfg, err := clientcmd.LoadFromFile(path)
	if err != nil {
		return nil, fmt.Errorf("load kubeconfig %s: %w", path, err)
	}

	mgr := &Manager{}
	for contextName, ctx := range rawCfg.Contexts {
		client, err := newClientForContext(path, rawCfg, contextName, ctx)
		if err != nil {
			// non-fatal: cluster may be unreachable
			continue
		}
		mgr.Clients = append(mgr.Clients, client)
	}
	return mgr, nil
}

// ContextNames returns the name of every loaded context.
func (m *Manager) ContextNames() []string {
	names := make([]string, len(m.Clients))
	for i, c := range m.Clients {
		names[i] = c.ContextName
	}
	return names
}

func newClientForContext(
	kubeconfigPath string,
	rawCfg *clientcmdapi.Config,
	contextName string,
	ctx *clientcmdapi.Context,
) (*Client, error) {
	overrides := &clientcmd.ConfigOverrides{CurrentContext: contextName}
	loader := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		&clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath},
		overrides,
	)
	restCfg, err := loader.ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("rest config for context %s: %w", contextName, err)
	}

	kube, err := kubernetes.NewForConfig(restCfg)
	if err != nil {
		return nil, fmt.Errorf("kube client for context %s: %w", contextName, err)
	}

	clusterName := ctx.Cluster
	if clusterName == "" {
		clusterName = contextName
	}

	client := &Client{
		ContextName: contextName,
		ClusterName: clusterName,
		kube:        kube,
		restCfg:     restCfg,
	}

	// metrics-server is optional
	if mc, err := metricsv1beta1.NewForConfig(restCfg); err == nil {
		client.metrics = mc
	}

	return client, nil
}
