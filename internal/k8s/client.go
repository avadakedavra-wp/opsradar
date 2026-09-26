package k8s

import (
	"fmt"
	"os"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	metricsv1beta1 "k8s.io/metrics/pkg/client/clientset/versioned"
)

// Client wraps the Kubernetes and Metrics clientsets.
type Client struct {
	kube    kubernetes.Interface
	metrics metricsv1beta1.Interface
}

// NewClient builds a Client. kubeconfigPath may be empty — tries in-cluster first,
// then falls back to the path (or $KUBECONFIG / $HOME/.kube/config).
func NewClient(kubeconfigPath string) (*Client, error) {
	cfg, err := rest.InClusterConfig()
	if err != nil {
		// fallback to kubeconfig
		if kubeconfigPath == "" {
			kubeconfigPath = os.Getenv("KUBECONFIG")
		}
		if kubeconfigPath == "" {
			kubeconfigPath = os.Getenv("HOME") + "/.kube/config"
		}
		cfg, err = clientcmd.BuildConfigFromFlags("", kubeconfigPath)
		if err != nil {
			return nil, fmt.Errorf("build kubeconfig: %w", err)
		}
	}

	kube, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("build kube client: %w", err)
	}

	metrics, err := metricsv1beta1.NewForConfig(cfg)
	if err != nil {
		// metrics-server not mandatory
		return &Client{kube: kube}, nil
	}

	return &Client{kube: kube, metrics: metrics}, nil
}
