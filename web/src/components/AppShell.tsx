import { NavLink, Outlet } from 'react-router-dom'

const navItems = [
  { to: '/accounts', label: '账号接入', hint: '创建账号、查看配对状态、管理登录会话' },
  { to: '/chats', label: '对话查看', hint: '按账号和会话筛选，固定窗口浏览消息时间线' },
  { to: '/agents', label: '智能回复', hint: '创建 Agent，接入大模型、Coze、n8n 或 Webhook' },
  { to: '/exports', label: '导出中心', hint: '按单账号多选会话，拆分生成独立导出文件' },
  { to: '/scripts', label: '剧本', hint: '上传话术、产品知识和流程内容' },
]

export function AppShell() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <section className="brand-card">
          <p className="eyebrow">WhatsApp Console</p>
          <h1>会话管理台</h1>
          <p className="brand-copy">账号、对话、智能回复、导出统一管理。</p>
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
          <p className="eyebrow">工作流</p>
          <ol className="step-list">
            <li>先接入账号</li>
            <li>再看对话</li>
            <li>最后导出或配置回复</li>
          </ol>
        </section>
      </aside>

      <main className="workspace">
        <Outlet />
      </main>
    </div>
  )
}
