import { type FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { PublicOnly, useAuth } from '../auth/AuthContext'

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
  const [email, setEmail] = useState('admin@example.com')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    setSubmitting(true)

    try {
      await auth.login({ email, password })
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
