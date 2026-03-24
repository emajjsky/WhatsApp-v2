import { NavLink, Outlet } from 'react-router-dom'

const navItems = [
  { to: '/', label: '首页总览', hint: '先看状态，再开始操作' },
  { to: '/accounts', label: '账号接入', hint: '创建账号并完成配对' },
  { to: '/chats', label: '对话查看', hint: '按账号筛选并查看消息' },
  { to: '/exports', label: '导出中心', hint: '创建任务并下载产物' },
  { to: '/agents', label: 'Agent 规则', hint: '配置规则并查看运行记录' },
]

export function AppShell() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <span className="nav-title">{item.label}</span>
              <span className="nav-hint">{item.hint}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-note">
          <p className="eyebrow">上手顺序</p>
          <ol className="step-list">
            <li>先创建一个账号卡片。</li>
            <li>点击配对，让手机扫码或输入配对码。</li>
            <li>进入对话页确认消息，再决定导出或 Agent 规则。</li>
          </ol>
        </div>
      </aside>

      <main className="workspace">
        <Outlet />
      </main>
    </div>
  )
}
