package proxies

import (
	"crypto/rand"
	"encoding/base64"
	"testing"
)

func TestSecretBoxRoundTrip(t *testing.T) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("generate key: %v", err)
	}
	box, err := newSecretBox(base64.StdEncoding.EncodeToString(key))
	if err != nil {
		t.Fatalf("new secret box: %v", err)
	}
	ciphertext, err := box.seal("proxy-password")
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	plaintext, err := box.open(ciphertext)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if plaintext != "proxy-password" {
		t.Fatalf("plaintext = %q, want proxy-password", plaintext)
	}
	if string(ciphertext) == "proxy-password" {
		t.Fatal("ciphertext must not contain the plaintext")
	}
}

func TestBuildProxyURLNormalizesSocksScheme(t *testing.T) {
	got := buildProxyURL("socks", "st01.loongproxy.com", 50014, "user", "pass")
	want := "socks5://user:pass@st01.loongproxy.com:50014"
	if got != want {
		t.Fatalf("proxy URL = %q, want %q", got, want)
	}
}
