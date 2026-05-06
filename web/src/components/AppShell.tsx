import { useEffect, useState } from 'react'
import { type UserPermission } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Icon, type IconName } from './Icon'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'

const sidebarCollapsedStorageKey = 'whatsapp.sidebarCollapsed.v1'

const baseNavItems: Array<{
  to: string
  label: string
  icon: IconName
  permission: UserPermission
}> = [
  { to: '/accounts', label: '账号接入', icon: 'account', permission: 'accounts' },
  { to: '/chats', label: '对话查看', icon: 'chat', permission: 'chats' },
  { to: '/scripts', label: '剧本', icon: 'script', permission: 'scripts' },
  { to: '/exports', label: '导出中心', icon: 'export', permission: 'exports' },
]

const adminNavItems = [
  { to: '/admin', label: '管理员后台', icon: 'admin' as IconName },
]

export function AppShell() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.localStorage.getItem(sidebarCollapsedStorageKey) === '1'
  })
  const userPermissions = new Set<UserPermission>(auth.user?.permissions ?? [])
  const visibleBaseNavItems =
    auth.user?.role === 'admin'
      ? baseNavItems
      : baseNavItems.filter((item) => userPermissions.has(item.permission))
  const navItems = auth.user?.role === 'admin'
    ? [...visibleBaseNavItems, ...adminNavItems]
    : visibleBaseNavItems

  useEffect(() => {
    window.localStorage.setItem(sidebarCollapsedStorageKey, sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  async function handleLogout() {
    await auth.logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className={`sidebar${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <div className="sidebar-topbar">
          <button
            className="sidebar-toggle"
            type="button"
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            aria-pressed={sidebarCollapsed}
          >
            <Icon name="chevronDown" />
          </button>
        </div>

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

        <section className="sidebar-note">
          <div className="sidebar-note-content">
            <p className="eyebrow">当前用户</p>
            <strong className="sidebar-user-name">{auth.user?.display_name}</strong>
            <span className="subtle-text">{auth.user?.email}</span>
          </div>
          <button className="secondary-button sidebar-logout" type="button" onClick={handleLogout}>
            <Icon name="logout" />
            <span>退出登录</span>
          </button>
        </section>
      </aside>

      <main className="workspace">
        <Outlet />
      </main>
    </div>
  )
}
