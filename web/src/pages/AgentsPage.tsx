import { type FormEvent, useEffect, useState } from 'react'
import {
  disableAgentRule,
  enableAgentRule,
  listAccounts,
  listAgentRuns,
  listAgentRules,
  listChats,
  upsertAgentRule,
  type AccountView,
  type AgentKnowledgeBinding,
  type AgentRuleView,
  type AgentRunView,
  type ChatSummary,
} from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { PageHeader } from '../components/PageHeader'
import { RuleEditor, type RuleEditorValue } from '../components/RuleEditor'
import { StatusBadge } from '../components/StatusBadge'

function createEmptyDraft(defaultAccountId: string): RuleEditorValue {
  return {
    accountId: defaultAccountId,
    name: '',
    enabled: false,
    replyMode: 'suggest',
    scopeChatTypes: ['direct'],
    scopeChatIds: [],
    triggerKeywordsText: '',
    matchMode: 'any',
    ignoreFromMe: true,
    minMessageChars: 0,
    cooldownSeconds: 300,
    maxAutoRepliesPerThread: 1,
    blockedKeywordsText: '',
    sensitiveTopicsText: '支付\n退款\n账号安全\n法律投诉',
    promptTemplate:
      '你是客服助手。请根据聊天上下文，用简短、礼貌、准确的中文给出回复。遇到支付、退款、账号安全、法律投诉时，只能建议人工接手，不要自己承诺结果。',
    knowledgeSummary: '',
    knowledgeReferencesText: '',
  }
}

function mapRuleToDraft(rule: AgentRuleView): RuleEditorValue {
  return {
    id: rule.id,
    accountId: rule.account_id,
    name: rule.name,
    enabled: rule.enabled,
    replyMode: rule.reply_mode,
    scopeChatTypes: rule.scope_filter.chat_types,
    scopeChatIds: rule.scope_filter.chat_ids,
    triggerKeywordsText: rule.trigger_filter.keywords.join('\n'),
    matchMode: rule.trigger_filter.match_mode,
    ignoreFromMe: rule.trigger_filter.ignore_from_me,
    minMessageChars: rule.trigger_filter.min_message_chars,
    cooldownSeconds: rule.cooldown_seconds,
    maxAutoRepliesPerThread: rule.max_auto_replies_per_thread,
    blockedKeywordsText: rule.blacklist_filter.blocked_keywords.join('\n'),
    sensitiveTopicsText: rule.blacklist_filter.sensitive_topics.join('\n'),
    promptTemplate: rule.prompt_template,
    knowledgeSummary: rule.knowledge_binding?.summary ?? '',
    knowledgeReferencesText: rule.knowledge_binding?.references.join('\n') ?? '',
  }
}

function splitList(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
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
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [rules, setRules] = useState<AgentRuleView[]>([])
  const [runs, setRuns] = useState<AgentRunView[]>([])
  const [runTotal, setRunTotal] = useState(0)
  const [selectedRuleId, setSelectedRuleId] = useState<string>('new')
  const [draft, setDraft] = useState<RuleEditorValue>(createEmptyDraft(''))
  const [loading, setLoading] = useState(true)
  const [refreshingRuns, setRefreshingRuns] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  async function loadRuns() {
    setRefreshingRuns(true)
    try {
      const response = await listAgentRuns({ limit: 12 })
      setRuns(response.runs)
      setRunTotal(response.total)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载运行记录失败')
    } finally {
      setRefreshingRuns(false)
    }
  }

  async function loadData() {
    setLoading(true)
    setError(undefined)

    try {
      const [accountsResponse, chatsResponse, rulesResponse, runsResponse] = await Promise.all([
        listAccounts(),
        listChats({ limit: 200 }),
        listAgentRules(),
        listAgentRuns({ limit: 12 }),
      ])

      setAccounts(accountsResponse.accounts)
      setChats(chatsResponse.chats)
      setRules(rulesResponse.rules)
      setRuns(runsResponse.runs)
      setRunTotal(runsResponse.total)
      setSelectedRuleId((current) => {
        if (current === 'new') {
          return 'new'
        }
        return rulesResponse.rules.some((rule) => rule.id === current)
          ? current
          : rulesResponse.rules[0]?.id ?? 'new'
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载 Agent 页面失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    if (selectedRuleId === 'new') {
      setDraft((current) =>
        current.accountId ? current : createEmptyDraft(accounts[0]?.id ?? ''),
      )
      return
    }

    const selectedRule = rules.find((rule) => rule.id === selectedRuleId)
    if (selectedRule) {
      setDraft(mapRuleToDraft(selectedRule))
    }
  }, [accounts, rules, selectedRuleId])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    setNotice(undefined)

    const references = splitList(draft.knowledgeReferencesText)
    const knowledgeBinding: AgentKnowledgeBinding | undefined =
      draft.knowledgeSummary.trim() || references.length > 0
        ? {
            summary: draft.knowledgeSummary.trim() || undefined,
            references,
          }
        : undefined

    try {
      const response = await upsertAgentRule({
        id: draft.id,
        account_id: draft.accountId,
        name: draft.name,
        enabled: draft.enabled,
        scope_filter: {
          chat_ids: draft.scopeChatIds,
          chat_types: draft.scopeChatTypes,
        },
        trigger_filter: {
          keywords: splitList(draft.triggerKeywordsText),
          match_mode: draft.matchMode,
          ignore_from_me: draft.ignoreFromMe,
          min_message_chars: draft.minMessageChars,
        },
        reply_mode: draft.replyMode,
        cooldown_seconds: draft.cooldownSeconds,
        max_auto_replies_per_thread: draft.maxAutoRepliesPerThread,
        blacklist_filter: {
          blocked_keywords: splitList(draft.blockedKeywordsText),
          sensitive_topics: splitList(draft.sensitiveTopicsText),
        },
        prompt_template: draft.promptTemplate,
        knowledge_binding: knowledgeBinding,
      })

      await loadData()
      setSelectedRuleId(response.rule.id)
      setNotice(
        response.rule.reply_mode === 'auto_send' && !response.rule.enabled
          ? '规则已保存。因为它是自动发送模式，所以仍保持停用，需要你回到左侧再手动启用。'
          : '规则已保存。',
      )
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存规则失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleToggleRule(rule: AgentRuleView) {
    setError(undefined)
    setNotice(undefined)

    try {
      if (rule.enabled) {
        await disableAgentRule(rule.id)
        setNotice(`已停用规则：${rule.name}`)
      } else {
        await enableAgentRule(rule.id)
        setNotice(`已启用规则：${rule.name}`)
      }

      await loadData()
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : '切换规则状态失败')
    }
  }

  function handleCreateRule() {
    setSelectedRuleId('new')
    setDraft(createEmptyDraft(accounts[0]?.id ?? ''))
    setNotice(undefined)
    setError(undefined)
  }

  function handleCancelEdit() {
    setError(undefined)
    setNotice(undefined)

    if (selectedRuleId === 'new') {
      setDraft(createEmptyDraft(accounts[0]?.id ?? ''))
      return
    }

    const selectedRule = rules.find((rule) => rule.id === selectedRuleId)
    if (selectedRule) {
      setDraft(mapRuleToDraft(selectedRule))
    }
  }

  const enabledRuleCount = rules.filter((rule) => rule.enabled).length
  const autoSendRuleCount = rules.filter((rule) => rule.reply_mode === 'auto_send').length
  const blockedRunCount = runs.filter((run) => run.status === 'blocked').length
  const accountNameMap = new Map(accounts.map((account) => [account.id, account.display_name]))

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Agent 规则"
        title="先把回复边界写清楚，再决定要不要让系统自己发"
        description="这里已经能创建规则、启停规则、查看运行记录。页面默认偏保守，尽量避免新手员工一上来就把自动发送开到飞起。"
        aside={
          <div className="header-meta-card">
            <span>已启用规则</span>
            <strong>{loading ? '...' : enabledRuleCount}</strong>
          </div>
        }
      />

      <section className="hero-strip">
        <div className="hero-copy">
          <p className="eyebrow">推荐顺序</p>
          <h3>先写建议规则，再观察，再决定是否升级到自动发送</h3>
          <p>
            这页把“规则配置”“启停开关”“运行记录”拆成了三个清晰区块。新人不用理解底层协议，只要按顺序走就不容易出错。
          </p>
        </div>
        <div className="hero-steps">
          <article className="hero-step">
            <span>01</span>
            <h4>先建草稿</h4>
            <p>先让系统给建议稿，不自动发送，确认话术没问题。</p>
          </article>
          <article className="hero-step">
            <span>02</span>
            <h4>看运行记录</h4>
            <p>观察有没有被拦截、有没有误触发，再收紧规则范围。</p>
          </article>
          <article className="hero-step">
            <span>03</span>
            <h4>最后才启用</h4>
            <p>自动发送规则保存后默认仍停用，必须再手动点一次启用。</p>
          </article>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card">
          <span>规则总数</span>
          <strong>{loading ? '...' : rules.length}</strong>
          <p>建议先从少量规则开始，一条一条验证，不要一口气铺满整套客服场景。</p>
        </article>
        <article className="metric-card">
          <span>自动发送规则</span>
          <strong>{loading ? '...' : autoSendRuleCount}</strong>
          <p>自动发送越多，越要看冷却时间、敏感主题和运行记录，不然很容易翻车。</p>
        </article>
        <article className="metric-card">
          <span>最近拦截记录</span>
          <strong>{loading ? '...' : blockedRunCount}</strong>
          <p>拦截不是坏事，它是在提醒你这条规则还不够稳。</p>
        </article>
      </section>

      {!loading && accounts.length === 0 ? (
        <EmptyPanel
          title="还没有可绑定的账号"
          description="先去“账号接入”页面创建并接入一个 WhatsApp 账号，再回来配置 Agent 规则。"
        />
      ) : (
        <section className="agent-layout">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">规则列表</p>
                <h3>左侧挑规则，右侧改内容</h3>
              </div>
              <button className="primary-button" type="button" onClick={handleCreateRule}>
                新建规则草案
              </button>
            </div>

            {rules.length > 0 ? (
              <div className="rule-list">
                {rules.map((rule) => (
                  <article
                    key={rule.id}
                    className={`rule-card${selectedRuleId === rule.id ? ' selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="rule-card-button"
                      onClick={() => setSelectedRuleId(rule.id)}
                    >
                      <div className="rule-card-header">
                        <div>
                          <strong>{rule.name}</strong>
                          <p>{accountNameMap.get(rule.account_id) || rule.account_id}</p>
                        </div>
                        <div className="chip-row">
                          <StatusBadge status={rule.enabled ? 'enabled' : 'disabled'} />
                          <StatusBadge status={rule.reply_mode} />
                        </div>
                      </div>

                      <p className="subtle-text">
                        关键词 {rule.trigger_filter.keywords.length} 个，固定聊天 {rule.scope_filter.chat_ids.length} 个，
                        更新于 {formatDateTime(rule.updated_at)}
                      </p>
                    </button>

                    <div className="button-row">
                      <button
                        type="button"
                        className={rule.enabled ? 'danger-button' : 'secondary-button'}
                        onClick={() => void handleToggleRule(rule)}
                      >
                        {rule.enabled ? '停用规则' : '启用规则'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyPanel
                title="还没有规则"
                description="先点上面的“新建规则草案”。建议先做建议稿模式，别一上来就自动发送。"
              />
            )}
          </article>

          <RuleEditor
            accounts={accounts}
            chats={chats}
            value={draft}
            submitting={submitting}
            onChange={setDraft}
            onSubmit={handleSubmit}
            onCancel={handleCancelEdit}
            canCancel={Boolean(draft.id || draft.name || draft.triggerKeywordsText || draft.promptTemplate)}
          />
        </section>
      )}

      <section className="two-column-grid">
        <article className="panel danger-panel">
          <p className="eyebrow">启用前检查</p>
          <h3>这些问题没想明白，就别开自动发送</h3>
          <ul className="plain-list">
            <li>涉及支付、退款、账号找回、法律投诉时，规则是否明确要求转人工。</li>
            <li>冷却时间和单个聊天自动回复次数，是否足够保守。</li>
            <li>关键词是否会误伤日常聊天，导致无关消息也被触发。</li>
          </ul>
        </article>

        <article className="panel">
          <p className="eyebrow">给新人的建议</p>
          <h3>先观察一轮，再逐步放开</h3>
          <ul className="plain-list">
            <li>先用“建议草稿”模式跑两天，看看客服是否愿意采纳这些话术。</li>
            <li>每次只改一条规则，避免多条规则同时变更后不知道是谁惹的祸。</li>
            <li>运行记录里只要频繁出现“已拦截”，就该回头收紧规则。</li>
          </ul>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">运行记录</p>
            <h3>最近 12 条 Agent 执行结果</h3>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void loadRuns()}
            disabled={refreshingRuns}
          >
            {refreshingRuns ? '刷新中...' : '刷新记录'}
          </button>
        </div>

        {runs.length > 0 ? (
          <div className="run-list">
            {runs.map((run) => (
              <article key={run.id} className="run-card">
                <div className="panel-heading">
                  <div>
                    <strong>{run.rule_name}</strong>
                    <p>{run.chat_title || run.wa_chat_jid || run.chat_id}</p>
                  </div>
                  <StatusBadge status={run.status} />
                </div>

                <p className="subtle-text">触发时间：{formatDateTime(run.created_at)}</p>
                {run.trigger_preview ? <p>触发消息：{run.trigger_preview}</p> : null}
                {run.output_draft ? <p>生成草稿：{run.output_draft}</p> : null}
                {run.block_reason ? <div className="warning-banner">{run.block_reason}</div> : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyPanel
            title="暂时还没有运行记录"
            description="等后面的 agent_runner 接进来后，这里会显示每次建议回复、拦截原因和发送结果。"
          />
        )}

        <p className="subtle-text">当前已加载 {runs.length} 条记录，后台总数 {runTotal}。</p>
      </section>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  )
}
