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
		innerDialer, err := xproxy.FromURL(d.inner, forward)
		if err != nil {
			return nil, fmt.Errorf("configure inner SOCKS5 proxy: %w", err)
		}
		return dialWithContext(ctx, innerDialer, network, address)
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
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_ = conn.Close()
		return nil, fmt.Errorf("proxy CONNECT returned HTTP %d", response.StatusCode)
	}
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
