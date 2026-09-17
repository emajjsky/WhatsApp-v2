package chats

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestNormalizeWhatsAppVoiceKeepsOGGWithoutConverter(t *testing.T) {
	t.Setenv("FFMPEG_PATH", "")
	input := []byte("OggS-test-payload")

	data, mimeType, fileName, err := normalizeWhatsAppVoice(input, "audio/ogg; codecs=opus", "recording.ogg")
	if err != nil {
		t.Fatalf("normalizeWhatsAppVoice() returned error: %v", err)
	}
	if !bytes.Equal(data, input) {
		t.Fatal("OGG payload was unexpectedly changed")
	}
	if mimeType != whatsappVoiceMIMEType {
		t.Fatalf("mimeType = %q, want %q", mimeType, whatsappVoiceMIMEType)
	}
	if fileName != "recording.ogg" {
		t.Fatalf("fileName = %q, want recording.ogg", fileName)
	}
}

func TestNormalizeWhatsAppVoiceConvertsWebMWithConfiguredFFmpeg(t *testing.T) {
	ffmpegPath := os.Getenv("FFMPEG_PATH")
	if ffmpegPath == "" {
		t.Skip("FFMPEG_PATH is not configured")
	}

	inputPath := filepath.Join(t.TempDir(), "recording.webm")
	generate := exec.Command(
		ffmpegPath,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
		"-t", "0.15", "-c:a", "libopus", inputPath,
	)
	if output, err := generate.CombinedOutput(); err != nil {
		t.Fatalf("generate WebM fixture: %v: %s", err, output)
	}

	input, err := os.ReadFile(inputPath)
	if err != nil {
		t.Fatalf("read WebM fixture: %v", err)
	}
	data, mimeType, fileName, err := normalizeWhatsAppVoice(input, "audio/webm; codecs=opus", "recording.webm")
	if err != nil {
		t.Fatalf("normalizeWhatsAppVoice() returned error: %v", err)
	}
	if !bytes.HasPrefix(data, []byte("OggS")) {
		t.Fatal("converted voice message is not an OGG stream")
	}
	if mimeType != whatsappVoiceMIMEType {
		t.Fatalf("mimeType = %q, want %q", mimeType, whatsappVoiceMIMEType)
	}
	if fileName != "voice-message.ogg" {
		t.Fatalf("fileName = %q, want voice-message.ogg", fileName)
	}
}

func TestNormalizeDirectPhoneNumber(t *testing.T) {
	if got := normalizeDirectPhoneNumber("+62 (812) 345-678"); got != "62812345678" {
		t.Fatalf("normalizeDirectPhoneNumber() = %q", got)
	}
}

func TestOpenDirectChatRejectsShortPhoneNumber(t *testing.T) {
	service := &Service{}
	_, err := service.OpenDirectChat(context.Background(), OpenDirectChatInput{AccountID: "account-1", PhoneNumber: "123"})
	if err == nil {
		t.Fatal("OpenDirectChat() accepted an invalid short number")
	}
}
