import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createExportJob,
  deleteExportJob,
  downloadExportArchive,
  downloadExportArtifact,
  listAccounts,
  listChats,
  listExportJobs,
  type AccountView,
  type ChatSummary,
  type ExportFormat,
  type ExportJobView,
} from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { Icon } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'

const formatOptions: Array<{ value: ExportFormat; label: string; description: string }> = [
  { value: 'markdown', label: 'Markdown', description: '适合留档、给客服和研发直接查看。' },
  { value: 'html', label: 'HTML', description: '适合直接打开浏览，交给非技术同事也方便。' },
  { value: 'json', label: 'JSON', description: '适合脚本处理、二次分析和数据交接。' },
]

const datePresetOptions = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: 'last7', label: '近 7 天' },
  { key: 'last30', label: '近 30 天' },
  { key: 'reset', label: '重置今天' },
] as const

function createInitialForm() {
  const today = formatDateInput(new Date())
  return {
    accountIds: [] as string[],
    chatIds: [] as string[],
    chatQuery: '',
    format: 'markdown' as ExportFormat,
    includeMedia: true,
    dateFrom: today,
    dateTo: today,
  }
}

type DropdownKey = 'accounts' | 'chats' | null
const exportChatListLimit = 5000

export function ExportsPage() {
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [jobs, setJobs] = useState<ExportJobView[]>([])
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([])
  const [form, setForm] = useState(createInitialForm)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [downloadingJobId, setDownloadingJobId] = useState<string>()
  const [deletingJobId, setDeletingJobId] = useState<string>()
  const [bulkDownloading, setBulkDownloading] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<DropdownKey>(null)
  const [error, setError] = useState<string>()
  const [success, setSuccess] = useState<string>()
  const dropdownRootRef = useRef<HTMLDivElement>(null)
  const selectedExportAccountId = form.accountIds[0] ?? ''

  const loadData = useCallback(async (background = false) => {
    const selectedAccountID = selectedExportAccountId

    if (!background) {
      setLoading(true)
      setError(undefined)
    }

    try {
      const [accountsResponse, chatsResponse, jobsResponse] = await Promise.all([
        listAccounts(),
        selectedAccountID
          ? listChats({ accountId: selectedAccountID, limit: exportChatListLimit })
          : Promise.resolve({ chats: [], total: 0, limit: exportChatListLimit, offset: 0 }),
        listExportJobs(),
      ])

      setAccounts(accountsResponse.accounts)
      setChats(chatsResponse.chats)
      setJobs(jobsResponse.jobs)
      setSelectedJobIds((current) =>
        current.filter((jobID) => jobsResponse.jobs.some((job) => job.id === jobID)),
      )
      setForm((current) => {
        const validAccountIDs = current.accountIds
          .filter((accountID) => accountsResponse.accounts.some((account) => account.id === accountID))
          .slice(0, 1)
        const nextAccountIDs = validAccountIDs.length
          ? validAccountIDs
          : accountsResponse.accounts[0]
            ? [accountsResponse.accounts[0].id]
            : []
        const validChatIDs = current.chatIds.filter((chatID) =>
          chatsResponse.chats.some(
            (chat) => chat.id === chatID && nextAccountIDs.includes(chat.account_id),
          ),
        )

        return {
          ...current,
          accountIds: nextAccountIDs,
          chatIds: validChatIDs,
        }
      })
    } catch (loadError) {
      if (!background) {
        setError(loadError instanceof Error ? loadError.message : '加载导出页失败')
      }
    } finally {
      if (!background) {
        setLoading(false)
      }
    }
  }, [selectedExportAccountId])

  useEffect(() => {
    void loadData()

    const timer = window.setInterval(() => {
      void loadData(true)
    }, 5000)

    return () => window.clearInterval(timer)
  }, [loadData])

  useEffect(() => {
    if (!openDropdown) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      if (!dropdownRootRef.current?.contains(event.target as Node)) {
        setOpenDropdown(null)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [openDropdown])

  const accountNameMap = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.display_name])),
    [accounts],
  )
  const chatNameMap = useMemo(
    () => new Map(chats.map((chat) => [chat.id, chat.title || chat.wa_chat_jid])),
    [chats],
  )

  const availableChats = chats.filter(
    (chat) => form.accountIds.length > 0 && form.accountIds.includes(chat.account_id),
  )
  const chatQuery = form.chatQuery.trim().toLowerCase()
  const visibleChats = availableChats.filter((chat) => {
    if (!chatQuery) {
      return true
    }

    return [
      chat.title,
      chat.wa_chat_jid,
      chat.latest_message_preview,
      accountNameMap.get(chat.account_id),
    ]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(chatQuery))
  })
  const groupedVisibleChats = form.accountIds
    .map((accountID) => ({
      accountID,
      accountName: accountNameMap.get(accountID) ?? accountID,
      chats: visibleChats.filter((chat) => chat.account_id === accountID),
    }))
    .filter((group) => group.chats.length > 0)

  const selectedChats = chats.filter((chat) => form.chatIds.includes(chat.id))
  const completedJobs = jobs.filter((job) => job.status === 'completed')
  const completedSelectedJobIds = selectedJobIds.filter((jobID) =>
    completedJobs.some((job) => job.id === jobID),
  )
  const allJobsSelected = jobs.length > 0 && jobs.every((job) => selectedJobIds.includes(job.id))

  function toggleAccount(accountID: string) {
    setSuccess(undefined)
    setForm((current) => {
      const nextAccountIDs = current.accountIds[0] === accountID ? [] : [accountID]

      return {
        ...current,
        accountIds: nextAccountIDs,
        chatIds: current.chatIds.filter((chatID) =>
          chats.some((chat) => chat.id === chatID && nextAccountIDs.includes(chat.account_id)),
        ),
      }
    })
  }

  function toggleChat(chatID: string) {
    setSuccess(undefined)
    setForm((current) => ({
      ...current,
      chatIds: current.chatIds.includes(chatID)
        ? current.chatIds.filter((item) => item !== chatID)
        : [...current.chatIds, chatID],
    }))
  }

  function selectAllVisibleChats() {
    const visibleIDs = visibleChats.map((chat) => chat.id)
    setForm((current) => ({
      ...current,
      chatIds: Array.from(new Set([...current.chatIds, ...visibleIDs])),
    }))
  }

  function clearSelectedChats() {
    setForm((current) => ({ ...current, chatIds: [] }))
  }

  function toggleJobSelection(jobId: string) {
    setSelectedJobIds((current) =>
      current.includes(jobId) ? current.filter((item) => item !== jobId) : [...current, jobId],
    )
  }

  function toggleAllJobs() {
    if (allJobsSelected) {
      setSelectedJobIds([])
      return
    }

    setSelectedJobIds(jobs.map((job) => job.id))
  }

  function applyDatePreset(preset: (typeof datePresetOptions)[number]['key']) {
    const today = new Date()
    const end = formatDateInput(today)

    switch (preset) {
      case 'today':
        setForm((current) => ({ ...current, dateFrom: end, dateTo: end }))
        return
      case 'yesterday': {
        const day = new Date(today)
        day.setDate(day.getDate() - 1)
        const date = formatDateInput(day)
        setForm((current) => ({ ...current, dateFrom: date, dateTo: date }))
        return
      }
      case 'last7': {
        const start = new Date(today)
        start.setDate(start.getDate() - 6)
        setForm((current) => ({
          ...current,
          dateFrom: formatDateInput(start),
          dateTo: end,
        }))
        return
      }
      case 'last30': {
        const start = new Date(today)
        start.setDate(start.getDate() - 29)
        setForm((current) => ({
          ...current,
          dateFrom: formatDateInput(start),
          dateTo: end,
        }))
        return
      }
      case 'reset':
        setForm((current) => ({ ...current, dateFrom: end, dateTo: end }))
        return
      default:
        return
    }
  }

  async function handleDownload(jobId: string) {
    setDownloadingJobId(jobId)
    setError(undefined)

    try {
      const { blob, filename } = await downloadExportArtifact(jobId)
      saveBlobDownload(blob, filename)
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : '下载导出文件失败')
    } finally {
      setDownloadingJobId(undefined)
    }
  }

  async function handleBulkDownload() {
    if (completedSelectedJobIds.length === 0) {
      setError('请先勾选要下载的导出记录')
      return
    }

    setBulkDownloading(true)
    setError(undefined)
    setSuccess(undefined)

    try {
      const { blob, filename } = await downloadExportArchive(completedSelectedJobIds)
      saveBlobDownload(blob, filename)
      setSuccess(`已打包 ${completedSelectedJobIds.length} 条导出记录。`)
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : '批量下载失败')
    } finally {
      setBulkDownloading(false)
    }
  }

  async function handleDeleteJob(jobId: string) {
    setDeletingJobId(jobId)
    setError(undefined)
    setSuccess(undefined)

    try {
      await deleteExportJob(jobId)
      setSelectedJobIds((current) => current.filter((item) => item !== jobId))
      await loadData(true)
      setSuccess('导出记录已删除。')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除导出记录失败')
    } finally {
      setDeletingJobId(undefined)
    }
  }

  async function handleBulkDeleteJobs() {
    if (selectedJobIds.length === 0) {
      setError('请先勾选要删除的导出记录')
      return
    }

    setBulkDeleting(true)
    setError(undefined)
    setSuccess(undefined)

    try {
      const results = await Promise.allSettled(selectedJobIds.map((jobId) => deleteExportJob(jobId)))
      const successCount = results.filter((result) => result.status === 'fulfilled').length
      const failedResults = results.filter((result) => result.status === 'rejected')

      setSelectedJobIds([])
      await loadData(true)

      if (failedResults.length > 0) {
        const firstError = failedResults[0].reason
        setError(firstError instanceof Error ? firstError.message : '部分导出记录删除失败')
      }
      if (successCount > 0) {
        setSuccess(`已删除 ${successCount} 条导出记录。`)
      }
    } finally {
      setBulkDeleting(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    setSuccess(undefined)

    if (form.accountIds.length === 0) {
      setError('请先选择至少一个账号')
      return
    }
    if (form.chatIds.length === 0) {
      setError('请至少选择一个联系人或群聊')
      return
    }
    if (!form.dateFrom || !form.dateTo) {
      setError('请先选择导出日期范围')
      return
    }
    if (form.dateFrom && form.dateTo && form.dateFrom > form.dateTo) {
      setError('结束日期不能早于开始日期')
      return
    }

    const jobsToCreate = chats.filter((chat) => form.chatIds.includes(chat.id))
    if (jobsToCreate.length === 0) {
      setError('没有找到可创建任务的会话')
      return
    }

    setSubmitting(true)

    const dateFrom = form.dateFrom ? toDateStart(form.dateFrom) : undefined
    const dateTo = form.dateTo ? toDateEndExclusive(form.dateTo) : undefined

    try {
      const results = await Promise.allSettled(
        jobsToCreate.map((chat) =>
          createExportJob({
            account_ids: [chat.account_id],
            chat_ids: [chat.id],
            date_from: dateFrom,
            date_to: dateTo,
            format: form.format,
            include_media: form.includeMedia,
          }),
        ),
      )

      const successCount = results.filter((result) => result.status === 'fulfilled').length
      const failedResults = results.filter((result) => result.status === 'rejected')

      await loadData()

      if (failedResults.length === 0) {
        setSuccess(`已创建 ${successCount} 个导出任务，每个会话都会生成独立文件。`)
        return
      }

      const failureSummary = failedResults
        .slice(0, 3)
        .map((result) =>
          result.reason instanceof Error ? result.reason.message : '创建任务失败',
        )
        .join('；')

      if (successCount > 0) {
        setSuccess(`已创建 ${successCount} 个导出任务，其余任务创建失败。`)
      }
      setError(`失败 ${failedResults.length} 个：${failureSummary}`)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '创建导出任务失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page page-exports">
      <section className="export-top-grid export-top-grid-tight">
        <article className="panel export-builder-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">导出配置</p>
              <h3>按账号与会话拆分导出</h3>
            </div>
            <span className="subtle-text">
              账号 {form.accountIds.length} / 会话 {form.chatIds.length}
            </span>
          </div>

          <form className="form-grid" onSubmit={handleSubmit}>
            <div ref={dropdownRootRef} className="dropdown-stack">
              <div className="field dropdown-field">
                <span>选择账号</span>
                <button
                  className={`dropdown-trigger${openDropdown === 'accounts' ? ' open' : ''}`}
                  type="button"
                  onClick={() => setOpenDropdown((current) => (current === 'accounts' ? null : 'accounts'))}
                >
                  <span>{formatAccountSelectionSummary(form.accountIds, accountNameMap)}</span>
                  <strong className="dropdown-trigger-indicator">
                    <span>{openDropdown === 'accounts' ? '收起' : '展开'}</span>
                    <Icon name="chevronDown" />
                  </strong>
                </button>

                {openDropdown === 'accounts' ? (
                  <div className="dropdown-panel">
                    <div className="dropdown-panel-header">
                      <strong>可选账号</strong>
                      <span className="subtle-text">{accounts.length} 个</span>
                    </div>
                    <div className="dropdown-option-list">
                      {accounts.map((account) => (
                        <label key={account.id} className="dropdown-option">
                          <input
                            type="radio"
                            name="export-account"
                            checked={form.accountIds.includes(account.id)}
                            onChange={() => toggleAccount(account.id)}
                          />
                          <div>
                            <strong>{account.display_name}</strong>
                            <span>{account.platform_label ?? account.phone_number ?? '未填写标签'}</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="field dropdown-field">
                <span>选择联系人 / 群聊</span>
                <button
                  className={`dropdown-trigger${openDropdown === 'chats' ? ' open' : ''}`}
                  type="button"
                  disabled={form.accountIds.length === 0}
                  onClick={() => setOpenDropdown((current) => (current === 'chats' ? null : 'chats'))}
                >
                  <span>
                    {form.accountIds.length === 0
                      ? '先选择账号'
                      : `已选 ${form.chatIds.length} 个联系人 / 群聊`}
                  </span>
                  <strong className="dropdown-trigger-indicator">
                    <span>{openDropdown === 'chats' ? '收起' : '展开'}</span>
                    <Icon name="chevronDown" />
                  </strong>
                </button>

                {openDropdown === 'chats' ? (
                  <div className="dropdown-panel dropdown-panel-wide">
                    <div className="dropdown-toolbar">
                      <label className="field compact-field">
                        <span>搜索会话</span>
                        <input
                          value={form.chatQuery}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, chatQuery: event.target.value }))
                          }
                          placeholder="搜联系人、群聊名、消息预览"
                        />
                      </label>

                      <div className="dropdown-action-row">
                        <button className="secondary-button" type="button" onClick={selectAllVisibleChats}>
                          <Icon name="check" />
                          全选当前结果
                        </button>
                        <button className="secondary-button" type="button" onClick={clearSelectedChats}>
                          <Icon name="delete" />
                          取消全选
                        </button>
                      </div>
                    </div>

                    {groupedVisibleChats.length > 0 ? (
                      <div className="grouped-chat-scroll">
                        {groupedVisibleChats.map((group) => (
                          <section key={group.accountID} className="grouped-chat-section">
                            <header className="grouped-chat-header">
                              <strong>{group.accountName}</strong>
                              <span className="subtle-text">{group.chats.length} 条</span>
                            </header>
                            <div className="dropdown-option-list">
                              {group.chats.map((chat) => (
                                <label key={chat.id} className="dropdown-option dropdown-option-chat">
                                  <input
                                    type="checkbox"
                                    checked={form.chatIds.includes(chat.id)}
                                    onChange={() => toggleChat(chat.id)}
                                  />
                                  <div>
                                    <div className="dropdown-option-title">
                                      <strong>{chat.title || chat.wa_chat_jid}</strong>
                                      <StatusBadge status={chat.chat_type} />
                                    </div>
                                    <span>{chat.latest_message_preview || chat.wa_chat_jid}</span>
                                  </div>
                                </label>
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    ) : (
                      <EmptyPanel
                        title="没有匹配的会话"
                        description="换个关键词，或者切换账号。这里只显示当前账号下的联系人和群聊。"
                      />
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="selected-chip-row">
              {form.accountIds.length > 0 ? (
                form.accountIds.map((accountID) => (
                  <span key={accountID} className="selection-chip">
                    账号 · {accountNameMap.get(accountID) ?? accountID}
                  </span>
                ))
              ) : (
                <span className="subtle-text">还没有选择账号</span>
              )}
            </div>

            <div className="export-form-grid">
              <label className="field compact-field">
                <span>开始日期</span>
                <input
                  type="date"
                  value={form.dateFrom}
                  onChange={(event) => setForm((current) => ({ ...current, dateFrom: event.target.value }))}
                />
              </label>

              <label className="field compact-field">
                <span>结束日期</span>
                <input
                  type="date"
                  value={form.dateTo}
                  onChange={(event) => setForm((current) => ({ ...current, dateTo: event.target.value }))}
                />
              </label>

              <label className="field compact-field">
                <span>导出格式</span>
                <select
                  value={form.format}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, format: event.target.value as ExportFormat }))
                  }
                >
                  {formatOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="date-preset-row">
              {datePresetOptions.map((preset) => (
                <button
                  key={preset.key}
                  className="date-preset-chip"
                  type="button"
                  onClick={() => applyDatePreset(preset.key)}
                >
                  {preset.label}
                </button>
              ))}
            </div>

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

            <div className="helper-card export-helper-card">
              <strong>当前策略</strong>
              <p>
                这次会按“一个账号 + 一个会话 = 一个导出任务”的方式拆分，避免不同客户内容混到一个文件里。
              </p>
              <p>
                当前范围：{formatDateRangeLabel(form.dateFrom, form.dateTo)}，已选 {selectedChats.length} 个会话。
              </p>
            </div>

            {selectedChats.length > 0 ? (
              <div className="selected-preview-row">
                {selectedChats.slice(0, 8).map((chat) => (
                  <span key={chat.id} className="selection-chip muted">
                    {chat.title || chat.wa_chat_jid}
                  </span>
                ))}
                {selectedChats.length > 8 ? (
                  <span className="subtle-text">还有 {selectedChats.length - 8} 个未展开</span>
                ) : null}
              </div>
            ) : null}

            <button className="primary-button" type="submit" disabled={submitting || loading}>
              <Icon name="export" />
              {submitting ? '正在创建导出任务...' : '批量创建导出任务'}
            </button>
          </form>
        </article>

        <article className="panel export-jobs-panel export-jobs-panel-side">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">导出记录</p>
              <h3>任务列表</h3>
            </div>
            <span className="subtle-text">{loading ? '正在刷新...' : `共 ${jobs.length} 条任务`}</span>
          </div>

          <div className="job-toolbar">
            <label className="job-bulk-check">
              <input
                type="checkbox"
                checked={allJobsSelected}
                disabled={jobs.length === 0}
                onChange={toggleAllJobs}
              />
              <span>全选记录</span>
            </label>

            <span className="subtle-text">
              已勾选 {selectedJobIds.length} / 可下载 {completedSelectedJobIds.length}
            </span>

            <div className="dropdown-action-row">
              <button
                className="secondary-button"
                type="button"
                disabled={selectedJobIds.length === 0}
                onClick={() => setSelectedJobIds([])}
              >
                <Icon name="delete" />
                清空勾选
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={completedSelectedJobIds.length === 0 || bulkDownloading}
                onClick={() => void handleBulkDownload()}
              >
                <Icon name="download" />
                {bulkDownloading ? '正在打包下载...' : `批量下载已选 (${completedSelectedJobIds.length})`}
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={selectedJobIds.length === 0 || bulkDeleting}
                onClick={() => void handleBulkDeleteJobs()}
              >
                <Icon name="delete" />
                {bulkDeleting ? '删除中...' : `删除已选 (${selectedJobIds.length})`}
              </button>
            </div>
          </div>

          {jobs.length > 0 ? (
            <div className="job-list-shell">
              <div className="job-list-header">
                <span>勾选</span>
                <span>创建时间</span>
                <span>账号</span>
                <span>对话</span>
                <span>格式</span>
                <span>状态</span>
                <span>操作</span>
              </div>

              <div className="job-list-scroll">
                {jobs.map((job) => {
                  return (
                    <div key={job.id} className="job-list-row">
                      <span className="job-checkbox-cell">
                        <input
                          type="checkbox"
                          checked={selectedJobIds.includes(job.id)}
                          onChange={() => toggleJobSelection(job.id)}
                        />
                      </span>
                      <span>{formatDateTime(job.created_at)}</span>
                      <span>{resolveJobAccountLabel(job, accountNameMap)}</span>
                      <span>{resolveJobChatLabel(job, chatNameMap)}</span>
                      <span>{job.format.toUpperCase()}</span>
                      <span>
                        <StatusBadge status={job.status} />
                      </span>
                      <span className="job-action-cell">
                        {job.status === 'completed' ? (
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={downloadingJobId === job.id}
                            onClick={() => void handleDownload(job.id)}
                          >
                            <Icon name="download" />
                            {downloadingJobId === job.id ? '下载中...' : '下载'}
                          </button>
                        ) : (
                          <span className="subtle-text">{job.error_message ?? '等待产物'}</span>
                        )}
                        <button
                          className="danger-button"
                          type="button"
                          disabled={deletingJobId === job.id}
                          onClick={() => void handleDeleteJob(job.id)}
                        >
                          <Icon name="delete" />
                          {deletingJobId === job.id ? '删除中...' : '删除'}
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <EmptyPanel
              title="还没有导出任务"
              description="选好账号和联系人后创建任务，右侧这里会持续刷新，并支持勾选批量下载。"
            />
          )}
        </article>
      </section>

      {success ? <div className="success-banner">{success}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  )
}

function formatAccountSelectionSummary(accountIds: string[], accountNameMap: Map<string, string>) {
  if (accountIds.length === 0) {
    return '请选择账号'
  }
  if (accountIds.length === 1) {
    return accountNameMap.get(accountIds[0]) ?? accountIds[0]
  }

  return `已选 ${accountIds.length} 个账号`
}

function resolveJobAccountLabel(job: ExportJobView, accountNameMap: Map<string, string>) {
  if (job.account_ids.length > 1) {
    return `${job.account_ids.length} 个账号`
  }

  return accountNameMap.get(job.account_id) ?? accountNameMap.get(job.account_ids[0] ?? '') ?? job.account_id
}

function resolveJobChatLabel(job: ExportJobView, chatNameMap: Map<string, string>) {
  if (job.chat_ids.length > 1) {
    return `${job.chat_ids.length} 个会话`
  }

  return chatNameMap.get(job.chat_id) ?? chatNameMap.get(job.chat_ids[0] ?? '') ?? job.chat_id
}

function saveBlobDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

function toDateStart(value: string) {
  return new Date(`${value}T00:00:00`).toISOString()
}

function toDateEndExclusive(value: string) {
  const nextDay = new Date(`${value}T00:00:00`)
  nextDay.setDate(nextDay.getDate() + 1)
  return nextDay.toISOString()
}

function formatDateInput(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatDateRangeLabel(dateFrom?: string, dateTo?: string) {
  if (dateFrom && dateTo) {
    return `${dateFrom} 到 ${dateTo}`
  }
  if (dateFrom) {
    return `自 ${dateFrom} 起`
  }
  if (dateTo) {
    return `截至 ${dateTo}`
  }

  return '全部时间'
}
