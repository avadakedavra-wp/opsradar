package handlers

// StartScanRequest is the POST /scan body.
type StartScanRequest struct {
	ClusterName string `json:"cluster_name"`
	// ContextName restricts the scan to one kubeconfig context. Empty means
	// "every loaded context" (see k8s.Manager.ListScanTargets).
	ContextName string `json:"context_name"`
	Namespace   string `json:"namespace"`
}

// StartScanResponse is returned from POST /scan.
type StartScanResponse struct {
	ScanID string `json:"scan_id"`
}

// GeneratePRRequest is the POST /pr/generate body.
type GeneratePRRequest struct {
	FindingID string `json:"finding_id"`
}
