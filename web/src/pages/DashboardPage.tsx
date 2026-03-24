import { useEffect, useState } from 'react'
import {
  getSystemHealth,
  listAccounts,
  listChats,
  type SystemHealthResponse,
} from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'

interface DashboardState {
  systemHealth?: SystemHealthResponse
  accountCount: number
  chatCount: number
}

function formatComponentName(name: string) {
  switch (name) {
    case 'database':
      return '数据库'
    case 'sessions':
      return '会话连接'
    case 'exports':
      return '导出任务'
    case 'agents':
      return 'Agent Runner'
    case 'audit':
      return '审计留痕'
    default:
      return name
  }
}

function formatSystemStatus(status?: SystemHealthResponse['status']) {
  switch (status) {
    case 'ok':
      return '在线'
    case 'degraded':
      return '降级运行'
    case 'down':
      return '异常'
    default:
      return '待连接'
  }
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

      const [systemHealthResult, accountsResult, chatsResult] = await Promise.allSettled([
        getSystemHealth(),
        listAccounts(),
        listChats({ limit: 1 }),
      ])

      if (!active) {
        return
      }

      const systemHealth =
        systemHealthResult.status === 'fulfilled' ? systemHealthResult.value : undefined

      setState({
        systemHealth,
        accountCount:
          accountsResult.status === 'fulfilled'
            ? accountsResult.value.accounts.length
            : (systemHealth?.metrics.accounts_total ?? 0),
        chatCount:
          chatsResult.status === 'fulfilled'
            ? chatsResult.value.total
            : (systemHealth?.metrics.chats_total ?? 0),
      })

      if (
        systemHealthResult.status === 'rejected' &&
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

  const connectedSessions = state.systemHealth?.metrics.sessions_connected ?? 0
  const enabledRules = state.systemHealth?.metrics.agent_rules_enabled ?? 0
  const pendingRuns = state.systemHealth?.metrics.agent_runs_pending ?? 0
  const componentCards = state.systemHealth?.components ?? []

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="首页总览"
        title="先看全局，再开始今天的操作"
        description="现在首页会把数据库、会话连接、导出、Agent Runner 和审计留痕的状态一起告诉你，先判断系统稳不稳，再决定今天怎么操作。"
        aside={
          <div className="header-meta-card">
            <span>系统状态</span>
            <strong>{formatSystemStatus(state.systemHealth?.status)}</strong>
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
          <p>账号越少越好维护，先把常用账号接稳，再逐步扩容。</p>
        </article>
        <article className="metric-card">
          <span>已归档会话</span>
          <strong>{loading ? '...' : state.chatCount}</strong>
          <p>如果这里一直是 0，多半说明 live ingest 还没真正进来，别急着怪前端。</p>
        </article>
        <article className="metric-card">
          <span>已连接会话</span>
          <strong>{loading ? '...' : connectedSessions}</strong>
          <p>占位连接器也会模拟连上和来消息，方便你先把流程跑通。</p>
        </article>
        <article className="metric-card">
          <span>启用规则 / 待处理运行</span>
          <strong>
            {loading ? '...' : `${enabledRules} / ${pendingRuns}`}
          </strong>
          <p>先看系统状态，再决定是不是该放开更多 Agent 规则。</p>
        </article>
      </section>

      <section className="two-column-grid">
        <article className="panel">
          <p className="eyebrow">组件体温表</p>
          <h3>这几块一眼看完，基本就知道今天能不能顺利干活</h3>
          {componentCards.length > 0 ? (
            <div className="rule-list">
              {componentCards.map((component) => (
                <article key={component.name} className="rule-card">
                  <div className="rule-card-header">
                    <div>
                      <strong>{formatComponentName(component.name)}</strong>
                      <p>{component.summary}</p>
                    </div>
                    <div className="chip-row">
                      <StatusBadge status={component.status} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyPanel title="还没拿到系统健康数据" description="先让后端跑起来，这里才会显示各个组件的状态。" />
          )}
        </article>

        <article className="panel">
          <p className="eyebrow">给新人的提示</p>
          <h3>最容易出错的三个地方</h3>
          <ul className="plain-list">
            <li>没先配对成功，就直接去聊天页找消息。</li>
            <li>账号状态异常时继续操作，结果误以为系统没反应。</li>
            <li>没确认聊天范围，就急着导出或做自动回复规则。</li>
          </ul>
        </article>
      </section>

      <section className="two-column-grid">
        <article className="panel">
          <p className="eyebrow">安全边界</p>
          <h3>平台默认帮你避开的风险</h3>
          <ul className="plain-list">
            <li>自动回复不会默认开启，Agent 页会继续把风险动作单独标出来。</li>
            <li>退出登录、导出任务、规则启停这些动作都会留下审计记录。</li>
            <li>Agent Runner 没配置时，系统健康会直接提醒，不会假装一切正常。</li>
          </ul>
        </article>

        <article className="panel">
          <p className="eyebrow">现在能直接试</p>
          <h3>这版已经不是 PPT 了，能真跑通这些流程</h3>
          <ul className="plain-list">
            <li>创建账号并发起配对，占位连接器会自动模拟连上。</li>
            <li>连接完成后会自动灌入演示消息，聊天页能直接看见归档结果。</li>
            <li>导出页可以创建任务并下载产物，Agent Runner 也能独立起服务做草稿和拦截判定。</li>
          </ul>
        </article>
      </section>

      {error ? <EmptyPanel title="还没拿到后端数据" description={error} /> : null}
    </div>
  )
}
