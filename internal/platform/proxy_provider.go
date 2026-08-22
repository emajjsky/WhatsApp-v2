package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type systemProxyProvider struct {
	endpoint string
	client   *http.Client
}

type systemProxyRoute struct {
	ProxyURL string
	RouteKey string
}

func newSystemProxyProvider(endpoint string) systemProxyProvider {
	return systemProxyProvider{
		endpoint: strings.TrimSpace(endpoint),
		client:   &http.Client{Timeout: 3 * time.Second},
	}
}

func (p systemProxyProvider) Resolve(ctx context.Context) (string, error) {
	route, err := p.ResolveRoute(ctx)
	return route.ProxyURL, err
}

func (p systemProxyProvider) ResolveRoute(ctx context.Context) (systemProxyRoute, error) {
	if p.endpoint == "" {
		return systemProxyRoute{}, nil
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, p.endpoint, nil)
	if err != nil {
		return systemProxyRoute{}, fmt.Errorf("create system proxy request: %w", err)
	}
	response, err := p.client.Do(request)
	if err != nil {
		return systemProxyRoute{}, fmt.Errorf("read system proxy: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return systemProxyRoute{}, fmt.Errorf("read system proxy returned HTTP %d", response.StatusCode)
	}
	var payload struct {
		ProxyURL string `json:"proxy_url"`
		RouteKey string `json:"route_key"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return systemProxyRoute{}, fmt.Errorf("decode system proxy: %w", err)
	}
	return systemProxyRoute{ProxyURL: strings.TrimSpace(payload.ProxyURL), RouteKey: strings.TrimSpace(payload.RouteKey)}, nil
}
