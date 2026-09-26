package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

const (
	ghAuthURL  = "https://github.com/login/oauth/authorize"
	ghTokenURL = "https://github.com/login/oauth/access_token"
)

// callbackURL is the redirect_uri GitHub returns to. It MUST exactly match the
// "Authorization callback URL" registered in the GitHub OAuth App. Priority:
// OAUTH_CALLBACK_URL env → derived from the incoming request host → default. The
// derived form means the callback tracks whatever host:port the API is reached on.
func callbackURL(c *fiber.Ctx) string {
	if v := os.Getenv("OAUTH_CALLBACK_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	host := c.Hostname() // includes port, e.g. "localhost:8080"
	if host == "" {
		host = "localhost:" + getEnvDefault("PORT", "8080")
	}
	return fmt.Sprintf("%s://%s/github/oauth/callback", c.Protocol(), host)
}

// dashboardSettingsURL returns where to send the user after OAuth. We prefer the
// dashboard origin the user actually started from (carried through the OAuth
// `state` param, so it works on any port), then OPSRADAR_DASHBOARD_URL, then the
// :3000 default. This is why changing only the dashboard port needs no GitHub change.
func dashboardSettingsURL(state string) string {
	if state != "" {
		if b, err := base64.RawURLEncoding.DecodeString(state); err == nil && len(b) > 0 {
			return strings.TrimRight(string(b), "/") + "/settings"
		}
	}
	if v := os.Getenv("OPSRADAR_DASHBOARD_URL"); v != "" {
		return strings.TrimRight(v, "/") + "/settings"
	}
	return "http://localhost:3000/settings"
}

func getEnvDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// GitHubOAuthStart handles GET /github/oauth/start
// Returns the GitHub OAuth URL for the frontend to redirect to.
func GitHubOAuthStart(c *fiber.Ctx) error {
	clientID := envOrFile("GITHUB_CLIENT_ID")
	if clientID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "GITHUB_CLIENT_ID not configured — enter it in Settings first",
		})
	}

	// Remember where the user came from so we can return them there after OAuth,
	// regardless of the dashboard's port. Prefer an explicit ?return=, then Origin.
	ret := c.Query("return")
	if ret == "" {
		ret = c.Get("Origin")
	}
	ret = strings.TrimRight(ret, "/")

	params := url.Values{}
	params.Set("client_id", clientID)
	params.Set("scope", "repo")
	params.Set("redirect_uri", callbackURL(c))
	if ret != "" {
		params.Set("state", base64.RawURLEncoding.EncodeToString([]byte(ret)))
	}

	return c.JSON(fiber.Map{
		"url": fmt.Sprintf("%s?%s", ghAuthURL, params.Encode()),
	})
}

// GitHubOAuthCallback handles GET /github/oauth/callback
// GitHub redirects here after the user approves/denies the OAuth app.
func GitHubOAuthCallback(c *fiber.Ctx) error {
	settingsURL := dashboardSettingsURL(c.Query("state"))

	if errParam := c.Query("error"); errParam != "" {
		desc := c.Query("error_description")
		return c.Redirect(settingsURL + "?github=error&msg=" + url.QueryEscape(desc))
	}

	code := c.Query("code")
	if code == "" {
		return c.Redirect(settingsURL + "?github=error&msg=no+code+returned")
	}

	clientID := envOrFile("GITHUB_CLIENT_ID")
	clientSecret := envOrFile("GITHUB_CLIENT_SECRET")
	if clientID == "" || clientSecret == "" {
		return c.Redirect(settingsURL + "?github=error&msg=missing+client+credentials")
	}

	ctx, cancel := context.WithTimeout(c.Context(), 20*time.Second)
	defer cancel()

	token, err := exchangeCode(ctx, clientID, clientSecret, code)
	if err != nil {
		return c.Redirect(settingsURL + "?github=error&msg=" + url.QueryEscape(err.Error()))
	}

	login, _ := getLoginFromToken(ctx, token)

	if writeErr := writeEnvFile(map[string]string{"GITHUB_TOKEN": token}); writeErr != nil {
		return c.Redirect(settingsURL + "?github=error&msg=save+failed")
	}
	os.Setenv("GITHUB_TOKEN", token)

	loginParam := ""
	if login != "" {
		loginParam = "&login=" + url.QueryEscape(login)
	}
	return c.Redirect(settingsURL + "?github=connected" + loginParam)
}

// GitHubOAuthStatus handles GET /github/oauth/status
// Returns whether GitHub is connected and the current login.
func GitHubOAuthStatus(c *fiber.Ctx) error {
	token := envOrFile("GITHUB_TOKEN")
	if token == "" {
		return c.JSON(fiber.Map{"connected": false})
	}

	ctx, cancel := context.WithTimeout(c.Context(), 10*time.Second)
	defer cancel()

	login, err := getLoginFromToken(ctx, token)
	if err != nil {
		return c.JSON(fiber.Map{"connected": false})
	}
	return c.JSON(fiber.Map{"connected": true, "login": login})
}

// envOrFile reads a key from the running process env first, then ~/.opsradar/.env.
func envOrFile(key string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return readEnvFile()[key]
}

func exchangeCode(ctx context.Context, clientID, clientSecret, code string) (string, error) {
	data := url.Values{}
	data.Set("client_id", clientID)
	data.Set("client_secret", clientSecret)
	data.Set("code", code)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ghTokenURL,
		strings.NewReader(data.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if result.Error != "" {
		return "", fmt.Errorf("%s: %s", result.Error, result.ErrorDesc)
	}
	if result.AccessToken == "" {
		return "", fmt.Errorf("no token returned from GitHub")
	}
	return result.AccessToken, nil
}

func getLoginFromToken(ctx context.Context, token string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/user", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var u struct {
		Login string `json:"login"`
	}
	json.NewDecoder(resp.Body).Decode(&u) //nolint:errcheck
	return u.Login, nil
}
