package auth

import "time"

type Role string

const (
	RoleAdmin Role = "admin"
	RoleUser  Role = "user"
)

type Status string

const (
	StatusActive   Status = "active"
	StatusDisabled Status = "disabled"
)

type Permission string

const (
	PermissionAccounts Permission = "accounts"
	PermissionChats    Permission = "chats"
	PermissionScripts  Permission = "scripts"
	PermissionExports  Permission = "exports"
)

var DefaultUserPermissions = []Permission{
	PermissionAccounts,
	PermissionChats,
	PermissionScripts,
	PermissionExports,
}

type User struct {
	ID           string       `json:"id"`
	Email        string       `json:"email"`
	DisplayName  string       `json:"display_name"`
	Role         Role         `json:"role"`
	Status       Status       `json:"status"`
	Permissions  []Permission `json:"permissions,omitempty"`
	Desktop      DesktopGrant `json:"desktop"`
	LastLoginAt  *time.Time   `json:"last_login_at,omitempty"`
	CreatedAt    time.Time    `json:"created_at"`
	UpdatedAt    time.Time    `json:"updated_at"`
	PasswordHash string       `json:"-"`
}

func (u User) IsAdmin() bool {
	return u.Role == RoleAdmin
}

func (u User) IsActive() bool {
	return u.Status == StatusActive
}

func (u User) HasPermission(permission Permission) bool {
	if u.IsAdmin() {
		return true
	}

	normalized := normalizePermission(permission)
	if normalized == "" {
		return false
	}

	for _, item := range u.Permissions {
		if normalizePermission(item) == normalized {
			return true
		}
	}

	return false
}

type Session struct {
	ID             string
	UserID         string
	TokenHash      string
	CloudTokenHash *string
	UserAgent      *string
	IPAddress      *string
	ExpiresAt      time.Time
	CreatedAt      time.Time
	LastSeenAt     time.Time
}

type LoginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type RegisterInput struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
	InviteCode  string `json:"invite_code"`
}

type DesktopGrant struct {
	Enabled          bool       `json:"enabled,omitempty"`
	LicenseExpiresAt *time.Time `json:"license_expires_at,omitempty"`
	MaxDevices       int        `json:"max_devices"`
}

type DesktopDeviceStatus string

const (
	DesktopDeviceStatusActive   DesktopDeviceStatus = "active"
	DesktopDeviceStatusDisabled DesktopDeviceStatus = "disabled"
)

type DesktopDevice struct {
	ID            string              `json:"id"`
	UserID        string              `json:"user_id"`
	DeviceID      string              `json:"device_id"`
	DeviceName    string              `json:"device_name"`
	AppVersion    string              `json:"app_version"`
	Status        DesktopDeviceStatus `json:"status"`
	LastIPAddress *string             `json:"last_ip_address,omitempty"`
	LastSeenAt    time.Time           `json:"last_seen_at"`
	CreatedAt     time.Time           `json:"created_at"`
	UpdatedAt     time.Time           `json:"updated_at"`
}

type DesktopClientInput struct {
	DeviceID   string `json:"device_id"`
	DeviceName string `json:"device_name"`
	AppVersion string `json:"app_version"`
}

type DesktopLoginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	DesktopClientInput
}

type DesktopRegisterInput struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
	InviteCode  string `json:"invite_code"`
	DesktopClientInput
}

type DesktopVerifyInput struct {
	DesktopClientInput
}

type DesktopAuthResult struct {
	User      User          `json:"user"`
	Device    DesktopDevice `json:"device"`
	Token     string        `json:"token,omitempty"`
	ExpiresAt time.Time     `json:"expires_at"`
}

type CreateUserInput struct {
	Email       string       `json:"email"`
	Password    string       `json:"password"`
	DisplayName string       `json:"display_name"`
	Role        Role         `json:"role"`
	Status      Status       `json:"status"`
	Permissions []Permission `json:"permissions,omitempty"`
	Desktop     DesktopGrant `json:"desktop,omitempty"`
}

type MirrorUserInput struct {
	ID          string       `json:"id"`
	Email       string       `json:"email"`
	DisplayName string       `json:"display_name"`
	Role        Role         `json:"role"`
	Status      Status       `json:"status"`
	Permissions []Permission `json:"permissions,omitempty"`
}

type UpdateUserInput struct {
	DisplayName *string       `json:"display_name,omitempty"`
	Role        *Role         `json:"role,omitempty"`
	Status      *Status       `json:"status,omitempty"`
	Permissions *[]Permission `json:"permissions,omitempty"`
	Desktop     *DesktopGrant `json:"desktop,omitempty"`
}

type UpdateDesktopDeviceInput struct {
	Status *DesktopDeviceStatus `json:"status,omitempty"`
}

type ResetPasswordInput struct {
	Password string `json:"password"`
}

type AuthResult struct {
	User       User      `json:"user"`
	Token      string    `json:"-"`
	CloudToken string    `json:"-"`
	ExpiresAt  time.Time `json:"expires_at"`
}

type InvitationStatus string

const (
	InvitationStatusActive   InvitationStatus = "active"
	InvitationStatusDisabled InvitationStatus = "disabled"
)

type InvitationCode struct {
	ID         string           `json:"id"`
	Code       string           `json:"code"`
	Status     InvitationStatus `json:"status"`
	MaxUses    int              `json:"max_uses"`
	UsedCount  int              `json:"used_count"`
	ExpiresAt  *time.Time       `json:"expires_at,omitempty"`
	Note       string           `json:"note"`
	CreatedBy  *string          `json:"created_by,omitempty"`
	LastUsedAt *time.Time       `json:"last_used_at,omitempty"`
	CreatedAt  time.Time        `json:"created_at"`
	UpdatedAt  time.Time        `json:"updated_at"`
}

type CreateInvitationInput struct {
	Code      string     `json:"code"`
	MaxUses   int        `json:"max_uses"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	Note      string     `json:"note"`
}

type UpdateInvitationInput struct {
	Status    *InvitationStatus `json:"status,omitempty"`
	MaxUses   *int              `json:"max_uses,omitempty"`
	ExpiresAt *time.Time        `json:"expires_at,omitempty"`
	Note      *string           `json:"note,omitempty"`
}
