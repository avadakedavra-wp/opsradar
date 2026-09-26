package handlers

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"io"
	"os"
	"sync"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	k8sinternal "github.com/opsradar/k8s-ops-radar/api/internal/k8s"
	"k8s.io/client-go/tools/remotecommand"
)

// wsWriter serializes writes onto a websocket connection. The exec stream may
// write stdout from one goroutine while we write status frames from another, so
// a mutex is required — concurrent WriteMessage calls corrupt the frame stream.
type wsWriter struct {
	conn *websocket.Conn
	mu   *sync.Mutex
}

func (w *wsWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := w.conn.WriteMessage(websocket.TextMessage, p); err != nil {
		return 0, err
	}
	return len(p), nil
}

// clientMsg is the JSON envelope the browser terminal sends us.
//   - {"type":"stdin","data":"ls\n"}
//   - {"type":"resize","cols":120,"rows":30}
type clientMsg struct {
	Type string `json:"type"`
	Data string `json:"data"`
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// RegisterExecWebSocket wires the interactive pod-exec websocket onto the raw
// app (not the API-key group): a browser WebSocket handshake cannot set custom
// headers, so when OPS_RADAR_API_KEY is set the key is validated from ?key=.
func RegisterExecWebSocket(app *fiber.App, mgr *k8sinternal.Manager) {
	if mgr == nil {
		return
	}

	app.Use("/k8s/exec", func(c *fiber.Ctx) error {
		if !websocket.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}
		if secret := os.Getenv("OPS_RADAR_API_KEY"); secret != "" {
			given := c.Query("key")
			if len(given) != len(secret) || subtle.ConstantTimeCompare([]byte(given), []byte(secret)) != 1 {
				return fiber.ErrUnauthorized
			}
		}
		return c.Next()
	})

	app.Get("/k8s/exec/:namespace/:pod", websocket.New(execConn(mgr)))
}

func execConn(mgr *k8sinternal.Manager) func(*websocket.Conn) {
	return func(conn *websocket.Conn) {
		defer conn.Close()

		namespace := conn.Params("namespace")
		pod := conn.Params("pod")
		container := conn.Query("container")
		contextName := conn.Query("context")

		var mu sync.Mutex
		out := &wsWriter{conn: conn, mu: &mu}

		emit := func(s string) {
			mu.Lock()
			_ = conn.WriteMessage(websocket.TextMessage, []byte(s))
			mu.Unlock()
		}

		client, err := mgr.ClientForContext(contextName)
		if err != nil {
			emit("\r\n\x1b[31mexec error: " + err.Error() + "\x1b[0m\r\n")
			return
		}

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		stdinR, stdinW := io.Pipe()
		resizeCh := make(chan remotecommand.TerminalSize, 4)

		// Reader goroutine: browser → stdin / resize. Closing the pipe + resize
		// channel on disconnect unblocks the exec stream so it tears down cleanly.
		go func() {
			defer stdinW.Close()
			defer close(resizeCh)
			for {
				_, data, err := conn.ReadMessage()
				if err != nil {
					cancel()
					return
				}
				var msg clientMsg
				if err := json.Unmarshal(data, &msg); err != nil {
					_, _ = stdinW.Write(data) // tolerate raw stdin frames
					continue
				}
				switch msg.Type {
				case "stdin":
					_, _ = stdinW.Write([]byte(msg.Data))
				case "resize":
					if msg.Cols > 0 && msg.Rows > 0 {
						select {
						case resizeCh <- remotecommand.TerminalSize{Width: msg.Cols, Height: msg.Rows}:
						default: // drop if the queue is momentarily full
						}
					}
				}
			}
		}()

		// Prefer bash, fall back to sh. `exec` a missing binary is fatal in a
		// non-interactive `sh -c`, so guard with `command -v` — otherwise the
		// fallback chain never runs and the session dies with exit 127.
		cmd := []string{"/bin/sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash; else exec /bin/sh; fi"}

		err = client.ExecStream(ctx, namespace, pod, container, cmd, stdinR, out, nil, true, resizeCh)
		if err != nil {
			emit("\r\n\x1b[33m── session ended: " + err.Error() + " ──\x1b[0m\r\n")
			return
		}
		emit("\r\n\x1b[32m── session closed ──\x1b[0m\r\n")
	}
}
