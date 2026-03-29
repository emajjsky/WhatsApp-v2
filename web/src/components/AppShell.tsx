import { NavLink, Outlet } from 'react-router-dom'

const navItems = [
  { to: '/accounts', label: '账号接入', hint: '创建账号、查看配对状态、管理登录会话' },
  { to: '/chats', label: '对话查看', hint: '按账号和会话筛选，固定窗口浏览消息时间线' },
  { to: '/exports', label: '导出中心', hint: '多选账号与会话，拆分生成独立导出文件' },
]

export function AppShell() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <section className="brand-card">
          <p className="eyebrow">WhatsApp Console</p>
          <h1>会话管理台</h1>
          <p className="brand-copy">先把账号接入、消息查看、导出留档这三件事跑稳，其他花活先别上。</p>
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
          <p className="eyebrow">使用顺序</p>
          <ol className="step-list">
            <li>先在账号接入里创建卡片并完成登录配对。</li>
            <li>再去对话查看页确认消息同步和历史时间线。</li>
            <li>最后在导出中心按账号和会话拆分生成文件。</li>
          </ol>
        </section>
      </aside>

      <main className="workspace">
        <Outlet />
      </main>
    </div>
  )
}
