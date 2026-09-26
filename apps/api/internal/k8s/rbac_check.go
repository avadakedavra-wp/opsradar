package k8s

import (
	"context"
	"fmt"

	authv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// requiredPermissions is the minimal set OpsRadar needs.
var requiredPermissions = []authv1.ResourceAttributes{
	{Group: "apps", Resource: "deployments", Verb: "list"},
	{Group: "apps", Resource: "deployments", Verb: "get"},
	{Resource: "pods", Verb: "list"},
}

// VerifyPermissions uses SelfSubjectAccessReview to confirm the service account
// has each required permission. Returns an error describing missing permissions.
func (c *Client) VerifyPermissions(ctx context.Context) error {
	var missing []string
	for _, attr := range requiredPermissions {
		review := &authv1.SelfSubjectAccessReview{
			Spec: authv1.SelfSubjectAccessReviewSpec{
				ResourceAttributes: &attr,
			},
		}
		result, err := c.kube.AuthorizationV1().SelfSubjectAccessReviews().Create(
			ctx, review, metav1.CreateOptions{},
		)
		if err != nil {
			return fmt.Errorf("access review for %s/%s/%s: %w", attr.Group, attr.Resource, attr.Verb, err)
		}
		if !result.Status.Allowed {
			missing = append(missing, fmt.Sprintf("%s/%s %s", attr.Group, attr.Resource, attr.Verb))
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing permissions: %v", missing)
	}
	return nil
}

// VerifyAll runs VerifyPermissions against every loaded context (or just
// contextFilter, if non-empty) and returns a map of context name to the
// error found there. An empty map means every checked context is fine.
func (m *Manager) VerifyAll(ctx context.Context, contextFilter string) map[string]error {
	failures := map[string]error{}
	for _, c := range m.Clients {
		if contextFilter != "" && c.ContextName != contextFilter {
			continue
		}
		if err := c.VerifyPermissions(ctx); err != nil {
			failures[c.ContextName] = err
		}
	}
	return failures
}
