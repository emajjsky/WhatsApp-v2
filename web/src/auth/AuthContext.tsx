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
  const [loading, setLoading] = useState(true)

  async function refresh() {
    const response = await getAuthSession()
    setUser(response.authenticated ? response.user : undefined)
    setRegistrationEnabled(response.registration_enabled)
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
    [loading, registrationEnabled, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

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
    return <Navigate to="/accounts" replace />
  }

  return <>{children}</>
}
