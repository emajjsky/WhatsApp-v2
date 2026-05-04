import { type UserPermission } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'

const baseNavItems: Array<{
  to: string
  label: string
  hint: string
  permission: UserPermission
}> = [
  { to: '/accounts', label: '账号接入', hint: '创建账号、查看配对状态、管理登录会话', permission: 'accounts' },
  { to: '/chats', label: '对话查看', hint: '按账号和会话筛选，浏览消息时间线', permission: 'chats' },
  { to: '/scripts', label: '剧本', hint: '上传话术、产品知识和流程内容', permission: 'scripts' },
  { to: '/exports', label: '导出中心', hint: '按单账号多选会话，生成导出文件', permission: 'exports' },
]

const adminNavItems = [
  { to: '/admin', label: '管理员后台', hint: '用户、邀请码、智能回复与权限配置' },
]

export function AppShell() {
  const auth = useAuth()
  const navigate = useNavigate()
  const userPermissions = new Set<UserPermission>(auth.user?.permissions ?? [])
  const visibleBaseNavItems =
    auth.user?.role === 'admin'
      ? baseNavItems
      : baseNavItems.filter((item) => userPermissions.has(item.permission))
  const navItems = auth.user?.role === 'admin'
    ? [...visibleBaseNavItems, ...adminNavItems]
    : visibleBaseNavItems

  async function handleLogout() {
    await auth.logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <section className="brand-card">
          <p className="eyebrow">WhatsApp Console</p>
          <h1>会话管理台</h1>
          <p className="brand-copy">账号、对话、剧本、导出统一管理。</p>
        </section>

        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <span className="nav-title">{item.label}</span>
              <span className="nav-hint">{item.hint}</span>
            </NavLink>
          ))}
        </nav>

        <section className="sidebar-note">
          <p className="eyebrow">当前用户</p>
          <strong className="sidebar-user-name">{auth.user?.display_name}</strong>
          <span className="subtle-text">{auth.user?.email}</span>
          <button className="secondary-button sidebar-logout" type="button" onClick={handleLogout}>
            退出登录
          </button>
        </section>
      </aside>

      <main className="workspace">
        <Outlet />
      </main>
    </div>
  )
}
