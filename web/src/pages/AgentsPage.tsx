import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  deleteAgentRule,
  listAccounts,
  listAgentRules,
  upsertAgentRule,
  type AccountView,
  type AgentProviderConfig,
  type AgentRuleView,
} from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { Icon } from '../components/Icon'

type AgentProviderType = 'openai_compatible' | 'coze' | 'n8n' | 'webhook'

interface AgentFormValue {
  id?: string
  accountId: string
  accountIds: string[]
  purpose: 'reply' | 'translation'
  name: string
  providerType: AgentProviderType
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
  promptTemplate: string
}

const providerOptions: Array<{ value: AgentProviderType; label: string; badge: string }> = [
  { value: 'openai_compatible', label: '大模型 API', badge: 'Prompt + Model' },
  { value: 'coze', label: 'Coze', badge: 'Agent API' },
  { value: 'n8n', label: 'n8n', badge: 'Webhook' },
  { value: 'webhook', label: 'Webhook', badge: 'Custom' },
]

const defaultReplyPrompt = '你是 WhatsApp 客服回复助手。根据当前聊天上下文生成一条简洁、礼貌、可直接发送给客户的回复建议。'
const defaultTranslationPrompt =
  '你是 WhatsApp 客服翻译助手。检测原文语种，并把文本准确翻译成目标语种。source_language_name 尽量使用中文语种名。只输出严格 JSON，不要 Markdown。'

function createEmptyAgent(accountId: string): AgentFormValue {
  return {
    accountId,
    accountIds: accountId ? [accountId] : [],
    purpose: 'reply',
    name: '',
    providerType: 'openai_compatible',
    model: '',
    baseUrl: '',
    apiKey: '',
    endpointUrl: '',
    authorization: '',
    method: 'POST',
    responsePath: 'draft',
    temperature: '0.2',
    maxTokens: '600',
    timeoutSeconds: '30',
    enableThinking: false,
    promptTemplate: defaultReplyPrompt,
  }
}

function mapRuleToForm(rule: AgentRuleView): AgentFormValue {
  const config = rule.provider_config ?? {}
  const providerType = normalizeProviderType(readConfigString(config, 'type'))

  return {
    id: rule.id,
    accountId: rule.account_id,
    accountIds: rule.account_ids?.length ? rule.account_ids : [rule.account_id],
    purpose: rule.purpose === 'translation' ? 'translation' : 'reply',
    name: rule.name,
    providerType,
    model: readConfigString(config, 'model'),
    baseUrl: readConfigString(config, 'base_url'),
    apiKey: readConfigString(config, 'api_key'),
    endpointUrl: readConfigString(config, 'endpoint_url') || readConfigString(config, 'base_url'),
    authorization: readConfigString(config, 'authorization'),
    method: readConfigString(config, 'method') || 'POST',
    responsePath: readConfigString(config, 'response_path') || 'draft',
    temperature: readConfigString(config, 'temperature') || '0.2',
    maxTokens: readConfigString(config, 'max_tokens') || '600',
    timeoutSeconds: readConfigString(config, 'timeout_seconds') || '30',
    enableThinking: readConfigBool(config, 'enable_thinking', false),
    promptTemplate: rule.prompt_template,
  }
}

function normalizeProviderType(value: string): AgentProviderType {
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

function readConfigString(config: AgentProviderConfig, key: string) {
  const value = config[key]
  if (value === undefined || value === null) {
    return ''
  }
  return String(value)
}

function readConfigBool(config: AgentProviderConfig, key: string, fallback: boolean) {
  const value = config[key]
  if (typeof value === 'boolean') {
    return value
  }
  if (value === undefined || value === null) {
    return fallback
  }

  const normalized = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) {
    return true
  }
  if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) {
    return false
  }

  return fallback
}

function optionalNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function compactConfig(config: AgentProviderConfig) {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined && value !== ''),
  ) as AgentProviderConfig
}

function buildProviderConfig(form: AgentFormValue): AgentProviderConfig {
  if (form.providerType === 'openai_compatible') {
    return compactConfig({
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

  return compactConfig({
    type: form.providerType,
    endpoint_url: form.endpointUrl.trim(),
    api_key: form.apiKey.trim(),
    authorization: form.authorization.trim(),
    method: form.method.trim().toUpperCase() || 'POST',
    response_path: form.responsePath.trim() || 'draft',
    timeout_seconds: optionalNumber(form.timeoutSeconds),
  })
}

function validateAgentForm(form: AgentFormValue) {
  if (form.accountIds.length === 0) {
    return '请选择绑定账号'
  }
  if (!form.name.trim()) {
    return 'Agent 名称不能为空'
  }

  if (form.providerType === 'openai_compatible') {
    if (!form.model.trim()) {
      return '大模型接入需要填写 Model'
    }
    if (!form.baseUrl.trim()) {
      return '大模型接入需要填写 Base URL'
    }
    if (!form.apiKey.trim()) {
      return '大模型接入需要填写 API Key'
    }
    if (!form.promptTemplate.trim()) {
      return '大模型接入需要填写提示词'
    }
  } else if (!form.endpointUrl.trim()) {
    return `${getProviderLabel(form.providerType)} 接入需要填写 API 地址`
  }

  return undefined
}

function getProviderLabel(providerType: string) {
  return providerOptions.find((option) => option.value === providerType)?.label ?? '大模型 API'
}

function normalizeSelectedAccountIds(accountIds: string[], fallbackAccountId: string) {
  const result: string[] = []
  const seen = new Set<string>()
  const add = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) {
      return
    }
    seen.add(trimmed)
    result.push(trimmed)
  }

  accountIds.forEach(add)
  add(fallbackAccountId)
  return result
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function AgentsPage() {
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [agents, setAgents] = useState<AgentRuleView[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string>('new')
  const [form, setForm] = useState<AgentFormValue>(createEmptyAgent(''))
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const accountNameMap = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.display_name])),
    [accounts],
  )
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId)

  async function loadData() {
    setLoading(true)
    setError(undefined)

    try {
      const [accountsResponse, agentsResponse] = await Promise.all([
        listAccounts(),
        listAgentRules(),
      ])

      setAccounts(accountsResponse.accounts)
      setAgents(agentsResponse.rules)
      setSelectedAgentId((current) => {
        if (current === 'new') {
          return 'new'
        }
        return agentsResponse.rules.some((agent) => agent.id === current)
          ? current
          : agentsResponse.rules[0]?.id ?? 'new'
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载 Agent 配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    if (selectedAgentId === 'new') {
      setForm((current) => {
        const accountId = current.accountId || accounts[0]?.id || ''
        return current.id
          ? createEmptyAgent(accountId)
          : { ...current, accountId, accountIds: current.accountIds.length ? current.accountIds : accountId ? [accountId] : [] }
      })
      return
    }

    const agent = agents.find((item) => item.id === selectedAgentId)
    if (agent) {
      setForm(mapRuleToForm(agent))
    }
  }, [accounts, agents, selectedAgentId])

  function updateForm(next: Partial<AgentFormValue>) {
    setForm((current) => ({ ...current, ...next }))
  }

  function updatePurpose(purpose: AgentFormValue['purpose']) {
    setForm((current) => ({
      ...current,
      purpose,
      providerType: purpose === 'translation' ? 'openai_compatible' : current.providerType,
      promptTemplate:
        current.promptTemplate === defaultReplyPrompt || current.promptTemplate === defaultTranslationPrompt
          ? purpose === 'translation'
            ? defaultTranslationPrompt
            : defaultReplyPrompt
          : current.promptTemplate,
    }))
  }

  function updateAccountSelection(accountId: string, checked: boolean) {
    setForm((current) => {
      const accountIds = checked
        ? normalizeSelectedAccountIds([...current.accountIds, accountId], current.accountId)
        : current.accountIds.filter((value) => value !== accountId)
      return {
        ...current,
        accountIds,
        accountId: accountIds[0] ?? '',
      }
    })
  }

  function handleCreateAgent() {
    setSelectedAgentId('new')
    setForm(createEmptyAgent(accounts[0]?.id ?? ''))
    setError(undefined)
    setNotice(undefined)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    setNotice(undefined)

    const validationError = validateAgentForm(form)
    if (validationError) {
      setError(validationError)
      return
    }

    setSubmitting(true)
    try {
      const accountIds = normalizeSelectedAccountIds(form.accountIds, form.accountId)
      const response = await upsertAgentRule({
        id: form.id,
        account_id: accountIds[0],
        account_ids: accountIds,
        purpose: form.purpose,
        name: form.name.trim(),
        enabled: true,
        scope_filter: {
          chat_ids: [],
          chat_types: [],
        },
        trigger_filter: {
          keywords: [],
          match_mode: 'any',
          ignore_from_me: true,
          min_message_chars: 0,
        },
        reply_mode: 'suggest',
        cooldown_seconds: 300,
        max_auto_replies_per_thread: 0,
        blacklist_filter: {
          blocked_keywords: [],
          sensitive_topics: [],
        },
        prompt_template: form.promptTemplate.trim(),
        provider_config: buildProviderConfig(form),
      })

      await loadData()
      setSelectedAgentId(response.rule.id)
      setNotice('Agent 已保存，可以在右侧对话辅助里手动生成回复建议。')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存 Agent 失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteAgent() {
    if (!selectedAgent) {
      return
    }

    const confirmed = window.confirm(`确定删除 Agent「${selectedAgent.name}」吗？`)
    if (!confirmed) {
      return
    }

    setDeleting(true)
    setError(undefined)
    setNotice(undefined)

    try {
      await deleteAgentRule(selectedAgent.id)
      await loadData()
      handleCreateAgent()
      setNotice(`Agent 已删除：${selectedAgent.name}`)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除 Agent 失败')
    } finally {
      setDeleting(false)
    }
  }

  if (loading && accounts.length === 0) {
    return (
      <div className="page page-agents">
        <section className="panel agent-loading-panel">
          <p className="eyebrow">智能回复</p>
          <h3>正在加载 Agent 配置</h3>
        </section>
      </div>
    )
  }

  if (!loading && accounts.length === 0) {
    return (
      <div className="page page-agents">
        <EmptyPanel
          title="还没有可绑定的账号"
          description="先去账号接入页面创建并接入一个 WhatsApp 账号。"
        />
        {error ? <div className="error-banner">{error}</div> : null}
      </div>
    )
  }

  return (
    <div className="page page-agents">
      <header className="agent-page-header">
        <div>
          <p className="eyebrow">智能回复</p>
          <h2>智能回复 Agent</h2>
        </div>
        <button className="primary-button" type="button" onClick={handleCreateAgent}>
          <Icon name="plus" />
          新建 Agent
        </button>
      </header>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <section className="agent-config-layout">
        <aside className="panel agent-list-panel">
          <div className="panel-heading agent-list-heading">
            <div>
              <p className="eyebrow">Agent</p>
              <h3>{agents.length} 个接入</h3>
            </div>
          </div>

          {agents.length > 0 ? (
            <div className="agent-list-scroll">
              {agents.map((agent) => {
                const providerType = normalizeProviderType(readConfigString(agent.provider_config ?? {}, 'type'))
                const accountLabel =
                  agent.account_ids?.length > 1
                    ? `${agent.account_ids.length} 个账号`
                    : accountNameMap.get(agent.account_id) || agent.account_id
                return (
                  <button
                    key={agent.id}
                    type="button"
                    className={`agent-list-item${selectedAgentId === agent.id ? ' selected' : ''}`}
                    onClick={() => setSelectedAgentId(agent.id)}
                  >
                    <span className="agent-list-title">{agent.name}</span>
                    <span className="agent-list-account">
                      {agent.purpose === 'translation' ? '翻译 Agent' : '回复 Agent'} · {accountLabel}
                    </span>
                    <span className="agent-list-meta">
                      <span>{getProviderLabel(providerType)}</span>
                      <span>{formatDateTime(agent.updated_at)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="agent-list-empty">
              <strong>还没有 Agent</strong>
              <span>创建一个大模型、Coze、n8n 或 Webhook 接入。</span>
              <button className="primary-button" type="button" onClick={handleCreateAgent}>
                <Icon name="plus" />
                新建 Agent
              </button>
            </div>
          )}
        </aside>

        <section className="panel agent-config-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{form.id ? '编辑 Agent' : '新建 Agent'}</p>
              <h3>{form.name.trim() || '未命名 Agent'}</h3>
            </div>
            <span className="toolbar-chip active">{getProviderLabel(form.providerType)}</span>
          </div>

          <form className="agent-config-form" onSubmit={handleSubmit}>
            <div className="two-column-grid">
              <label className="field">
                <span>Agent 名称</span>
                <input
                  value={form.name}
                  onChange={(event) => updateForm({ name: event.target.value })}
                  placeholder="例如：售前客服 Agent"
                />
              </label>

              <div className="field">
                <span>绑定账号</span>
                <div className="agent-account-checklist">
                  {accounts.map((account) => (
                    <label key={account.id} className="checkbox-row agent-account-option">
                      <input
                        type="checkbox"
                        checked={form.accountIds.includes(account.id)}
                        onChange={(event) => updateAccountSelection(account.id, event.target.checked)}
                      />
                      <span>{account.display_name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="agent-provider-tabs agent-purpose-tabs" role="tablist" aria-label="Agent 用途">
              <button
                type="button"
                className={`agent-provider-tab${form.purpose === 'reply' ? ' active' : ''}`}
                onClick={() => updatePurpose('reply')}
                aria-pressed={form.purpose === 'reply'}
              >
                <strong>回复 Agent</strong>
                <span>生成客服草稿</span>
              </button>
              <button
                type="button"
                className={`agent-provider-tab${form.purpose === 'translation' ? ' active' : ''}`}
                onClick={() => updatePurpose('translation')}
                aria-pressed={form.purpose === 'translation'}
              >
                <strong>翻译 Agent</strong>
                <span>语言检测 + 翻译</span>
              </button>
            </div>

            <div className="agent-provider-tabs" role="tablist" aria-label="Agent 接入方式">
              {providerOptions
                .filter((option) => form.purpose === 'reply' || option.value === 'openai_compatible')
                .map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`agent-provider-tab${form.providerType === option.value ? ' active' : ''}`}
                  onClick={() => updateForm({ providerType: option.value })}
                  aria-pressed={form.providerType === option.value}
                >
                  <strong>{option.label}</strong>
                  <span>{option.badge}</span>
                </button>
              ))}
            </div>

            {form.providerType === 'openai_compatible' ? (
              <div className="agent-provider-fields">
                <div className="two-column-grid">
                  <label className="field">
                    <span>Model</span>
                    <input
                      value={form.model}
                      onChange={(event) => updateForm({ model: event.target.value })}
                      placeholder="gpt-4o-mini"
                    />
                  </label>

                  <label className="field">
                    <span>Base URL</span>
                    <input
                      value={form.baseUrl}
                      onChange={(event) => updateForm({ baseUrl: event.target.value })}
                      placeholder="https://api.openai.com/v1"
                    />
                  </label>
                </div>

                <label className="field">
                  <span>API Key</span>
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(event) => updateForm({ apiKey: event.target.value })}
                    placeholder="sk-..."
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
                    placeholder="https://..."
                  />
                </label>

                <div className="two-column-grid">
                  <label className="field">
                    <span>Authorization</span>
                    <input
                      value={form.authorization}
                      onChange={(event) => updateForm({ authorization: event.target.value })}
                      placeholder="Bearer ..."
                    />
                  </label>

                  <label className="field">
                    <span>API Key</span>
                    <input
                      type="password"
                      value={form.apiKey}
                      onChange={(event) => updateForm({ apiKey: event.target.value })}
                      placeholder="不填则使用 Authorization"
                    />
                  </label>
                </div>

                <div className="agent-advanced-grid">
                  <label className="field compact-field">
                    <span>Method</span>
                    <select
                      value={form.method}
                      onChange={(event) => updateForm({ method: event.target.value })}
                    >
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
                      placeholder="draft"
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

            <label className="field agent-prompt-field">
              <span>提示词</span>
              <textarea
                rows={8}
                value={form.promptTemplate}
                onChange={(event) => updateForm({ promptTemplate: event.target.value })}
                placeholder="写清楚 Agent 的角色、语气、边界和回复格式"
              />
            </label>

            <div className="button-row agent-config-actions">
              <button className="primary-button" type="submit" disabled={submitting}>
                <Icon name="save" />
                {submitting ? '保存中...' : form.id ? '保存 Agent' : '创建 Agent'}
              </button>
              {form.id ? (
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => void handleDeleteAgent()}
                  disabled={deleting || submitting}
                >
                  <Icon name="delete" />
                  {deleting ? '删除中...' : '删除 Agent'}
                </button>
              ) : null}
            </div>
          </form>
        </section>
      </section>
    </div>
  )
}
