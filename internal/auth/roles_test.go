package auth

import (
	"context"
	"errors"
	"testing"
)

func TestRoleAccess(t *testing.T) {
	tests := []struct {
		name       string
		user       User
		admin      bool
		superAdmin bool
	}{
		{"regular user", User{ID: "user", Email: "user@example.com", Role: RoleUser}, false, false},
		{"administrator", User{ID: "admin", Email: "other@example.com", Role: RoleAdmin}, true, false},
		{"super administrator", User{ID: "root", Email: "admin@example.com", Role: RoleSuperAdmin}, true, true},
		{"invalid super administrator", User{ID: "other", Email: "other@example.com", Role: RoleSuperAdmin}, false, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if test.user.IsAdmin() != test.admin || test.user.IsSuperAdmin() != test.superAdmin {
				t.Fatalf("unexpected role access for %s", test.name)
			}
			ctx := ContextWithUser(context.Background(), test.user)
			_, adminError := RequireAdmin(ctx)
			_, superError := RequireSuperAdmin(ctx)
			if (adminError == nil) != test.admin || (superError == nil) != test.superAdmin {
				t.Fatalf("unexpected context permissions: admin=%v super=%v", adminError, superError)
			}
			if !test.superAdmin && !errors.Is(superError, ErrForbidden) {
				t.Fatalf("expected forbidden error, got %v", superError)
			}
		})
	}
}
