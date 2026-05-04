import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PublicOnly, useAuth } from '../auth/AuthContext'

export function RegisterPage() {
  return (
    <PublicOnly>
      <RegisterForm />
    </PublicOnly>
  )
}

function RegisterForm() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)

    if (!auth.registrationEnabled) {
      setError('当前系统暂未开放注册，请联系管理员。')
      return
    }
    if (!inviteCode.trim()) {
      setError('请输入管理员提供的邀请码。')
      return
    }

    setSubmitting(true)
    try {
      await auth.register({
        display_name: displayName.trim(),
        email: email.trim(),
        password,
        invite_code: inviteCode.trim(),
      })
      navigate('/accounts', { replace: true })
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : '注册失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div>
          <p className="eyebrow">WhatsApp Console</p>
          <h1>注册账号</h1>
          <p className="auth-copy">使用管理员发放的邀请码创建普通用户账号。</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>昵称</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
              required
            />
          </label>

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
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>

          <label className="field">
            <span>邀请码</span>
            <input
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              autoComplete="off"
              required
            />
          </label>

          {error ? <div className="error-banner">{error}</div> : null}

          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? '注册中...' : '注册'}
          </button>
        </form>

        <p className="auth-footer">
          已有账号？<Link to="/login">返回登录</Link>
        </p>
      </section>
    </main>
  )
}
