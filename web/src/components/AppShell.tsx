import { NavLink, Outlet } from 'react-router-dom'

const navItems = [
  { to: '/', label: '首页总览', hint: '先看状态，再开始操作' },
  { to: '/accounts', label: '账号接入', hint: '创建账号并完成配对' },
  { to: '/chats', label: '对话查看', hint: '按账号筛选并查看消息' },
  { to: '/exports', label: '导出中心', hint: '后续接入任务导出' },
  { to: '/agents', label: 'Agent 规则', hint: '后续接入建议回复与自动回复' },
]

export function AppShell() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <p className="eyebrow">WhatsApp 工作台</p>
          <h1>对话台</h1>
          <p className="brand-copy">
            给新手员工准备的日常操作台。先连账号，再看聊天，再决定是否导出或交给 Agent。
          </p>
        </div>

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
