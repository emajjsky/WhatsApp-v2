package proxychain

import (
	"context"
	"encoding/binary"
	"io"
	"net"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestDialerRequiresInnerProxy(t *testing.T) {
	_, err := New("socks5://127.0.0.1:7891", "")
	require.Error(t, err)
}

func startTCPHelloServer(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			go func() {
				defer conn.Close()
				_, _ = conn.Write([]byte("hello"))
			}()
		}
	}()
	return listener.Addr().String()
}

func startSOCKS5Server(t *testing.T, nextAddress string) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			go handleTestSOCKS5(conn, nextAddress)
		}
	}()
	return listener.Addr().String()
}

func handleTestSOCKS5(conn net.Conn, nextAddress string) {
	defer conn.Close()
	header := make([]byte, 2)
	if _, err := io.ReadFull(conn, header); err != nil || header[0] != 5 {
		return
	}
	methods := make([]byte, int(header[1]))
	if _, err := io.ReadFull(conn, methods); err != nil {
		return
	}
	if _, err := conn.Write([]byte{5, 0}); err != nil {
		return
	}
	requestHeader := make([]byte, 4)
	if _, err := io.ReadFull(conn, requestHeader); err != nil || requestHeader[0] != 5 || requestHeader[1] != 1 {
		return
	}
	var target string
	switch requestHeader[3] {
	case 1:
		address := make([]byte, 6)
		if _, err := io.ReadFull(conn, address); err != nil {
			return
		}
		target = net.JoinHostPort(net.IP(address[:4]).String(), stringPort(binary.BigEndian.Uint16(address[4:])))
	case 3:
		length := make([]byte, 1)
		if _, err := io.ReadFull(conn, length); err != nil {
			return
		}
		address := make([]byte, int(length[0])+2)
		if _, err := io.ReadFull(conn, address); err != nil {
			return
		}
		target = net.JoinHostPort(string(address[:len(address)-2]), stringPort(binary.BigEndian.Uint16(address[len(address)-2:])))
	default:
		return
	}
	forwardAddress := nextAddress
	if nextAddress == "" {
		forwardAddress = target
	}
	forward, err := net.Dial("tcp", forwardAddress)
	if err != nil {
		_, _ = conn.Write([]byte{5, 5, 0, 1, 0, 0, 0, 0, 0, 0})
		return
	}
	defer forward.Close()
	if _, err := conn.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}); err != nil {
		return
	}
	go func() { _, _ = io.Copy(forward, conn) }()
	_, _ = io.Copy(conn, forward)
}

func stringPort(port uint16) string {
	return strconv.Itoa(int(port))
}

func TestDialerRejectsUnsupportedProxyScheme(t *testing.T) {
	_, err := New("ftp://127.0.0.1:21", "socks5://127.0.0.1:5000")
	require.Error(t, err)
}

func TestDialerCanBuildDirectInnerProxyPlan(t *testing.T) {
	dialer, err := New("", "socks5://user:pass@127.0.0.1:5000")
	require.NoError(t, err)
	require.Equal(t, "socks5", dialer.inner.Scheme)
	require.Equal(t, "127.0.0.1:5000", dialer.innerAddr)
}

func TestDialerContextDialerInterface(t *testing.T) {
	dialer, err := New("", "socks5://127.0.0.1:5000")
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	defer cancel()
	_, err = dialer.DialContext(ctx, "tcp", "127.0.0.1:1")
	require.Error(t, err)
}

func TestParseProxyURLNormalizesSocksAlias(t *testing.T) {
	parsed, err := parseProxyURL("socks://127.0.0.1:5000")
	require.NoError(t, err)
	require.Equal(t, "socks5", parsed.Scheme)
	require.Equal(t, "127.0.0.1:5000", net.JoinHostPort(parsed.Hostname(), parsed.Port()))
}

func TestProxyURLWithCredentialsIsParsed(t *testing.T) {
	parsed, err := parseProxyURL("socks5://user:pass@127.0.0.1:5000")
	require.NoError(t, err)
	require.Equal(t, "user", parsed.User.Username())
	password, ok := parsed.User.Password()
	require.True(t, ok)
	require.Equal(t, "pass", password)
	_, _ = url.Parse(parsed.String())
}

func TestDialerUsesInnerProxyThroughOuterSOCKS5(t *testing.T) {
	target := startTCPHelloServer(t)
	inner := startSOCKS5Server(t, target)
	outer := startSOCKS5Server(t, inner)

	dialer, err := New("socks5://"+outer, "socks5://"+inner)
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	conn, err := dialer.DialContext(ctx, "tcp", target)
	require.NoError(t, err)
	defer conn.Close()

	buf := make([]byte, 5)
	_, err = io.ReadFull(conn, buf)
	require.NoError(t, err)
	require.Equal(t, "hello", string(buf))
}
