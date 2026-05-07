package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type CloudClient struct {
	baseURL    string
	httpClient *http.Client
}

type cloudAuthResponse struct {
	User      User      `json:"user"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

type cloudDesktopAuthResponse struct {
	User      User          `json:"user"`
	Device    DesktopDevice `json:"device"`
	Token     string        `json:"token"`
	ExpiresAt time.Time     `json:"expires_at"`
}

func NewCloudClient(baseURL string) *CloudClient {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil
	}

	return &CloudClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

func (c *CloudClient) Login(ctx context.Context, input LoginInput) (cloudAuthResponse, error) {
	return c.postAuth(ctx, "/api/auth/login", input)
}

func (c *CloudClient) Register(ctx context.Context, input RegisterInput) (cloudAuthResponse, error) {
	return c.postAuth(ctx, "/api/auth/register", input)
}

func (c *CloudClient) DesktopLogin(ctx context.Context, input DesktopLoginInput) (cloudDesktopAuthResponse, error) {
	return c.postDesktopAuth(ctx, "/api/desktop/auth/login", input)
}

func (c *CloudClient) DesktopRegister(ctx context.Context, input DesktopRegisterInput) (cloudDesktopAuthResponse, error) {
	return c.postDesktopAuth(ctx, "/api/desktop/auth/register", input)
}

func (c *CloudClient) postAuth(ctx context.Context, route string, payload any) (cloudAuthResponse, error) {
	if c == nil || c.baseURL == "" {
		return cloudAuthResponse{}, fmt.Errorf("cloud auth client is not configured")
	}

	endpoint, err := url.JoinPath(c.baseURL, route)
	if err != nil {
		return cloudAuthResponse{}, fmt.Errorf("build cloud auth URL: %w", err)
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return cloudAuthResponse{}, fmt.Errorf("encode cloud auth request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return cloudAuthResponse{}, fmt.Errorf("create cloud auth request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "whatsapp-agent-desktop/0.1")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return cloudAuthResponse{}, fmt.Errorf("call cloud auth: %w", err)
	}
	defer resp.Body.Close()

	var response struct {
		User      User      `json:"user"`
		Token     string    `json:"token"`
		ExpiresAt time.Time `json:"expires_at"`
		Error     string    `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return cloudAuthResponse{}, fmt.Errorf("decode cloud auth response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := strings.TrimSpace(response.Error)
		if message == "" {
			message = resp.Status
		}
		return cloudAuthResponse{}, fmt.Errorf("cloud auth rejected request: %s", message)
	}
	if strings.TrimSpace(response.User.ID) == "" || strings.TrimSpace(response.User.Email) == "" {
		return cloudAuthResponse{}, fmt.Errorf("cloud auth returned incomplete user")
	}

	return cloudAuthResponse{
		User:      response.User,
		Token:     strings.TrimSpace(response.Token),
		ExpiresAt: response.ExpiresAt,
	}, nil
}

func (c *CloudClient) postDesktopAuth(ctx context.Context, route string, payload any) (cloudDesktopAuthResponse, error) {
	if c == nil || c.baseURL == "" {
		return cloudDesktopAuthResponse{}, fmt.Errorf("cloud auth client is not configured")
	}

	endpoint, err := url.JoinPath(c.baseURL, route)
	if err != nil {
		return cloudDesktopAuthResponse{}, fmt.Errorf("build cloud desktop auth URL: %w", err)
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return cloudDesktopAuthResponse{}, fmt.Errorf("encode cloud desktop auth request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return cloudDesktopAuthResponse{}, fmt.Errorf("create cloud desktop auth request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "whatsapp-agent-desktop/0.1")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return cloudDesktopAuthResponse{}, fmt.Errorf("call cloud desktop auth: %w", err)
	}
	defer resp.Body.Close()

	var response struct {
		User      User          `json:"user"`
		Device    DesktopDevice `json:"device"`
		Token     string        `json:"token"`
		ExpiresAt time.Time     `json:"expires_at"`
		Error     string        `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return cloudDesktopAuthResponse{}, fmt.Errorf("decode cloud desktop auth response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := strings.TrimSpace(response.Error)
		if message == "" {
			message = resp.Status
		}
		return cloudDesktopAuthResponse{}, fmt.Errorf("cloud desktop auth rejected request: %s", message)
	}
	if strings.TrimSpace(response.User.ID) == "" || strings.TrimSpace(response.User.Email) == "" {
		return cloudDesktopAuthResponse{}, fmt.Errorf("cloud desktop auth returned incomplete user")
	}
	if strings.TrimSpace(response.Device.DeviceID) == "" {
		return cloudDesktopAuthResponse{}, fmt.Errorf("cloud desktop auth returned incomplete device")
	}

	return cloudDesktopAuthResponse{
		User:      response.User,
		Device:    response.Device,
		Token:     strings.TrimSpace(response.Token),
		ExpiresAt: response.ExpiresAt,
	}, nil
}
