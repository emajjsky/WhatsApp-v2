package sessions

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type liveUpdateSubscriber interface {
	Subscribe(buffer int) (<-chan LiveUpdate, func())
}

type LiveHandler struct {
	subscriber liveUpdateSubscriber
}

func NewLiveHandler(subscriber liveUpdateSubscriber) (*LiveHandler, error) {
	if subscriber == nil {
		return nil, fmt.Errorf("live handler requires a subscriber")
	}

	return &LiveHandler{subscriber: subscriber}, nil
}

func (h *LiveHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/live", h.handleStream)
}

func (h *LiveHandler) handleStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming is not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	updates, cancel := h.subscriber.Subscribe(64)
	defer cancel()

	_, _ = w.Write([]byte(": connected\n\n"))
	flusher.Flush()

	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case update, ok := <-updates:
			if !ok {
				return
			}

			payload, err := json.Marshal(update)
			if err != nil {
				continue
			}

			if _, err := fmt.Fprintf(w, "data: %s\n\n", payload); err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
