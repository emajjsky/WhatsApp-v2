package auth

import (
	"context"
	"errors"
)

type contextKey string

const userContextKey contextKey = "auth_user"

var (
	ErrUnauthenticated = errors.New("authentication required")
	ErrForbidden       = errors.New("administrator permission required")
)

func ContextWithUser(ctx context.Context, user User) context.Context {
	return context.WithValue(ctx, userContextKey, user)
}

func CurrentUser(ctx context.Context) (User, bool) {
	if ctx == nil {
		return User{}, false
	}

	user, ok := ctx.Value(userContextKey).(User)
	if !ok || user.ID == "" {
		return User{}, false
	}

	return user, true
}

func RequireUser(ctx context.Context) (User, error) {
	user, ok := CurrentUser(ctx)
	if !ok {
		return User{}, ErrUnauthenticated
	}

	return user, nil
}

func RequireAdmin(ctx context.Context) (User, error) {
	user, err := RequireUser(ctx)
	if err != nil {
		return User{}, err
	}
	if !user.IsAdmin() {
		return User{}, ErrForbidden
	}

	return user, nil
}

func RequirePermission(ctx context.Context, permission Permission) (User, error) {
	user, err := RequireUser(ctx)
	if err != nil {
		return User{}, err
	}
	if !user.HasPermission(permission) {
		return User{}, ErrForbidden
	}

	return user, nil
}
