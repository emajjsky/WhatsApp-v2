import { type FormEvent, useMemo, useState } from 'react'
import type {
  AccountView,
  AgentMatchMode,
  AgentReplyMode,
  ChatSummary,
  ChatType,
} from '../api/client'
import { StatusBadge } from './StatusBadge'

const chatTypeOptions: Array<{ value: ChatType; label: string }> = [
  { value: 'direct', label: '单聊' },
  { value: 'group', label: '群聊' },
  { value: 'broadcast', label: '广播' },
  { value: 'status', label: '状态' },
]

const matchModeOptions: Array<{ value: AgentMatchMode; label: string }> = [
  { value: 'any', label: '命中任一关键词' },
  { value: 'all', label: '必须命中全部关键词' },
]

const editorSections = [
  { id: 'basic', label: '基础' },
  { id: 'scope', label: '范围' },
  { id: 'trigger', label: '触发' },
  { id: 'prompt', label: '提示词' },
  { id: 'safety', label: '安全' },
] as const

type EditorSection = (typeof editorSections)[number]['id']

export interface RuleEditorValue {
  id?: string
  accountId: string
  name: string
  enabled: boolean
  replyMode: AgentReplyMode
  scopeChatTypes: ChatType[]
  scopeChatIds: string[]
  triggerKeywordsText: string
  matchMode: AgentMatchMode
  ignoreFromMe: boolean
  minMessageChars: number
  cooldownSeconds: number
  maxAutoRepliesPerThread: number
  blockedKeywordsText: string
  sensitiveTopicsText: string
  promptTemplate: string
  knowledgeSummary: string
  knowledgeReferencesText: string
}

interface RuleEditorProps {
  accounts: AccountView[]
  chats: ChatSummary[]
  value: RuleEditorValue
  submitting: boolean
  onChange: (next: RuleEditorValue) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  canCancel: boolean
}

export function RuleEditor({
  accounts,
  chats,
  value,
  submitting,
  onChange,
  onSubmit,
  onCancel,
  canCancel,
}: RuleEditorProps) {
  const [activeSection, setActiveSection] = useState<EditorSection>('basic')
  const [chatPicker, setChatPicker] = useState('')

  const accountChats = useMemo(
    () => chats.filter((chat) => chat.account_id === value.accountId),
    [chats, value.accountId],
  )
  const remainingChats = useMemo(
    () => accountChats.filter((chat) => !value.scopeChatIds.includes(chat.id)),
    [accountChats, value.scopeChatIds],
  )
  const selectedChatId = remainingChats.some((chat) => chat.id === chatPicker)
    ? chatPicker
    : remainingChats[0]?.id ?? ''

  function update(next: Partial<RuleEditorValue>) {
    onChange({ ...value, ...next })
  }

  function updateReplyMode(replyMode: AgentReplyMode) {
    if (replyMode === 'manual') {
      update({ replyMode, enabled: false })
      return
    }
    if (replyMode === 'auto_send') {
      update({
        replyMode,
        enabled: false,
        cooldownSeconds: value.cooldownSeconds || 300,
        maxAutoRepliesPerThread: value.maxAutoRepliesPerThread || 1,
      })
      return
    }

    update({ replyMode })
  }

  function toggleChatType(chatType: ChatType) {
    if (value.scopeChatTypes.includes(chatType)) {
      update({ scopeChatTypes: value.scopeChatTypes.filter((item) => item !== chatType) })
      return
    }

    update({ scopeChatTypes: [...value.scopeChatTypes, chatType] })
  }

  function addScopedChat() {
    if (!selectedChatId || value.scopeChatIds.includes(selectedChatId)) {
      return
    }

    update({ scopeChatIds: [...value.scopeChatIds, selectedChatId] })
    setChatPicker('')
  }

  function removeScopedChat(chatId: string) {
    update({ scopeChatIds: value.scopeChatIds.filter((item) => item !== chatId) })
  }

  function getScopedChatLabel(chatId: string) {
    const chat = chats.find((item) => item.id === chatId)
    return chat?.title || chat?.wa_chat_jid || chatId
  }

  return (
    <section className="panel agent-editor-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">规则编辑</p>
          <h3>{value.id ? '修改当前规则' : '新建规则草稿'}</h3>
        </div>
        <div className="chip-row">
          <StatusBadge status={value.enabled ? 'enabled' : 'disabled'} />
          <StatusBadge status={value.replyMode} />
        </div>
      </div>

      <form className="form-grid agent-editor-form agent-editor-form-modern" onSubmit={onSubmit}>
        <div className="choice-grid agent-mode-grid">
          <button
            type="button"
            className={`mode-card${value.replyMode === 'manual' ? ' active' : ''}`}
            onClick={() => updateReplyMode('manual')}
          >
            <div className="mode-card-header">
              <strong>手动记录</strong>
              <StatusBadge status="manual" />
            </div>
            <p>只保存适用范围、提示词和风控边界，不调用模型。</p>
          </button>

          <button
            type="button"
            className={`mode-card${value.replyMode === 'suggest' ? ' active' : ''}`}
            onClick={() => updateReplyMode('suggest')}
          >
            <div className="mode-card-header">
              <strong>生成草稿</strong>
              <StatusBadge status="suggest" />
            </div>
            <p>命中规则后生成待审核草稿，由你决定写回或发送。</p>
          </button>

          <button
            type="button"
            className={`mode-card${value.replyMode === 'auto_send' ? ' active danger' : ''}`}
            onClick={() => updateReplyMode('auto_send')}
          >
            <div className="mode-card-header">
              <strong>允许自动发送</strong>
              <StatusBadge status="auto_send" />
            </div>
            <p>保存后仍保持停用，需要在左侧列表里手动启用。</p>
          </button>
        </div>

        <div className="agent-editor-section-tabs" role="tablist" aria-label="规则配置分段">
          {editorSections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`section-tab${activeSection === section.id ? ' active' : ''}`}
              onClick={() => setActiveSection(section.id)}
              aria-pressed={activeSection === section.id}
            >
              {section.label}
            </button>
          ))}
        </div>

        <div className="agent-editor-section-body">
          {activeSection === 'basic' ? (
            <section className="helper-card agent-section-card">
              <div className="two-column-grid">
                <label className="field">
                  <span>绑定账号</span>
                  <select
                    value={value.accountId}
                    onChange={(event) =>
                      update({
                        accountId: event.target.value,
                        scopeChatIds: value.scopeChatIds.filter((chatId) =>
                          chats.some(
                            (chat) => chat.id === chatId && chat.account_id === event.target.value,
                          ),
                        ),
                      })
                    }
                  >
                    {accounts.length === 0 ? <option value="">没有可用账号</option> : null}
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.display_name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>规则名称</span>
                  <input
                    value={value.name}
                    onChange={(event) => update({ name: event.target.value })}
                    placeholder="例如：售前咨询回复"
                  />
                </label>
              </div>

              {value.replyMode !== 'auto_send' ? (
                <label className="checkbox-row agent-enable-row">
                  <input
                    type="checkbox"
                    checked={value.enabled}
                    onChange={(event) => update({ enabled: event.target.checked })}
                    disabled={value.replyMode === 'manual'}
                  />
                  <span>{value.replyMode === 'manual' ? '手动记录不需要启用' : '保存后启用这条规则'}</span>
                </label>
              ) : (
                <div className="warning-banner">
                  自动发送规则保存后会保持停用，需要你在左侧规则列表里再次启用。
                </div>
              )}
            </section>
          ) : null}

          {activeSection === 'scope' ? (
            <section className="helper-card agent-section-card">
              <strong>适用范围</strong>
              <div className="chip-row">
                {chatTypeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`chip-button${value.scopeChatTypes.includes(option.value) ? ' active' : ''}`}
                    onClick={() => toggleChatType(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="inline-select-row">
                <select value={selectedChatId} onChange={(event) => setChatPicker(event.target.value)}>
                  <option value="">选择固定会话</option>
                  {remainingChats.map((chat) => (
                    <option key={chat.id} value={chat.id}>
                      {chat.title || chat.wa_chat_jid}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={addScopedChat}
                  disabled={!selectedChatId}
                >
                  加入范围
                </button>
              </div>

              {value.scopeChatIds.length > 0 ? (
                <div className="token-list">
                  {value.scopeChatIds.map((chatId) => (
                    <button
                      key={chatId}
                      type="button"
                      className="token-button"
                      onClick={() => removeScopedChat(chatId)}
                    >
                      {getScopedChatLabel(chatId)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="subtle-text">未指定固定会话时，会按聊天类型生效。</p>
              )}
            </section>
          ) : null}

          {activeSection === 'trigger' ? (
            <section className="helper-card agent-section-card">
              <div className="two-column-grid agent-editor-split">
                <label className="field">
                  <span>关键词，每行一个</span>
                  <textarea
                    rows={8}
                    value={value.triggerKeywordsText}
                    onChange={(event) => update({ triggerKeywordsText: event.target.value })}
                    placeholder={'价格\n发货\n库存'}
                  />
                </label>

                <div className="form-grid">
                  <label className="field">
                    <span>命中方式</span>
                    <select
                      value={value.matchMode}
                      onChange={(event) => update({ matchMode: event.target.value as AgentMatchMode })}
                    >
                      {matchModeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>最少消息字数</span>
                    <input
                      type="number"
                      min={0}
                      value={value.minMessageChars}
                      onChange={(event) => update({ minMessageChars: Number(event.target.value || 0) })}
                    />
                  </label>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={value.ignoreFromMe}
                      onChange={(event) => update({ ignoreFromMe: event.target.checked })}
                    />
                    <span>忽略我方自己发出的消息</span>
                  </label>
                </div>
              </div>
            </section>
          ) : null}

          {activeSection === 'prompt' ? (
            <section className="helper-card agent-section-card">
              <label className="field">
                <span>规则级提示词覆盖</span>
                <textarea
                  rows={7}
                  value={value.promptTemplate}
                  onChange={(event) => update({ promptTemplate: event.target.value })}
                  placeholder="留空时使用账号级 AI 配置里的全局提示词。"
                />
              </label>

              <div className="two-column-grid agent-editor-split">
                <label className="field">
                  <span>知识摘要</span>
                  <textarea
                    rows={5}
                    value={value.knowledgeSummary}
                    onChange={(event) => update({ knowledgeSummary: event.target.value })}
                    placeholder="例如：退换货说明、营业时间、物流话术。"
                  />
                </label>

                <label className="field">
                  <span>参考资料，每行一个</span>
                  <textarea
                    rows={5}
                    value={value.knowledgeReferencesText}
                    onChange={(event) => update({ knowledgeReferencesText: event.target.value })}
                    placeholder={'退货政策文档\n运费说明\n售后 SOP'}
                  />
                </label>
              </div>
            </section>
          ) : null}

          {activeSection === 'safety' ? (
            <section className="helper-card agent-section-card">
              <div className="two-column-grid agent-editor-split">
                <div className="form-grid">
                  <label className="field">
                    <span>冷却时间（秒）</span>
                    <input
                      type="number"
                      min={0}
                      value={value.cooldownSeconds}
                      onChange={(event) => update({ cooldownSeconds: Number(event.target.value || 0) })}
                    />
                  </label>

                  <label className="field">
                    <span>单个聊天最多自动回复次数</span>
                    <input
                      type="number"
                      min={0}
                      value={value.maxAutoRepliesPerThread}
                      onChange={(event) =>
                        update({ maxAutoRepliesPerThread: Number(event.target.value || 0) })
                      }
                    />
                  </label>
                </div>

                <div className="form-grid">
                  <label className="field">
                    <span>禁止词，每行一个</span>
                    <textarea
                      rows={5}
                      value={value.blockedKeywordsText}
                      onChange={(event) => update({ blockedKeywordsText: event.target.value })}
                      placeholder={'退款\n赔偿\n验证码'}
                    />
                  </label>

                  <label className="field">
                    <span>敏感主题，每行一个</span>
                    <textarea
                      rows={5}
                      value={value.sensitiveTopicsText}
                      onChange={(event) => update({ sensitiveTopicsText: event.target.value })}
                      placeholder={'支付\n法务\n账号安全'}
                    />
                  </label>
                </div>
              </div>
            </section>
          ) : null}
        </div>

        {value.replyMode === 'manual' ? (
          <div className="warning-banner">
            当前是手动记录模式：系统不会生成草稿，也不会自动发送。
          </div>
        ) : null}

        {value.replyMode === 'auto_send' ? (
          <div className="warning-banner">
            自动发送需要额外启用；建议先用“生成草稿”跑通，再切到自动发送。
          </div>
        ) : null}

        <div className="button-row agent-editor-actions">
          <button className="primary-button" type="submit" disabled={submitting || accounts.length === 0}>
            {submitting ? '正在保存...' : value.id ? '保存规则' : '创建规则'}
          </button>
          {canCancel ? (
            <button className="secondary-button" type="button" onClick={onCancel} disabled={submitting}>
              撤销本次修改
            </button>
          ) : null}
        </div>
      </form>
    </section>
  )
}
