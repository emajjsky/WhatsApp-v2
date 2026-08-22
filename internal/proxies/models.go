package proxies

import "time"

type RouteMode string

const (
	RouteModeAuto   RouteMode = "auto"
	RouteModeDirect RouteMode = "direct"
	RouteModeSystem RouteMode = "system"
)

type Proxy struct {
	ID                 string
	UserID             string
	Name               string
	Scheme             string
	Host               string
	Port               int
	Username           string
	PasswordCiphertext []byte
	RouteMode          RouteMode
	ExitIP             *string
	Country            *string
	Enabled            bool
	ExpiresAt          *time.Time
	LastCheckedAt      *time.Time
	LastCheckError     *string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type View struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Scheme         string     `json:"scheme"`
	Host           string     `json:"host"`
	Port           int        `json:"port"`
	Username       string     `json:"username,omitempty"`
	ExitIP         *string    `json:"exit_ip,omitempty"`
	Country        *string    `json:"country,omitempty"`
	Enabled        bool       `json:"enabled"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	LastCheckedAt  *time.Time `json:"last_checked_at,omitempty"`
	LastCheckError *string    `json:"last_check_error,omitempty"`
	HasCredentials bool       `json:"has_credentials"`
	RouteMode      RouteMode  `json:"route_mode"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type Input struct {
	Name      string     `json:"name"`
	Scheme    string     `json:"scheme"`
	Host      string     `json:"host"`
	Port      int        `json:"port"`
	Username  string     `json:"username"`
	Password  string     `json:"password"`
	RouteMode RouteMode  `json:"route_mode,omitempty"`
	ExitIP    *string    `json:"exit_ip,omitempty"`
	Country   *string    `json:"country,omitempty"`
	Enabled   *bool      `json:"enabled,omitempty"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}

type UpdateInput struct {
	Name      *string    `json:"name,omitempty"`
	Scheme    *string    `json:"scheme,omitempty"`
	Host      *string    `json:"host,omitempty"`
	Port      *int       `json:"port,omitempty"`
	Username  *string    `json:"username,omitempty"`
	Password  *string    `json:"password,omitempty"`
	RouteMode *RouteMode `json:"route_mode,omitempty"`
	ExitIP    *string    `json:"exit_ip,omitempty"`
	Country   *string    `json:"country,omitempty"`
	Enabled   *bool      `json:"enabled,omitempty"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}
