import { type FormEvent, useState } from 'react'
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

interface MatchModeOption {
  value: AgentMatchMode
  label: string
}

const matchModeOptions: MatchModeOption[] = [
  { value: 'any', label: '命中任一关键词即可' },
  { value: 'all', label: '必须同时命中所有关键词' },
]

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
  const [chatPicker, setChatPicker] = useState('')

  const accountChats = chats.filter((chat) => chat.account_id === value.accountId)
  const remainingChats = accountChats.filter((chat) => !value.scopeChatIds.includes(chat.id))

  const selectedChatId = remainingChats.some((chat) => chat.id === chatPicker)
    ? chatPicker
    : remainingChats[0]?.id ?? ''

  function update(next: Partial<RuleEditorValue>) {
    onChange({ ...value, ...next })
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
  }

  function removeScopedChat(chatId: string) {
    update({ scopeChatIds: value.scopeChatIds.filter((item) => item !== chatId) })
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">规则编辑</p>
          <h3>{value.id ? '修改当前规则' : '新建一条规则草案'}</h3>
        </div>
        <div className="chip-row">
          <StatusBadge status={value.enabled ? 'enabled' : 'disabled'} />
          <StatusBadge status={value.replyMode} />
        </div>
      </div>

      <form className="form-grid" onSubmit={onSubmit}>
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
              placeholder="例如：售前咨询建议回复"
            />
          </label>
        </div>

        <div className="choice-grid">
          <button
            type="button"
            className={`mode-card${value.replyMode === 'suggest' ? ' active' : ''}`}
            onClick={() => update({ replyMode: 'suggest', enabled: value.id ? value.enabled : false })}
          >
            <div className="mode-card-header">
              <strong>先出建议草稿</strong>
              <StatusBadge status="suggest" />
            </div>
            <p>系统只给建议，不会自己发出去。适合新手员工先练手，也适合高风险场景。</p>
          </button>

          <button
            type="button"
            className={`mode-card${value.replyMode === 'auto_send' ? ' active danger' : ''}`}
            onClick={() => update({ replyMode: 'auto_send', enabled: false })}
          >
            <div className="mode-card-header">
              <strong>允许自动发送</strong>
              <StatusBadge status="auto_send" />
            </div>
            <p>保存后仍保持停用，需要你回到左侧手动启用。这是故意做的二次确认，不会偷着开。</p>
          </button>
        </div>

        <div className="two-column-grid">
          <section className="helper-card">
            <strong>适用范围</strong>
            <p>先选聊天类型，再决定是否缩小到某几个固定聊天。</p>
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
                <option value="">选择一个固定聊天</option>
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
                {value.scopeChatIds.map((chatId) => {
                  const chat = chats.find((item) => item.id === chatId)
                  return (
                    <button
                      key={chatId}
                      type="button"
                      className="token-button"
                      onClick={() => removeScopedChat(chatId)}
                    >
                      {chat?.title || chat?.wa_chat_jid || chatId}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="subtle-text">未指定固定聊天时，会按上面勾选的聊天类型生效。</p>
            )}
          </section>

          <section className="helper-card">
            <strong>触发条件</strong>
            <div className="form-grid">
              <label className="field">
                <span>关键词，每行一个</span>
                <textarea
                  rows={5}
                  value={value.triggerKeywordsText}
                  onChange={(event) => update({ triggerKeywordsText: event.target.value })}
                  placeholder="价格&#10;发货&#10;库存"
                />
              </label>

              <label className="field">
                <span>关键词命中方式</span>
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

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={value.ignoreFromMe}
                  onChange={(event) => update({ ignoreFromMe: event.target.checked })}
                />
                <span>忽略我方自己发出的消息，避免规则自触发</span>
              </label>

              <label className="field">
                <span>最少消息字数</span>
                <input
                  type="number"
                  min={0}
                  value={value.minMessageChars}
                  onChange={(event) =>
                    update({ minMessageChars: Number(event.target.value || 0) })
                  }
                />
              </label>
            </div>
          </section>
        </div>

        <label className="field">
          <span>回复提示词</span>
          <textarea
            rows={8}
            value={value.promptTemplate}
            onChange={(event) => update({ promptTemplate: event.target.value })}
            placeholder="告诉 Agent 该怎么回复、哪些话题必须转人工、语气应该怎样。"
          />
        </label>

        <div className="two-column-grid">
          <section className="helper-card">
            <strong>安全边界</strong>
            <div className="form-grid">
              <label className="field">
                <span>冷却时间（秒）</span>
                <input
                  type="number"
                  min={0}
                  value={value.cooldownSeconds}
                  onChange={(event) =>
                    update({ cooldownSeconds: Number(event.target.value || 0) })
                  }
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

              <label className="field">
                <span>禁止词，每行一个</span>
                <textarea
                  rows={5}
                  value={value.blockedKeywordsText}
                  onChange={(event) => update({ blockedKeywordsText: event.target.value })}
                  placeholder="退款&#10;赔偿&#10;验证码"
                />
              </label>

              <label className="field">
                <span>敏感主题，每行一个</span>
                <textarea
                  rows={5}
                  value={value.sensitiveTopicsText}
                  onChange={(event) => update({ sensitiveTopicsText: event.target.value })}
                  placeholder="支付&#10;法务&#10;账号安全"
                />
              </label>
            </div>
          </section>

          <section className="helper-card">
            <strong>知识补充</strong>
            <div className="form-grid">
              <label className="field">
                <span>知识摘要</span>
                <textarea
                  rows={4}
                  value={value.knowledgeSummary}
                  onChange={(event) => update({ knowledgeSummary: event.target.value })}
                  placeholder="例如：退换货说明、营业时间、常见物流话术。"
                />
              </label>

              <label className="field">
                <span>参考资料，每行一个</span>
                <textarea
                  rows={6}
                  value={value.knowledgeReferencesText}
                  onChange={(event) => update({ knowledgeReferencesText: event.target.value })}
                  placeholder="退货政策文档&#10;运费说明&#10;售后SOP"
                />
              </label>
            </div>
          </section>
        </div>

        {value.replyMode === 'auto_send' ? (
          <div className="warning-banner">
            自动发送规则保存后会保持停用。你需要回到左侧再点一次“启用规则”，这是给新手员工留的安全闸门。
          </div>
        ) : null}

        <div className="button-row">
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
