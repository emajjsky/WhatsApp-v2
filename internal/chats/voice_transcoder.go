package chats

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const whatsappVoiceMIMEType = "audio/ogg; codecs=opus"

func normalizeWhatsAppVoice(data []byte, mimeType, fileName string) ([]byte, string, string, error) {
	if len(data) == 0 {
		return nil, "", "", fmt.Errorf("voice recording is empty")
	}

	normalizedMIME := strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	if normalizedMIME == "audio/ogg" || normalizedMIME == "audio/opus" {
		return data, whatsappVoiceMIMEType, voiceFileName(fileName), nil
	}

	ffmpegPath, err := resolveFFmpegPath()
	if err != nil {
		return nil, "", "", err
	}

	tempDir, err := os.MkdirTemp("", "whatsapp-voice-*")
	if err != nil {
		return nil, "", "", fmt.Errorf("prepare voice conversion: %w", err)
	}
	defer os.RemoveAll(tempDir)

	inputExtension := strings.ToLower(filepath.Ext(strings.TrimSpace(fileName)))
	if inputExtension == "" || len(inputExtension) > 8 {
		inputExtension = ".webm"
	}
	inputPath := filepath.Join(tempDir, "input"+inputExtension)
	outputPath := filepath.Join(tempDir, "voice-message.ogg")
	if err := os.WriteFile(inputPath, data, 0o600); err != nil {
		return nil, "", "", fmt.Errorf("write voice conversion input: %w", err)
	}

	command := exec.Command(
		ffmpegPath,
		"-hide_banner", "-loglevel", "error", "-y",
		"-i", inputPath,
		"-vn", "-c:a", "libopus", "-b:a", "32k", "-vbr", "on",
		"-application", "voip", "-ar", "48000", "-ac", "1",
		"-f", "ogg", outputPath,
	)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = err.Error()
		}
		return nil, "", "", fmt.Errorf("convert voice recording to OGG Opus: %s", detail)
	}

	converted, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, "", "", fmt.Errorf("read converted voice recording: %w", err)
	}
	if len(converted) == 0 {
		return nil, "", "", fmt.Errorf("converted voice recording is empty")
	}

	return converted, whatsappVoiceMIMEType, "voice-message.ogg", nil
}

func resolveFFmpegPath() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("FFMPEG_PATH")); configured != "" {
		if stat, err := os.Stat(configured); err == nil && !stat.IsDir() {
			return configured, nil
		}
		return "", fmt.Errorf("voice converter is unavailable at %s", configured)
	}
	if discovered, err := exec.LookPath("ffmpeg"); err == nil {
		return discovered, nil
	}
	return "", fmt.Errorf("voice messages require the bundled FFmpeg converter")
}

func voiceFileName(value string) string {
	base := strings.TrimSpace(filepath.Base(value))
	if strings.EqualFold(filepath.Ext(base), ".ogg") {
		return base
	}
	return "voice-message.ogg"
}
