package accounts

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"whatsapp-agent-platform/internal/httpx"
	"whatsapp-agent-platform/internal/sessions"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) (*Handler, error) {
	if service == nil {
		return nil, fmt.Errorf("account handler requires a service")
	}

	return &Handler{service: service}, nil
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/accounts", h.handleAccounts)
	mux.HandleFunc("/api/accounts/", h.handleAccountByID)
}

func (h *Handler) handleAccounts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		accounts, err := h.service.ListAccounts(r.Context())
		if err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, err.Error())
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{"accounts": accounts})
	case http.MethodPost:
		var input CreateAccountInput
		if err := httpx.DecodeJSON(r, &input); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}

		account, err := h.service.CreateAccount(r.Context(), input)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}

		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"account": account})
	default:
		httpx.WriteMethodNotAllowed(w, http.MethodGet, http.MethodPost)
	}
}

func (h *Handler) handleAccountByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/accounts/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 2 || strings.TrimSpace(parts[0]) == "" {
		http.NotFound(w, r)
		return
	}

	accountID := parts[0]
	action := parts[1]

	switch {
	case r.Method == http.MethodGet && action == "status":
		account, err := h.service.GetAccountStatus(r.Context(), accountID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"account": account})
	case r.Method == http.MethodPost && action == "pair":
		var payload struct {
			Method sessions.PairingMethod `json:"method"`
		}
		if r.ContentLength > 0 {
			if err := httpx.DecodeJSON(r, &payload); err != nil {
				httpx.WriteError(w, http.StatusBadRequest, err.Error())
				return
			}
		}

		account, err := h.service.StartPairing(r.Context(), accountID, payload.Method)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"account": account})
	case r.Method == http.MethodPost && action == "logout":
		account, err := h.service.Logout(r.Context(), accountID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"account": account})
	default:
		http.NotFound(w, r)
	}
}

func (h *Handler) writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrAccountNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	default:
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
	}
}
