package auth

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/httpx"
)

type CloudAdminProxy struct {
	baseURL     string
	authService *Service
	httpClient  *http.Client
}

func NewCloudAdminProxy(baseURL string, authService *Service) *CloudAdminProxy {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" || authService == nil {
		return nil
	}

	return &CloudAdminProxy{
		baseURL:     baseURL,
		authService: authService,
		httpClient: &http.Client{
			Timeout: 45 * time.Second,
		},
	}
}

func (p *CloudAdminProxy) Forward(w http.ResponseWriter, r *http.Request) {
	if p == nil {
		httpx.WriteError(w, http.StatusBadGateway, "cloud admin proxy is not configured")
		return
	}

	req, err := p.newCloudRequest(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	resp, err := p.httpClient.Do(req)
	if err != nil {
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("call cloud admin: %v", err))
		return
	}
	defer resp.Body.Close()

	if contentType := strings.TrimSpace(resp.Header.Get("Content-Type")); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (p *CloudAdminProxy) newCloudRequest(r *http.Request) (*http.Request, error) {
	endpoint, err := url.JoinPath(p.baseURL, r.URL.Path)
	if err != nil {
		return nil, fmt.Errorf("build cloud admin URL: %w", err)
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, endpoint, r.Body)
	if err != nil {
		return nil, fmt.Errorf("create cloud admin request: %w", err)
	}
	req.URL.RawQuery = r.URL.RawQuery

	cloudToken, err := p.authService.CloudTokenFromLocalToken(r.Context(), sessionTokenFromAdminRequest(r, p.authService.Config().CookieName))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+cloudToken)
	req.Header.Set("User-Agent", "whatsapp-agent-desktop/0.1")
	if contentType := strings.TrimSpace(r.Header.Get("Content-Type")); contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if accept := strings.TrimSpace(r.Header.Get("Accept")); accept != "" {
		req.Header.Set("Accept", accept)
	} else {
		req.Header.Set("Accept", "application/json")
	}
	return req, nil
}

func sessionTokenFromAdminRequest(r *http.Request, cookieName string) string {
	if token := bearerToken(r); token != "" {
		return token
	}
	if strings.TrimSpace(cookieName) == "" {
		cookieName = "wa_session"
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(cookie.Value)
}
