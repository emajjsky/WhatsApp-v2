import { useEffect, useState } from 'react'
import { getHealth, listAccounts, listChats, type HealthResponse } from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { PageHeader } from '../components/PageHeader'

interface DashboardState {
  health?: HealthResponse
  accountCount: number
  chatCount: number
}

export function DashboardPage() {
  const [state, setState] = useState<DashboardState>({ accountCount: 0, chatCount: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError(undefined)

      const [healthResult, accountsResult, chatsResult] = await Promise.allSettled([
        getHealth(),
        listAccounts(),
        listChats({ limit: 1 }),
      ])

      if (!active) {
        return
      }

      setState({
        health: healthResult.status === 'fulfilled' ? healthResult.value : undefined,
        accountCount: accountsResult.status === 'fulfilled' ? accountsResult.value.accounts.length : 0,
        chatCount: chatsResult.status === 'fulfilled' ? chatsResult.value.total : 0,
      })

      if (
        healthResult.status === 'rejected' &&
        accountsResult.status === 'rejected' &&
        chatsResult.status === 'rejected'
      ) {
        setError('还没有连上后端。先启动 Go API，再回来刷新这个页面。')
      }

      setLoading(false)
    }

    void load()

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="首页总览"
        title="先看全局，再开始今天的操作"
        description="这个首页只做一件事：告诉新手员工下一步该去哪。账号接入、对话查看、导出和 Agent 配置都有明确入口。"
        aside={
          <div className="header-meta-card">
            <span>服务状态</span>
            <strong>{state.health?.status === 'ok' ? '在线' : '待连接'}</strong>
          </div>
        }
      />

      <section className="hero-strip">
        <div className="hero-copy">
          <p className="eyebrow">今日流程</p>
          <h3>三步完成一个标准工作回合</h3>
          <p>先确认账号可用，再进入对话页检查消息，最后决定是人工处理、导出留档，还是交给 Agent 规则。</p>
        </div>
        <div className="hero-steps">
          <article className="hero-step">
            <span>01</span>
            <h4>接入账号</h4>
            <p>创建账号卡片，完成扫码或配对码连接。</p>
          </article>
          <article className="hero-step">
            <span>02</span>
            <h4>查看对话</h4>
            <p>按账号和关键词找聊天，确认上下文是否完整。</p>
          </article>
          <article className="hero-step">
            <span>03</span>
            <h4>决定动作</h4>
            <p>人工回复、导出留档，或者后续交给 Agent 规则。</p>
          </article>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card">
          <span>已接入账号</span>
          <strong>{loading ? '...' : state.accountCount}</strong>
          <p>账号卡片越少越好维护，先把常用账号接上。</p>
        </article>
        <article className="metric-card">
          <span>已归档会话</span>
          <strong>{loading ? '...' : state.chatCount}</strong>
          <p>这里显示当前聊天总量，便于判断归档是否已经开始工作。</p>
        </article>
        <article className="metric-card">
          <span>环境状态</span>
          <strong>{state.health?.environment ?? '未连接'}</strong>
          <p>建议先在开发环境完成流程验收，再切到正式环境。</p>
        </article>
      </section>

      <section className="two-column-grid">
        <article className="panel">
          <p className="eyebrow">给新人的提示</p>
          <h3>最容易出错的三个地方</h3>
          <ul className="plain-list">
            <li>没先配对成功，就直接去聊天页找消息。</li>
            <li>账号状态异常时继续操作，结果误以为系统没反应。</li>
            <li>没确认聊天范围，就急着导出或做自动回复规则。</li>
          </ul>
        </article>

        <article className="panel">
          <p className="eyebrow">安全边界</p>
          <h3>平台默认帮你避开的风险</h3>
          <ul className="plain-list">
            <li>自动回复不会默认开启，后续 Agent 页会明确标红风险。</li>
            <li>退出登录、删除产物这类动作会独立展示，不和普通按钮混在一起。</li>
            <li>导出与 Agent 相关能力会保留审计线索，方便回看是谁做的。</li>
          </ul>
        </article>
      </section>

      {error ? <EmptyPanel title="还没拿到后端数据" description={error} /> : null}
    </div>
  )
}
