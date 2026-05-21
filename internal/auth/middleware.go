package auth

import (
	"net/http"
	"strings"

	"whatsapp-agent-platform/internal/httpx"
)

func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isPublicPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}

		token := bearerTokenFromHeader(r)
		if token == "" {
			cookie, err := r.Cookie(s.cfg.CookieName)
			if err != nil || strings.TrimSpace(cookie.Value) == "" {
				httpx.WriteError(w, http.StatusUnauthorized, ErrUnauthenticated.Error())
				return
			}
			token = strings.TrimSpace(cookie.Value)
		}

		if token == "" {
			httpx.WriteError(w, http.StatusUnauthorized, ErrUnauthenticated.Error())
			return
		}

		user, err := s.UserFromToken(r.Context(), token)
		if err != nil {
			httpx.WriteError(w, http.StatusUnauthorized, err.Error())
			return
		}
		if !canAccessPath(user, r.URL.Path) {
			httpx.WriteError(w, http.StatusForbidden, ErrForbidden.Error())
			return
		}

		next.ServeHTTP(w, r.WithContext(ContextWithUser(r.Context(), user)))
	})
}

func bearerTokenFromHeader(r *http.Request) string {
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

func isPublicPath(path string) bool {
	switch strings.TrimSpace(path) {
	case "/", "/healthz", "/api/auth/session", "/api/auth/login", "/api/auth/logout", "/api/auth/register", "/api/desktop/auth/login", "/api/desktop/auth/register", "/api/desktop/auth/verify", "/api/desktop/devices/heartbeat":
		return true
	default:
		return false
	}
}

func canAccessPath(user User, path string) bool {
	if user.IsAdmin() {
		return true
	}

	switch {
	case strings.HasPrefix(path, "/api/admin/"):
		return false
	case strings.HasPrefix(path, "/api/accounts"), strings.HasPrefix(path, "/api/live"):
		return user.HasPermission(PermissionAccounts)
	case strings.HasPrefix(path, "/api/chats"), strings.HasPrefix(path, "/api/media/"), strings.HasPrefix(path, "/api/agent-configs"), strings.HasPrefix(path, "/api/agent-runs"), strings.HasPrefix(path, "/api/agent-translations"), strings.HasPrefix(path, "/api/agent-status-card"), strings.HasPrefix(path, "/api/assistant-usage-logs"), strings.HasPrefix(path, "/api/desktop/agent/"):
		return user.HasPermission(PermissionChats)
	case strings.HasPrefix(path, "/api/scripts"):
		return user.HasPermission(PermissionScripts)
	case strings.HasPrefix(path, "/api/exports"):
		return user.HasPermission(PermissionExports)
	case strings.HasPrefix(path, "/api/audit"), strings.HasPrefix(path, "/api/agents"):
		return false
	case strings.HasPrefix(path, "/api/system/health"):
		return true
	default:
		return true
	}
}
