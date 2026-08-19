import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import {
  getAuthSession,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
  type AuthUser,
  type LoginPayload,
  type RegisterPayload,
} from '../api/client'

interface AuthContextValue {
  user?: AuthUser
  authenticated: boolean
  registrationEnabled: boolean
  environment?: string
  cloudAdminOnly: boolean
  loading: boolean
  login: (payload: LoginPayload) => Promise<void>
  register: (payload: RegisterPayload) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser>()
  const [registrationEnabled, setRegistrationEnabled] = useState(false)
  const [environment, setEnvironment] = useState<string>()
  const [loading, setLoading] = useState(true)

  async function refresh() {
    const response = await getAuthSession()
    setUser(response.authenticated ? response.user : undefined)
    setRegistrationEnabled(response.registration_enabled)
    setEnvironment(response.environment)
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const response = await getAuthSession()
        if (cancelled) {
          return
        }
        setUser(response.authenticated ? response.user : undefined)
        setRegistrationEnabled(response.registration_enabled)
        setEnvironment(response.environment)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      authenticated: Boolean(user),
      registrationEnabled,
      environment,
      cloudAdminOnly: environment === 'electron-cloud',
      loading,
      login: async (payload) => {
        const response = await loginRequest(payload)
        setUser(response.user)
      },
      register: async (payload) => {
        const response = await registerRequest(payload)
        setUser(response.user)
      },
      logout: async () => {
        await logoutRequest()
        setUser(undefined)
      },
      refresh,
    }),
    [environment, loading, registrationEnabled, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// The provider and route guards intentionally share this hook in one module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }

  return context
}

export function RequireAuth() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.loading) {
    return <div className="auth-loading">正在检查登录状态...</div>
  }
  if (!auth.authenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}

export function RequireAdmin() {
  const auth = useAuth()

  if (auth.loading) {
    return <div className="auth-loading">正在检查权限...</div>
  }
  if (!auth.authenticated) {
    return <Navigate to="/login" replace />
  }
  if (auth.user?.role !== 'admin') {
    if (auth.cloudAdminOnly) {
      return <div className="auth-loading">当前账号没有后台权限</div>
    }
    return <Navigate to="/accounts" replace />
  }

  return <Outlet />
}

export function PublicOnly({ children }: { children: ReactNode }) {
  const auth = useAuth()

  if (auth.loading) {
    return <div className="auth-loading">正在加载...</div>
  }
  if (auth.authenticated) {
    return <Navigate to={auth.cloudAdminOnly ? '/admin' : '/accounts'} replace />
  }

  return <>{children}</>
}
