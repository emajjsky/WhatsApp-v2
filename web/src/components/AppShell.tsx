import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { subscribeLiveUpdates, type LiveUpdate, type UserPermission } from '../api/client'
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
  { to: '/contacts', label: '联系人', icon: 'contacts', permission: 'chats' },
  { to: '/exports', label: '导出', icon: 'export', permission: 'exports' },
  { to: '/proxies', label: 'IP代理', icon: 'shield', permission: 'accounts' },
]

const adminNavItems = [{ to: '/admin', label: '后台', icon: 'admin' as IconName }]

export function AppShell() {
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [appVersion, setAppVersion] = useState('')
  const isDesktopRuntime = Boolean((window as Window & { desktopRuntime?: unknown }).desktopRuntime)
  const userPermissions = new Set<UserPermission>(auth.user?.permissions ?? [])
  const visibleBaseNavItems = auth.cloudAdminOnly
    ? []
    : auth.user?.role === 'admin' || auth.user?.role === 'super_admin'
      ? baseNavItems
      : baseNavItems.filter((item) => userPermissions.has(item.permission))
  const navItems = (auth.user?.role === 'admin' || auth.user?.role === 'super_admin' ? [...visibleBaseNavItems, ...adminNavItems] : visibleBaseNavItems).filter(
    (item) => item.to !== '/proxies' || isDesktopRuntime,
  )
  const isChatMode = location.pathname.startsWith('/chats')

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

  useEffect(() => {
    function notifyIncomingCall(update: LiveUpdate) {
      if (update.type !== 'incoming_call') {
        return
      }

      const callType = update.call_type === 'video' ? '视频' : '语音'
      const caller = update.caller_jid?.split('@')[0] || '未知联系人'
      const desktopRuntime = (
        window as Window & {
          desktopRuntime?: {
            notifyIncomingCall?: (payload: { callType: string; caller: string }) => Promise<unknown>
          }
        }
      ).desktopRuntime
      if (desktopRuntime?.notifyIncomingCall) {
        void desktopRuntime.notifyIncomingCall({ callType: update.call_type ?? 'audio', caller })
        return
      }

      if (!('Notification' in window)) {
        return
      }
      const showNotification = () => new Notification(
        `WhatsApp ${callType}来电`,
        { body: `来自 ${caller}，请使用手机或官方 WhatsApp 接听。` },
      )
      if (Notification.permission === 'granted') {
        showNotification()
      } else if (Notification.permission === 'default') {
        void Notification.requestPermission().then((permission) => {
          if (permission === 'granted') {
            showNotification()
          }
        })
      }
    }

    return subscribeLiveUpdates(notifyIncomingCall)
  }, [])

  return (
    <div className={`app-shell${isChatMode ? ' app-shell-chat-mode' : ''}`}>
      <aside className={`sidebar sidebar-compact${isChatMode ? ' sidebar-chat-mode' : ''}`}>
        <nav className={`nav-list${isChatMode ? ' nav-list-chat-mode' : ''}`} aria-label="主导航">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              data-tooltip={item.label}
              aria-label={item.label}
            >
              <span className="nav-icon">
                <Icon name={item.icon} />
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
            data-tooltip="退出登录"
            aria-label="退出登录"
          >
            <Icon name="logout" />
          </button>
        </section>
      </aside>

      <main className="workspace">
        <Outlet />
      </main>
    </div>
  )
}
