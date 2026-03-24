package sessions

import (
	"fmt"
	"log/slog"

	waLog "go.mau.fi/whatsmeow/util/log"
)

type whatsmeowLogger struct {
	logger *slog.Logger
}

func newWhatsmeowLogger(logger *slog.Logger) waLog.Logger {
	if logger == nil {
		logger = slog.Default()
	}

	return &whatsmeowLogger{logger: logger.With("library", "whatsmeow")}
}

func (l *whatsmeowLogger) Warnf(msg string, args ...interface{}) {
	l.logger.Warn(fmt.Sprintf(msg, args...))
}

func (l *whatsmeowLogger) Errorf(msg string, args ...interface{}) {
	l.logger.Error(fmt.Sprintf(msg, args...))
}

func (l *whatsmeowLogger) Infof(msg string, args ...interface{}) {
	l.logger.Info(fmt.Sprintf(msg, args...))
}

func (l *whatsmeowLogger) Debugf(msg string, args ...interface{}) {
	l.logger.Debug(fmt.Sprintf(msg, args...))
}

func (l *whatsmeowLogger) Sub(module string) waLog.Logger {
	return &whatsmeowLogger{logger: l.logger.With("module", module)}
}
