import { type FormEvent, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { PublicOnly, useAuth } from '../auth/AuthContext'

const rememberedEmailKey = 'whatsapp-agent-login-email'
const rememberedPasswordKey = 'whatsapp-agent-login-password'
const rememberPasswordKey = 'whatsapp-agent-login-remember-password'

type RememberedLogin = {
  email?: string
  password?: string
  rememberPassword?: boolean
  secure?: boolean
}

type DesktopRuntime = {
  getRememberedLogin?: () => Promise<RememberedLogin>
  saveRememberedLogin?: (payload: { email: string; password: string; rememberPassword: boolean }) => Promise<{ secure: boolean }>
}

function desktopRuntime() {
  return (window as Window & { desktopRuntime?: DesktopRuntime }).desktopRuntime
}

function readLoginStorage(key: string) {
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

export function LoginPage() {
  return (
    <PublicOnly>
      <LoginForm />
    </PublicOnly>
  )
}

function LoginForm() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState(() => readLoginStorage(rememberedEmailKey))
  const [password, setPassword] = useState('')
  const [rememberPassword, setRememberPassword] = useState(() => readLoginStorage(rememberPasswordKey) === 'true')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false

    async function loadRememberedLogin() {
      let remembered: RememberedLogin
      try {
        remembered = desktopRuntime()?.getRememberedLogin
          ? await desktopRuntime()!.getRememberedLogin!()
          : {
              email: readLoginStorage(rememberedEmailKey),
              password: readLoginStorage(rememberedPasswordKey),
              rememberPassword: readLoginStorage(rememberPasswordKey) === 'true',
              secure: false,
            }
      } catch (storageError) {
        void storageError
        remembered = {
          email: readLoginStorage(rememberedEmailKey),
          password: readLoginStorage(rememberedPasswordKey),
          rememberPassword: readLoginStorage(rememberPasswordKey) === 'true',
          secure: false,
        }
      }
      if (cancelled) {
        return
      }
      const localEmail = readLoginStorage(rememberedEmailKey)
      const localPassword = readLoginStorage(rememberedPasswordKey)
      const localRememberPassword = readLoginStorage(rememberPasswordKey) === 'true'
      const hasDesktopEmail = Boolean(remembered.email?.trim())
      setEmail(hasDesktopEmail ? remembered.email! : localEmail)
      setRememberPassword(hasDesktopEmail ? remembered.rememberPassword === true : localRememberPassword)
      if (remembered.password) {
        setPassword(remembered.password)
      } else if (!hasDesktopEmail || remembered.secure === false) {
        setPassword(localPassword)
      }
    }

    void loadRememberedLogin()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    setSubmitting(true)

    try {
      const runtime = desktopRuntime()
      await auth.login({ email, password })
      try {
        window.localStorage.setItem(rememberedEmailKey, email.trim())
        window.localStorage.setItem(rememberPasswordKey, String(rememberPassword))
        if (!runtime?.saveRememberedLogin && rememberPassword) {
          window.localStorage.setItem(rememberedPasswordKey, password)
        } else if (!rememberPassword || runtime?.saveRememberedLogin) {
          window.localStorage.removeItem(rememberedPasswordKey)
        }
      } catch (storageError) {
        void storageError
      }
      if (runtime?.saveRememberedLogin) {
        try {
          const result = await runtime.saveRememberedLogin({ email: email.trim(), password, rememberPassword })
          if (result.secure) {
            try {
              window.localStorage.removeItem(rememberedPasswordKey)
            } catch (storageError) {
              void storageError
            }
          } else if (rememberPassword) {
            try {
              window.localStorage.setItem(rememberedPasswordKey, password)
            } catch (storageError) {
              void storageError
            }
          }
        } catch (storageError) {
          void storageError
          if (rememberPassword) {
            try {
              window.localStorage.setItem(rememberedPasswordKey, password)
            } catch (storageError) {
              void storageError
            }
          }
        }
      }
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
      navigate(from && from !== '/login' ? from : '/accounts', { replace: true })
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div>
          <p className="eyebrow">WhatsApp Console</p>
          <h1>登录后台</h1>
          <p className="auth-copy">使用管理员或用户账号进入系统。</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <label className="auth-remember-row">
            <input
              type="checkbox"
              checked={rememberPassword}
              onChange={(event) => {
                const checked = event.target.checked
                setRememberPassword(checked)
                if (!checked) {
                  try {
                    window.localStorage.removeItem(rememberedPasswordKey)
                    window.localStorage.setItem(rememberPasswordKey, 'false')
                  } catch (storageError) {
                    void storageError
                  }
                  void desktopRuntime()?.saveRememberedLogin?.({ email: email.trim(), password: '', rememberPassword: false })
                }
              }}
            />
            <span>记住密码</span>
          </label>

          {error ? <div className="error-banner">{error}</div> : null}

          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? '登录中...' : '登录'}
          </button>
        </form>

        {auth.registrationEnabled ? (
          <p className="auth-footer">
            没有账号？<Link to="/register">注册新账号</Link>
          </p>
        ) : null}
      </section>
    </main>
  )
}
