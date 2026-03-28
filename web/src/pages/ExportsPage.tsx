import { type FormEvent, useEffect, useState } from 'react'
import {
  createExportJob,
  getExportArtifactUrl,
  listAccounts,
  listChats,
  listExportJobs,
  type AccountView,
  type ChatSummary,
  type ExportFormat,
  type ExportJobView,
} from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { StatusBadge } from '../components/StatusBadge'

const formatCards: Array<{ title: ExportFormat; description: string }> = [
  { title: 'json', description: '适合做二次分析、脚本处理和数据交接。' },
  { title: 'markdown', description: '适合给运营、客服或研发做文本化留档。' },
  { title: 'html', description: '适合直接打开查看，给非技术同事留一份整洁可读的记录。' },
]

const initialForm = {
  accountIds: [] as string[],
  chatIds: [] as string[],
  chatQuery: '',
  format: 'html' as ExportFormat,
  includeMedia: true,
  dateFrom: '',
  dateTo: '',
}

export function ExportsPage() {
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [jobs, setJobs] = useState<ExportJobView[]>([])
  const [form, setForm] = useState(initialForm)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()

  async function loadData() {
    setLoading(true)
    setError(undefined)

    try {
      const [accountsResponse, chatsResponse, jobsResponse] = await Promise.all([
        listAccounts(),
        listChats({ limit: 500 }),
        listExportJobs(),
      ])

      setAccounts(accountsResponse.accounts)
      setChats(chatsResponse.chats)
      setJobs(jobsResponse.jobs)
      setForm((current) => {
        const accountIds = current.accountIds.filter((accountID) =>
          accountsResponse.accounts.some((account) => account.id === accountID),
        )
        const chatIds = current.chatIds.filter((chatID) =>
          chatsResponse.chats.some(
            (chat) =>
              chat.id === chatID &&
              (accountIds.length === 0 || accountIds.includes(chat.account_id)),
          ),
        )

        return {
          ...current,
          accountIds,
          chatIds,
        }
      })
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
    }, 5000)

    return () => window.clearInterval(timer)
  }, [])

  const accountNameMap = new Map(accounts.map((account) => [account.id, account.display_name]))
  const filteredChats = chats.filter((chat) => {
    if (form.accountIds.length === 0) {
      return false
    }

    if (!form.accountIds.includes(chat.account_id)) {
      return false
    }

    const query = form.chatQuery.trim().toLowerCase()
    if (!query) {
      return true
    }

    return [
      chat.title,
      chat.wa_chat_jid,
      chat.latest_message_preview,
      accountNameMap.get(chat.account_id),
    ]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(query))
  })
  const selectedChats = chats.filter((chat) => form.chatIds.includes(chat.id))

  function toggleAccount(accountID: string) {
    setForm((current) => {
      const nextAccountIDs = current.accountIds.includes(accountID)
        ? current.accountIds.filter((item) => item !== accountID)
        : [...current.accountIds, accountID]

      return {
        ...current,
        accountIds: nextAccountIDs,
        chatIds: current.chatIds.filter((chatID) =>
          chats.some(
            (chat) =>
              chat.id === chatID &&
              (nextAccountIDs.length === 0 || nextAccountIDs.includes(chat.account_id)),
          ),
        ),
      }
    })
  }

  function toggleChat(chatID: string) {
    setForm((current) => ({
      ...current,
      chatIds: current.chatIds.includes(chatID)
        ? current.chatIds.filter((item) => item !== chatID)
        : [...current.chatIds, chatID],
    }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (form.accountIds.length === 0) {
      setError('请先选择至少一个账号')
      return
    }
    if (form.chatIds.length === 0) {
      setError('请至少选择一个联系人或群聊')
      return
    }
    if (form.dateFrom && form.dateTo && form.dateFrom > form.dateTo) {
      setError('结束日期不能早于开始日期')
      return
    }

    setSubmitting(true)
    setError(undefined)

    try {
      await createExportJob({
        account_ids: form.accountIds,
        chat_ids: form.chatIds,
        date_from: form.dateFrom ? toDateStart(form.dateFrom) : undefined,
        date_to: form.dateTo ? toDateEndExclusive(form.dateTo) : undefined,
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
      <section className="two-column-grid export-builder-layout">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">导出范围</p>
              <h3>多账号、多联系人、按时间打包导出</h3>
            </div>
            <span className="subtle-text">账号 {form.accountIds.length} / 会话 {form.chatIds.length}</span>
          </div>

          <form className="form-grid" onSubmit={handleSubmit}>
            <section className="helper-card">
              <strong>1. 选择账号</strong>
              <p>先圈定要导出的 WhatsApp 账号，再从右侧会话列表里挑联系人或群聊。</p>
              <div className="chip-row">
                {accounts.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    className={`chip-button${form.accountIds.includes(account.id) ? ' active' : ''}`}
                    onClick={() => toggleAccount(account.id)}
                  >
                    {account.display_name}
                  </button>
                ))}
              </div>
            </section>

            <div className="two-column-grid date-range-grid">
              <label className="field">
                <span>开始日期</span>
                <input
                  type="date"
                  value={form.dateFrom}
                  onChange={(event) => setForm((current) => ({ ...current, dateFrom: event.target.value }))}
                />
              </label>

              <label className="field">
                <span>结束日期</span>
                <input
                  type="date"
                  value={form.dateTo}
                  onChange={(event) => setForm((current) => ({ ...current, dateTo: event.target.value }))}
                />
              </label>
            </div>

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
              <span>包含媒体清单和可下载附件</span>
            </label>

            <section className="helper-card">
              <strong>当前选择</strong>
              <p>
                {form.accountIds.length > 0
                  ? `已选 ${form.accountIds.length} 个账号、${form.chatIds.length} 个会话，时间范围：${formatDateRangeLabel(form.dateFrom, form.dateTo)}`
                  : '还没选账号。先点上面的账号标签，再去右边挑联系人或群聊。'}
              </p>
            </section>

            <button className="primary-button" type="submit" disabled={submitting || loading}>
              {submitting ? '正在创建导出任务...' : '创建导出任务'}
            </button>
          </form>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">会话选择</p>
              <h3>联系人和群聊都能多选</h3>
            </div>
            <span className="subtle-text">{form.accountIds.length === 0 ? '先选账号' : `${filteredChats.length} 条可选`}</span>
          </div>

          {form.accountIds.length === 0 ? (
            <EmptyPanel
              title="先选账号"
              description="左边至少选一个账号后，这里才会显示这个账号下的联系人和群聊。"
            />
          ) : (
            <div className="selection-toolbar">
              <label className="field">
                <span>搜索联系人 / 群聊</span>
                <input
                  value={form.chatQuery}
                  onChange={(event) => setForm((current) => ({ ...current, chatQuery: event.target.value }))}
                  placeholder="搜联系人名、群聊名、聊天内容"
                />
              </label>

              {filteredChats.length > 0 ? (
                <div className="selection-grid">
                  {filteredChats.map((chat) => (
                    <button
                      key={chat.id}
                      type="button"
                      className={`account-card${form.chatIds.includes(chat.id) ? ' selected' : ''}`}
                      onClick={() => toggleChat(chat.id)}
                    >
                      <div className="account-card-header">
                        <strong>{chat.title || chat.wa_chat_jid}</strong>
                        <StatusBadge status={chat.chat_type} />
                      </div>
                      <p>{accountNameMap.get(chat.account_id) ?? chat.account_id}</p>
                      <span>{chat.latest_message_preview || '暂无预览内容'}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyPanel
                  title="没有匹配的会话"
                  description="换个关键词，或者先多选几个账号。右侧这里只会显示当前已选账号下的联系人和群聊。"
                />
              )}
            </div>
          )}
        </article>
      </section>

      <section className="two-column-grid">
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

        <article className="panel">
          <p className="eyebrow">已选会话</p>
          <h3>导出前最后确认一眼</h3>
          {selectedChats.length > 0 ? (
            <div className="rule-list">
              {selectedChats.map((chat) => (
                <article key={chat.id} className="rule-card">
                  <div className="rule-card-header">
                    <div>
                      <strong>{chat.title || chat.wa_chat_jid}</strong>
                      <p>{accountNameMap.get(chat.account_id) ?? chat.account_id}</p>
                    </div>
                    <StatusBadge status={chat.chat_type} />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyPanel title="还没有会话" description="右边勾选你要导出的联系人或群聊，这里会汇总展示。" />
          )}
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
                <p className="subtle-text">
                  账号 {job.account_ids.length} 个，会话 {job.chat_ids.length} 个
                </p>
                <p className="subtle-text">时间范围：{formatDateRangeLabel(job.date_from, job.date_to)}</p>
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
          <EmptyPanel
            title="还没有导出任务"
            description="选好账号、联系人或群聊，再按时间范围发起导出，任务就会出现在这里。"
          />
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

function toDateStart(value: string) {
  return new Date(`${value}T00:00:00`).toISOString()
}

function toDateEndExclusive(value: string) {
  const nextDay = new Date(`${value}T00:00:00`)
  nextDay.setDate(nextDay.getDate() + 1)
  return nextDay.toISOString()
}

function formatDateRangeLabel(dateFrom?: string, dateTo?: string) {
  if (dateFrom && dateTo) {
    const end = new Date(dateTo)
    end.setSeconds(end.getSeconds() - 1)
    return `${formatDateOnly(dateFrom)} ~ ${formatDateOnly(end.toISOString())}`
  }
  if (dateFrom) {
    return `自 ${formatDateOnly(dateFrom)} 起`
  }
  if (dateTo) {
    const end = new Date(dateTo)
    end.setSeconds(end.getSeconds() - 1)
    return `截至 ${formatDateOnly(end.toISOString())}`
  }

  return '全部时间'
}

function formatDateOnly(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.replaceAll('-', '/')
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}
