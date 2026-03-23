import { type FormEvent, useEffect, useState } from 'react'
import {
  createExportJob,
  getExportArtifactUrl,
  listChats,
  listExportJobs,
  type ChatSummary,
  type ExportFormat,
  type ExportJobView,
} from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'

const formatCards: Array<{ title: ExportFormat; description: string }> = [
  { title: 'json', description: '适合做二次分析、脚本处理和数据交接。' },
  { title: 'markdown', description: '适合给运营、客服或研发做文本化留档。' },
  { title: 'html', description: '适合直接打开查看，给非技术同事留一份整洁可读的记录。' },
]

export function ExportsPage() {
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [jobs, setJobs] = useState<ExportJobView[]>([])
  const [form, setForm] = useState({
    chatId: '',
    format: 'html' as ExportFormat,
    includeMedia: true,
  })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()

  async function loadData() {
    setLoading(true)
    setError(undefined)

    try {
      const [chatsResponse, jobsResponse] = await Promise.all([
        listChats({ limit: 100 }),
        listExportJobs(),
      ])

      setChats(chatsResponse.chats)
      setJobs(jobsResponse.jobs)
      setForm((current) => ({
        ...current,
        chatId: current.chatId || chatsResponse.chats[0]?.id || '',
      }))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载导出页失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()

    const timer = window.setInterval(() => {
      void loadData()
    }, 3000)

    return () => window.clearInterval(timer)
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.chatId) {
      setError('请先选择一个聊天')
      return
    }

    setSubmitting(true)
    setError(undefined)

    try {
      await createExportJob({
        chat_id: form.chatId,
        format: form.format,
        include_media: form.includeMedia,
      })

      await loadData()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '创建导出任务失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="导出中心"
        title="把聊天整理成可下载产物"
        description="这里先支持按单个聊天发起导出任务。新手员工只需要选聊天、选格式，再决定要不要带媒体信息。"
      />

      <section className="two-column-grid">
        <article className="panel">
          <p className="eyebrow">创建导出</p>
          <h3>一步发起导出任务</h3>
          <form className="form-grid" onSubmit={handleSubmit}>
            <label className="field">
              <span>选择聊天</span>
              <select
                value={form.chatId}
                onChange={(event) => setForm((current) => ({ ...current, chatId: event.target.value }))}
              >
                {chats.map((chat) => (
                  <option key={chat.id} value={chat.id}>
                    {chat.title || chat.wa_chat_jid}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>导出格式</span>
              <select
                value={form.format}
                onChange={(event) =>
                  setForm((current) => ({ ...current, format: event.target.value as ExportFormat }))
                }
              >
                {formatCards.map((item) => (
                  <option key={item.title} value={item.title}>
                    {item.title.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.includeMedia}
                onChange={(event) =>
                  setForm((current) => ({ ...current, includeMedia: event.target.checked }))
                }
              />
              <span>包含媒体清单</span>
            </label>

            <button className="primary-button" type="submit" disabled={submitting || loading}>
              {submitting ? '正在创建...' : '创建导出任务'}
            </button>
          </form>

          <div className="helper-card">
            <strong>怎么选更稳</strong>
            <p>如果你只是要给同事留档，优先选 HTML。需要做数据处理时，再选 JSON 或 Markdown。</p>
          </div>
        </article>

        <article className="panel">
          <p className="eyebrow">格式说明</p>
          <h3>三种格式各干什么</h3>
          <div className="card-grid">
            {formatCards.map((item) => (
              <article key={item.title} className="highlight-panel compact-card">
                <strong>{item.title.toUpperCase()}</strong>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">任务列表</p>
            <h3>当前导出任务</h3>
          </div>
          <span className="subtle-text">{loading ? '正在刷新...' : `共 ${jobs.length} 条任务`}</span>
        </div>

        {jobs.length > 0 ? (
          <div className="card-grid">
            {jobs.map((job) => (
              <article key={job.id} className="panel compact-card">
                <div className="panel-heading">
                  <div>
                    <strong>{job.format.toUpperCase()}</strong>
                    <p>{formatDateTime(job.created_at)}</p>
                  </div>
                  <StatusBadge status={mapJobStatus(job.status)} />
                </div>
                <p className="subtle-text">聊天 ID：{job.chat_id}</p>
                <p className="subtle-text">媒体：{job.include_media ? '包含' : '不包含'}</p>
                {job.error_message ? <div className="error-banner">{job.error_message}</div> : null}
                {job.status === 'completed' ? (
                  <a
                    className="secondary-button inline-button"
                    href={getExportArtifactUrl(job.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    下载产物
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyPanel title="还没有导出任务" description="先选一个聊天并提交任务，右侧就会开始出现任务状态。" />
        )}
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  )
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function mapJobStatus(status: ExportJobView['status']) {
  switch (status) {
    case 'queued':
      return 'pending'
    case 'running':
      return 'reconnecting'
    case 'completed':
      return 'connected'
    case 'failed':
      return 'failed'
    default:
      return status
  }
}
