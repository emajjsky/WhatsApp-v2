package auth

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/httpx"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) (*Handler, error) {
	if service == nil {
		return nil, fmt.Errorf("auth handler requires a service")
	}

	return &Handler{service: service}, nil
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/auth/session", h.handleSession)
	mux.HandleFunc("/api/auth/login", h.handleLogin)
	mux.HandleFunc("/api/auth/logout", h.handleLogout)
	mux.HandleFunc("/api/auth/register", h.handleRegister)
	mux.HandleFunc("/api/desktop/auth/login", h.handleDesktopLogin)
	mux.HandleFunc("/api/desktop/auth/register", h.handleDesktopRegister)
	mux.HandleFunc("/api/desktop/auth/verify", h.handleDesktopVerify)
	mux.HandleFunc("/api/desktop/devices/heartbeat", h.handleDesktopVerify)
	mux.HandleFunc("/api/admin/users", h.handleUsers)
	mux.HandleFunc("/api/admin/users/", h.handleUserByID)
	mux.HandleFunc("/api/admin/invitations", h.handleInvitations)
	mux.HandleFunc("/api/admin/invitations/", h.handleInvitationByID)
}

func (h *Handler) handleDesktopLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var input DesktopLoginInput
	if err := httpx.DecodeJSON(r, &input); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := h.service.DesktopLogin(r.Context(), input, r)
	if err != nil {
		h.writeAuthError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) handleDesktopRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var input DesktopRegisterInput
	if err := httpx.DecodeJSON(r, &input); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := h.service.DesktopRegister(r.Context(), input, r)
	if err != nil {
		h.writeAuthError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusCreated, result)
}

func (h *Handler) handleDesktopVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var input DesktopVerifyInput
	if err := httpx.DecodeJSON(r, &input); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := h.service.DesktopVerify(r.Context(), bearerToken(r), input, r)
	if err != nil {
		h.writeAuthError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) handleSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	token := h.sessionToken(r)
	user, err := h.service.UserFromToken(r.Context(), token)
	if err != nil {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"authenticated":        false,
			"registration_enabled": h.service.Config().RegistrationEnabled,
			"environment":          h.service.Config().Environment,
		})
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"authenticated":        true,
		"user":                 user,
		"registration_enabled": h.service.Config().RegistrationEnabled,
		"environment":          h.service.Config().Environment,
	})
}

func (h *Handler) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var input LoginInput
	if err := httpx.DecodeJSON(r, &input); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := h.service.Login(r.Context(), input, r)
	if err != nil {
		h.writeAuthError(w, err)
		return
	}

	h.setSessionCookie(w, result)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"user":       result.User,
		"token":      result.Token,
		"expires_at": result.ExpiresAt,
	})
}

func (h *Handler) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var input RegisterInput
	if err := httpx.DecodeJSON(r, &input); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := h.service.Register(r.Context(), input, r)
	if err != nil {
		h.writeAuthError(w, err)
		return
	}

	h.setSessionCookie(w, result)
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"user":       result.User,
		"token":      result.Token,
		"expires_at": result.ExpiresAt,
	})
}

func (h *Handler) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	if err := h.service.Logout(r.Context(), h.sessionToken(r)); err != nil {
		h.writeAuthError(w, err)
		return
	}

	h.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleUsers(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		users, err := h.service.ListUsers(r.Context())
		if err != nil {
			h.writeAuthError(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"users": users})
	case http.MethodPost:
		var input CreateUserInput
		if err := httpx.DecodeJSON(r, &input); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}

		user, err := h.service.AdminCreateUser(r.Context(), input)
		if err != nil {
			h.writeAuthError(w, err)
			return
		}

		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"user": user})
	default:
		httpx.WriteMethodNotAllowed(w, http.MethodGet, http.MethodPost)
	}
}

func (h *Handler) handleUserByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/users/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		http.NotFound(w, r)
		return
	}

	userID := parts[0]
	if len(parts) == 1 && r.Method == http.MethodPatch {
		var input UpdateUserInput
		if err := httpx.DecodeJSON(r, &input); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}

		user, err := h.service.UpdateUser(r.Context(), userID, input)
		if err != nil {
			h.writeAuthError(w, err)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{"user": user})
		return
	}

	if len(parts) == 2 && parts[1] == "desktop-devices" && r.Method == http.MethodGet {
		devices, err := h.service.ListDesktopDevices(r.Context(), userID)
		if err != nil {
			h.writeAuthError(w, err)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{"devices": devices})
		return
	}

	if len(parts) == 4 && parts[1] == "desktop-devices" && parts[3] == "status" && r.Method == http.MethodPatch {
		var input UpdateDesktopDeviceInput
		if err := httpx.DecodeJSON(r, &input); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}

		device, err := h.service.UpdateDesktopDevice(r.Context(), userID, parts[2], input)
		if err != nil {
			h.writeAuthError(w, err)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{"device": device})
		return
	}

	if len(parts) == 2 && parts[1] == "password" && r.Method == http.MethodPost {
		var input ResetPasswordInput
		if err := httpx.DecodeJSON(r, &input); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}

		if err := h.service.ResetPassword(r.Context(), userID, input); err != nil {
			h.writeAuthError(w, err)
			return
		}

		w.WriteHeader(http.StatusNoContent)
		return
	}

	http.NotFound(w, r)
}

func (h *Handler) handleInvitations(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		items, err := h.service.ListInvitationCodes(r.Context())
		if err != nil {
			h.writeAuthError(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"invitations": items})
	case http.MethodPost:
		var input CreateInvitationInput
		if err := httpx.DecodeJSON(r, &input); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}

		item, err := h.service.CreateInvitationCode(r.Context(), input)
		if err != nil {
			h.writeAuthError(w, err)
			return
		}

		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"invitation": item})
	default:
		httpx.WriteMethodNotAllowed(w, http.MethodGet, http.MethodPost)
	}
}

func (h *Handler) handleInvitationByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/invitations/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 1 || strings.TrimSpace(parts[0]) == "" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodPatch {
		httpx.WriteMethodNotAllowed(w, http.MethodPatch)
		return
	}

	var input UpdateInvitationInput
	if err := httpx.DecodeJSON(r, &input); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	item, err := h.service.UpdateInvitationCode(r.Context(), parts[0], input)
	if err != nil {
		h.writeAuthError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"invitation": item})
}

func (h *Handler) sessionToken(r *http.Request) string {
	if r == nil {
		return ""
	}

	cookie, err := r.Cookie(h.service.Config().CookieName)
	if err != nil {
		return ""
	}

	return strings.TrimSpace(cookie.Value)
}

func (h *Handler) setSessionCookie(w http.ResponseWriter, result AuthResult) {
	cfg := h.service.Config()
	http.SetCookie(w, &http.Cookie{
		Name:     cfg.CookieName,
		Value:    result.Token,
		Path:     "/",
		Expires:  result.ExpiresAt,
		MaxAge:   int(timeUntil(result.ExpiresAt).Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   cfg.SecureCookie,
	})
}

func (h *Handler) clearSessionCookie(w http.ResponseWriter) {
	cfg := h.service.Config()
	http.SetCookie(w, &http.Cookie{
		Name:     cfg.CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   cfg.SecureCookie,
	})
}

func (h *Handler) writeAuthError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnauthenticated), errors.Is(err, ErrInvalidSession):
		httpx.WriteError(w, http.StatusUnauthorized, err.Error())
	case errors.Is(err, ErrForbidden):
		httpx.WriteError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, ErrInvalidCredentials):
		httpx.WriteError(w, http.StatusUnauthorized, err.Error())
	case errors.Is(err, ErrRegistrationDisabled), errors.Is(err, ErrUserDisabled), errors.Is(err, ErrCannotDisableSelf), errors.Is(err, ErrCannotDemoteLastAdmin), errors.Is(err, ErrInvalidInviteCode), errors.Is(err, ErrDesktopDisabled), errors.Is(err, ErrDesktopLicenseExpired), errors.Is(err, ErrDesktopDeviceDisabled), errors.Is(err, ErrDesktopDeviceLimitReached):
		httpx.WriteError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, ErrDesktopDeviceRequired):
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrUserNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	default:
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
	}
}

func bearerToken(r *http.Request) string {
	if r == nil {
		return ""
	}
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if header == "" {
		return ""
	}
	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}

	return strings.TrimSpace(parts[1])
}

func timeUntil(t time.Time) time.Duration {
	duration := time.Until(t)
	if duration < 0 {
		return 0
	}

	return duration
}
