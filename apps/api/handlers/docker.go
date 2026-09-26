package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"github.com/gofiber/fiber/v2"
)

// DockerHandler handles /docker.
type DockerHandler struct{}

type ContainerInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Image   string `json:"image"`
	Status  string `json:"status"`
	Created string `json:"created"`
}

func (h *DockerHandler) List(c *fiber.Ctx) error {
	containers, err := listContainers(c.Context())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"containers": containers})
}

func listContainers(ctx context.Context) ([]ContainerInfo, error) {
	format := `{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","created":"{{.CreatedAt}}"}`
	cmd := exec.CommandContext(ctx, "docker", "ps", "-a", "--format", format)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("docker ps: %w", err)
	}
	var containers []ContainerInfo
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		var ci ContainerInfo
		if err := json.Unmarshal([]byte(line), &ci); err == nil {
			containers = append(containers, ci)
		}
	}
	return containers, nil
}
