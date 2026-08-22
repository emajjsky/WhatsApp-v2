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
	"whatsapp-agent-platform/internal/proxychain"
	"whatsapp-agent-platform/internal/support/ids"
)

var ErrProxyNotFound = errors.New("proxy not found")

type Plan struct {
	ProxyURL  string
	RouteMode RouteMode
	ExitIP    string
}

type SystemProxyRoute struct {
	ProxyURL string
	ExitIP   string
}

type Service struct {
	repository  *Repository
	secrets     *secretBox
	systemProxy func(context.Context) (SystemProxyRoute, error)
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

func (s *Service) SetSystemProxyProvider(provider func(context.Context) (string, error)) {
	if provider == nil {
		s.systemProxy = nil
		return
	}
	s.systemProxy = func(ctx context.Context) (SystemProxyRoute, error) {
		proxyURL, err := provider(ctx)
		return SystemProxyRoute{ProxyURL: proxyURL}, err
	}
}

func (s *Service) SetSystemProxyRouteProvider(provider func(context.Context) (SystemProxyRoute, error)) {
	s.systemProxy = provider
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
	if input.RouteMode != nil {
		proxy.RouteMode = normalizeRouteMode(*input.RouteMode)
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
	if err := s.repository.InvalidateCheck(ctx, id); err != nil {
		return View{}, err
	}
	proxy.ExitIP = nil
	proxy.LastCheckedAt = nil
	proxy.LastCheckError = nil
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

func (s *Service) ValidateAccountProxy(ctx context.Context, accountID string) error {
	item, err := s.repository.ResolveBinding(ctx, accountID)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("请先在“IP代理”页面配置并验证账号网络出口")
	}
	if err != nil {
		return err
	}
	return validatePairingProxyBinding(item, time.Now())
}

func (s *Service) ResolveProxyURL(ctx context.Context, accountID string) (string, error) {
	plan, err := s.ResolveProxyPlan(ctx, accountID)
	return plan.ProxyURL, err
}

func (s *Service) ResolveProxyPlan(ctx context.Context, accountID string) (Plan, error) {
	item, err := s.repository.ResolveBinding(ctx, accountID)
	if errors.Is(err, sql.ErrNoRows) {
		return Plan{}, nil
	}
	if err != nil {
		return Plan{}, err
	}
	if !item.Enabled {
		return Plan{}, fmt.Errorf("bound proxy %q is disabled", item.Name)
	}
	if item.ExpiresAt != nil && !item.ExpiresAt.After(time.Now()) {
		return Plan{}, fmt.Errorf("bound proxy %q has expired", item.Name)
	}
	if err := validatePairingProxyBinding(item, time.Now()); err != nil {
		return Plan{}, err
	}
	password, err := s.secrets.open(item.PasswordCiphertext)
	if err != nil {
		return Plan{}, err
	}
	exitIP := ""
	if item.ExitIP != nil {
		exitIP = strings.TrimSpace(*item.ExitIP)
	}
	return Plan{
		ProxyURL:  buildProxyURL(item.Scheme, item.Host, item.Port, item.Username, password),
		RouteMode: normalizeRouteMode(item.RouteMode),
		ExitIP:    exitIP,
	}, nil
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
	outerRoute := SystemProxyRoute{}
	mode := normalizeRouteMode(item.RouteMode)
	if mode == RouteModeSystem && s.systemProxy == nil {
		return View{}, fmt.Errorf("代理“通过系统代理链式”需要先启用可用的 Clash/系统代理")
	}
	if mode != RouteModeDirect && s.systemProxy != nil {
		outerRoute, err = s.systemProxy(ctx)
		if err != nil {
			if mode == RouteModeSystem {
				return View{}, fmt.Errorf("detect system proxy for test: %w", err)
			}
			// 自动模式的定义就是系统代理不可用时直连独立代理。
			outerRoute = SystemProxyRoute{}
		}
		if mode == RouteModeSystem && strings.TrimSpace(outerRoute.ProxyURL) == "" {
			return View{}, fmt.Errorf("代理“通过系统代理链式”需要先启用可用的 Clash/系统代理")
		}
	}
	effectiveProxyURL := proxyURL
	usesExistingSystemRoute := strings.TrimSpace(outerRoute.ProxyURL) != "" && sameProxyExitIP(exitIPOf(item), outerRoute.ExitIP)
	if usesExistingSystemRoute {
		// Clash 已经使用该账号代理作为最终出口，检测时也必须走同一条现成链路。
		effectiveProxyURL = outerRoute.ProxyURL
	}
	parsed, err = url.Parse(effectiveProxyURL)
	if err != nil {
		return View{}, fmt.Errorf("parse effective proxy URL: %w", err)
	}
	if strings.TrimSpace(outerRoute.ProxyURL) != "" && effectiveProxyURL == proxyURL {
		dialer, dialErr := proxychain.New(outerRoute.ProxyURL, proxyURL)
		if dialErr != nil {
			return View{}, fmt.Errorf("configure chained test proxy: %w", dialErr)
		}
		transport.Proxy = nil
		transport.DialContext = dialer.DialContext
	} else if parsed.Scheme == "socks5" {
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
	exitIP, ipErr := probeExitIP(ctx, client)
	whatsappErr := probeWhatsAppWeb(ctx, client)
	if whatsappErr != nil {
		message := fmt.Sprintf("此代理未通过链路检测（%s）。WhatsApp 网络不可达；出口 IP检测：%s；WhatsApp检测：%s", testRouteLabel(outerRoute, usesExistingSystemRoute), friendlyProbeError(ipErr), friendlyProbeError(whatsappErr))
		_ = s.repository.UpdateCheck(ctx, id, "", message)
		return View{}, fmt.Errorf("%s", message)
	}
	// 某些代理商会拦截 api.ipify.org，但并不影响 WhatsApp Web。此时
	// 代理仍然可用，保留上一次成功的出口 IP并把检测标记为成功。
	storedExitIP := exitIP
	if storedExitIP == "" && item.ExitIP != nil {
		storedExitIP = strings.TrimSpace(*item.ExitIP)
	}
	if err := s.repository.UpdateCheck(ctx, id, storedExitIP, ""); err != nil {
		return View{}, err
	}
	if exitIP != "" {
		item.ExitIP = &exitIP
	}
	now := time.Now().UTC()
	item.LastCheckedAt = &now
	item.LastCheckError = nil
	return mapView(item), nil
}

func exitIPOf(item Proxy) string {
	if item.ExitIP == nil {
		return ""
	}
	return strings.TrimSpace(*item.ExitIP)
}

func testRouteLabel(outerRoute SystemProxyRoute, usesExistingSystemRoute bool) string {
	if strings.TrimSpace(outerRoute.ProxyURL) == "" {
		return "直连账号代理"
	}
	if usesExistingSystemRoute {
		return "Clash 已完成该静态代理链路"
	}
	return "Clash 普通代理 → 账号静态代理"
}

func sameProxyExitIP(localExitIP, outerExitIP string) bool {
	local := net.ParseIP(strings.TrimSpace(localExitIP))
	outer := net.ParseIP(strings.TrimSpace(outerExitIP))
	return local != nil && outer != nil && local.Equal(outer)
}

func probeExitIP(ctx context.Context, client *http.Client) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.ipify.org", nil)
	if err != nil {
		return "", err
	}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 128))
	if err != nil {
		return "", err
	}
	exitIP := strings.TrimSpace(string(body))
	if net.ParseIP(exitIP) == nil {
		return "", errors.New("返回内容不是有效 IP")
	}
	return exitIP, nil
}

func probeWhatsAppWeb(ctx context.Context, client *http.Client) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://web.whatsapp.com/", nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "Mozilla/5.0 WhatsApp-Agent-Desktop")
	request.Header.Set("Range", "bytes=0-0")
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1024))
	if response.StatusCode >= 500 {
		return fmt.Errorf("HTTP %d", response.StatusCode)
	}
	return nil
}

func compactProbeError(err error) string {
	if err == nil {
		return "成功"
	}
	message := strings.Join(strings.Fields(err.Error()), " ")
	if len(message) > 220 {
		return message[:220] + "..."
	}
	return message
}

func friendlyProbeError(err error) string {
	if err == nil {
		return "成功"
	}
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "socks connect") || (strings.Contains(message, "socks5") && strings.Contains(message, "eof")):
		return "SOCKS5连接被代理服务关闭，请检查账号、密码、端口或代理是否已过期"
	case strings.Contains(message, "connection refused"):
		return "代理端口拒绝连接，请确认地址和端口正确"
	case strings.Contains(message, "i/o timeout") || strings.Contains(message, "context deadline exceeded"):
		return "代理连接超时，请检查网络或代理服务状态"
	case strings.Contains(message, "no such host") || strings.Contains(message, "dns"):
		return "代理地址无法解析，请检查代理地址"
	default:
		return compactProbeError(err)
	}
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
		Username: strings.TrimSpace(input.Username), PasswordCiphertext: ciphertext, RouteMode: normalizeRouteMode(input.RouteMode), ExitIP: normalizedPointer(input.ExitIP), Country: normalizedPointer(input.Country), Enabled: input.Enabled == nil || *input.Enabled, ExpiresAt: input.ExpiresAt,
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

func normalizeRouteMode(value RouteMode) RouteMode {
	switch RouteMode(strings.ToLower(strings.TrimSpace(string(value)))) {
	case RouteModeDirect:
		return RouteModeDirect
	case RouteModeSystem:
		return RouteModeSystem
	default:
		return RouteModeAuto
	}
}

func validatePairingProxyBinding(proxy Proxy, now time.Time) error {
	if !proxy.Enabled {
		return fmt.Errorf("账号绑定的代理已停用，请启用代理或重新选择")
	}
	if proxy.ExpiresAt != nil && !proxy.ExpiresAt.After(now) {
		return fmt.Errorf("账号绑定的代理已过期，请更换代理")
	}
	if proxy.LastCheckedAt == nil {
		return fmt.Errorf("请先在“IP代理”页面点击“检测此代理”，验证通过后才能配对")
	}
	if proxy.LastCheckError != nil && strings.TrimSpace(*proxy.LastCheckError) != "" {
		return fmt.Errorf("账号代理最近检测失败，请重新检测后再配对")
	}
	return nil
}

func buildProxyURL(scheme, host string, port int, username, password string) string {
	parsed := url.URL{Scheme: normalizeScheme(scheme), Host: net.JoinHostPort(host, strconv.Itoa(port))}
	if strings.TrimSpace(username) != "" {
		parsed.User = url.UserPassword(username, password)
	}
	return parsed.String()
}

func mapView(item Proxy) View {
	return View{ID: item.ID, Name: item.Name, Scheme: item.Scheme, Host: item.Host, Port: item.Port, Username: item.Username, ExitIP: item.ExitIP, Country: item.Country, Enabled: item.Enabled, ExpiresAt: item.ExpiresAt, LastCheckedAt: item.LastCheckedAt, LastCheckError: item.LastCheckError, HasCredentials: len(item.PasswordCiphertext) > 0, RouteMode: normalizeRouteMode(item.RouteMode), CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
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
