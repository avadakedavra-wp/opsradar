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
