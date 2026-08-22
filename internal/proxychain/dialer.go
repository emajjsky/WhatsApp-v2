package proxychain

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
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
)

const (
	defaultDialTimeout = 30 * time.Second
	defaultKeepAlive   = 30 * time.Second
)

// Dialer connects to the configured inner proxy through an optional system
// proxy. It is intentionally a net/http-compatible ContextDialer so the same
// route can be used by WhatsApp websocket and media clients.
type Dialer struct {
	outer     *url.URL
	inner     *url.URL
	innerAddr string
	base      *net.Dialer
}

func New(outerProxyURL, innerProxyURL string) (*Dialer, error) {
	inner, err := parseProxyURL(innerProxyURL)
	if err != nil {
		return nil, fmt.Errorf("parse inner proxy: %w", err)
	}
	var outer *url.URL
	if strings.TrimSpace(outerProxyURL) != "" {
		outer, err = parseProxyURL(outerProxyURL)
		if err != nil {
			return nil, fmt.Errorf("parse outer proxy: %w", err)
		}
	}

	return &Dialer{
		outer:     outer,
		inner:     inner,
		innerAddr: net.JoinHostPort(inner.Hostname(), inner.Port()),
		base:      &net.Dialer{Timeout: defaultDialTimeout, KeepAlive: defaultKeepAlive},
	}, nil
}

func (d *Dialer) Dial(network, address string) (net.Conn, error) {
	return d.DialContext(context.Background(), network, address)
}

func (d *Dialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	if d == nil || d.inner == nil {
		return nil, errors.New("proxy chain is not configured")
	}
	forward, err := d.forwardDialer(ctx)
	if err != nil {
		return nil, err
	}

	switch d.inner.Scheme {
	case "socks5":
		return d.dialSOCKS5(ctx, forward, network, address)
	case "http", "https":
		conn, err := forward.Dial(network, d.innerAddr)
		if err != nil {
			return nil, fmt.Errorf("connect to inner HTTP proxy: %w", err)
		}
		if d.inner.Scheme == "https" {
			tlsConn := tls.Client(conn, &tls.Config{ServerName: d.inner.Hostname(), MinVersion: tls.VersionTLS12})
			if err := tlsConn.HandshakeContext(ctx); err != nil {
				_ = conn.Close()
				return nil, fmt.Errorf("handshake with inner HTTPS proxy: %w", err)
			}
			conn = tlsConn
		}
		return connectHTTPProxy(ctx, conn, d.inner, address)
	default:
		return nil, fmt.Errorf("unsupported inner proxy scheme %q", d.inner.Scheme)
	}
}

func (d *Dialer) dialSOCKS5(ctx context.Context, forward xproxy.Dialer, network, address string) (net.Conn, error) {
	conn, err := dialWithContext(ctx, forward, "tcp", d.innerAddr)
	if err != nil {
		return nil, fmt.Errorf("connect to inner SOCKS5 proxy %s: %w", d.innerAddr, err)
	}
	closeOnError := true
	defer func() {
		if closeOnError {
			_ = conn.Close()
		}
	}()

	deadline := time.Now().Add(defaultDialTimeout)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}
	_ = conn.SetDeadline(deadline)
	username, password, authenticated := innerCredentials(d.inner)
	methods := []byte{5, 1, 0}
	if authenticated {
		if len(username) > 255 || len(password) > 255 {
			return nil, errors.New("SOCKS5账号或密码超过协议长度限制")
		}
		methods[2] = 2
	}
	if _, err := conn.Write(methods); err != nil {
		return nil, fmt.Errorf("write SOCKS5 method request: %w", err)
	}
	methodResponse := []byte{0, 0}
	if _, err := io.ReadFull(conn, methodResponse); err != nil {
		return nil, fmt.Errorf("read SOCKS5 method response: %w", err)
	}
	if methodResponse[0] != 5 {
		return nil, fmt.Errorf("SOCKS5返回了错误协议版本 %d", methodResponse[0])
	}
	switch methodResponse[1] {
	case 0:
	case 2:
		if !authenticated {
			return nil, errors.New("SOCKS5代理要求账号密码，但当前配置为空")
		}
		credentials := make([]byte, 0, 3+len(username)+len(password))
		credentials = append(credentials, 1, byte(len(username)))
		credentials = append(credentials, username...)
		credentials = append(credentials, byte(len(password)))
		credentials = append(credentials, password...)
		if _, err := conn.Write(credentials); err != nil {
			return nil, fmt.Errorf("write SOCKS5账号密码: %w", err)
		}
		authResponse := []byte{0, 0}
		if _, err := io.ReadFull(conn, authResponse); err != nil {
			return nil, fmt.Errorf("read SOCKS5账号密码响应: %w", err)
		}
		if authResponse[0] != 1 || authResponse[1] != 0 {
			return nil, errors.New("SOCKS5账号密码认证失败")
		}
	case 255:
		return nil, errors.New("SOCKS5代理拒绝了当前认证方式")
	default:
		return nil, fmt.Errorf("SOCKS5代理返回未知认证方式 %d", methodResponse[1])
	}
	host, portText, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("parse SOCKS5 target %q: %w", address, err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return nil, fmt.Errorf("invalid SOCKS5 target port %q", portText)
	}
	request, err := socks5ConnectRequest(host, port)
	if err != nil {
		return nil, err
	}
	if _, err := conn.Write(request); err != nil {
		return nil, fmt.Errorf("write SOCKS5 CONNECT request: %w", err)
	}
	if err := readSOCKS5ConnectResponse(conn); err != nil {
		return nil, err
	}
	_ = conn.SetDeadline(time.Time{})
	closeOnError = false
	return conn, nil
}

func innerCredentials(proxyURL *url.URL) (string, string, bool) {
	if proxyURL == nil || proxyURL.User == nil {
		return "", "", false
	}
	password, _ := proxyURL.User.Password()
	return proxyURL.User.Username(), password, true
}

func socks5ConnectRequest(host string, port int) ([]byte, error) {
	request := []byte{5, 1, 0}
	if ip := net.ParseIP(host); ip != nil {
		if ip4 := ip.To4(); ip4 != nil {
			request = append(request, 1)
			request = append(request, ip4...)
		} else {
			request = append(request, 4)
			request = append(request, ip.To16()...)
		}
	} else {
		if len(host) > 255 {
			return nil, errors.New("SOCKS5目标域名超过协议长度限制")
		}
		request = append(request, 3, byte(len(host)))
		request = append(request, host...)
	}
	request = append(request, byte(port>>8), byte(port))
	return request, nil
}

func readSOCKS5ConnectResponse(conn net.Conn) error {
	header := []byte{0, 0, 0, 0}
	if _, err := io.ReadFull(conn, header); err != nil {
		return fmt.Errorf("read SOCKS5 CONNECT response: %w", err)
	}
	if header[0] != 5 {
		return fmt.Errorf("SOCKS5 CONNECT返回了错误协议版本 %d", header[0])
	}
	if header[1] != 0 {
		return fmt.Errorf("SOCKS5 CONNECT被拒绝：%s", socks5ReplyText(header[1]))
	}
	var addressLength int
	switch header[3] {
	case 1:
		addressLength = 4
	case 4:
		addressLength = 16
	case 3:
		length := []byte{0}
		if _, err := io.ReadFull(conn, length); err != nil {
			return fmt.Errorf("read SOCKS5绑定域名长度: %w", err)
		}
		addressLength = int(length[0])
	default:
		return fmt.Errorf("SOCKS5 CONNECT返回未知地址类型 %d", header[3])
	}
	boundAddress := make([]byte, addressLength+2)
	if _, err := io.ReadFull(conn, boundAddress); err != nil {
		return fmt.Errorf("read SOCKS5绑定地址: %w", err)
	}
	return nil
}

func socks5ReplyText(code byte) string {
	switch code {
	case 1:
		return "通用代理故障"
	case 2:
		return "连接被规则拒绝"
	case 3:
		return "网络不可达"
	case 4:
		return "目标主机不可达"
	case 5:
		return "目标连接被拒绝"
	case 6:
		return "TTL已过期"
	case 7:
		return "不支持的命令"
	case 8:
		return "不支持的地址类型"
	default:
		return fmt.Sprintf("错误码 %d", code)
	}
}

func (d *Dialer) forwardDialer(ctx context.Context) (xproxy.Dialer, error) {
	if d.outer == nil {
		return contextDialer{ctx: ctx, dialer: d.base}, nil
	}

	switch d.outer.Scheme {
	case "socks5":
		return xproxy.FromURL(d.outer, contextDialer{ctx: ctx, dialer: d.base})
	case "http", "https":
		return &httpForwardDialer{ctx: ctx, outer: d.outer, base: d.base}, nil
	default:
		return nil, fmt.Errorf("unsupported outer proxy scheme %q", d.outer.Scheme)
	}
}

type contextDialer struct {
	ctx    context.Context
	dialer *net.Dialer
}

func (d contextDialer) Dial(network, address string) (net.Conn, error) {
	return d.dialer.DialContext(d.ctx, network, address)
}

type httpForwardDialer struct {
	ctx   context.Context
	outer *url.URL
	base  *net.Dialer
}

func (d *httpForwardDialer) Dial(network, address string) (net.Conn, error) {
	conn, err := d.base.DialContext(d.ctx, network, net.JoinHostPort(d.outer.Hostname(), d.outer.Port()))
	if err != nil {
		return nil, err
	}
	if d.outer.Scheme == "https" {
		tlsConn := tls.Client(conn, &tls.Config{ServerName: d.outer.Hostname(), MinVersion: tls.VersionTLS12})
		if err := tlsConn.HandshakeContext(d.ctx); err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("handshake with HTTPS proxy: %w", err)
		}
		conn = tlsConn
	}
	return connectHTTPProxy(d.ctx, conn, d.outer, address)
}

func connectHTTPProxy(ctx context.Context, conn net.Conn, proxyURL *url.URL, target string) (net.Conn, error) {
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}

	request := &http.Request{
		Method: http.MethodConnect,
		URL:    &url.URL{Opaque: target},
		Host:   target,
		Header: make(http.Header),
	}
	if proxyURL.User != nil {
		password, _ := proxyURL.User.Password()
		credentials := proxyURL.User.Username() + ":" + password
		request.Header.Set("Proxy-Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(credentials)))
	}
	if err := request.Write(conn); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("write proxy CONNECT request: %w", err)
	}

	response, err := http.ReadResponse(bufio.NewReader(conn), request)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("read proxy CONNECT response: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
		_ = conn.Close()
		return nil, fmt.Errorf("proxy CONNECT returned HTTP %d", response.StatusCode)
	}
	// CONNECT 200 后已经进入隧道，响应体不能继续读取。
	_ = conn.SetDeadline(time.Time{})
	return conn, nil
}

func dialWithContext(ctx context.Context, dialer xproxy.Dialer, network, address string) (net.Conn, error) {
	if contextDialer, ok := dialer.(xproxy.ContextDialer); ok {
		return contextDialer.DialContext(ctx, network, address)
	}
	result := make(chan struct {
		conn net.Conn
		err  error
	}, 1)
	go func() {
		conn, err := dialer.Dial(network, address)
		result <- struct {
			conn net.Conn
			err  error
		}{conn: conn, err: err}
	}()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case response := <-result:
		return response.conn, response.err
	}
}

func parseProxyURL(raw string) (*url.URL, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return nil, errors.New("proxy URL is required")
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return nil, err
	}
	if parsed.Scheme == "socks" || parsed.Scheme == "socks5h" {
		parsed.Scheme = "socks5"
	}
	if parsed.Scheme != "socks5" && parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("unsupported proxy scheme %q", parsed.Scheme)
	}
	if parsed.Hostname() == "" || parsed.Port() == "" {
		return nil, errors.New("proxy host and port are required")
	}
	return parsed, nil
}
