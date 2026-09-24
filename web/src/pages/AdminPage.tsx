import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  createInvitation,
  createUser,
  deleteUser,
  discoverProviderModels,
  deleteAgentSkill,
  deleteAgentSkillFile,
  listAccounts,
  listAgentSkills,
  listProviderPresets,
  listDesktopDevices,
  deleteProviderPreset,
  deleteSystemAgentConfig,
  listAssistantUsageLogFilters,
  listAssistantUsageLogs,
  listInvitations,
  listSystemAgentConfigs,
  listUsers,
  resetUserPassword,
  testProviderASR,
  updateInvitation,
  updateUser,
  updateDesktopDeviceStatus,
  upsertAgentSkill,
  upsertAgentSkillFile,
  upsertProviderPreset,
  upsertSystemAgentConfig,
  type AgentSkillFileKind,
  type AgentSkillFileView,
  type AgentSkillView,
  type AgentProviderConfig,
  type AgentPurpose,
  type ProviderPresetView,
  type AssistantUsageAction,
  type AssistantUsageLogView,
  type AccountView,
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
import { useAuth } from '../auth/AuthContext'

type AdminTab = 'users' | 'invitations' | 'agents' | 'skills' | 'providerPresets' | 'usageLogs'
type ProviderType = 'openai_compatible' | 'openrouter' | 'coze' | 'n8n' | 'webhook'

interface AgentConfigForm {
  id: string
  name: string
  purpose: AgentPurpose
  enabled: boolean
  model: string
  historyLimit: string
  contextMessageLimit: string
  stageLabels: string
  customerTypeLabels: string
  riskLabels: string
  rulesPrompt: string
  promptTemplate: string
  skillIds: string[]
  providerPresetId: string
}

interface ProviderPresetForm {
  id: string
  name: string
  providerType: ProviderType
  baseUrl: string
  apiKey: string
  apiKeyConfigured: boolean
  textEnabled: boolean
  models: string
  defaultModel: string
  asrEnabled: boolean
  asrBaseUrl: string
  asrModel: string
  isDefaultASR: boolean
  enabled: boolean
}

interface SkillForm {
  id: string
  name: string
  slug: string
  description: string
  enabled: boolean
  skillMarkdown: string
}

interface SkillFileForm {
  id: string
  path: string
  fileKind: Exclude<AgentSkillFileKind, 'skill'>
  contentType: string
  contentText: string
  sortOrder: string
}

const defaultReplyRulesPrompt = `必须遵守：
1. 只输出严格 JSON，不要 Markdown，不要代码块，不要思考过程，不要解释。
2. JSON 必须可以被 JSON.parse 解析。
3. 所有回复正文默认使用中文草稿，便于中国客服审核；不要直接翻译成外语，外语翻译由系统后续处理。
4. 每个方案要能直接复制给客户发送，语气自然、简洁，有 WhatsApp 聊天感。
5. 必须输出 3 个方案，方案之间要有明显差异，避免只是同义改写。
6. 不要承诺收益，不要诱导高风险投资，不要使用夸大保证。

输出 JSON Schema：
{"replies":[{"title":"回复方案 1","strategy":"策略名称","content":"可直接发送给客户的中文回复正文"},{"title":"回复方案 2","strategy":"策略名称","content":"可直接发送给客户的中文回复正文"},{"title":"回复方案 3","strategy":"策略名称","content":"可直接发送给客户的中文回复正文"}]}`
const defaultTranslationRulesPrompt =
  '必须遵守：只输出一个严格 JSON 对象，不要 Markdown、代码块、思考过程或解释。检测原文语种，并按照系统本次请求指定的 target_language 翻译，不要把目标语言写死为中文，不要输出多份译文。JSON Schema：{"source_language_code":"ISO 639 语言代码","source_language_name":"中文语种名","translated_text":"本次目标语言的译文"}。'
const defaultStatusCardRulesPrompt =
  '必须遵守：只输出一个严格 JSON 对象，不要 Markdown、代码块、思考过程或解释。JSON 必须可以被 JSON.parse 解析。必须包含完整字段：{"current_stage":"string","customer_types":["string"],"current_risk":"低|中|高","summary":"string","evidence":["string"],"next_action":"string","confidence":"string"}。'
const defaultReplyRolePrompt = '你负责根据客户最新消息和上下文，生成适合当前场景的中文客服回复方案。'
const defaultTranslationRolePrompt = '你负责准确识别原文，并翻译成系统指定的目标语言，保持原意、语气和格式。'
const defaultStatusCardRolePrompt = '你负责分析客户当前阶段、客户类型和风险，并给出简洁、可执行的下一步建议。'

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
  { value: 'openrouter', label: 'OpenRouter（语音转写）' },
  { value: 'coze', label: 'Coze' },
  { value: 'n8n', label: 'n8n' },
  { value: 'webhook', label: 'Webhook' },
]

const permissionOptions: Array<{ value: UserPermission; label: string }> = [
  { value: 'accounts', label: '账号接入' },
  { value: 'chats', label: '对话查看' },
  { value: 'exports', label: '导出中心' },
]

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('users')
  const mockMode = import.meta.env.DEV && new URLSearchParams(window.location.search).get('mock') === '1'
  if (mockMode) {
    return <AdminMockPage />
  }

  return (
    <div className="page page-admin">
      <header className="admin-page-header">
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
            active={tab === 'skills'}
            title="Skill 管理"
            hint="话术包和知识目录"
            onClick={() => setTab('skills')}
          />
          <AdminTabButton
            active={tab === 'providerPresets'}
            title="Provider 配置"
            hint="密钥和可用模型"
            onClick={() => setTab('providerPresets')}
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
        {tab === 'skills' ? <SkillAdminPanel /> : null}
        {tab === 'providerPresets' ? <ProviderPresetPanel /> : null}
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

function AdminDialog({
  title,
  eyebrow,
  onClose,
  className,
  children,
}: {
  title: string
  eyebrow: string
  onClose: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className="admin-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section className={`admin-dialog${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title">
        <header className="admin-dialog-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h3 id="admin-dialog-title">{title}</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭" title="关闭">
            <Icon name="close" />
          </button>
        </header>
        <div className="admin-dialog-body">{children}</div>
      </section>
    </div>
  )
}

function UserAdminPanel() {
  const isSuperAdmin = useAuth().user?.role === 'super_admin'
  const [users, setUsers] = useState<AuthUser[]>([])
  const [editor, setEditor] = useState<AuthUser | 'new'>()
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
      setEditor(undefined)
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

  async function handleResetPassword(user: AuthUser, nextPassword: string) {
    setError(undefined)
    setNotice(undefined)
    try {
      await resetUserPassword(user.id, nextPassword)
      setNotice(`${user.email} 的密码已更新`)
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : '重置密码失败')
      throw resetError
    }
  }

  async function handleDeleteUser(user: AuthUser) {
    if (!window.confirm(`确定删除 ${user.display_name}（${user.email}）？此操作无法撤销。`)) return
    setError(undefined)
    setNotice(undefined)
    try {
      await deleteUser(user.id)
      setEditor(undefined)
      await loadUsers()
      setNotice('用户已删除')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除用户失败')
    }
  }

  return (
    <section className="panel admin-record-page">
      <div className="admin-record-page-header">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">用户列表</p>
            <h3>{loading ? '加载中' : `${users.length} 个用户`}</h3>
          </div>
          <button className="primary-button" type="button" onClick={() => {
            setEmail('')
            setDisplayName('')
            setPassword('')
            setRole('user')
            setPermissions(permissionOptions.map((item) => item.value))
            setDesktopEnabled(true)
            setDesktopMaxDevices('1')
            setDesktopExpiresAt('')
            setEditor('new')
          }}>
            <Icon name="plus" />
            创建用户
          </button>
        </div>
      </div>
      <div className="admin-record-list">
          {users.map((user) => (
            <article className="admin-record-summary" key={user.id} onDoubleClick={() => isSuperAdmin && setEditor(user)}>
              <div className="admin-record-summary-main">
                <span className="admin-record-avatar">{user.display_name.slice(0, 1)}</span>
                <div>
                  <strong>{user.display_name}</strong>
                  <span>{user.email}</span>
                </div>
              </div>
              <div className="admin-record-summary-meta">
                <span>{user.role === 'super_admin' ? '超级管理员' : user.role === 'admin' ? '管理员' : '普通用户'}</span>
                <small>{user.status === 'active' ? '正常' : '已停用'} · 桌面端 {user.desktop?.max_devices ?? 1} 台设备</small>
              </div>
              {isSuperAdmin ? <button className="secondary-button" type="button" onClick={() => setEditor(user)}>
                <Icon name="edit" />
                编辑
              </button> : null}
            </article>
          ))}
      </div>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      {editor === 'new' ? (
        <AdminDialog title="创建后台账号" eyebrow="新建用户" onClose={() => setEditor(undefined)}>
          <form className="form-grid" onSubmit={handleCreate}>
            <label className="field"><span>邮箱</span><input value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label className="field"><span>昵称</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
            <label className="field"><span>初始密码</span><input type="password" value={password} minLength={8} onChange={(event) => setPassword(event.target.value)} required /></label>
            {isSuperAdmin ? <label className="field"><span>角色</span><select value={role} onChange={(event) => setRole(event.target.value as UserRole)}><option value="user">普通用户</option><option value="admin">管理员</option></select></label> : null}
            {role === 'user' ? <PermissionPicker value={permissions} onChange={setPermissions} /> : null}
            <DesktopGrantEditor enabled={desktopEnabled} maxDevices={desktopMaxDevices} expiresAt={desktopExpiresAt} onEnabledChange={setDesktopEnabled} onMaxDevicesChange={setDesktopMaxDevices} onExpiresAtChange={setDesktopExpiresAt} />
            <div className="admin-dialog-actions"><button className="secondary-button" type="button" onClick={() => setEditor(undefined)}>取消</button><button className="primary-button" type="submit" disabled={submitting}><Icon name="user" />{submitting ? '创建中...' : '创建用户'}</button></div>
          </form>
        </AdminDialog>
      ) : null}
      {isSuperAdmin && editor && editor !== 'new' ? (
        <AdminDialog title={`编辑用户 · ${editor.display_name}`} eyebrow="用户管理" onClose={() => setEditor(undefined)}>
          <UserAdminRow user={editor} onUpdate={handlePatchUser} onResetPassword={handleResetPassword} />
          {error ? <div className="error-banner">{error}</div> : null}
          {editor.role !== 'super_admin' ? <div className="admin-dialog-actions"><button className="danger-button" type="button" onClick={() => void handleDeleteUser(editor)}>删除用户</button></div> : null}
        </AdminDialog>
      ) : null}
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

type MockAdminTab = Exclude<AdminTab, 'usageLogs'>

type MockUser = {
  id: string
  name: string
  email: string
  role: '管理员' | '普通用户'
  status: '启用' | '停用'
  permissions: string[]
  devices: number
}

type MockInvitation = {
  id: string
  code: string
  used: number
  total: number
  status: '启用' | '停用'
  note: string
}

type MockAgent = {
  id: string
  name: string
  purpose: '回复 Agent' | '翻译 Agent' | '状态卡 Agent'
  provider: string
  model: string
  enabled: boolean
  skills: string[]
  rolePrompt: string
}

type MockSkill = {
  id: string
  name: string
  slug: string
  description: string
  enabled: boolean
  markdown: string
  references: string[]
}

type MockProvider = {
  id: string
  name: string
  type: string
  baseUrl: string
  apiKey: string
  models: string[]
  defaultModel: string
  textEnabled: boolean
  asrEnabled: boolean
  asrBaseUrl: string
  asrModel: string
  isDefaultASR: boolean
  enabled: boolean
}

const mockUsers: MockUser[] = [
  { id: 'u-1', name: 'KKT', email: 'liuchao168928@gmail.com', role: '管理员', status: '启用', permissions: ['管理员全部权限'], devices: 1 },
  { id: 'u-2', name: '王钱', email: 'wnwygquian@gmail.com', role: '普通用户', status: '启用', permissions: ['账号接入', '对话查看', '导出中心'], devices: 1 },
  { id: 'u-3', name: '大大', email: '84010505@qq.com', role: '普通用户', status: '启用', permissions: ['账号接入', '对话查看', '导出中心'], devices: 1 },
  { id: 'u-4', name: '二师兄', email: '84622435@qq.com', role: '普通用户', status: '启用', permissions: ['账号接入', '对话查看', '导出中心'], devices: 1 },
  { id: 'u-5', name: 'Administrator', email: 'admin@example.com', role: '管理员', status: '启用', permissions: ['管理员全部权限'], devices: 2 },
]

const mockInvitations: MockInvitation[] = [
  { id: 'invite-1', code: 'HELLO-WHATSAPP', used: 4, total: 50, status: '启用', note: '客户测试批次' },
  { id: 'invite-2', code: 'CLIENT-2026', used: 1, total: 10, status: '启用', note: '正式客户' },
]

const mockAgents: MockAgent[] = [
  { id: 'agent-1', name: '1#智能体（入群引导）', purpose: '回复 Agent', provider: 'uini vibe', model: 'gpt-5.5', enabled: true, skills: ['入群转化话术'], rolePrompt: '你负责根据客户最新消息，生成自然、简洁的中文客服回复方案。' },
  { id: 'agent-2', name: '3333', purpose: '回复 Agent', provider: 'siliconflow', model: 'Qwen/Qwen3-32B', enabled: true, skills: ['Brandes 投资学习社群接待话术'], rolePrompt: '你负责识别客户意图并给出下一步可执行的客服回复。' },
  { id: 'agent-3', name: '中文翻译', purpose: '翻译 Agent', provider: 'uini vibe', model: 'gpt-5.5', enabled: true, skills: [], rolePrompt: '识别原文语言，翻译成系统指定的目标语言，保持原意和格式。' },
  { id: 'agent-4', name: '客户状态分析', purpose: '状态卡 Agent', provider: 'siliconflow', model: 'Qwen/Qwen3-32B', enabled: false, skills: ['客户状态分析规则'], rolePrompt: '分析客户阶段、客户类型、风险和下一步建议。' },
]

const mockSkills: MockSkill[] = [
  { id: 'skill-1', name: 'Brandes 投资学习社群接待话术', slug: 'new-skill', description: '面向投资学习社群的客户接待和转化知识。', enabled: true, markdown: '# Brandes 投资学习社群接待话术\n\n## 何时使用\n客户咨询社群、学习内容或入群流程时使用。\n\n## 使用要求\n- 优先参考 references 中的资料。\n- 回复自然、准确、适合 WhatsApp 客服场景。', references: ['references/brandes-faq.md'] },
  { id: 'skill-2', name: '入群转化话术', slug: 'group-conversion', description: '处理客户入群咨询、资格确认和后续跟进。', enabled: true, markdown: '# 入群转化话术\n\n## 目标\n帮助客服清晰完成入群引导。', references: ['references/group-rules.md', 'references/faq.md'] },
]

const mockProviders: MockProvider[] = [
  { id: 'provider-1', name: 'siliconflow', type: 'OpenAI-compatible', baseUrl: 'https://api.siliconflow.cn/v1', apiKey: 'sk-demo-siliconflow', models: ['Qwen/Qwen3-32B', 'deepseek-ai/DeepSeek-V3', 'THUDM/GLM-4.5'], defaultModel: 'Qwen/Qwen3-32B', textEnabled: true, asrEnabled: false, asrBaseUrl: '', asrModel: '', isDefaultASR: false, enabled: true },
  { id: 'provider-2', name: 'uini vibe', type: 'OpenAI-compatible', baseUrl: 'https://api.uini.example/v1', apiKey: 'sk-demo-uini', models: ['gpt-5.5', 'gpt-4.1-mini'], defaultModel: 'gpt-5.5', textEnabled: true, asrEnabled: false, asrBaseUrl: '', asrModel: '', isDefaultASR: false, enabled: true },
  { id: 'provider-3', name: 'global asr', type: 'OpenAI-compatible', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-demo-asr', models: [], defaultModel: '', textEnabled: false, asrEnabled: true, asrBaseUrl: '', asrModel: 'gpt-4o-transcribe', isDefaultASR: true, enabled: true },
]

function AdminMockPage() {
  const [tab, setTab] = useState<MockAdminTab>('users')
  const [users, setUsers] = useState(mockUsers)
  const [invitations, setInvitations] = useState(mockInvitations)
  const [agents, setAgents] = useState(mockAgents)
  const [skills, setSkills] = useState(mockSkills)
  const [providers, setProviders] = useState(mockProviders)
  const [notice, setNotice] = useState('')

  function notify(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice((current) => current === message ? '' : current), 2200)
  }

  return (
    <div className="page page-admin admin-mock-page">
      <header className="admin-page-header">
        <nav className="admin-tab-list admin-mock-tabs" aria-label="后台模块">
          <MockAdminTabButton active={tab === 'users'} title="用户管理" hint="账号、角色、权限" onClick={() => setTab('users')} />
          <MockAdminTabButton active={tab === 'invitations'} title="邀请码" hint="注册入口控制" onClick={() => setTab('invitations')} />
          <MockAdminTabButton active={tab === 'agents'} title="智能回复配置" hint="回复和翻译 Agent" onClick={() => setTab('agents')} />
          <MockAdminTabButton active={tab === 'skills'} title="Skill 管理" hint="话术包和知识目录" onClick={() => setTab('skills')} />
          <MockAdminTabButton active={tab === 'providerPresets'} title="Provider 配置" hint="密钥和可用模型" onClick={() => setTab('providerPresets')} />
        </nav>
      </header>
      <main className="admin-content">
        {tab === 'users' ? <MockUsersPanel users={users} onChange={setUsers} onNotify={notify} /> : null}
        {tab === 'invitations' ? <MockInvitationsPanel invitations={invitations} onChange={setInvitations} onNotify={notify} /> : null}
        {tab === 'agents' ? <MockAgentsPanel agents={agents} setAgents={setAgents} skills={skills} providers={providers} onNotify={notify} /> : null}
        {tab === 'skills' ? <MockSkillsPanel skills={skills} setSkills={setSkills} onNotify={notify} /> : null}
        {tab === 'providerPresets' ? <MockProvidersPanel providers={providers} setProviders={setProviders} onNotify={notify} /> : null}
      </main>
      {notice ? <div className="success-banner admin-mock-notice">{notice}</div> : null}
    </div>
  )
}

function MockAdminTabButton({ active, title, hint, onClick }: { active: boolean; title: string; hint: string; onClick: () => void }) {
  return <button type="button" className={`admin-tab-button${active ? ' active' : ''}`} onClick={onClick}><strong>{title}</strong><span>{hint}</span></button>
}

function MockModal({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  return <div className="admin-mock-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="admin-mock-modal" role="dialog" aria-modal="true" aria-labelledby="admin-mock-modal-title"><header><div><p className="eyebrow">{eyebrow}</p><h3 id="admin-mock-modal-title">{title}</h3></div><button className="secondary-button" type="button" onClick={onClose}>关闭</button></header><div className="admin-mock-modal-body">{children}</div></section></div>
}

function MockAdminListShell({ eyebrow, title, count, createLabel, onCreate, children }: { eyebrow: string; title: string; count: string; createLabel: string; onCreate: () => void; children: ReactNode }) {
  return <section className="panel admin-mock-list-shell"><header className="admin-mock-list-header"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div><div className="admin-mock-list-actions"><span className="subtle-text">{count}</span><button className="primary-button" type="button" onClick={onCreate}><Icon name="plus" />{createLabel}</button></div></header><div className="admin-mock-record-list">{children}</div></section>
}

function MockUsersPanel({ users, onChange, onNotify }: { users: MockUser[]; onChange: (users: MockUser[]) => void; onNotify: (message: string) => void }) {
  const [draft, setDraft] = useState<MockUser>()
  const [password, setPassword] = useState('')
  const openCreate = () => { setDraft({ id: '', name: '', email: '', role: '普通用户', status: '启用', permissions: ['账号接入', '对话查看'], devices: 1 }); setPassword('') }
  const openEdit = (user: MockUser) => { setDraft({ ...user }); setPassword('') }
  const close = () => setDraft(undefined)
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!draft) return; const next = draft.id ? users.map((user) => user.id === draft.id ? draft : user) : [{ ...draft, id: `mock-${Date.now()}`, name: draft.name || '新用户', email: draft.email || 'new@example.com' }, ...users]; onChange(next); close(); onNotify(draft.id ? '用户已更新（mock）' : '用户已创建（mock）') }
  return <><MockAdminListShell eyebrow="用户管理" title="后台用户" count={`${users.length} 个用户`} createLabel="创建用户" onCreate={openCreate}>{users.map((user) => <article className="admin-mock-record" key={user.id} onDoubleClick={() => openEdit(user)}><div className="admin-mock-record-main"><span className="admin-mock-avatar">{user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><span>{user.email}</span><em className={user.status === '启用' ? 'active' : ''}>{user.status} · {user.role}</em></div></div><div className="admin-mock-record-meta"><span>{user.permissions.join('、')}</span><small>桌面端 {user.devices} 台设备</small></div><button className="secondary-button" type="button" onClick={() => openEdit(user)}><Icon name="edit" />编辑</button></article>)}</MockAdminListShell>{draft ? <MockModal title={draft.id ? '编辑后台用户' : '创建后台账号'} eyebrow={draft.id ? '编辑用户' : '新建用户'} onClose={close}><form className="form-grid" onSubmit={save}><div className="mock-two-columns"><label className="field"><span>邮箱</span><input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required /></label><label className="field"><span>昵称</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label></div><label className="field"><span>{draft.id ? '新密码（可选）' : '初始密码'}</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={draft.id ? undefined : 8} required={!draft.id} placeholder={draft.id ? '留空保持原密码' : '至少 8 位'} /></label><div className="mock-two-columns"><label className="field"><span>角色</span><select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as MockUser['role'] })}><option>普通用户</option><option>管理员</option></select></label><label className="field"><span>账号状态</span><select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as MockUser['status'] })}><option>启用</option><option>停用</option></select></label></div><div className="mock-check-grid">{['账号接入', '对话查看', '导出中心', '允许桌面端登录'].map((permission) => <label key={permission}><input type="checkbox" checked={draft.permissions.includes(permission)} onChange={(e) => setDraft({ ...draft, permissions: e.target.checked ? [...draft.permissions, permission] : draft.permissions.filter((item) => item !== permission) })} />{permission}</label>)}</div><div className="mock-two-columns"><label className="field"><span>设备数</span><input type="number" min="1" value={draft.devices} onChange={(e) => setDraft({ ...draft, devices: Number(e.target.value) || 1 })} /></label><span /></div><footer className="admin-mock-modal-footer"><button className="secondary-button" type="button" onClick={close}>取消</button><button className="primary-button" type="submit"><Icon name="save" />保存用户</button></footer></form></MockModal> : null}</>
}

function MockInvitationsPanel({ invitations, onChange, onNotify }: { invitations: MockInvitation[]; onChange: (items: MockInvitation[]) => void; onNotify: (message: string) => void }) {
  const [draft, setDraft] = useState<MockInvitation>()
  const openCreate = () => setDraft({ id: '', code: '', used: 0, total: 10, status: '启用', note: '' })
  const openEdit = (item: MockInvitation) => setDraft({ ...item })
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!draft) return; const next = draft.id ? invitations.map((item) => item.id === draft.id ? draft : item) : [{ ...draft, id: `mock-${Date.now()}`, code: draft.code || 'NEW-INVITE' }, ...invitations]; onChange(next); setDraft(undefined); onNotify(draft.id ? '邀请码已更新（mock）' : '邀请码已创建（mock）') }
  return <><MockAdminListShell eyebrow="邀请码" title="注册邀请码" count={`${invitations.length} 个邀请码`} createLabel="创建邀请码" onCreate={openCreate}>{invitations.map((item) => <article className="admin-mock-record" key={item.id} onDoubleClick={() => openEdit(item)}><div className="admin-mock-record-main"><span className="admin-mock-record-icon"><Icon name="key" /></span><div><strong>{item.code}</strong><span>{item.note || '暂无备注'}</span><em className={item.status === '启用' ? 'active' : ''}>{item.status}</em></div></div><div className="admin-mock-record-meta"><span>已用 {item.used}/{item.total}</span><small>普通用户注册入口</small></div><button className="secondary-button" type="button" onClick={() => openEdit(item)}><Icon name="edit" />编辑</button></article>)}</MockAdminListShell>{draft ? <MockModal title={draft.id ? '编辑邀请码' : '创建邀请码'} eyebrow={draft.id ? '编辑邀请码' : '新建邀请码'} onClose={() => setDraft(undefined)}><form className="form-grid" onSubmit={save}><label className="field"><span>邀请码</span><input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="留空自动生成" /></label><div className="mock-two-columns"><label className="field"><span>可用次数</span><input type="number" min="1" value={draft.total} onChange={(e) => setDraft({ ...draft, total: Number(e.target.value) || 1 })} /></label><label className="field"><span>当前状态</span><select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as MockInvitation['status'] })}><option>启用</option><option>停用</option></select></label></div><label className="field"><span>备注</span><input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="例如：客户测试批次" /></label><footer className="admin-mock-modal-footer"><button className="secondary-button" type="button" onClick={() => setDraft(undefined)}>取消</button><button className="primary-button" type="submit"><Icon name="save" />保存邀请码</button></footer></form></MockModal> : null}</>
}

function MockAgentsPanel({ agents, setAgents, skills, providers, onNotify }: { agents: MockAgent[]; setAgents: (items: MockAgent[]) => void; skills: MockSkill[]; providers: MockProvider[]; onNotify: (message: string) => void }) {
  const [draft, setDraft] = useState<MockAgent>()
  const [agentFilter, setAgentFilter] = useState<'all' | MockAgent['purpose']>('all')
  const openCreate = () => setDraft({ id: '', name: '', purpose: '回复 Agent', provider: providers[0]?.name ?? '', model: providers[0]?.defaultModel ?? '', enabled: true, skills: [], rolePrompt: '' })
  const openEdit = (agent: MockAgent) => setDraft({ ...agent })
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!draft) return; const next = draft.id ? agents.map((item) => item.id === draft.id ? draft : item) : [{ ...draft, id: `mock-${Date.now()}`, name: draft.name || '新智能体' }, ...agents]; setAgents(next); setDraft(undefined); onNotify(draft.id ? '智能体已更新（mock）' : '智能体已创建（mock）') }
  const selectedProvider = providers.find((provider) => provider.name === draft?.provider)
  const visibleAgents = agentFilter === 'all' ? agents : agents.filter((agent) => agent.purpose === agentFilter)
  return <><MockAdminListShell eyebrow="智能体配置" title="系统智能体" count={`${visibleAgents.length} / ${agents.length} 个智能体`} createLabel="新建智能体" onCreate={openCreate}><nav className="mock-agent-filter" aria-label="智能体类型"><button className={agentFilter === 'all' ? 'active' : ''} type="button" onClick={() => setAgentFilter('all')}>全部<span>{agents.length}</span></button><button className={agentFilter === '翻译 Agent' ? 'active' : ''} type="button" onClick={() => setAgentFilter('翻译 Agent')}>翻译<span>{agents.filter((agent) => agent.purpose === '翻译 Agent').length}</span></button><button className={agentFilter === '回复 Agent' ? 'active' : ''} type="button" onClick={() => setAgentFilter('回复 Agent')}>回复<span>{agents.filter((agent) => agent.purpose === '回复 Agent').length}</span></button><button className={agentFilter === '状态卡 Agent' ? 'active' : ''} type="button" onClick={() => setAgentFilter('状态卡 Agent')}>状态卡<span>{agents.filter((agent) => agent.purpose === '状态卡 Agent').length}</span></button></nav><div className="admin-mock-record-list">{visibleAgents.map((agent) => <article className="admin-mock-record" key={agent.id} onDoubleClick={() => openEdit(agent)}><div className="admin-mock-record-main"><span className="admin-mock-record-icon"><Icon name="chat" /></span><div><strong>{agent.name}</strong><span>{agent.purpose} · {agent.provider} / {agent.model}</span><em className={agent.enabled ? 'active' : ''}>{agent.enabled ? '已启用' : '未启用'}</em></div></div><div className="admin-mock-record-meta"><span>{agent.skills.length ? `已绑定 ${agent.skills.length} 个 Skill` : '未绑定 Skill'}</span><small>角色提示词已配置</small></div><button className="secondary-button" type="button" onClick={() => openEdit(agent)}><Icon name="edit" />编辑</button></article>)}</div></MockAdminListShell>{draft ? <MockModal title={draft.id ? '编辑智能体' : '新建智能体'} eyebrow="智能回复配置" onClose={() => setDraft(undefined)}><form className="form-grid" onSubmit={save}><div className="mock-two-columns"><label className="field"><span>智能体名称</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label><label className="field"><span>智能体类型</span><select value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value as MockAgent['purpose'] })}><option>回复 Agent</option><option>翻译 Agent</option><option>状态卡 Agent</option></select></label></div><label className="mock-toggle"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />启用当前智能体</label><div className="mock-two-columns"><label className="field"><span>Provider</span><select value={draft.provider} onChange={(e) => { const provider = providers.find((item) => item.name === e.target.value); setDraft({ ...draft, provider: e.target.value, model: provider?.defaultModel ?? '' }) }}>{providers.map((provider) => <option key={provider.id}>{provider.name}</option>)}</select></label><label className="field"><span>默认模型</span><select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>{(selectedProvider?.models ?? [draft.model]).map((model) => <option key={model}>{model}</option>)}</select></label></div><div className="mock-skill-bindings">{skills.map((skill) => <label key={skill.id}><input type="checkbox" checked={draft.skills.includes(skill.name)} onChange={(e) => setDraft({ ...draft, skills: e.target.checked ? [...draft.skills, skill.name] : draft.skills.filter((name) => name !== skill.name) })} />{skill.name}</label>)}</div><label className="field"><span>角色与功能要求</span><textarea rows={5} value={draft.rolePrompt} onChange={(e) => setDraft({ ...draft, rolePrompt: e.target.value })} placeholder="填写角色、功能和处理边界" required /></label><footer className="admin-mock-modal-footer"><button className="secondary-button" type="button" onClick={() => setDraft(undefined)}>取消</button><button className="primary-button" type="submit"><Icon name="save" />保存智能体</button></footer></form></MockModal> : null}</>
}

function MockSkillsPanel({ skills, setSkills, onNotify }: { skills: MockSkill[]; setSkills: (items: MockSkill[]) => void; onNotify: (message: string) => void }) {
  const [draft, setDraft] = useState<MockSkill>()
  const openCreate = () => setDraft({ id: '', name: '', slug: '', description: '', enabled: true, markdown: '# 新建 Skill\n\n## 何时使用\n', references: ['references/new-reference.md'] })
  const openEdit = (skill: MockSkill) => setDraft({ ...skill, references: [...skill.references] })
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!draft) return; const next = draft.id ? skills.map((item) => item.id === draft.id ? draft : item) : [{ ...draft, id: `mock-${Date.now()}`, name: draft.name || '新建 Skill', slug: draft.slug || 'new-skill' }, ...skills]; setSkills(next); setDraft(undefined); onNotify(draft.id ? 'Skill 已更新（mock）' : 'Skill 已创建（mock）') }
  return <><MockAdminListShell eyebrow="Agent Skills" title="Skill 目录" count={`${skills.length} 个 Skill`} createLabel="新建 Skill" onCreate={openCreate}>{skills.map((skill) => <article className="admin-mock-record" key={skill.id} onDoubleClick={() => openEdit(skill)}><div className="admin-mock-record-main"><span className="admin-mock-record-icon"><Icon name="fileText" /></span><div><strong>{skill.name}</strong><span>{skill.slug} · {skill.description || '暂无说明'}</span><em className={skill.enabled ? 'active' : ''}>{skill.enabled ? '已启用' : '未启用'} · {skill.references.length + 1} 个文件</em></div></div><div className="admin-mock-record-meta"><span>SKILL.md</span><small>{skill.references.length} 个 references / assets</small></div><button className="secondary-button" type="button" onClick={() => openEdit(skill)}><Icon name="edit" />编辑</button></article>)}</MockAdminListShell>{draft ? <MockModal title={draft.id ? '编辑 Skill' : '新建 Skill'} eyebrow="Skill 管理" onClose={() => setDraft(undefined)}><form className="form-grid" onSubmit={save}><div className="mock-two-columns"><label className="field"><span>名称</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label><label className="field"><span>目录名</span><input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} required /></label></div><label className="field"><span>说明</span><input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label><label className="mock-toggle"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />启用这个 Skill</label><label className="field"><span>SKILL.md</span><textarea className="mock-markdown-editor" value={draft.markdown} onChange={(e) => setDraft({ ...draft, markdown: e.target.value })} rows={12} /></label><section className="mock-reference-editor"><header><strong>references / assets</strong><button className="secondary-button" type="button" onClick={() => setDraft({ ...draft, references: [...draft.references, `references/new-${draft.references.length + 1}.md`] })}><Icon name="plus" />新增文件</button></header>{draft.references.map((reference, index) => <div className="mock-reference-row" key={`${reference}-${index}`}><Icon name="fileText" /><input value={reference} onChange={(e) => setDraft({ ...draft, references: draft.references.map((item, itemIndex) => itemIndex === index ? e.target.value : item) })} /><select defaultValue="reference"><option>reference</option><option>asset</option></select></div>)}</section><footer className="admin-mock-modal-footer"><button className="secondary-button" type="button" onClick={() => setDraft(undefined)}>取消</button><button className="primary-button" type="submit"><Icon name="save" />保存 Skill</button></footer></form></MockModal> : null}</>
}

function MockProvidersPanel({ providers, setProviders, onNotify }: { providers: MockProvider[]; setProviders: (items: MockProvider[]) => void; onNotify: (message: string) => void }) {
  const [draft, setDraft] = useState<MockProvider>()
  const openCreate = () => setDraft({ id: '', name: '', type: 'OpenAI-compatible', baseUrl: '', apiKey: '', models: [], defaultModel: '', textEnabled: true, asrEnabled: false, asrBaseUrl: '', asrModel: '', isDefaultASR: false, enabled: true })
  const openEdit = (provider: MockProvider) => setDraft({ ...provider, models: [...provider.models] })
  function detectModels() { if (!draft) return; const models = draft.models.length ? draft.models : ['gpt-5.5', 'gpt-4.1-mini']; setDraft({ ...draft, models, defaultModel: draft.defaultModel || models[0] }); onNotify('已检测到可用模型（mock）') }
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!draft) return; const next = draft.id ? providers.map((item) => item.id === draft.id ? draft : item) : [{ ...draft, id: `mock-${Date.now()}`, name: draft.name || '新 Provider' }, ...providers]; setProviders(next); setDraft(undefined); onNotify(draft.id ? 'Provider 已更新（mock）' : 'Provider 已创建（mock）') }
  return <>
    <MockAdminListShell eyebrow="Provider / Model" title="Provider 预设" count={`${providers.length} 个 Provider`} createLabel="新建 Provider" onCreate={openCreate}>
      {providers.map((provider) => <article className="admin-mock-record" key={provider.id} onDoubleClick={() => openEdit(provider)}>
        <div className="admin-mock-record-main"><span className="admin-mock-record-icon"><Icon name="key" /></span><div><strong>{provider.name}</strong><span>{provider.type} · {provider.baseUrl}</span><em className={provider.enabled ? 'active' : ''}>{provider.enabled ? '已启用' : '未启用'} · {provider.textEnabled ? '文本模型' : '语音转写'}</em></div></div>
        <div className="admin-mock-record-meta"><span>{provider.textEnabled ? `${provider.models.length} 个文本模型` : '未启用文本模型'}</span><small>{provider.asrEnabled ? `${provider.asrModel}${provider.isDefaultASR ? ' · 默认转写' : ''}` : '未启用 ASR'}</small></div>
        <button className="secondary-button" type="button" onClick={() => openEdit(provider)}><Icon name="edit" />编辑</button>
      </article>)}
    </MockAdminListShell>
    {draft ? <MockModal title={draft.id ? '编辑 Provider' : '新建 Provider'} eyebrow="Provider 配置" onClose={() => setDraft(undefined)}>
      <form className="form-grid" onSubmit={save}>
        <div className="mock-two-columns"><label className="field"><span>预设名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label><label className="field"><span>Provider 类型</span><select value={draft.type} onChange={(event) => setDraft((current) => current ? event.target.value === 'OpenRouter' ? { ...current, type: 'OpenRouter', name: current.name || 'OpenRouter ASR', baseUrl: 'https://openrouter.ai/api/v1', textEnabled: false, asrEnabled: true, asrModel: 'google/gemini-2.5-flash-lite', isDefaultASR: true } : { ...current, type: event.target.value } : current)}><option>OpenAI-compatible</option><option>OpenRouter</option><option>Coze</option><option>n8n</option><option>Webhook</option></select></label></div>
        <label className="field"><span>Base URL / API 地址</span><input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" required /></label>
        <label className="field"><span>API Key</span><input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="请输入 API Key" required /></label>
        <div className="mock-two-columns" role="radiogroup" aria-label="Provider 用途"><label className="mock-toggle mock-toggle-box"><input type="radio" name="mock-provider-capability" checked={draft.textEnabled} disabled={draft.type === 'OpenRouter'} onChange={() => setDraft({ ...draft, textEnabled: true, asrEnabled: false, isDefaultASR: false })} />文本模型</label><label className="mock-toggle mock-toggle-box"><input type="radio" name="mock-provider-capability" checked={draft.asrEnabled} onChange={() => setDraft({ ...draft, textEnabled: false, asrEnabled: true })} />语音转写（ASR）</label></div>
        {draft.textEnabled ? <><div className="mock-model-detect"><div><strong>可用模型</strong><span>{draft.models.length ? `${draft.models.length} 个模型已检测` : '尚未检测模型'}</span></div><button className="secondary-button" type="button" onClick={detectModels}><Icon name="search" />检测可用模型</button></div>{draft.models.length ? <div className="mock-model-list">{draft.models.map((model) => <span key={model}>{model}</span>)}</div> : null}<label className="field"><span>默认文本模型</span><select value={draft.defaultModel} onChange={(event) => setDraft({ ...draft, defaultModel: event.target.value })} disabled={!draft.models.length}><option value="">请先检测模型</option>{draft.models.map((model) => <option key={model}>{model}</option>)}</select></label></> : null}
        {draft.asrEnabled ? <section className="provider-asr-section"><div className="admin-form-section-title"><strong>语音转写</strong><span>自动识别语种，不使用智能体提示词</span></div>{draft.type !== 'OpenRouter' ? <label className="field"><span>ASR API 地址（可选）</span><input value={draft.asrBaseUrl} onChange={(event) => setDraft({ ...draft, asrBaseUrl: event.target.value })} placeholder="留空时使用上方 Base URL" /></label> : null}<div className="mock-two-columns"><label className="field"><span>ASR 模型</span>{draft.type === 'OpenRouter' ? <select value={draft.asrModel} onChange={(event) => setDraft({ ...draft, asrModel: event.target.value })}><option value="google/gemini-2.5-flash-lite">Gemini 2.5 Flash Lite（测试推荐）</option><option value="google/gemini-2.5-flash">Gemini 2.5 Flash（更高精度）</option></select> : <input value={draft.asrModel} onChange={(event) => setDraft({ ...draft, asrModel: event.target.value })} placeholder="例如：whisper-1" />}</label><label className="mock-toggle mock-toggle-box"><input type="checkbox" checked={draft.isDefaultASR} onChange={(event) => setDraft({ ...draft, isDefaultASR: event.target.checked })} />设为默认语音转写 Provider</label></div></section> : null}
        <label className="mock-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />启用当前 Provider</label>
        <footer className="admin-mock-modal-footer"><button className="secondary-button" type="button" onClick={() => setDraft(undefined)}>取消</button><button className="primary-button" type="submit"><Icon name="save" />保存 Provider</button></footer>
      </form>
    </MockModal> : null}
  </>
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

function UserAdminRow({
  user,
  onUpdate,
  onResetPassword,
}: {
  user: AuthUser
  onUpdate: (
    user: AuthUser,
    patch: { role?: UserRole; status?: UserStatus; permissions?: UserPermission[]; desktop?: DesktopGrant },
  ) => Promise<void>
  onResetPassword: (user: AuthUser, password: string) => Promise<void>
}) {
  const [passwordEditorOpen, setPasswordEditorOpen] = useState(false)
  const [nextPassword, setNextPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string>()
  const [savingPassword, setSavingPassword] = useState(false)

  function closePasswordEditor() {
    setPasswordEditorOpen(false)
    setNextPassword('')
    setConfirmPassword('')
    setPasswordError(undefined)
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordError(undefined)

    if (nextPassword.length < 8) {
      setPasswordError('密码至少需要 8 位')
      return
    }
    if (nextPassword !== confirmPassword) {
      setPasswordError('两次输入的密码不一致')
      return
    }

    setSavingPassword(true)
    try {
      await onResetPassword(user, nextPassword)
      closePasswordEditor()
    } catch (resetError) {
      setPasswordError(resetError instanceof Error ? resetError.message : '修改密码失败')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <section className="admin-user-row">
      <header className="admin-user-identity">
        <div>
          <strong>{user.display_name}</strong>
          <span>{user.email}</span>
        </div>
        <span className={`admin-user-status ${user.status}`}>
          {user.status === 'active' ? '正常' : '已停用'}
        </span>
      </header>

      <div className="admin-user-primary-settings">
        <label className="field compact-field">
          <span>角色</span>
          <select
            value={user.role}
            disabled={user.role === 'super_admin'}
            onChange={(event) => void onUpdate(user, { role: event.target.value as UserRole })}
          >
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
            {user.role === 'super_admin' ? <option value="super_admin">超级管理员</option> : null}
          </select>
        </label>
        <label className="field compact-field">
          <span>账号状态</span>
          <select
            value={user.status}
            disabled={user.role === 'super_admin'}
            onChange={(event) => void onUpdate(user, { status: event.target.value as UserStatus })}
          >
            <option value="active">启用</option>
            <option value="disabled">禁用</option>
          </select>
        </label>
        <div className="admin-user-permissions">
          <span className="admin-control-label">功能权限</span>
          {user.role === 'user' ? (
            <PermissionPicker
              value={user.permissions ?? []}
              compact
              onChange={(next) => void onUpdate(user, { permissions: next })}
            />
          ) : (
            <span className="admin-permission-summary">{user.role === 'super_admin' ? '超级管理员全部权限' : '管理员后台权限'}</span>
          )}
        </div>
      </div>

      <div className="admin-user-secondary-settings">
        <div className="admin-user-desktop-settings">
          <span className="admin-control-label">桌面授权</span>
          <DesktopUserControls user={user} onUpdate={onUpdate} />
        </div>
        <button
          className="secondary-button admin-password-toggle"
          type="button"
          onClick={() => {
            if (passwordEditorOpen) {
              closePasswordEditor()
            } else {
              setPasswordEditorOpen(true)
            }
          }}
        >
          <Icon name="key" />
          {passwordEditorOpen ? '取消修改' : '修改密码'}
        </button>
      </div>

      {passwordEditorOpen ? (
        <form className="admin-password-form" onSubmit={submitPassword}>
          <label className="field compact-field">
            <span>新密码</span>
            <input
              type="password"
              value={nextPassword}
              minLength={8}
              autoComplete="new-password"
              onChange={(event) => setNextPassword(event.target.value)}
              required
            />
          </label>
          <label className="field compact-field">
            <span>确认新密码</span>
            <input
              type="password"
              value={confirmPassword}
              minLength={8}
              autoComplete="new-password"
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </label>
          <button className="primary-button" type="submit" disabled={savingPassword}>
            <Icon name="key" />
            {savingPassword ? '保存中...' : '保存新密码'}
          </button>
          {passwordError ? <span className="admin-password-error">{passwordError}</span> : null}
        </form>
      ) : null}
    </section>
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

function SkillAdminPanel() {
  const [skills, setSkills] = useState<AgentSkillView[]>([])
  const [selectedSkillId, setSelectedSkillId] = useState('new')
  const [editorOpen, setEditorOpen] = useState(false)
  const [skillForm, setSkillForm] = useState<SkillForm>(() => createDefaultSkillForm())
  const [fileForm, setFileForm] = useState<SkillFileForm>(() => createDefaultSkillFileForm())
  const [selectedFileId, setSelectedFileId] = useState('new')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedSkillId),
    [selectedSkillId, skills],
  )
  const editableFiles = useMemo(
    () => (selectedSkill?.files ?? []).filter((file) => file.file_kind !== 'skill'),
    [selectedSkill],
  )
  const selectedFile = useMemo(
    () => editableFiles.find((file) => file.id === selectedFileId),
    [editableFiles, selectedFileId],
  )

  async function loadSkills() {
    setLoading(true)
    setError(undefined)
    try {
      const response = await listAgentSkills()
      setSkills(response.skills)
      setSelectedSkillId((current) => {
        if (current === 'new') {
          return current
        }
        return response.skills.some((skill) => skill.id === current) ? current : response.skills[0]?.id ?? 'new'
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载 Skill 失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSkills()
  }, [])

  useEffect(() => {
    setSkillForm(selectedSkill ? mapSkillToForm(selectedSkill) : createDefaultSkillForm())
    setSelectedFileId('new')
  }, [selectedSkill, selectedSkillId])

  useEffect(() => {
    setFileForm(selectedFile ? mapSkillFileToForm(selectedFile) : createDefaultSkillFileForm())
  }, [selectedFile, selectedFileId])

  function updateSkillForm(next: Partial<SkillForm>) {
    setSkillForm((current) => ({ ...current, ...next }))
  }

  function updateFileForm(next: Partial<SkillFileForm>) {
    setFileForm((current) => ({ ...current, ...next }))
  }

  async function handleSaveSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const response = await upsertAgentSkill({
        id: skillForm.id || undefined,
        name: skillForm.name.trim(),
        slug: skillForm.slug.trim(),
        description: skillForm.description.trim(),
        enabled: skillForm.enabled,
        skill_markdown: skillForm.skillMarkdown.trim(),
      })
      setSkills((current) => [
        ...current.filter((item) => item.id !== response.skill.id),
        response.skill,
      ].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')))
      setSelectedSkillId(response.skill.id)
      setEditorOpen(false)
      setNotice('Skill 已保存')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存 Skill 失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteSkill() {
    if (!selectedSkill || saving) {
      return
    }
    if (!window.confirm(`确认删除 Skill「${selectedSkill.name}」？`)) {
      return
    }
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    try {
      await deleteAgentSkill(selectedSkill.id)
      setSkills((current) => current.filter((item) => item.id !== selectedSkill.id))
      setSelectedSkillId('new')
      setEditorOpen(false)
      setNotice('Skill 已删除')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除 Skill 失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedSkill) {
      setError('请先保存或选择一个 Skill')
      return
    }
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const response = await upsertAgentSkillFile(selectedSkill.id, {
        id: fileForm.id || undefined,
        path: fileForm.path.trim(),
        file_kind: fileForm.fileKind,
        content_type: fileForm.contentType.trim(),
        content_text: fileForm.contentText,
        sort_order: optionalNumber(fileForm.sortOrder) ?? 0,
      })
      setSkills((current) => current.map((item) => (item.id === response.skill.id ? response.skill : item)))
      setSelectedSkillId(response.skill.id)
      setSelectedFileId('new')
      setNotice('文件已保存')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存文件失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteFile(file: AgentSkillFileView) {
    if (!selectedSkill || saving || file.file_kind === 'skill') {
      return
    }
    if (!window.confirm(`确认删除文件「${file.path}」？`)) {
      return
    }
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const response = await deleteAgentSkillFile(selectedSkill.id, file.id)
      setSkills((current) => current.map((item) => (item.id === response.skill.id ? response.skill : item)))
      setSelectedFileId('new')
      setNotice('文件已删除')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除文件失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleReferenceUpload(file: File | undefined) {
    if (!file) {
      return
    }
    const text = await file.text().catch(() => '')
    const path = `references/${file.name}`
    setFileForm({
      id: '',
      path,
      fileKind: 'reference',
      contentType: file.type || 'text/plain; charset=utf-8',
      contentText: text,
      sortOrder: String(editableFiles.length),
    })
    setSelectedFileId('new')
  }

  return (
    <section className="panel admin-record-page admin-skill-record-page">
      <div className="admin-record-page-header">
        <div className="panel-heading">
        <div>
          <p className="eyebrow">Agent Skills</p>
          <h3>{loading ? '加载 Skill 中' : `${skills.length} 个 Skill`}</h3>
        </div>
        <button className="primary-button" type="button" onClick={() => { setSelectedSkillId('new'); setEditorOpen(true) }}>
          <Icon name="plus" />
          新建 Skill
        </button>
      </div>
      </div>

      <div className="admin-record-list">
        {skills.length ? skills.map((skill) => (
          <article className="admin-record-summary" key={skill.id} onDoubleClick={() => { setSelectedSkillId(skill.id); setEditorOpen(true) }}>
            <div className="admin-record-summary-main"><span className="admin-record-avatar"><Icon name="fileText" /></span><div><strong>{skill.name}</strong><span>{skill.slug} · {skill.description || '暂无说明'}</span></div></div>
            <div className="admin-record-summary-meta"><span>{skill.enabled ? '已启用' : '已停用'}</span><small>{skill.files?.length ?? 0} 个文件</small></div>
            <button className="secondary-button" type="button" onClick={() => { setSelectedSkillId(skill.id); setEditorOpen(true) }}><Icon name="edit" />编辑</button>
          </article>
        )) : <div className="system-agent-empty">还没有 Skill</div>}
      </div>

      {editorOpen ? <AdminDialog title={selectedSkill ? `编辑 Skill · ${selectedSkill.name}` : '新建 Skill'} eyebrow="Skill 管理" onClose={() => setEditorOpen(false)}><div className="admin-skill-dialog-content"><div className="admin-skill-workbench">
        <aside className="admin-skill-list">
          {skills.length ? (
            skills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                className={`admin-skill-item${skill.id === selectedSkillId ? ' active' : ''}`}
                onClick={() => setSelectedSkillId(skill.id)}
              >
                <strong>{skill.name}</strong>
                <span>{skill.slug}</span>
                <small>{skill.enabled ? '已启用' : '已停用'} · {skill.files?.length ?? 0} 个文件</small>
              </button>
            ))
          ) : (
            <div className="system-agent-empty">还没有 Skill</div>
          )}
        </aside>

        <div className="admin-skill-editor">
          <form className="admin-skill-form" onSubmit={handleSaveSkill}>
            <section className="admin-form-section">
              <div className="admin-form-section-title">
                <strong>Skill 目录</strong>
                <span>一个 Skill 就是一套可绑定到 agent 的话术和知识能力</span>
              </div>
              <div className="two-column-grid">
                <label className="field">
                  <span>名称</span>
                  <input value={skillForm.name} onChange={(event) => updateSkillForm({ name: event.target.value })} />
                </label>
                <label className="field">
                  <span>目录名</span>
                  <input value={skillForm.slug} onChange={(event) => updateSkillForm({ slug: event.target.value })} />
                </label>
              </div>
              <label className="field">
                <span>说明</span>
                <input
                  value={skillForm.description}
                  onChange={(event) => updateSkillForm({ description: event.target.value })}
                />
              </label>
              <label className="checkbox-row agent-thinking-row">
                <input
                  type="checkbox"
                  checked={skillForm.enabled}
                  onChange={(event) => updateSkillForm({ enabled: event.target.checked })}
                />
                <span>启用这个 Skill</span>
              </label>
              <label className="field agent-prompt-field">
                <span>SKILL.md</span>
                <textarea
                  rows={11}
                  value={skillForm.skillMarkdown}
                  onChange={(event) => updateSkillForm({ skillMarkdown: event.target.value })}
                />
              </label>
              <div className="button-row">
                <button className="primary-button" type="submit" disabled={saving}>
                  <Icon name="save" />
                  保存 Skill
                </button>
                {selectedSkill ? (
                  <button className="danger-button" type="button" onClick={() => void handleDeleteSkill()} disabled={saving}>
                    <Icon name="delete" />
                    删除
                  </button>
                ) : null}
              </div>
            </section>
          </form>

          <section className="admin-form-section admin-skill-files">
            <div className="admin-form-section-title">
              <strong>references / assets</strong>
              <span>客服话术优先放 references，assets 暂作资料登记</span>
            </div>
            <div className="admin-skill-file-grid">
              <div className="admin-skill-file-list">
                <button
                  type="button"
                  className={`admin-skill-file-item${selectedFileId === 'new' ? ' active' : ''}`}
                  onClick={() => setSelectedFileId('new')}
                >
                  <Icon name="plus" />
                  新建 reference
                </button>
                {editableFiles.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    className={`admin-skill-file-item${file.id === selectedFileId ? ' active' : ''}`}
                    onClick={() => setSelectedFileId(file.id)}
                  >
                    <Icon name={file.file_kind === 'asset' ? 'document' : 'fileText'} />
                    <span>
                      <strong>{file.path}</strong>
                      <small>{formatByteSize(file.byte_size)}</small>
                    </span>
                  </button>
                ))}
              </div>

              <form className="admin-skill-file-editor" onSubmit={handleSaveFile}>
                <div className="two-column-grid">
                  <label className="field">
                    <span>路径</span>
                    <input value={fileForm.path} onChange={(event) => updateFileForm({ path: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>类型</span>
                    <select
                      value={fileForm.fileKind}
                      onChange={(event) =>
                        updateFileForm({ fileKind: event.target.value as Exclude<AgentSkillFileKind, 'skill'> })
                      }
                    >
                      <option value="reference">reference</option>
                      <option value="asset">asset</option>
                    </select>
                  </label>
                </div>
                <div className="two-column-grid">
                  <label className="field">
                    <span>Content-Type</span>
                    <input
                      value={fileForm.contentType}
                      onChange={(event) => updateFileForm({ contentType: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>排序</span>
                    <input
                      type="number"
                      value={fileForm.sortOrder}
                      onChange={(event) => updateFileForm({ sortOrder: event.target.value })}
                    />
                  </label>
                </div>
                <label className="knowledge-upload-drop">
                  <strong>从本地文件填充内容</strong>
                  <span>建议使用 txt、md、csv、json。PDF/Word 先登记文件名，自动抽文本后续补。</span>
                  <input
                    type="file"
                    accept=".txt,.md,.csv,.json,.log,.html,.pdf,.doc,.docx"
                    onChange={(event) => void handleReferenceUpload(event.target.files?.[0])}
                  />
                </label>
                <label className="field agent-prompt-field">
                  <span>文件内容</span>
                  <textarea
                    rows={10}
                    value={fileForm.contentText}
                    onChange={(event) => updateFileForm({ contentText: event.target.value })}
                  />
                </label>
                <div className="button-row">
                  <button className="primary-button" type="submit" disabled={saving || !selectedSkill}>
                    <Icon name="save" />
                    保存文件
                  </button>
                  {selectedFile ? (
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => void handleDeleteFile(selectedFile)}
                      disabled={saving}
                    >
                      <Icon name="delete" />
                      删除文件
                    </button>
                  ) : null}
                </div>
              </form>
            </div>
          </section>
        </div>
      </div></div></AdminDialog> : null}

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
    </section>
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

function InvitationAdminPanel() {
  const [items, setItems] = useState<InvitationCodeView[]>([])
  const [editor, setEditor] = useState<InvitationCodeView | 'new'>()
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
      setEditor(undefined)
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
    <section className="panel admin-record-page">
      <div className="admin-record-page-header">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">邀请码列表</p>
            <h3>{loading ? '加载中' : `${items.length} 个邀请码`}</h3>
          </div>
          <button className="primary-button" type="button" onClick={() => {
            setCode('')
            setMaxUses('1')
            setExpiresAt('')
            setNote('')
            setEditor('new')
          }}>
            <Icon name="plus" />
            创建邀请码
          </button>
        </div>
      </div>
      <div className="admin-record-list">
          {items.map((item) => (
            <article key={item.id} className="admin-record-summary" onDoubleClick={() => setEditor(item)}>
              <div className="admin-record-summary-main">
                <span className="admin-record-avatar"><Icon name="key" /></span>
                <div>
                <strong>{item.code}</strong>
                <span>
                  已用 {item.used_count}/{item.max_uses}
                  {item.expires_at ? ` · 过期 ${formatDateTime(item.expires_at)}` : ''}
                </span>
                {item.note ? <small>{item.note}</small> : null}
              </div>
              </div>
              <div className="admin-record-summary-meta"><span>{item.status === 'active' ? '启用' : '禁用'}</span><small>注册入口控制</small></div>
              <button className="secondary-button" type="button" onClick={() => setEditor(item)}><Icon name="edit" />编辑</button>
            </article>
          ))}
      </div>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {editor === 'new' ? (
        <AdminDialog title="创建邀请码" eyebrow="新建邀请码" onClose={() => setEditor(undefined)}>
          <form className="form-grid" onSubmit={handleCreate}>
            <label className="field"><span>邀请码</span><input value={code} placeholder="留空自动生成" onChange={(event) => setCode(event.target.value)} /></label>
            <label className="field"><span>可用次数</span><input type="number" min={1} value={maxUses} onChange={(event) => setMaxUses(event.target.value)} required /></label>
            <label className="field"><span>过期时间</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
            <label className="field"><span>备注</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>
            <div className="admin-dialog-actions"><button className="secondary-button" type="button" onClick={() => setEditor(undefined)}>取消</button><button className="primary-button" type="submit" disabled={submitting}><Icon name="key" />{submitting ? '创建中...' : '创建邀请码'}</button></div>
          </form>
        </AdminDialog>
      ) : null}
      {editor && editor !== 'new' ? <InvitationAdminEditor item={editor} onSave={async (patch) => { await handlePatch(editor, patch); await loadItems(); setEditor(undefined) }} onClose={() => setEditor(undefined)} /> : null}
    </section>
  )
}

function InvitationAdminEditor({ item, onSave, onClose }: { item: InvitationCodeView; onSave: (patch: { status?: InvitationStatus; max_uses?: number; expires_at?: string; note?: string }) => Promise<void>; onClose: () => void }) {
  const [status, setStatus] = useState(item.status)
  const [maxUses, setMaxUses] = useState(String(item.max_uses))
  const [expiresAt, setExpiresAt] = useState(toDateTimeLocal(item.expires_at))
  const [note, setNote] = useState(item.note)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = Number(maxUses)
    if (!Number.isFinite(parsed) || parsed < 1) { setError('可用次数必须大于 0'); return }
    setSaving(true)
    setError('')
    try { await onSave({ status, max_uses: parsed, expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined, note: note.trim() }); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : '保存邀请码失败') } finally { setSaving(false) }
  }
  return <AdminDialog title={`编辑邀请码 · ${item.code}`} eyebrow="邀请码管理" onClose={onClose}><form className="form-grid" onSubmit={submit}><label className="field"><span>邀请码</span><input value={item.code} readOnly /></label><label className="field"><span>可用次数</span><input type="number" min={1} value={maxUses} onChange={(event) => setMaxUses(event.target.value)} required /></label><label className="field"><span>状态</span><select value={status} onChange={(event) => setStatus(event.target.value as InvitationStatus)}><option value="active">启用</option><option value="disabled">禁用</option></select></label><label className="field"><span>过期时间</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label><label className="field"><span>备注</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>{error ? <div className="error-banner">{error}</div> : null}<div className="admin-dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={saving}><Icon name="save" />{saving ? '保存中...' : '保存邀请码'}</button></div></form></AdminDialog>
}

function AssistantUsageLogPanel() {
  const [logs, setLogs] = useState<AssistantUsageLogView[]>([])
  const [accounts, setAccounts] = useState<AccountView[]>([])
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

  async function loadLogs(nextAccountId = accountId) {
    if (!nextAccountId) {
      setLogs([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const response = await listAssistantUsageLogs({
        logDate: logDate || undefined,
        accountId: nextAccountId,
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
    let accountResponse: { accounts: AccountView[] } = { accounts: [] }
    let filterResponse: {
      accounts: Array<{ id: string; name: string }>
      agents: Array<{ id: string; name: string }>
    } = { accounts: [], agents: [] }

    try {
      accountResponse = await listAccounts()
      setAccounts(accountResponse.accounts)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载账号失败')
    }

    try {
      filterResponse = await listAssistantUsageLogFilters()
      setFilterOptions(filterResponse)
    } catch (loadError) {
      console.warn('failed to load assistant usage log filters', loadError)
    }

    setAccountId((current) => {
      const availableAccounts = accountResponse.accounts.length
        ? accountResponse.accounts
        : filterResponse.accounts.map((option) => ({
            id: option.id,
            display_name: option.name,
          } as AccountView))
      if (current && availableAccounts.some((option) => option.id === current)) {
        void loadLogs(current)
        return current
      }
      const nextAccountId = availableAccounts[0]?.id ?? ''
      if (nextAccountId) {
        void loadLogs(nextAccountId)
      } else {
        setLogs([])
        setLoading(false)
      }
      return nextAccountId
    })
  }

  useEffect(() => {
    // Initial load only; filter changes are applied explicitly by the query button.
    void loadFilterOptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const accountOptions = useMemo(
    () => mergeUsageLogOptions(
      accounts.map((account) => ({
        id: account.id,
        name: account.display_name || account.phone_number || account.id,
      })),
      filterOptions.accounts,
    ),
    [accounts, filterOptions.accounts],
  )
  const visibleAccountOptions = useMemo(
    () =>
      accountOptions.length
        ? accountOptions
        : mergeUsageLogOptions(
            [],
            logs.map((log) => ({
              id: log.ws_account_id,
              name: log.ws_account_name || log.ws_account_id,
            })),
          ),
    [accountOptions, logs],
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
            {!visibleAccountOptions.length ? <option value="">暂无账号</option> : null}
            {visibleAccountOptions.map((option) => (
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
        <button className="primary-button" type="button" onClick={() => void loadLogs()} disabled={loading || !accountId}>
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

function ProviderPresetPanel() {
  const [presets, setPresets] = useState<ProviderPresetView[]>([])
  const [selectedId, setSelectedId] = useState('new')
  const [editorOpen, setEditorOpen] = useState(false)
  const [form, setForm] = useState<ProviderPresetForm>(() => createDefaultProviderPresetForm())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [testingASR, setTestingASR] = useState(false)
  const [asrTestResult, setASRTestResult] = useState<string>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const selected = useMemo(() => presets.find((item) => item.id === selectedId), [presets, selectedId])

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    setForm(selected ? mapProviderPresetToForm(selected) : createDefaultProviderPresetForm())
	setASRTestResult(undefined)
  }, [selected, selectedId])

  async function load() {
    setLoading(true)
    setError(undefined)
    try {
      const response = await listProviderPresets()
      setPresets(response.presets)
      setSelectedId((current) => current === 'new' || response.presets.some((item) => item.id === current)
        ? current
        : response.presets[0]?.id ?? 'new')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载 Provider 配置失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    const models = parsePresetModels(form.models)
    if (!form.name.trim() || form.textEnabled === form.asrEnabled) {
      setError(form.name.trim() ? 'Provider 必须且只能选择文本模型或语音转写能力' : '预设名称不能为空')
	  setSaving(false)
	  return
	}
	if (form.textEnabled && form.providerType === 'openai_compatible' && !models.length) {
	  setError('启用文本模型时至少需要一个可用模型')
	  setSaving(false)
	  return
	}
	if (form.asrEnabled && !form.asrModel.trim()) {
	  setError('启用语音转写时必须填写 ASR 模型')
      setSaving(false)
      return
    }
    try {
      const response = await upsertProviderPreset({
        id: form.id || undefined,
        name: form.name.trim(),
        provider_type: form.providerType,
        base_url: form.baseUrl.trim(),
        api_key: form.apiKey.trim() || undefined,
		text_enabled: form.textEnabled,
        models,
        default_model: form.defaultModel.trim(),
		asr_enabled: form.asrEnabled,
		asr_base_url: form.asrBaseUrl.trim() || undefined,
		asr_model: form.asrModel.trim() || undefined,
		is_default_asr: form.asrEnabled && form.isDefaultASR,
        enabled: form.enabled,
      })
      setPresets((current) => [...current.filter((item) => item.id !== response.preset.id), response.preset])
      setSelectedId(response.preset.id)
      setEditorOpen(false)
      setNotice('Provider 配置已保存')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存 Provider 配置失败')
    } finally {
      setSaving(false)
    }
  }

  function handleProviderTypeChange(providerType: ProviderType) {
    setForm((current) => {
      if (providerType === 'openrouter') {
        return {
          ...current,
          providerType,
          name: current.name || 'OpenRouter ASR',
          baseUrl: 'https://openrouter.ai/api/v1',
          textEnabled: false,
          asrEnabled: true,
          asrBaseUrl: '',
          asrModel: current.providerType === 'openrouter' && current.asrModel ? current.asrModel : 'google/gemini-2.5-flash-lite',
          isDefaultASR: true,
        }
      }
      return {
        ...current,
        providerType,
        baseUrl: current.providerType === 'openrouter' ? '' : current.baseUrl,
        textEnabled: current.providerType === 'openrouter' ? true : current.textEnabled,
        asrEnabled: current.providerType === 'openrouter' ? false : current.asrEnabled,
        asrModel: current.providerType === 'openrouter' ? '' : current.asrModel,
        isDefaultASR: current.providerType === 'openrouter' ? false : current.isDefaultASR,
      }
    })
  }

  async function handleDiscoverModels() {
    if (discovering || saving) return
    setError(undefined)
    setNotice(undefined)
    if (form.providerType !== 'openai_compatible') {
      setError('当前 Provider 类型不支持自动检测模型')
      return
    }
    if (!form.baseUrl.trim()) {
      setError('请先填写 Base URL')
      return
    }
    if (!form.apiKey.trim() && !form.apiKeyConfigured) {
      setError('请先填写 API Key')
      return
    }

    setDiscovering(true)
    try {
      const response = await discoverProviderModels({
        id: form.id || undefined,
        provider_type: form.providerType,
        base_url: form.baseUrl.trim(),
        api_key: form.apiKey.trim() || undefined,
      })
      const models = response.models
      setForm((current) => ({
        ...current,
        models: models.join('\n'),
        defaultModel: models.includes(current.defaultModel) ? current.defaultModel : models[0] ?? '',
      }))
      setNotice(`已检测到 ${models.length} 个模型，请选择默认模型后保存 Provider`)
    } catch (discoverError) {
      setError(discoverError instanceof Error ? discoverError.message : '检测模型失败')
    } finally {
      setDiscovering(false)
    }
  }

  async function handleTestASR(file?: File) {
	if (!file || testingASR || !selected?.id) return
	setTestingASR(true)
	setError(undefined)
	setASRTestResult(undefined)
	try {
	  const response = await testProviderASR(selected.id, file)
	  setASRTestResult(response.transcription.text)
	  setNotice(`语音转写测试成功 · ${response.transcription.model}`)
	} catch (testError) {
	  setError(testError instanceof Error ? testError.message : '语音转写测试失败')
	} finally {
	  setTestingASR(false)
	}
  }

  async function handleDelete() {
    if (!selected || saving || !window.confirm(`确认删除 Provider「${selected.name}」？`)) return
    setSaving(true)
    try {
      await deleteProviderPreset(selected.id)
      setPresets((current) => current.filter((item) => item.id !== selected.id))
      setSelectedId('new')
      setEditorOpen(false)
      setNotice('Provider 配置已删除')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除 Provider 配置失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel admin-record-page provider-preset-panel">
      <div className="admin-record-page-header"><div className="panel-heading"><div><p className="eyebrow">Provider / Model</p><h3>{loading ? '加载配置中' : `${presets.length} 个 Provider`}</h3></div><button className="primary-button" type="button" onClick={() => { setSelectedId('new'); setEditorOpen(true) }}><Icon name="plus" />新建 Provider</button></div></div>
      <div className="admin-record-list">
        <aside className="admin-record-list-inner">
          <div className="admin-list-caption"><strong>已保存 Provider</strong><span>点击项目编辑连接信息、模型和启用状态</span></div>
          <div className="system-agent-list">
            {presets.map((preset) => <button key={preset.id} type="button" className="admin-record-summary provider-record-summary" onClick={() => { setSelectedId(preset.id); setEditorOpen(true) }}><span className="admin-record-avatar"><Icon name="key" /></span><span className="admin-record-summary-main"><strong>{preset.name}</strong><span>{preset.provider_type === 'openrouter' ? 'OpenRouter' : preset.provider_type} · {preset.base_url}</span></span><span className="admin-record-summary-meta"><span>{preset.enabled ? '已启用' : '已停用'} · {preset.text_enabled ? '文本模型' : '语音转写'}</span><small>{preset.text_enabled ? `${preset.models.length} 个模型 · 默认 ${preset.default_model || '未选择'}` : `ASR · ${preset.asr_model || '未配置'}`}{preset.is_default_asr ? ' · 默认转写' : ''}</small></span><span className="admin-record-summary-arrow"><Icon name="chevronRight" /></span></button>)}
            {!presets.length ? <div className="system-agent-empty">还没有 Provider 配置</div> : null}
          </div>
        </aside>
      </div>
      {editorOpen ? <AdminDialog title={selected ? `编辑 Provider · ${selected.name}` : '新建 Provider'} eyebrow="Provider 配置" onClose={() => setEditorOpen(false)}><form className="agent-config-form" onSubmit={handleSubmit}>
          <div className="admin-agent-editor-body">
            <section className="admin-form-section">
              <div className="admin-form-section-title"><strong>连接信息</strong><span>智能体直接使用这里保存的密钥和模型</span></div>
              <div className="two-column-grid">
                <label className="field"><span>预设名称</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：OpenAI 主账号" /></label>
                <label className="field"><span>Provider 类型</span><select value={form.providerType} onChange={(event) => handleProviderTypeChange(event.target.value as ProviderType)}>{providerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              </div>
              <label className="field"><span>Base URL / API 地址</span><input value={form.baseUrl} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.example.com/v1" /></label>
              <label className="field"><span>API Key</span><input type="password" value={form.apiKey} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder={form.apiKeyConfigured ? '已配置，留空保持不变' : '请输入 API Key'} /></label>
			  <div className="two-column-grid" role="radiogroup" aria-label="Provider 用途">
				<label className="checkbox-row agent-thinking-row"><input type="radio" name="provider-capability" checked={form.textEnabled} disabled={form.providerType === 'openrouter'} onChange={() => setForm((current) => ({ ...current, textEnabled: true, asrEnabled: false, isDefaultASR: false }))} /><span>文本模型</span></label>
				<label className="checkbox-row agent-thinking-row"><input type="radio" name="provider-capability" checked={form.asrEnabled} onChange={() => setForm((current) => ({ ...current, textEnabled: false, asrEnabled: true }))} /><span>语音转写（ASR）</span></label>
			  </div>
			  {form.textEnabled ? <>
			  <div className="provider-model-toolbar">
                <div>
                  <span className="admin-control-label">可用模型</span>
                  <small>{parsePresetModels(form.models).length ? `已保存 ${parsePresetModels(form.models).length} 个模型` : '尚未检测模型'}</small>
                </div>
                <button className="secondary-button" type="button" onClick={() => void handleDiscoverModels()} disabled={discovering || saving}>
                  <Icon name="search" />{discovering ? '检测中...' : '检测可用模型'}
                </button>
              </div>
			  <label className="field"><span>默认文本模型</span><select value={form.defaultModel} onChange={(event) => setForm((current) => ({ ...current, defaultModel: event.target.value }))}><option value="">请选择模型</option>{parsePresetModels(form.models).map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
			  </> : null}
			  {form.asrEnabled ? <section className="provider-asr-section">
				<div className="admin-form-section-title"><strong>语音转写</strong><span>自动识别语种，不使用智能体提示词</span></div>
				{form.providerType !== 'openrouter' ? <label className="field"><span>ASR API 地址（可选）</span><input value={form.asrBaseUrl} onChange={(event) => setForm((current) => ({ ...current, asrBaseUrl: event.target.value }))} placeholder="留空时使用上方 Base URL；也可填写完整 /audio/transcriptions 地址" /></label> : null}
				<div className="two-column-grid">
				  <label className="field"><span>ASR 模型</span>{form.providerType === 'openrouter' ? <select value={form.asrModel} onChange={(event) => setForm((current) => ({ ...current, asrModel: event.target.value }))}><option value="google/gemini-2.5-flash-lite">Gemini 2.5 Flash Lite（测试推荐）</option><option value="google/gemini-2.5-flash">Gemini 2.5 Flash（更高精度）</option></select> : <input value={form.asrModel} onChange={(event) => setForm((current) => ({ ...current, asrModel: event.target.value }))} placeholder="例如：whisper-1" />}</label>
				  <label className="checkbox-row agent-thinking-row"><input type="checkbox" checked={form.isDefaultASR} onChange={(event) => setForm((current) => ({ ...current, isDefaultASR: event.target.checked }))} /><span>设为默认语音转写 Provider</span></label>
				</div>
				{selected ? <div className="provider-model-toolbar"><div><span className="admin-control-label">测试语音转写</span><small>上传一段音频验证 API、模型和返回文本</small></div><label className={`secondary-button${testingASR ? ' disabled' : ''}`}><Icon name="audio" />{testingASR ? '转写中...' : '选择音频测试'}<input className="visually-hidden" type="file" accept="audio/*" disabled={testingASR} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void handleTestASR(file) }} /></label></div> : <small className="muted">保存 Provider 后可以上传音频测试。</small>}
				{asrTestResult ? <div className="provider-asr-test-result"><strong>转写结果</strong><p>{asrTestResult}</p></div> : null}
			  </section> : null}
			  <label className="checkbox-row agent-thinking-row"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} /><span>启用当前 Provider</span></label>
            </section>
          </div>
          <div className="admin-agent-actions">{notice ? <div className="success-banner">{notice}</div> : null}{error ? <div className="error-banner">{error}</div> : null}<div className="button-row"><button className="primary-button" type="submit" disabled={saving}><Icon name="save" />{saving ? '保存中...' : '保存 Provider'}</button>{selected ? <button className="danger-button" type="button" onClick={() => void handleDelete()} disabled={saving}><Icon name="delete" />删除 Provider</button> : null}</div></div>
        </form></AdminDialog> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
    </section>
  )
}

function createDefaultProviderPresetForm(): ProviderPresetForm {
  return { id: '', name: '', providerType: 'openai_compatible', baseUrl: '', apiKey: '', apiKeyConfigured: false, textEnabled: true, models: '', defaultModel: '', asrEnabled: false, asrBaseUrl: '', asrModel: '', isDefaultASR: false, enabled: true }
}

function mapProviderPresetToForm(preset: ProviderPresetView): ProviderPresetForm {
  const asrEnabled = preset.asr_enabled
  return { id: preset.id, name: preset.name, providerType: normalizeProviderType(preset.provider_type), baseUrl: preset.base_url, apiKey: '', apiKeyConfigured: preset.api_key_configured, textEnabled: !asrEnabled, models: preset.models.join('\n'), defaultModel: preset.default_model, asrEnabled, asrBaseUrl: preset.asr_base_url, asrModel: preset.asr_model, isDefaultASR: preset.is_default_asr, enabled: preset.enabled }
}

function parsePresetModels(value: string) {
  return Array.from(new Set(value.split(/[\n,，]+/).map((item) => item.trim()).filter(Boolean)))
}

function SystemAgentPanel() {
  const [configs, setConfigs] = useState<SystemAgentConfigView[]>([])
  const [skills, setSkills] = useState<AgentSkillView[]>([])
  const [providerPresets, setProviderPresets] = useState<ProviderPresetView[]>([])
  const [purpose, setPurpose] = useState<AgentPurpose>('reply')
  const [selectedConfigId, setSelectedConfigId] = useState('new')
  const [editorOpen, setEditorOpen] = useState(false)
  const [form, setForm] = useState<AgentConfigForm>(() => createDefaultConfigForm('reply'))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [rulesExpanded, setRulesExpanded] = useState(false)

  const purposeConfigs = useMemo(
    () => configs.filter((config) => config.purpose === purpose),
    [configs, purpose],
  )
  const selectedConfig = useMemo(
    () => purposeConfigs.find((config) => config.id === selectedConfigId),
    [purposeConfigs, selectedConfigId],
  )
  const selectedProviderPreset = useMemo(
    () => providerPresets.find((preset) => preset.id === form.providerPresetId),
    [form.providerPresetId, providerPresets],
  )

  async function loadConfigs() {
    setLoading(true)
    setError(undefined)
    try {
      const [response, skillResponse, presetResponse] = await Promise.all([
        listSystemAgentConfigs(),
        listAgentSkills(),
        listProviderPresets(),
      ])
      setConfigs(response.configs)
      setSkills(skillResponse.skills)
      setProviderPresets(presetResponse.presets)
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
    // Initial load only; purpose switching is handled by the selection effect below.
    void loadConfigs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    setRulesExpanded(false)
  }, [purpose, selectedConfigId])

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
      if (!selectedProviderPreset) {
        setError('请选择一个已配置的 Provider')
        return
      }
      if (selectedProviderPreset.provider_type === 'openai_compatible' && !form.model.trim()) {
        setError('请选择模型')
        return
      }
      if (purpose === 'reply' && (!Number.isInteger(Number(form.contextMessageLimit)) || Number(form.contextMessageLimit) < 1 || Number(form.contextMessageLimit) > 50)) {
        setError('上下文消息条数请输入 1 至 50 的整数')
        return
      }

      const response = await upsertSystemAgentConfig({
        id: form.id || undefined,
        name,
        purpose,
        enabled: form.enabled,
        provider_config: buildProviderConfig({ ...form, purpose }, selectedProviderPreset),
        prompt_template: form.promptTemplate.trim(),
        skill_ids: purpose === 'reply' ? form.skillIds : [],
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
      setEditorOpen(false)
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
      setEditorOpen(false)
      setNotice('智能体已删除')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除智能体失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel admin-record-page admin-agent-record-page">
      <div className="admin-record-page-header">
        <div className="panel-heading">
        <div>
          <p className="eyebrow">系统智能体</p>
          <h3>{loading ? '加载配置中' : `${configs.length} 个智能体`}</h3>
        </div>
        <button className="primary-button" type="button" onClick={() => { setSelectedConfigId('new'); setEditorOpen(true) }}>
          <Icon name="plus" />
          新建智能体
        </button>
      </div>
      </div>

      <nav className="admin-purpose-switch admin-purpose-switch-top" aria-label="智能体类型">
        <button type="button" className={`admin-purpose-button${purpose === 'reply' ? ' active' : ''}`} onClick={() => setPurpose('reply')}><strong>回复 Agent</strong><span>{configs.filter((config) => config.purpose === 'reply').length}</span></button>
        <button type="button" className={`admin-purpose-button${purpose === 'translation' ? ' active' : ''}`} onClick={() => setPurpose('translation')}><strong>翻译 Agent</strong><span>{configs.filter((config) => config.purpose === 'translation').length}</span></button>
        <button type="button" className={`admin-purpose-button${purpose === 'status_card' ? ' active' : ''}`} onClick={() => setPurpose('status_card')}><strong>状态卡 Agent</strong><span>{configs.filter((config) => config.purpose === 'status_card').length}</span></button>
      </nav>

      <div className="admin-record-list">
        {purposeConfigs.length ? purposeConfigs.map((config) => {
          const presetID = readConfigString(config.provider_config ?? {}, 'preset_id')
          const providerName = providerPresets.find((preset) => preset.id === presetID)?.name
          return <article className="admin-record-summary" key={config.id} onDoubleClick={() => { setSelectedConfigId(config.id); setEditorOpen(true) }}><div className="admin-record-summary-main"><span className="admin-record-avatar"><Icon name="chat" /></span><div><strong>{config.name}</strong><span>{getPurposeTitle(config.purpose)} · {providerName || '待选择 Provider'}</span></div></div><div className="admin-record-summary-meta"><span>{config.enabled ? '已启用' : '未启用'}</span><small>{readConfigString(config.provider_config ?? {}, 'model') || '未选择模型'}</small></div><button className="secondary-button" type="button" onClick={() => { setSelectedConfigId(config.id); setEditorOpen(true) }}><Icon name="edit" />编辑</button></article>
        }) : <div className="system-agent-empty">当前类型还没有智能体</div>}
      </div>

      {editorOpen ? <AdminDialog className="admin-agent-dialog" title={selectedConfig ? `编辑智能体 · ${selectedConfig.name}` : `新建${getPurposeTitle(purpose)}`} eyebrow="智能回复配置" onClose={() => setEditorOpen(false)}><div className="admin-agent-modal-content">
        <nav className="admin-agent-modal-nav" aria-label="选择智能体">
          <div className="admin-agent-modal-purpose">
            {(['reply', 'translation', 'status_card'] as AgentPurpose[]).map((item) => (
              <button key={item} type="button" className={`admin-agent-modal-purpose-button${purpose === item ? ' active' : ''}`} onClick={() => setPurpose(item)}>
                <strong>{getPurposeTitle(item)}</strong>
                <span>{configs.filter((config) => config.purpose === item).length} 个</span>
              </button>
            ))}
          </div>
          <div className="admin-agent-modal-agents">
            {purposeConfigs.length ? purposeConfigs.map((config) => (
              <button key={config.id} type="button" className={`admin-agent-modal-agent${config.id === selectedConfigId ? ' active' : ''}`} onClick={() => setSelectedConfigId(config.id)}>
                <span>{config.name}</span>
                <small>{config.enabled ? '已启用' : '未启用'}</small>
              </button>
            )) : <span className="admin-agent-modal-empty">当前类型还没有已创建的智能体</span>}
          </div>
        </nav>

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
                <strong>模型配置</strong>
                <span>连接地址和密钥统一在 Provider 预设中维护</span>
              </div>
              <div className="two-column-grid agent-provider-selection-grid">
                <label className="field">
                  <span>Provider</span>
                <select
                  value={form.providerPresetId}
                  onChange={(event) => {
                    const preset = providerPresets.find((item) => item.id === event.target.value)
                    updateForm({
                      providerPresetId: preset?.id ?? '',
                      model: preset?.default_model || preset?.models[0] || '',
                    })
                  }}
                >
                  <option value="">请选择 Provider</option>
                  {providerPresets
                    .filter((preset) => preset.enabled || preset.id === form.providerPresetId)
                    .filter((preset) => preset.text_enabled && (purpose !== 'translation' || preset.provider_type === 'openai_compatible'))
                    .map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                  ))}
                </select>
                </label>
                <label className="field">
                  <span>模型</span>
                  <select
                    value={form.model}
                    onChange={(event) => updateForm({ model: event.target.value })}
                    disabled={!selectedProviderPreset || selectedProviderPreset.models.length === 0}
                  >
                    <option value="">{selectedProviderPreset ? '请选择模型' : '请先选择 Provider'}</option>
                    {selectedProviderPreset?.models.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </label>
              </div>
              {providerPresets.filter((preset) => preset.enabled).length === 0 ? (
                <div className="inline-empty-note">请先到 Provider 预设中配置密钥并检测可用模型。</div>
              ) : null}
            </section>

            {purpose === 'reply' ? (
              <section className="admin-form-section">
                <div className="admin-form-section-title">
                  <strong>对话上下文</strong>
                  <span>前台开启携带上下文时生效，默认 20 条</span>
                </div>
                <label className="field compact-field">
                  <span>上下文消息条数</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    value={form.contextMessageLimit}
                    onChange={(event) => updateForm({ contextMessageLimit: event.target.value })}
                  />
                </label>
              </section>
            ) : null}

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

            {purpose === 'reply' ? (
              <section className="admin-form-section">
                <div className="admin-form-section-title">
                  <strong>绑定 Skill</strong>
                  <span>回复生成时会自动参考已绑定 Skill 的 SKILL.md 和 references</span>
                </div>
                <div className="admin-skill-bind-list">
                  {skills.length ? (
                    skills.map((skill) => {
                      const checked = form.skillIds.includes(skill.id)
                      return (
                        <label key={skill.id} className="admin-skill-bind-row">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              const next = new Set(form.skillIds)
                              if (event.target.checked) {
                                next.add(skill.id)
                              } else {
                                next.delete(skill.id)
                              }
                              updateForm({ skillIds: Array.from(next) })
                            }}
                          />
                          <span>
                            <strong>{skill.name}</strong>
                            <small>{skill.enabled ? '已启用' : '已停用'} · {skill.slug}</small>
                          </span>
                        </label>
                      )
                    })
                  ) : (
                    <div className="system-agent-empty">还没有可绑定的 Skill，请先到 Skill 管理中新建</div>
                  )}
                </div>
              </section>
            ) : null}

            <section className="admin-form-section admin-prompt-section">
              <div className="admin-form-section-title">
                <div>
                  <strong>规则提示词</strong>
                  <span>系统自动生效，负责输出格式和基础约束</span>
                </div>
                <button
                  className="icon-button admin-prompt-toggle"
                  type="button"
                  onClick={() => setRulesExpanded((current) => !current)}
                  aria-expanded={rulesExpanded}
                  aria-label={rulesExpanded ? '收起规则提示词' : '展开规则提示词'}
                  title={rulesExpanded ? '收起规则提示词' : '展开规则提示词'}
                >
                  <Icon name="chevronDown" className={rulesExpanded ? 'rotate-180' : ''} />
                </button>
              </div>
              {rulesExpanded ? (
                <label className="field agent-prompt-field">
                  <span>系统规则（自动生效）</span>
                  <textarea rows={8} value={form.rulesPrompt} readOnly />
                </label>
              ) : null}
              <label className="field agent-prompt-field">
                <span>角色与功能要求</span>
                <textarea
                  rows={6}
                  value={form.promptTemplate}
                  onChange={(event) => updateForm({ promptTemplate: event.target.value })}
                  placeholder={getPurposeRolePlaceholder(purpose)}
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
      </div></AdminDialog> : null}
    </section>
  )
}

function createDefaultConfigForm(purpose: AgentPurpose): AgentConfigForm {
  return {
    id: '',
    name: getPurposeDefaultName(purpose),
    purpose,
    enabled: false,
    model: '',
    historyLimit: '500',
    contextMessageLimit: '20',
    stageLabels: defaultStatusStageLabels.join('\n'),
    customerTypeLabels: defaultCustomerTypeLabels.join('\n'),
    riskLabels: defaultRiskLabels.join('\n'),
    rulesPrompt: getPurposeRulesPrompt(purpose),
    promptTemplate:
      purpose === 'translation'
        ? defaultTranslationRolePrompt
        : purpose === 'status_card'
          ? defaultStatusCardRolePrompt
          : defaultReplyRolePrompt,
    skillIds: [],
    providerPresetId: '',
  }
}

function createDefaultSkillForm(): SkillForm {
  return {
    id: '',
    name: '新建 Skill',
    slug: 'new-skill',
    description: '',
    enabled: true,
    skillMarkdown: defaultSkillMarkdown('新建 Skill'),
  }
}

function defaultSkillMarkdown(name: string) {
  return [
    `# ${name}`,
    '',
    '## 何时使用',
    '当客户消息与本技能的话术、知识或场景匹配时使用。',
    '',
    '## 回复目标',
    '结合 references 中的资料，生成自然、准确、适合 WhatsApp 客服场景的回复。',
    '',
    '## 使用要求',
    '- 优先参考本技能下的 references。',
    '- 不要编造资料中没有的承诺。',
    '- 不要输出内部分析过程。',
  ].join('\n')
}

function createDefaultSkillFileForm(): SkillFileForm {
  return {
    id: '',
    path: 'references/new-reference.md',
    fileKind: 'reference',
    contentType: 'text/markdown; charset=utf-8',
    contentText: '',
    sortOrder: '0',
  }
}

function mapSkillToForm(skill: AgentSkillView): SkillForm {
  return {
    id: skill.id,
    name: skill.name,
    slug: skill.slug,
    description: skill.description,
    enabled: skill.enabled,
    skillMarkdown: skill.skill_markdown || defaultSkillMarkdown(skill.name),
  }
}

function mapSkillFileToForm(file: AgentSkillFileView): SkillFileForm {
  return {
    id: file.id,
    path: file.path,
    fileKind: file.file_kind === 'asset' ? 'asset' : 'reference',
    contentType: file.content_type,
    contentText: file.content_text,
    sortOrder: String(file.sort_order ?? 0),
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

function getPurposeRolePlaceholder(purpose: AgentPurpose) {
  switch (purpose) {
    case 'translation':
      return '例如：你是面向东南亚客户的专业翻译，保持客服语气自然、礼貌。'
    case 'status_card':
      return '例如：你是销售主管，重点判断客户意向和下一步跟进动作。'
    default:
      return '例如：你是耐心专业的跨境客服，重点帮助客户了解产品并推进下一步。'
  }
}

function getPurposeRulesPrompt(purpose: AgentPurpose) {
  switch (purpose) {
    case 'translation':
      return defaultTranslationRulesPrompt
    case 'status_card':
      return defaultStatusCardRulesPrompt
    default:
      return defaultReplyRulesPrompt
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
  const fallback = createDefaultConfigForm(config.purpose)

  return {
    ...fallback,
    id: config.id,
    name: config.name,
    enabled: config.enabled,
    model: readConfigString(providerConfig, 'model'),
    historyLimit: readConfigString(providerConfig, 'history_limit') || fallback.historyLimit,
    contextMessageLimit: readConfigString(providerConfig, 'context_message_limit') || fallback.contextMessageLimit,
    stageLabels: readConfigStringList(providerConfig, 'stage_labels', defaultStatusStageLabels).join('\n'),
    customerTypeLabels: readConfigStringList(
      providerConfig,
      'customer_type_labels',
      defaultCustomerTypeLabels,
    ).join('\n'),
    riskLabels: readConfigStringList(providerConfig, 'risk_labels', defaultRiskLabels).join('\n'),
    rulesPrompt: readConfigString(providerConfig, 'rules_prompt') || getPurposeRulesPrompt(config.purpose),
    promptTemplate: normalizeStoredRolePrompt(
      config.purpose,
      config.prompt_template,
      Boolean(readConfigString(providerConfig, 'rules_prompt')),
    ) || fallback.promptTemplate,
    skillIds: config.skill_ids ?? [],
    providerPresetId: readConfigString(providerConfig, 'preset_id'),
  }
}

function normalizeStoredRolePrompt(purpose: AgentPurpose, prompt: string, hasStoredRules: boolean) {
  const trimmed = prompt.trim()
  if (!trimmed || hasStoredRules) {
    return trimmed
  }

  if (
    purpose === 'reply' &&
    trimmed.includes('输出 JSON Schema') &&
    trimmed.includes('回复方案 3') &&
    trimmed.includes('不要承诺收益')
  ) {
    return defaultReplyRolePrompt
  }
  if (
    purpose === 'translation' &&
    trimmed.includes('target_language') &&
    trimmed.includes('translated_text')
  ) {
    return defaultTranslationRolePrompt
  }
  if (purpose === 'status_card' && trimmed.startsWith('你是 WhatsApp 私域转化顾问。') && trimmed.endsWith('只输出严格 JSON。')) {
    return defaultStatusCardRolePrompt
  }
  return trimmed
}

function buildProviderConfig(form: AgentConfigForm, preset: ProviderPresetView): AgentProviderConfig {
  return withStatusCardConfig(form, compactConfig({
    type: normalizeProviderType(preset.provider_type),
    model: form.model.trim(),
    preset_id: preset.id,
    rules_prompt: form.rulesPrompt.trim(),
    ...(form.purpose === 'reply' ? { context_message_limit: Number(form.contextMessageLimit) } : {}),
  }))
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

function normalizeProviderType(value: string): ProviderType {
  switch (value.trim().toLowerCase()) {
    case 'openrouter':
    case 'open_router':
    case 'open-router':
      return 'openrouter'
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

function toDateTimeLocal(value?: string) {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatByteSize(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B'
  }
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`
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
