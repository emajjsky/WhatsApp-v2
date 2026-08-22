package proxies

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	xproxy "golang.org/x/net/proxy"
	"whatsapp-agent-platform/internal/support/ids"
)

var ErrProxyNotFound = errors.New("proxy not found")

type Service struct {
	repository *Repository
	secrets    *secretBox
}

func NewService(repository *Repository, encodedKey string) (*Service, error) {
	if repository == nil {
		return nil, fmt.Errorf("proxy service requires a repository")
	}
	secrets, err := newSecretBox(encodedKey)
	if err != nil {
		return nil, err
	}
	return &Service{repository: repository, secrets: secrets}, nil
}

func (s *Service) List(ctx context.Context) ([]View, error) {
	items, err := s.repository.List(ctx)
	if err != nil {
		return nil, err
	}
	views := make([]View, 0, len(items))
	for _, item := range items {
		views = append(views, mapView(item))
	}
	return views, nil
}

func (s *Service) Create(ctx context.Context, input Input) (View, error) {
	proxy, err := s.normalizeInput(input, true)
	if err != nil {
		return View{}, err
	}
	proxy.ID = ids.NewUUID()
	if err := s.repository.Create(ctx, proxy); err != nil {
		return View{}, mapProxyError(err)
	}
	return mapView(proxy), nil
}

func (s *Service) Update(ctx context.Context, id string, input UpdateInput) (View, error) {
	proxy, err := s.repository.Get(ctx, id)
	if err != nil {
		return View{}, mapProxyError(err)
	}
	if input.Name != nil {
		proxy.Name = strings.TrimSpace(*input.Name)
	}
	if input.Scheme != nil {
		proxy.Scheme = normalizeScheme(*input.Scheme)
	}
	if input.Host != nil {
		proxy.Host = strings.TrimSpace(*input.Host)
	}
	if input.Port != nil {
		proxy.Port = *input.Port
	}
	if input.Username != nil {
		proxy.Username = strings.TrimSpace(*input.Username)
	}
	if input.Password != nil && strings.TrimSpace(*input.Password) != "" {
		proxy.PasswordCiphertext, err = s.secrets.seal(strings.TrimSpace(*input.Password))
		if err != nil {
			return View{}, fmt.Errorf("encrypt proxy password: %w", err)
		}
	}
	if input.ExitIP != nil {
		proxy.ExitIP = normalizedPointer(input.ExitIP)
	}
	if input.Country != nil {
		proxy.Country = normalizedPointer(input.Country)
	}
	if input.Enabled != nil {
		proxy.Enabled = *input.Enabled
	}
	if input.ExpiresAt != nil {
		proxy.ExpiresAt = input.ExpiresAt
	}
	if err := validateProxy(proxy); err != nil {
		return View{}, err
	}
	if err := s.repository.Update(ctx, proxy); err != nil {
		return View{}, mapProxyError(err)
	}
	return mapView(proxy), nil
}

func (s *Service) Delete(ctx context.Context, id string) error {
	if err := s.repository.Delete(ctx, id); err != nil {
		return mapProxyError(err)
	}
	return nil
}

func (s *Service) GetAccountProxy(ctx context.Context, accountID string) (*View, error) {
	item, err := s.repository.GetBinding(ctx, accountID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	view := mapView(item)
	return &view, nil
}

func (s *Service) SetAccountProxy(ctx context.Context, accountID, proxyID string) (*View, error) {
	proxyID = strings.TrimSpace(proxyID)
	if proxyID == "" {
		if err := s.repository.ClearBinding(ctx, accountID); err != nil {
			return nil, err
		}
		return nil, nil
	}
	if err := s.repository.SetBinding(ctx, accountID, proxyID); err != nil {
		return nil, err
	}
	return s.GetAccountProxy(ctx, accountID)
}

func (s *Service) ResolveProxyURL(ctx context.Context, accountID string) (string, error) {
	item, err := s.repository.ResolveBinding(ctx, accountID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !item.Enabled {
		return "", fmt.Errorf("bound proxy %q is disabled", item.Name)
	}
	if item.ExpiresAt != nil && !item.ExpiresAt.After(time.Now()) {
		return "", fmt.Errorf("bound proxy %q has expired", item.Name)
	}
	password, err := s.secrets.open(item.PasswordCiphertext)
	if err != nil {
		return "", err
	}
	return buildProxyURL(item.Scheme, item.Host, item.Port, item.Username, password), nil
}

func (s *Service) Test(ctx context.Context, id string) (View, error) {
	item, err := s.repository.Get(ctx, id)
	if err != nil {
		return View{}, mapProxyError(err)
	}
	password, err := s.secrets.open(item.PasswordCiphertext)
	if err != nil {
		return View{}, err
	}
	proxyURL := buildProxyURL(item.Scheme, item.Host, item.Port, item.Username, password)
	parsed, err := url.Parse(proxyURL)
	if err != nil {
		return View{}, fmt.Errorf("parse proxy URL: %w", err)
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if parsed.Scheme == "socks5" {
		dialer, dialErr := xproxy.FromURL(parsed, &net.Dialer{Timeout: 20 * time.Second, KeepAlive: 30 * time.Second})
		if dialErr != nil {
			return View{}, fmt.Errorf("configure socks5 test proxy: %w", dialErr)
		}
		transport.Proxy = nil
		transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			return dialer.Dial(network, address)
		}
	} else {
		transport.Proxy = http.ProxyURL(parsed)
	}
	client := &http.Client{Transport: transport, Timeout: 20 * time.Second}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.ipify.org", nil)
	if err != nil {
		return View{}, err
	}
	response, err := client.Do(request)
	if err != nil {
		_ = s.repository.UpdateCheck(ctx, id, "", err.Error())
		return View{}, fmt.Errorf("proxy connectivity test failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := fmt.Sprintf("proxy check returned HTTP %d", response.StatusCode)
		_ = s.repository.UpdateCheck(ctx, id, "", message)
		return View{}, fmt.Errorf("%s", message)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 128))
	if err != nil {
		message := fmt.Sprintf("read proxy check response: %v", err)
		_ = s.repository.UpdateCheck(ctx, id, "", message)
		return View{}, fmt.Errorf("%s", message)
	}
	exitIP := strings.TrimSpace(string(body))
	if net.ParseIP(exitIP) == nil {
		message := "proxy check returned invalid exit IP"
		_ = s.repository.UpdateCheck(ctx, id, "", message)
		return View{}, fmt.Errorf("%s", message)
	}
	if err := s.repository.UpdateCheck(ctx, id, exitIP, ""); err != nil {
		return View{}, err
	}
	item.ExitIP = &exitIP
	now := time.Now().UTC()
	item.LastCheckedAt = &now
	item.LastCheckError = nil
	return mapView(item), nil
}

func (s *Service) normalizeInput(input Input, requirePassword bool) (Proxy, error) {
	password := strings.TrimSpace(input.Password)
	if requirePassword && password == "" {
		return Proxy{}, fmt.Errorf("password is required")
	}
	ciphertext, err := s.secrets.seal(password)
	if err != nil {
		return Proxy{}, fmt.Errorf("encrypt proxy password: %w", err)
	}
	proxy := Proxy{
		Name: strings.TrimSpace(input.Name), Scheme: normalizeScheme(input.Scheme), Host: strings.TrimSpace(input.Host), Port: input.Port,
		Username: strings.TrimSpace(input.Username), PasswordCiphertext: ciphertext, ExitIP: normalizedPointer(input.ExitIP), Country: normalizedPointer(input.Country), Enabled: input.Enabled == nil || *input.Enabled, ExpiresAt: input.ExpiresAt,
	}
	if err := validateProxy(proxy); err != nil {
		return Proxy{}, err
	}
	return proxy, nil
}

func validateProxy(proxy Proxy) error {
	if proxy.Name == "" || proxy.Host == "" || proxy.Port < 1 || proxy.Port > 65535 {
		return fmt.Errorf("proxy name, host and valid port are required")
	}
	if proxy.Scheme != "http" && proxy.Scheme != "https" && proxy.Scheme != "socks5" {
		return fmt.Errorf("proxy scheme must be http, https or socks5")
	}
	if net.ParseIP(proxy.Host) == nil && strings.ContainsAny(proxy.Host, " /\\") {
		return fmt.Errorf("proxy host is invalid")
	}
	return nil
}

func normalizeScheme(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "socks", "socks5", "socks5h":
		return "socks5"
	case "https":
		return "https"
	case "", "http":
		return "http"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func buildProxyURL(scheme, host string, port int, username, password string) string {
	parsed := url.URL{Scheme: normalizeScheme(scheme), Host: net.JoinHostPort(host, strconv.Itoa(port))}
	if strings.TrimSpace(username) != "" {
		parsed.User = url.UserPassword(username, password)
	}
	return parsed.String()
}

func mapView(item Proxy) View {
	return View{ID: item.ID, Name: item.Name, Scheme: item.Scheme, Host: item.Host, Port: item.Port, Username: item.Username, ExitIP: item.ExitIP, Country: item.Country, Enabled: item.Enabled, ExpiresAt: item.ExpiresAt, LastCheckedAt: item.LastCheckedAt, LastCheckError: item.LastCheckError, HasCredentials: len(item.PasswordCiphertext) > 0, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func normalizedPointer(value *string) *string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	return &trimmed
}

func mapProxyError(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w", ErrProxyNotFound)
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "local_account_proxy_bindings") && (strings.Contains(message, "foreign key") || strings.Contains(message, "violates")) {
		return fmt.Errorf("该代理仍绑定了 WhatsApp 账号，请先在“登录”页面将账号改为“本机网络”或其他代理，再删除")
	}
	if strings.Contains(message, "local_proxy_endpoints_user_name_unique") || strings.Contains(message, "duplicate key value") {
		return fmt.Errorf("已存在同名代理，请直接点击“编辑”更新它，或换一个名称")
	}
	return err
}
