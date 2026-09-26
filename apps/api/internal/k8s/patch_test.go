package k8s

import (
	"encoding/json"
	"reflect"
	"testing"

	corev1 "k8s.io/api/core/v1"
)

// TestBuildFragmentPatch verifies that the fix artifacts Bob now emits
// (strategic merge patches) route to a correct Deployment-rooted patch, and
// that bare fragments are wrapped under the right path instead of corrupting
// the pod template.
func TestBuildFragmentPatch(t *testing.T) {
	containers := []corev1.Container{{Name: "traefik"}}

	cases := []struct {
		name     string
		fragment string
		want     map[string]interface{}
	}{
		{
			name:     "spec-rooted replicas passes through unchanged",
			fragment: `{"spec":{"replicas":2}}`,
			want:     map[string]interface{}{"spec": map[string]interface{}{"replicas": float64(2)}},
		},
		{
			name:     "spec-rooted container resources passes through unchanged",
			fragment: `{"spec":{"template":{"spec":{"containers":[{"name":"traefik","resources":{"requests":{"cpu":"10m","memory":"128Mi"}}}]}}}}`,
			want: map[string]interface{}{"spec": map[string]interface{}{"template": map[string]interface{}{"spec": map[string]interface{}{
				"containers": []interface{}{map[string]interface{}{
					"name":      "traefik",
					"resources": map[string]interface{}{"requests": map[string]interface{}{"cpu": "10m", "memory": "128Mi"}},
				}},
			}}}},
		},
		{
			name:     "bare replicas is wrapped under spec, not a container",
			fragment: `{"replicas":2}`,
			want:     map[string]interface{}{"spec": map[string]interface{}{"replicas": float64(2)}},
		},
		{
			name:     "bare container-level resources is wrapped under the named container",
			fragment: `{"resources":{"requests":{"cpu":"10m"}}}`,
			want: map[string]interface{}{"spec": map[string]interface{}{"template": map[string]interface{}{"spec": map[string]interface{}{
				"containers": []interface{}{map[string]interface{}{
					"name":      "traefik",
					"resources": map[string]interface{}{"requests": map[string]interface{}{"cpu": "10m"}},
				}},
			}}}},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, err := buildFragmentPatch(tc.fragment, containers)
			if err != nil {
				t.Fatalf("buildFragmentPatch: %v", err)
			}
			var got map[string]interface{}
			if err := json.Unmarshal(out, &got); err != nil {
				t.Fatalf("unmarshal result: %v", err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("patch mismatch\n got: %v\nwant: %v", got, tc.want)
			}
		})
	}
}

// TestLooksLikeFullManifest guards the routing decision: merge-patch fragments
// must NOT be mistaken for full manifests (which would send them to ApplyYAML
// and fail with "Object 'Kind' is missing").
func TestLooksLikeFullManifest(t *testing.T) {
	cases := map[string]bool{
		`{"spec":{"replicas":2}}`:                     false,
		`{"resources":{"requests":{"cpu":"10m"}}}`:    false,
		"apiVersion: apps/v1\nkind: Deployment\n":     true,
		`{"apiVersion":"apps/v1","kind":"Deployment"}`: true,
	}
	for in, want := range cases {
		if got := looksLikeFullManifest(in); got != want {
			t.Errorf("looksLikeFullManifest(%q) = %v, want %v", in, got, want)
		}
	}
}
