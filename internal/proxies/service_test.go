package proxies

import (
	"testing"
	"time"
)

func TestValidatePairingProxyBindingRequiresSuccessfulRecentCheck(t *testing.T) {
	now := time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC)
	checkedAt := now.Add(-5 * time.Minute)

	if err := validatePairingProxyBinding(Proxy{}, now); err == nil {
		t.Fatal("expected an unverified proxy to block pairing")
	}

	failed := Proxy{Enabled: true, LastCheckedAt: &checkedAt}
	message := "SOCKS5 handshake failed"
	failed.LastCheckError = &message
	if err := validatePairingProxyBinding(failed, now); err == nil {
		t.Fatal("expected a failed proxy check to block pairing")
	}

	valid := Proxy{Enabled: true, LastCheckedAt: &checkedAt}
	if err := validatePairingProxyBinding(valid, now); err != nil {
		t.Fatalf("expected a successfully checked proxy to allow pairing: %v", err)
	}
}

func TestValidatePairingProxyBindingRejectsExpiredProxy(t *testing.T) {
	now := time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC)
	checkedAt := now.Add(-5 * time.Minute)
	expiredAt := now.Add(-time.Minute)
	proxy := Proxy{Enabled: true, LastCheckedAt: &checkedAt, ExpiresAt: &expiredAt}
	if err := validatePairingProxyBinding(proxy, now); err == nil {
		t.Fatal("expected an expired proxy to block pairing")
	}
}

func TestExitIPOfDoesNotTreatProxyEndpointAsFinalExit(t *testing.T) {
	proxy := Proxy{Host: "140.174.104.226"}
	if got := exitIPOf(proxy); got != "" {
		t.Fatalf("exit IP = %q, want empty when only the proxy endpoint is known", got)
	}

	exitIP := "203.0.113.20"
	proxy.ExitIP = &exitIP
	if got := exitIPOf(proxy); got != exitIP {
		t.Fatalf("exit IP = %q, want %q", got, exitIP)
	}
}
