import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { type UserPermission } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Icon, type IconName } from './Icon'

const baseNavItems: Array<{
  to: string
  label: string
  icon: IconName
  permission: UserPermission
}> = [
  { to: '/accounts', label: '登录', icon: 'account', permission: 'accounts' },
  { to: '/chats', label: '对话', icon: 'chat', permission: 'chats' },
  { to: '/scripts', label: '话术', icon: 'script', permission: 'scripts' },
  { to: '/exports', label: '导出', icon: 'export', permission: 'exports' },
  { to: '/proxies', label: 'IP代理', icon: 'shield', permission: 'accounts' },
]

const adminNavItems = [{ to: '/admin', label: '后台', icon: 'admin' as IconName }]

export function AppShell() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [appVersion, setAppVersion] = useState('')
  const isDesktopRuntime = Boolean((window as Window & { desktopRuntime?: unknown }).desktopRuntime)
  const userPermissions = new Set<UserPermission>(auth.user?.permissions ?? [])
  const visibleBaseNavItems = auth.cloudAdminOnly
    ? []
    : auth.user?.role === 'admin'
      ? baseNavItems
      : baseNavItems.filter((item) => userPermissions.has(item.permission))
  const navItems = (auth.user?.role === 'admin' ? [...visibleBaseNavItems, ...adminNavItems] : visibleBaseNavItems).filter(
    (item) => item.to !== '/proxies' || isDesktopRuntime,
  )

  async function handleLogout() {
    await auth.logout()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    let cancelled = false

    async function loadAppVersion() {
      const desktopRuntime = (
        window as Window & { desktopRuntime?: { appVersion?: () => Promise<string> } }
      ).desktopRuntime
      if (!desktopRuntime?.appVersion) {
        return
      }

      try {
        const version = await desktopRuntime.appVersion()
        if (!cancelled) {
          setAppVersion(version)
        }
      } catch {
        if (!cancelled) {
          setAppVersion('')
        }
      }
    }

    void loadAppVersion()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="app-shell">
      <aside className="sidebar sidebar-compact">
        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              title={item.label}
              aria-label={item.label}
            >
              <span className="nav-icon">
                <Icon name={item.icon} />
              </span>
              <span className="nav-copy">
                <span className="nav-title">{item.label}</span>
              </span>
            </NavLink>
          ))}
        </nav>

        <section className="sidebar-note sidebar-note-compact">
          {appVersion ? <span className="sidebar-version">v{appVersion}</span> : null}
          <button
            className="secondary-button sidebar-logout"
            type="button"
            onClick={handleLogout}
            title={`退出登录：${auth.user?.email ?? ''}`}
            aria-label="退出登录"
          >
            <Icon name="logout" />
            <span>退出</span>
          </button>
        </section>
      </aside>

      <main className="workspace">
        <Outlet />
      </main>
    </div>
  )
}
