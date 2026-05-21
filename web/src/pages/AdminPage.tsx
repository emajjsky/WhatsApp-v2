import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  createInvitation,
  createUser,
  listDesktopDevices,
  deleteSystemAgentConfig,
  listAssistantUsageLogFilters,
  listAssistantUsageLogs,
  listInvitations,
  listSystemAgentConfigs,
  listUsers,
  resetUserPassword,
  updateInvitation,
  updateUser,
  updateDesktopDeviceStatus,
  upsertSystemAgentConfig,
  type AgentProviderConfig,
  type AgentPurpose,
  type AssistantUsageAction,
  type AssistantUsageLogView,
  type AuthUser,
  type DesktopDeviceStatus,
  type DesktopDeviceView,
  type DesktopGrant,
  type InvitationCodeView,
  type InvitationStatus,
  type SystemAgentConfigView,
  type UserPermission,
  type UserRole,
  type UserStatus,
} from '../api/client'
import { Icon } from '../components/Icon'

type AdminTab = 'users' | 'invitations' | 'agents' | 'usageLogs'
type ProviderType = 'openai_compatible' | 'coze' | 'n8n' | 'webhook'

interface AgentConfigForm {
  id: string
  name: string
  purpose: AgentPurpose
  enabled: boolean
  providerType: ProviderType
  model: string
  baseUrl: string
  apiKey: string
  endpointUrl: string
  authorization: string
  method: string
  responsePath: string
  temperature: string
  maxTokens: string
  timeoutSeconds: string
  enableThinking: boolean
  historyLimit: string
  stageLabels: string
  customerTypeLabels: string
  riskLabels: string
  promptTemplate: string
}

const defaultReplyPrompt = `你是 WhatsApp 跨境客服回复策略助手。你的任务是基于客户最新消息和上下文，输出 3 个不同回复策略，帮助客服选择最合适的一条。

必须遵守：
1. 只输出严格 JSON，不要 Markdown，不要代码块，不要解释。
2. JSON 必须可以被 JSON.parse 解析。
3. 所有回复正文默认使用中文草稿，便于中国客服审核；不要直接翻译成外语，外语翻译由系统后续处理。
4. 每个方案要能直接复制给客户发送，语气自然、简洁、有 WhatsApp 聊天感。
5. 三个方案必须有明显差异，避免只是同义改写。
6. 不要承诺收益，不要诱导高风险投资，不要使用夸大保证。

输出 JSON Schema：
{
  "replies": [
    {
      "title": "回复方案 1",
      "strategy": "策略名称，例如：共情破冰 / 专业解释 / 轻推入群",
      "content": "可直接发送给客户的中文回复正文"
    },
    {
      "title": "回复方案 2",
      "strategy": "策略名称",
      "content": "可直接发送给客户的中文回复正文"
    },
    {
      "title": "回复方案 3",
      "strategy": "策略名称",
      "content": "可直接发送给客户的中文回复正文"
    }
  ]
}`
const defaultTranslationPrompt =
  '你是 WhatsApp 客服翻译助手。检测原文语种，并把文本准确翻译成目标语种。source_language_name 使用中文语种名。只输出严格 JSON。'
const defaultStatusCardPrompt =
  '你是 WhatsApp 私域转化顾问。基于完整聊天记录分析客户所处阶段、客户类型、风险等级，并给出下一步引导入群和转化动作。只输出严格 JSON。'

const defaultStatusStageLabels = [
  '新线索',
  '已破冰',
  '问费用',
  '问进群',
  '已进群',
  '问推荐',
  '问操作',
  '异议中',
  'check-in',
  '沉默待复访',
]
const defaultCustomerTypeLabels = ['新手', '有经验', '曾亏损', '价格敏感', '信任不足', '操作小白', '高意向']
const defaultRiskLabels = ['低', '中', '高']

const providerOptions: Array<{ value: ProviderType; label: string }> = [
  { value: 'openai_compatible', label: 'OpenAI-compatible' },
  { value: 'coze', label: 'Coze' },
  { value: 'n8n', label: 'n8n' },
  { value: 'webhook', label: 'Webhook' },
]

const permissionOptions: Array<{ value: UserPermission; label: string }> = [
  { value: 'accounts', label: '账号接入' },
  { value: 'chats', label: '对话查看' },
  { value: 'scripts', label: '剧本' },
  { value: 'exports', label: '导出中心' },
]

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('users')

  return (
    <div className="page page-admin">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">管理员后台</p>
          <h2>系统配置</h2>
        </div>
        <div className="admin-tab-list" role="tablist">
          <AdminTabButton
            active={tab === 'users'}
            title="用户管理"
            hint="账号、角色、权限"
            onClick={() => setTab('users')}
          />
          <AdminTabButton
            active={tab === 'invitations'}
            title="邀请码"
            hint="注册入口控制"
            onClick={() => setTab('invitations')}
          />
          <AdminTabButton
            active={tab === 'agents'}
            title="智能回复配置"
            hint="回复和翻译 Agent"
            onClick={() => setTab('agents')}
          />
          <AdminTabButton
            active={tab === 'usageLogs'}
            title="采纳数据"
            hint="方案采纳和发送记录"
            onClick={() => setTab('usageLogs')}
          />
        </div>
      </header>

      <main className="admin-content">
        {tab === 'users' ? <UserAdminPanel /> : null}
        {tab === 'invitations' ? <InvitationAdminPanel /> : null}
        {tab === 'agents' ? <SystemAgentPanel /> : null}
        {tab === 'usageLogs' ? <AssistantUsageLogPanel /> : null}
      </main>
    </div>
  )
}

function AdminTabButton({
  active,
  title,
  hint,
  onClick,
}: {
  active: boolean
  title: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`admin-tab-button${active ? ' active' : ''}`}
      onClick={onClick}
    >
      <strong>{title}</strong>
      <span>{hint}</span>
    </button>
  )
}

function UserAdminPanel() {
  const [users, setUsers] = useState<AuthUser[]>([])
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('user')
  const [permissions, setPermissions] = useState<UserPermission[]>(permissionOptions.map((item) => item.value))
  const [desktopEnabled, setDesktopEnabled] = useState(true)
  const [desktopMaxDevices, setDesktopMaxDevices] = useState('1')
  const [desktopExpiresAt, setDesktopExpiresAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  async function loadUsers() {
    setLoading(true)
    setError(undefined)
    try {
      const response = await listUsers()
      setUsers(response.users)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载用户失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    setNotice(undefined)

    try {
      await createUser({
        email: email.trim(),
        display_name: displayName.trim(),
        password,
        role,
        status: 'active',
        permissions: role === 'user' ? permissions : undefined,
        desktop: buildDesktopGrant(desktopEnabled, desktopMaxDevices, desktopExpiresAt),
      })
      setEmail('')
      setDisplayName('')
      setPassword('')
      setRole('user')
      setPermissions(permissionOptions.map((item) => item.value))
      setDesktopEnabled(true)
      setDesktopMaxDevices('1')
      setDesktopExpiresAt('')
      await loadUsers()
      setNotice('用户已创建')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建用户失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePatchUser(
    user: AuthUser,
    patch: { role?: UserRole; status?: UserStatus; permissions?: UserPermission[]; desktop?: DesktopGrant },
  ) {
    setError(undefined)
    setNotice(undefined)
    try {
      await updateUser(user.id, patch)
      await loadUsers()
      setNotice('用户已更新')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '更新用户失败')
    }
  }

  async function handleResetPassword(user: AuthUser) {
    const nextPassword = window.prompt(`请输入 ${user.email} 的新密码，至少 8 位`)
    if (!nextPassword) {
      return
    }

    setError(undefined)
    setNotice(undefined)
    try {
      await resetUserPassword(user.id, nextPassword)
      setNotice('密码已重置')
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : '重置密码失败')
    }
  }

  return (
    <section className="admin-layout">
      <article className="panel admin-create-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">新建用户</p>
            <h3>创建后台账号</h3>
          </div>
        </div>

        <form className="form-grid" onSubmit={handleCreate}>
          <label className="field">
            <span>邮箱</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label className="field">
            <span>昵称</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>初始密码</span>
            <input
              type="password"
              value={password}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>角色</span>
            <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </label>
              {role === 'user' ? (
            <PermissionPicker value={permissions} onChange={setPermissions} />
          ) : null}
          <DesktopGrantEditor
            enabled={desktopEnabled}
            maxDevices={desktopMaxDevices}
            expiresAt={desktopExpiresAt}
            onEnabledChange={setDesktopEnabled}
            onMaxDevicesChange={setDesktopMaxDevices}
            onExpiresAtChange={setDesktopExpiresAt}
          />
          <button className="primary-button" type="submit" disabled={submitting}>
            <Icon name="user" />
            {submitting ? '创建中...' : '创建用户'}
          </button>
        </form>
      </article>

      <article className="panel admin-users-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">用户列表</p>
            <h3>{loading ? '加载中' : `${users.length} 个用户`}</h3>
          </div>
        </div>

        <div className="admin-user-list">
          {users.map((user) => (
            <div key={user.id} className="admin-user-row">
              <div>
                <strong>{user.display_name}</strong>
                <span>{user.email}</span>
                <small>{user.role === 'admin' ? '管理员' : permissionLabel(user.permissions ?? [])}</small>
              </div>
              <select
                value={user.role}
                onChange={(event) => void handlePatchUser(user, { role: event.target.value as UserRole })}
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
              <select
                value={user.status}
                onChange={(event) =>
                  void handlePatchUser(user, { status: event.target.value as UserStatus })
                }
              >
                <option value="active">启用</option>
                <option value="disabled">禁用</option>
              </select>
              {user.role === 'user' ? (
                <PermissionPicker
                  value={user.permissions ?? []}
                  compact
                  onChange={(next) => void handlePatchUser(user, { permissions: next })}
                />
              ) : null}
              <DesktopUserControls user={user} onUpdate={handlePatchUser} />
              <button className="secondary-button" type="button" onClick={() => void handleResetPassword(user)}>
                <Icon name="key" />
                重置密码
              </button>
            </div>
          ))}
        </div>
      </article>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
    </section>
  )
}

function PermissionPicker({
  value,
  onChange,
  compact = false,
}: {
  value: UserPermission[]
  onChange: (next: UserPermission[]) => void
  compact?: boolean
}) {
  const selected = new Set(value)

  function toggle(permission: UserPermission, checked: boolean) {
    const next = new Set(selected)
    if (checked) {
      next.add(permission)
    } else {
      next.delete(permission)
    }
    onChange(permissionOptions.map((item) => item.value).filter((permission) => next.has(permission)))
  }

  return (
    <div className={`permission-picker${compact ? ' compact' : ''}`}>
      {permissionOptions.map((item) => (
        <label key={item.value} className="checkbox-row">
          <input
            type="checkbox"
            checked={selected.has(item.value)}
            onChange={(event) => toggle(item.value, event.target.checked)}
          />
          <span>{item.label}</span>
        </label>
      ))}
    </div>
  )
}

function DesktopGrantEditor({
  enabled,
  maxDevices,
  expiresAt,
  onEnabledChange,
  onMaxDevicesChange,
  onExpiresAtChange,
}: {
  enabled: boolean
  maxDevices: string
  expiresAt: string
  onEnabledChange: (value: boolean) => void
  onMaxDevicesChange: (value: string) => void
  onExpiresAtChange: (value: string) => void
}) {
  return (
    <div className="desktop-grant-editor">
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        <span>允许桌面端登录</span>
      </label>
      <label className="field compact-field">
        <span>设备数</span>
        <input
          type="number"
          min={1}
          value={maxDevices}
          onChange={(event) => onMaxDevicesChange(event.target.value)}
        />
      </label>
      <label className="field compact-field">
        <span>授权到期</span>
        <input
          type="datetime-local"
          value={expiresAt}
          onChange={(event) => onExpiresAtChange(event.target.value)}
        />
      </label>
    </div>
  )
}

function DesktopUserControls({
  user,
  onUpdate,
}: {
  user: AuthUser
  onUpdate: (
    user: AuthUser,
    patch: { role?: UserRole; status?: UserStatus; permissions?: UserPermission[]; desktop?: DesktopGrant },
  ) => Promise<void>
}) {
  const [devices, setDevices] = useState<DesktopDeviceView[]>([])
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)

  const desktop = normalizeUserDesktopGrant(user.desktop)

  async function loadDevices() {
    setLoading(true)
    try {
      const response = await listDesktopDevices(user.id)
      setDevices(response.devices)
    } finally {
      setLoading(false)
    }
  }

  async function toggleExpanded() {
    const next = !expanded
    setExpanded(next)
    if (next) {
      await loadDevices()
    }
  }

  async function patchDesktop(patch: Partial<DesktopGrant>) {
    await onUpdate(user, {
      desktop: {
        ...desktop,
        ...patch,
      },
    })
  }

  async function patchDevice(device: DesktopDeviceView, status: DesktopDeviceStatus) {
    await updateDesktopDeviceStatus(user.id, device.device_id, status)
    await loadDevices()
  }

  return (
    <div className="desktop-user-controls">
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={desktop.enabled}
          onChange={(event) => void patchDesktop({ enabled: event.target.checked })}
        />
        <span>桌面端</span>
      </label>
      <input
        type="number"
        min={1}
        value={desktop.max_devices}
        title="最大设备数"
        onChange={(event) => void patchDesktop({ max_devices: Math.max(1, Number(event.target.value) || 1) })}
      />
      <button className="secondary-button" type="button" onClick={() => void toggleExpanded()}>
        <Icon name="account" />
        设备
      </button>
      {expanded ? (
        <div className="desktop-device-list">
          {loading ? <span>加载中...</span> : null}
          {!loading && devices.length === 0 ? <span>暂无设备</span> : null}
          {devices.map((device) => (
            <div key={device.id} className="desktop-device-row">
              <div>
                <strong>{device.device_name || device.device_id}</strong>
                <span>{device.app_version || 'unknown'} · {formatDateTime(device.last_seen_at)}</span>
              </div>
              <select
                value={device.status}
                onChange={(event) => void patchDevice(device, event.target.value as DesktopDeviceStatus)}
              >
                <option value="active">启用</option>
                <option value="disabled">禁用</option>
              </select>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function buildDesktopGrant(enabled: boolean, maxDevices: string, expiresAt: string): DesktopGrant {
  const parsedMaxDevices = Number(maxDevices)
  return {
    enabled,
    max_devices: Number.isFinite(parsedMaxDevices) && parsedMaxDevices > 0 ? parsedMaxDevices : 1,
    license_expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
  }
}

function normalizeUserDesktopGrant(value?: DesktopGrant): DesktopGrant {
  return {
    enabled: value?.enabled ?? true,
    license_expires_at: value?.license_expires_at,
    max_devices: value?.max_devices && value.max_devices > 0 ? value.max_devices : 1,
  }
}

function permissionLabel(value: UserPermission[]) {
  if (value.length === 0) {
    return '未分配权限'
  }

  const labels = permissionOptions
    .filter((item) => value.includes(item.value))
    .map((item) => item.label)
  return labels.join('、')
}

function InvitationAdminPanel() {
  const [items, setItems] = useState<InvitationCodeView[]>([])
  const [code, setCode] = useState('')
  const [maxUses, setMaxUses] = useState('1')
  const [expiresAt, setExpiresAt] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  async function loadItems() {
    setLoading(true)
    setError(undefined)
    try {
      const response = await listInvitations()
      setItems(response.invitations)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载邀请码失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadItems()
  }, [])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    setNotice(undefined)

    try {
      const uses = Number(maxUses)
      await createInvitation({
        code: code.trim() || undefined,
        max_uses: Number.isFinite(uses) && uses > 0 ? uses : 1,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        note: note.trim() || undefined,
      })
      setCode('')
      setMaxUses('1')
      setExpiresAt('')
      setNote('')
      await loadItems()
      setNotice('邀请码已创建')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建邀请码失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePatch(item: InvitationCodeView, patch: { status?: InvitationStatus; max_uses?: number; note?: string }) {
    setError(undefined)
    setNotice(undefined)
    try {
      await updateInvitation(item.id, patch)
      await loadItems()
      setNotice('邀请码已更新')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '更新邀请码失败')
    }
  }

  return (
    <section className="admin-layout">
      <article className="panel admin-create-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">新建邀请码</p>
            <h3>控制普通用户注册</h3>
          </div>
        </div>

        <form className="form-grid" onSubmit={handleCreate}>
          <label className="field">
            <span>邀请码</span>
            <input
              value={code}
              placeholder="留空自动生成"
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <label className="field">
            <span>可用次数</span>
            <input
              type="number"
              min={1}
              value={maxUses}
              onChange={(event) => setMaxUses(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>过期时间</span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </label>
          <label className="field">
            <span>备注</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <button className="primary-button" type="submit" disabled={submitting}>
            <Icon name="key" />
            {submitting ? '创建中...' : '创建邀请码'}
          </button>
        </form>
      </article>

      <article className="panel admin-users-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">邀请码列表</p>
            <h3>{loading ? '加载中' : `${items.length} 个邀请码`}</h3>
          </div>
        </div>

        <div className="admin-user-list">
          {items.map((item) => (
            <div key={item.id} className="admin-user-row invitation-row">
              <div>
                <strong>{item.code}</strong>
                <span>
                  已用 {item.used_count}/{item.max_uses}
                  {item.expires_at ? ` · 过期 ${formatDateTime(item.expires_at)}` : ''}
                </span>
                {item.note ? <small>{item.note}</small> : null}
              </div>
              <select
                value={item.status}
                onChange={(event) =>
                  void handlePatch(item, { status: event.target.value as InvitationStatus })
                }
              >
                <option value="active">启用</option>
                <option value="disabled">禁用</option>
              </select>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  const nextMaxUses = window.prompt('请输入新的可用次数', String(item.max_uses))
                  if (!nextMaxUses) {
                    return
                  }
                  const parsed = Number(nextMaxUses)
                  if (Number.isFinite(parsed)) {
                    void handlePatch(item, { max_uses: parsed })
                  }
                }}
              >
                <Icon name="edit" />
                修改次数
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  const nextNote = window.prompt('请输入备注', item.note)
                  if (nextNote !== null) {
                    void handlePatch(item, { note: nextNote })
                  }
                }}
              >
                <Icon name="edit" />
                备注
              </button>
            </div>
          ))}
        </div>
      </article>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
    </section>
  )
}

function AssistantUsageLogPanel() {
  const [logs, setLogs] = useState<AssistantUsageLogView[]>([])
  const [filterOptions, setFilterOptions] = useState<{
    accounts: Array<{ id: string; name: string }>
    agents: Array<{ id: string; name: string }>
  }>({ accounts: [], agents: [] })
  const [logDate, setLogDate] = useState(todayDateInput())
  const [accountId, setAccountId] = useState('')
  const [agentId, setAgentId] = useState('')
  const [action, setAction] = useState<AssistantUsageAction | ''>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  async function loadLogs() {
    setLoading(true)
    setError(undefined)
    try {
      const response = await listAssistantUsageLogs({
        logDate: logDate || undefined,
        accountId: accountId || undefined,
        agentId: agentId || undefined,
        action,
        limit: 200,
      })
      setLogs(response.logs)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载采纳数据失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadFilterOptions() {
    try {
      const response = await listAssistantUsageLogFilters()
      setFilterOptions(response)
    } catch (loadError) {
      console.warn('failed to load assistant usage log filters', loadError)
    }
  }

  useEffect(() => {
    void loadFilterOptions()
    void loadLogs()
  }, [])

  const accountOptions = useMemo(
    () => mergeUsageLogOptions(
      filterOptions.accounts,
      logs.map((log) => ({
        id: log.ws_account_id,
        name: log.ws_account_name || log.ws_account_id,
      })),
    ),
    [filterOptions.accounts, logs],
  )
  const agentOptions = useMemo(
    () => mergeUsageLogOptions(
      filterOptions.agents,
      logs.map((log) => ({
        id: log.agent_id,
        name: log.agent_name || log.agent_id,
      })),
    ),
    [filterOptions.agents, logs],
  )

  function handleExportLogs() {
    exportUsageLogsToCSV(logs)
  }

  return (
    <section className="panel admin-usage-log-panel">
      <div className="admin-usage-log-heading">
        <div>
          <h3>采纳数据</h3>
          <p>一条采纳或发送记录占一行，便于检索和导出。</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={handleExportLogs}
          disabled={!logs.length}
        >
          <Icon name="download" />
          导出当前结果
        </button>
      </div>

      <div className="admin-usage-log-toolbar">
        <label className="field compact-field">
          <span>日期</span>
          <input type="date" value={logDate} onChange={(event) => setLogDate(event.target.value)} />
        </label>
        <label className="field compact-field">
          <span>WS账号</span>
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            <option value="">全部账号</option>
            {accountOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field compact-field">
          <span>智能体</span>
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
            <option value="">全部智能体</option>
            {agentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field compact-field">
          <span>动作</span>
          <select value={action} onChange={(event) => setAction(event.target.value as AssistantUsageAction | '')}>
            <option value="">全部</option>
            <option value="writeback">写回</option>
            <option value="send">发送</option>
          </select>
        </label>
        <button className="primary-button" type="button" onClick={() => void loadLogs()} disabled={loading}>
          {loading ? '查询中...' : '查询'}
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="admin-usage-log-table-wrap">
        {logs.length ? (
          <table className="admin-usage-log-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>WS账号</th>
                <th>客户</th>
                <th>客户消息</th>
                <th>智能体</th>
                <th>方案</th>
                <th>采纳方案原文</th>
                <th>翻译原文</th>
                <th>发送内容</th>
                <th>动作</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.created_at)}</td>
                  <td>{log.ws_account_name || log.ws_account_id || '-'}</td>
                  <td>
                    <strong>{log.customer_nickname || '-'}</strong>
                    <small>{log.customer_id || '-'}</small>
                  </td>
                  <td>{formatUsageLogTriggerMessages(log)}</td>
                  <td>{log.agent_name || log.agent_id || '-'}</td>
                  <td>{log.adopted_option_index ? `方案 ${log.adopted_option_index}` : '-'}</td>
                  <td>{log.adopted_option_content || '-'}</td>
                  <td>{log.translation_source_content || '-'}</td>
                  <td>{log.translated_content || log.final_draft_content || '-'}</td>
                  <td>{log.action_type === 'send' ? '发送' : '写回'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state compact-empty-state">
            {loading ? '正在加载...' : '暂无采纳数据'}
          </div>
        )}
      </div>
    </section>
  )
}

function SystemAgentPanel() {
  const [configs, setConfigs] = useState<SystemAgentConfigView[]>([])
  const [purpose, setPurpose] = useState<AgentPurpose>('reply')
  const [selectedConfigId, setSelectedConfigId] = useState('new')
  const [form, setForm] = useState<AgentConfigForm>(() => createDefaultConfigForm('reply'))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const purposeConfigs = useMemo(
    () => configs.filter((config) => config.purpose === purpose),
    [configs, purpose],
  )
  const selectedConfig = useMemo(
    () => purposeConfigs.find((config) => config.id === selectedConfigId),
    [purposeConfigs, selectedConfigId],
  )

  async function loadConfigs() {
    setLoading(true)
    setError(undefined)
    try {
      const response = await listSystemAgentConfigs()
      setConfigs(response.configs)
      setSelectedConfigId((current) => {
        if (current === 'new') {
          return current
        }
        return response.configs.some((config) => config.purpose === purpose && config.id === current)
          ? current
          : response.configs.find((config) => config.purpose === purpose)?.id ?? 'new'
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载智能体配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadConfigs()
  }, [])

  useEffect(() => {
    setSelectedConfigId((current) => {
      if (current === 'new') {
        return current
      }
      return configs.some((config) => config.purpose === purpose && config.id === current)
        ? current
        : configs.find((config) => config.purpose === purpose)?.id ?? 'new'
    })
  }, [configs, purpose])

  useEffect(() => {
    setForm(selectedConfig ? mapSystemConfigToForm(selectedConfig) : createDefaultConfigForm(purpose))
  }, [purpose, selectedConfig, selectedConfigId])

  function updateForm(next: Partial<AgentConfigForm>) {
    setForm((current) => ({ ...current, ...next }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(undefined)
    setNotice(undefined)

    try {
      const name = form.name.trim()
      if (!name) {
        setError('智能体名称不能为空')
        return
      }

      const response = await upsertSystemAgentConfig({
        id: form.id || undefined,
        name,
        purpose,
        enabled: form.enabled,
        provider_config: buildProviderConfig({ ...form, purpose }),
        prompt_template: form.promptTemplate.trim(),
      })
      setConfigs((current) => [
        ...current
          .filter((item) => item.id !== response.config.id)
          .map((item) =>
            (response.config.purpose === 'translation' || response.config.purpose === 'status_card') &&
            response.config.enabled &&
            item.purpose === response.config.purpose
              ? { ...item, enabled: false }
              : item,
          ),
        response.config,
      ])
      setSelectedConfigId(response.config.id)
      setNotice('智能体配置已保存')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存智能体配置失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteSelected() {
    if (!selectedConfig || saving) {
      return
    }

    const confirmed = window.confirm(`确认删除智能体「${selectedConfig.name}」？`)
    if (!confirmed) {
      return
    }

    setSaving(true)
    setError(undefined)
    setNotice(undefined)

    try {
      await deleteSystemAgentConfig(selectedConfig.id)
      setConfigs((current) => current.filter((item) => item.id !== selectedConfig.id))
      setSelectedConfigId('new')
      setNotice('智能体已删除')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除智能体失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel admin-agent-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">系统智能体</p>
          <h3>{loading ? '加载配置中' : getPurposeTitle(purpose)}</h3>
        </div>
      </div>

      <div className="admin-agent-workbench">
        <aside className="admin-agent-sidebar">
          <div className="admin-purpose-switch">
            <button
              type="button"
              className={`admin-purpose-button${purpose === 'reply' ? ' active' : ''}`}
              onClick={() => setPurpose('reply')}
            >
              <strong>回复 Agent</strong>
              <span>用户在对话页按场景选择</span>
            </button>
            <button
              type="button"
              className={`admin-purpose-button${purpose === 'translation' ? ' active' : ''}`}
              onClick={() => setPurpose('translation')}
            >
              <strong>翻译 Agent</strong>
              <span>管理员选择一个当前生效</span>
            </button>
            <button
              type="button"
              className={`admin-purpose-button${purpose === 'status_card' ? ' active' : ''}`}
              onClick={() => setPurpose('status_card')}
            >
              <strong>状态卡 Agent</strong>
              <span>分析客户阶段、类型和风险</span>
            </button>
          </div>

          <div className="system-agent-selector">
            <div className="system-agent-selector-head">
              <div>
                <strong>{getPurposeConfigTitle(purpose)}</strong>
                <span>{getPurposeDescription(purpose)}</span>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setSelectedConfigId('new')}
                disabled={selectedConfigId === 'new'}
              >
                <Icon name="plus" />
                新建
              </button>
            </div>
            <div className="system-agent-list">
              {purposeConfigs.length ? (
                purposeConfigs.map((config) => (
                  <button
                    key={config.id}
                    type="button"
                    className={`system-agent-item${config.id === selectedConfigId ? ' active' : ''}`}
                    onClick={() => setSelectedConfigId(config.id)}
                  >
                    <span>
                      <strong>{config.name}</strong>
                      <small>
                        {config.enabled
                          ? purpose === 'translation' || purpose === 'status_card'
                            ? '当前生效'
                            : '已启用'
                          : '未启用'}
                      </small>
                    </span>
                    <small>{readConfigString(config.provider_config ?? {}, 'type') || '未配置 Provider'}</small>
                  </button>
                ))
              ) : (
                <div className="system-agent-empty">当前用途还没有智能体</div>
              )}
            </div>
          </div>
        </aside>

        <form className="agent-config-form admin-agent-editor" onSubmit={handleSubmit}>
          <div className="admin-agent-editor-body">
            <section className="admin-form-section">
              <div className="admin-form-section-title">
                <strong>基础设置</strong>
                <span>{getPurposeEnableHint(purpose)}</span>
              </div>
              <div className="two-column-grid">
                <label className="field">
                  <span>智能体名称</span>
                  <input
                    value={form.name}
                    onChange={(event) => updateForm({ name: event.target.value })}
                    placeholder={getPurposeNamePlaceholder(purpose)}
                  />
                </label>
                <label className="field">
                  <span>智能体类型</span>
                  <input value={getPurposeTitle(purpose)} disabled />
                </label>
              </div>

              <label className="checkbox-row agent-thinking-row">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => updateForm({ enabled: event.target.checked })}
                />
                <span>{getPurposeEnableLabel(purpose)}</span>
              </label>
            </section>

            <section className="admin-form-section">
              <div className="admin-form-section-title">
                <strong>API 接入</strong>
                <span>回复和状态卡可接大模型、Coze、n8n；翻译使用 OpenAI-compatible</span>
              </div>
              <div className="admin-provider-grid">
                {providerOptions
                  .filter((option) => purpose !== 'translation' || option.value === 'openai_compatible')
                  .map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`admin-provider-option${form.providerType === option.value ? ' active' : ''}`}
                      onClick={() => updateForm({ providerType: option.value })}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.value === 'openai_compatible' ? 'Prompt + Model' : 'Agent API'}</span>
                    </button>
                  ))}
              </div>

            {form.providerType === 'openai_compatible' ? (
              <div className="agent-provider-fields">
                <div className="two-column-grid">
                  <label className="field">
                    <span>Model</span>
                    <input value={form.model} onChange={(event) => updateForm({ model: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>Base URL</span>
                    <input value={form.baseUrl} onChange={(event) => updateForm({ baseUrl: event.target.value })} />
                  </label>
                </div>
                <label className="field">
                  <span>API Key</span>
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(event) => updateForm({ apiKey: event.target.value })}
                  />
                </label>
                <div className="agent-advanced-grid">
                  <label className="field compact-field">
                    <span>Temperature</span>
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={form.temperature}
                      onChange={(event) => updateForm({ temperature: event.target.value })}
                    />
                  </label>
                  <label className="field compact-field">
                    <span>Max Tokens</span>
                    <input
                      type="number"
                      min={1}
                      value={form.maxTokens}
                      onChange={(event) => updateForm({ maxTokens: event.target.value })}
                    />
                  </label>
                  <label className="field compact-field">
                    <span>Timeout</span>
                    <input
                      type="number"
                      min={1}
                      value={form.timeoutSeconds}
                      onChange={(event) => updateForm({ timeoutSeconds: event.target.value })}
                    />
                  </label>
                </div>
                <label className="checkbox-row agent-thinking-row">
                  <input
                    type="checkbox"
                    checked={form.enableThinking}
                    onChange={(event) => updateForm({ enableThinking: event.target.checked })}
                  />
                  <span>启用思考模式</span>
                </label>
              </div>
            ) : (
              <div className="agent-provider-fields">
                <label className="field">
                  <span>API 地址</span>
                  <input
                    value={form.endpointUrl}
                    onChange={(event) => updateForm({ endpointUrl: event.target.value })}
                  />
                </label>
                <div className="two-column-grid">
                  <label className="field">
                    <span>Authorization</span>
                    <input
                      value={form.authorization}
                      onChange={(event) => updateForm({ authorization: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>API Key</span>
                    <input
                      type="password"
                      value={form.apiKey}
                      onChange={(event) => updateForm({ apiKey: event.target.value })}
                    />
                  </label>
                </div>
                <div className="agent-advanced-grid">
                  <label className="field compact-field">
                    <span>Method</span>
                    <select value={form.method} onChange={(event) => updateForm({ method: event.target.value })}>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="PATCH">PATCH</option>
                    </select>
                  </label>
                  <label className="field compact-field">
                    <span>Response Path</span>
                    <input
                      value={form.responsePath}
                      onChange={(event) => updateForm({ responsePath: event.target.value })}
                    />
                  </label>
                  <label className="field compact-field">
                    <span>Timeout</span>
                    <input
                      type="number"
                      min={1}
                      value={form.timeoutSeconds}
                      onChange={(event) => updateForm({ timeoutSeconds: event.target.value })}
                    />
                  </label>
                </div>
              </div>
            )}
            </section>

            {purpose === 'status_card' ? (
              <section className="admin-form-section">
                <div className="admin-form-section-title">
                  <strong>状态卡配置</strong>
                  <span>历史默认读取全部，最多 500 条；标签会约束状态卡输出</span>
                </div>
                <label className="field compact-field">
                  <span>历史记录条数</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={form.historyLimit}
                    onChange={(event) => updateForm({ historyLimit: event.target.value })}
                    placeholder="默认全部，最多 500"
                  />
                </label>
                <div className="three-column-grid admin-status-label-grid">
                  <label className="field agent-prompt-field">
                    <span>当前阶段标签</span>
                    <textarea
                      rows={6}
                      value={form.stageLabels}
                      onChange={(event) => updateForm({ stageLabels: event.target.value })}
                    />
                  </label>
                  <label className="field agent-prompt-field">
                    <span>客户类型标签</span>
                    <textarea
                      rows={6}
                      value={form.customerTypeLabels}
                      onChange={(event) => updateForm({ customerTypeLabels: event.target.value })}
                    />
                  </label>
                  <label className="field agent-prompt-field">
                    <span>风险标签</span>
                    <textarea
                      rows={6}
                      value={form.riskLabels}
                      onChange={(event) => updateForm({ riskLabels: event.target.value })}
                    />
                  </label>
                </div>
              </section>
            ) : null}

            <section className="admin-form-section">
              <div className="admin-form-section-title">
                <strong>提示词</strong>
                <span>控制智能体生成内容的规则和风格</span>
              </div>
              <label className="field agent-prompt-field">
                <span>Prompt</span>
                <textarea
                  rows={8}
                  value={form.promptTemplate}
                  onChange={(event) => updateForm({ promptTemplate: event.target.value })}
                />
              </label>
            </section>
          </div>

          <div className="admin-agent-actions">
            {notice ? <div className="success-banner">{notice}</div> : null}
            {error ? <div className="error-banner">{error}</div> : null}

            <div className="button-row">
              <button className="primary-button" type="submit" disabled={saving}>
                <Icon name="save" />
                {saving ? '保存中...' : '保存智能体'}
              </button>
              {selectedConfig ? (
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => void handleDeleteSelected()}
                  disabled={saving}
                >
                  <Icon name="delete" />
                  删除智能体
                </button>
              ) : null}
            </div>
          </div>
        </form>
      </div>
    </section>
  )
}

function createDefaultConfigForm(purpose: AgentPurpose): AgentConfigForm {
  return {
    id: '',
    name: getPurposeDefaultName(purpose),
    purpose,
    enabled: false,
    providerType: 'openai_compatible',
    model: '',
    baseUrl: '',
    apiKey: '',
    endpointUrl: '',
    authorization: '',
    method: 'POST',
    responsePath: 'draft',
    temperature: '0.2',
    maxTokens: purpose === 'translation' ? '800' : purpose === 'status_card' ? '1400' : '1200',
    timeoutSeconds: '60',
    enableThinking: false,
    historyLimit: '500',
    stageLabels: defaultStatusStageLabels.join('\n'),
    customerTypeLabels: defaultCustomerTypeLabels.join('\n'),
    riskLabels: defaultRiskLabels.join('\n'),
    promptTemplate:
      purpose === 'translation'
        ? defaultTranslationPrompt
        : purpose === 'status_card'
          ? defaultStatusCardPrompt
          : defaultReplyPrompt,
  }
}

function getPurposeTitle(purpose: AgentPurpose) {
  switch (purpose) {
    case 'translation':
      return '翻译 Agent'
    case 'status_card':
      return '状态卡 Agent'
    default:
      return '回复 Agent'
  }
}

function getPurposeConfigTitle(purpose: AgentPurpose) {
  switch (purpose) {
    case 'translation':
      return '翻译智能体'
    case 'status_card':
      return '状态卡智能体'
    default:
      return '回复智能体'
  }
}

function getPurposeDescription(purpose: AgentPurpose) {
  switch (purpose) {
    case 'translation':
      return '普通用户不选择翻译智能体，管理员只启用一个作为当前生效'
    case 'status_card':
      return '对话页右侧状态卡使用当前生效的状态卡智能体'
    default:
      return '用户可在对话页按需求选择启用的回复智能体'
  }
}

function getPurposeEnableHint(purpose: AgentPurpose) {
  switch (purpose) {
    case 'translation':
      return '翻译只允许一个当前生效'
    case 'status_card':
      return '状态卡只允许一个当前生效'
    default:
      return '启用后普通用户可在对话页选择'
  }
}

function getPurposeEnableLabel(purpose: AgentPurpose) {
  switch (purpose) {
    case 'translation':
      return '设为当前生效翻译智能体'
    case 'status_card':
      return '设为当前生效状态卡智能体'
    default:
      return '启用当前智能体'
  }
}

function getPurposeNamePlaceholder(purpose: AgentPurpose) {
  switch (purpose) {
    case 'translation':
      return '例如：多语言翻译助手'
    case 'status_card':
      return '例如：客户状态分析助手'
    default:
      return '例如：售前回复助手'
  }
}

function getPurposeDefaultName(purpose: AgentPurpose) {
  switch (purpose) {
    case 'translation':
      return '翻译智能体'
    case 'status_card':
      return '状态卡智能体'
    default:
      return '回复智能体'
  }
}

function mapSystemConfigToForm(config: SystemAgentConfigView): AgentConfigForm {
  const providerConfig = config.provider_config ?? {}
  const providerType = normalizeProviderType(readConfigString(providerConfig, 'type'))
  const fallback = createDefaultConfigForm(config.purpose)

  return {
    ...fallback,
    id: config.id,
    name: config.name,
    enabled: config.enabled,
    providerType,
    model: readConfigString(providerConfig, 'model'),
    baseUrl: readConfigString(providerConfig, 'base_url'),
    apiKey: readConfigString(providerConfig, 'api_key'),
    endpointUrl: readConfigString(providerConfig, 'endpoint_url') || readConfigString(providerConfig, 'base_url'),
    authorization: readConfigString(providerConfig, 'authorization'),
    method: readConfigString(providerConfig, 'method') || 'POST',
    responsePath: readConfigString(providerConfig, 'response_path') || 'draft',
    temperature: readConfigString(providerConfig, 'temperature') || fallback.temperature,
    maxTokens: readConfigString(providerConfig, 'max_tokens') || fallback.maxTokens,
    timeoutSeconds: readConfigString(providerConfig, 'timeout_seconds') || fallback.timeoutSeconds,
    enableThinking: readConfigBool(providerConfig, 'enable_thinking', false),
    historyLimit: readConfigString(providerConfig, 'history_limit') || fallback.historyLimit,
    stageLabels: readConfigStringList(providerConfig, 'stage_labels', defaultStatusStageLabels).join('\n'),
    customerTypeLabels: readConfigStringList(
      providerConfig,
      'customer_type_labels',
      defaultCustomerTypeLabels,
    ).join('\n'),
    riskLabels: readConfigStringList(providerConfig, 'risk_labels', defaultRiskLabels).join('\n'),
    promptTemplate: config.prompt_template || fallback.promptTemplate,
  }
}

function buildProviderConfig(form: AgentConfigForm): AgentProviderConfig {
  if (form.providerType === 'openai_compatible') {
    return withStatusCardConfig(form, {
      type: 'openai_compatible',
      model: form.model.trim(),
      base_url: form.baseUrl.trim(),
      api_key: form.apiKey.trim(),
      temperature: optionalNumber(form.temperature),
      max_tokens: optionalNumber(form.maxTokens),
      timeout_seconds: optionalNumber(form.timeoutSeconds),
      enable_thinking: form.enableThinking,
    })
  }

  return withStatusCardConfig(form, {
    type: form.providerType,
    endpoint_url: form.endpointUrl.trim(),
    api_key: form.apiKey.trim(),
    authorization: form.authorization.trim(),
    method: form.method.trim().toUpperCase() || 'POST',
    response_path: form.responsePath.trim() || 'draft',
    timeout_seconds: optionalNumber(form.timeoutSeconds),
  })
}

function withStatusCardConfig(form: AgentConfigForm, config: AgentProviderConfig) {
  if (form.purpose !== 'status_card') {
    return compactConfig(config)
  }

  return compactConfig({
    ...config,
    history_limit: optionalNumber(form.historyLimit) ?? 500,
    stage_labels: parseLabelTextarea(form.stageLabels),
    customer_type_labels: parseLabelTextarea(form.customerTypeLabels),
    risk_labels: parseLabelTextarea(form.riskLabels),
  })
}

function compactConfig(config: AgentProviderConfig) {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined && value !== ''),
  ) as AgentProviderConfig
}

function optionalNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readConfigString(config: AgentProviderConfig, key: string) {
  const value = config[key]
  if (value === undefined || value === null) {
    return ''
  }
  return String(value)
}

function readConfigStringList(config: AgentProviderConfig, key: string, fallback: string[]) {
  const value = config[key]
  if (Array.isArray(value)) {
    const parsed = value.map((item) => String(item).trim()).filter(Boolean)
    return parsed.length ? parsed : fallback
  }
  if (typeof value === 'string') {
    const parsed = parseLabelTextarea(value)
    return parsed.length ? parsed : fallback
  }
  return fallback
}

function parseLabelTextarea(value: string) {
  const seen = new Set<string>()
  return value
    .split(/[\n,，/]+/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) {
        return false
      }
      seen.add(item)
      return true
    })
}

function readConfigBool(config: AgentProviderConfig, key: string, fallback: boolean) {
  const value = config[key]
  if (typeof value === 'boolean') {
    return value
  }
  if (value === undefined || value === null) {
    return fallback
  }

  return ['true', '1', 'yes', 'on', 'enabled'].includes(String(value).trim().toLowerCase())
}

function normalizeProviderType(value: string): ProviderType {
  switch (value.trim().toLowerCase()) {
    case 'coze':
      return 'coze'
    case 'n8n':
      return 'n8n'
    case 'webhook':
      return 'webhook'
    default:
      return 'openai_compatible'
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatUsageLogTriggerMessages(log: AssistantUsageLogView) {
  if (log.trigger_messages?.length) {
    return log.trigger_messages
      .map((message, index) => {
        const sender = message.sender_name || message.sender_jid || `客户消息 ${index + 1}`
        const content = message.text_content || message.media_ref || message.message_type || '无文本内容'
        return `${index + 1}. ${sender}：${content}`
      })
      .join('\n')
  }

  return log.latest_message_text || log.latest_message_media_ref || log.latest_message_type || '无当前消息'
}

function mergeUsageLogOptions(
  primary: Array<{ id: string; name: string }>,
  fallback: Array<{ id: string; name: string }>,
) {
  const map = new Map<string, string>()
  for (const item of [...primary, ...fallback]) {
    const id = item.id?.trim()
    if (!id || map.has(id)) {
      continue
    }
    map.set(id, item.name?.trim() || id)
  }

  return Array.from(map, ([id, name]) => ({ id, name })).sort((left, right) =>
    left.name.localeCompare(right.name, 'zh-CN'),
  )
}

function exportUsageLogsToCSV(logs: AssistantUsageLogView[]) {
  if (!logs.length) {
    return
  }

  const headers = [
    '时间',
    '日期',
    'WS账号ID',
    'WS账号',
    '客户ID',
    '客户昵称',
    '客户消息',
    '最新消息接收时间',
    '智能体ID',
    '智能体',
    '采纳方案序号',
    '采纳方案原文',
    '翻译原文',
    '发送内容',
    '译文语种',
    '动作',
  ]
  const rows = logs.map((log) => [
    formatDateTime(log.created_at),
    log.log_date,
    log.ws_account_id,
    log.ws_account_name,
    log.customer_id,
    log.customer_nickname,
    formatUsageLogTriggerMessages(log),
    log.latest_message_received_at ? formatDateTime(log.latest_message_received_at) : '',
    log.agent_id,
    log.agent_name,
    log.adopted_option_index ? `方案 ${log.adopted_option_index}` : '',
    log.adopted_option_content,
    log.translation_source_content,
    log.translated_content || log.final_draft_content,
    log.target_language,
    log.action_type === 'send' ? '发送' : '写回',
  ])
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => csvCell(cell)).join(','))
    .join('\r\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `采纳数据-${todayDateInput()}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function todayDateInput() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}
