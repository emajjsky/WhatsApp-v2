import { startTransition, useDeferredValue, useEffect, useState } from 'react'
import {
  getChatMessages,
  listAccounts,
  listChats,
  type AccountView,
  type ChatSummary,
  type ChatType,
  type MessageHistoryResponse,
} from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'

const chatTypeOptions: Array<{ value: ChatType | ''; label: string }> = [
  { value: '', label: '全部' },
  { value: 'direct', label: '单聊' },
  { value: 'group', label: '群聊' },
  { value: 'broadcast', label: '广播' },
  { value: 'status', label: '状态' },
]

export function ChatsPage() {
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [selectedChatType, setSelectedChatType] = useState<ChatType | ''>('')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [selectedChatId, setSelectedChatId] = useState<string>()
  const [history, setHistory] = useState<MessageHistoryResponse>()
  const [listLoading, setListLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true

    async function loadAccountsList() {
      try {
        const response = await listAccounts()
        if (!active) {
          return
        }

        setAccounts(response.accounts)
      } catch (loadError) {
        if (!active) {
          return
        }

        setError(loadError instanceof Error ? loadError.message : '加载账号失败')
      }
    }

    void loadAccountsList()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadChatsList() {
      setListLoading(true)
      setError(undefined)

      try {
        const response = await listChats({
          accountId: selectedAccountId || undefined,
          query: deferredSearch.trim() || undefined,
          chatType: selectedChatType,
          limit: 60,
        })

        if (!active) {
          return
        }

        setChats(response.chats)

        const currentStillVisible = response.chats.some((item) => item.id === selectedChatId)
        const nextChatId = currentStillVisible ? selectedChatId : response.chats[0]?.id
        startTransition(() => setSelectedChatId(nextChatId))
      } catch (loadError) {
        if (!active) {
          return
        }

        setChats([])
        setError(loadError instanceof Error ? loadError.message : '加载聊天失败')
      } finally {
        if (active) {
          setListLoading(false)
        }
      }
    }

    void loadChatsList()

    return () => {
      active = false
    }
  }, [deferredSearch, selectedAccountId, selectedChatId, selectedChatType])

  useEffect(() => {
    if (!selectedChatId) {
      setHistory(undefined)
      return
    }

    let active = true

    async function loadHistory() {
      const chatId = selectedChatId
      if (!chatId) {
        return
      }

      setHistoryLoading(true)
      setError(undefined)

      try {
        const response = await getChatMessages(chatId, { limit: 50 })
        if (!active) {
          return
        }

        setHistory(response)
      } catch (loadError) {
        if (!active) {
          return
        }

        setHistory(undefined)
        setError(loadError instanceof Error ? loadError.message : '加载消息失败')
      } finally {
        if (active) {
          setHistoryLoading(false)
        }
      }
    }

    void loadHistory()

    return () => {
      active = false
    }
  }, [selectedChatId])

  async function loadMoreMessages() {
    if (!selectedChatId || !history?.next_before) {
      return
    }

    setHistoryLoading(true)
    setError(undefined)

    try {
      const response = await getChatMessages(selectedChatId, {
        limit: history.limit,
        before: history.next_before,
      })

      setHistory((current) => {
        if (!current) {
          return response
        }

        return {
          ...response,
          messages: [...response.messages, ...current.messages],
        }
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载更多消息失败')
    } finally {
      setHistoryLoading(false)
    }
  }

  const selectedChat = chats.find((item) => item.id === selectedChatId)

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="对话查看"
        title="先确认上下文，再决定下一步动作"
        description="左边先筛选账号和聊天，右边再看消息时间线。页面默认只保留必要信息，避免新同事一上来就被术语淹没。"
      />

      <section className="chat-workspace">
        <aside className="chat-sidebar panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">筛选区</p>
              <h3>找聊天</h3>
            </div>
            <span className="subtle-text">{listLoading ? '正在同步...' : `${chats.length} 条结果`}</span>
          </div>

          <div className="filter-stack">
            <label className="field">
              <span>按账号查看</span>
              <select value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)}>
                <option value="">全部账号</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.display_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>搜索关键词</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜聊天名、手机号、消息内容"
              />
            </label>

            <div className="chip-row" role="tablist" aria-label="聊天类型">
              {chatTypeOptions.map((option) => (
                <button
                  key={option.value || 'all'}
                  type="button"
                  className={`chip-button${selectedChatType === option.value ? ' active' : ''}`}
                  onClick={() => setSelectedChatType(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {chats.length > 0 ? (
            <div className="chat-list">
              {chats.map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  className={`chat-row${selectedChatId === chat.id ? ' selected' : ''}`}
                  onClick={() => startTransition(() => setSelectedChatId(chat.id))}
                >
                  <div className="chat-row-header">
                    <strong>{chat.title || chat.wa_chat_jid}</strong>
                    <StatusBadge status={chat.chat_type} />
                  </div>
                  <p>{chat.latest_message_preview || fallbackMessageCopy(chat.latest_message_type)}</p>
                  <span>{formatDateTime(chat.last_message_at)}</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyPanel
              title="没有找到聊天"
              description="先确认账号已接入并开始归档，然后再按关键词或聊天类型筛选。"
            />
          )}
        </aside>

        <section className="chat-stage panel">
          {selectedChat && history ? (
            <>
              <div className="chat-stage-header">
                <div>
                  <p className="eyebrow">当前聊天</p>
                  <h3>{history.chat.title || history.chat.wa_chat_jid}</h3>
                  <p className="subtle-text">
                    {history.chat.wa_chat_jid}
                    {history.chat.participant_count ? ` · ${history.chat.participant_count} 人` : ''}
                  </p>
                </div>
                <div className="chat-stage-meta">
                  <StatusBadge status={history.chat.chat_type} />
                  <span>{history.messages.length} 条已加载消息</span>
                </div>
              </div>

              {history.has_more ? (
                <button className="secondary-button align-start" type="button" onClick={() => void loadMoreMessages()}>
                  {historyLoading ? '正在加载更早消息...' : '加载更早消息'}
                </button>
              ) : null}

              <div className="message-timeline">
                {history.messages.map((message) => (
                  <article key={message.id} className={`message-card${message.from_me ? ' own' : ''}`}>
                    <div className="message-meta">
                      <strong>{message.from_me ? '本机发送' : message.sender_jid}</strong>
                      <span>{formatDateTime(message.sent_at)}</span>
                    </div>
                    <p>{message.text_content || fallbackMessageCopy(message.message_type)}</p>

                    {message.media.length > 0 ? (
                      <div className="media-chip-list">
                        {message.media.map((media) => (
                          <span key={media.id} className="media-chip">
                            {media.media_type}
                            {media.file_name ? ` · ${media.file_name}` : ''}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </>
          ) : (
            <EmptyPanel
              title="右侧还没有内容"
              description="先在左边点开一条聊天。新员工只需要看右侧时间线，不需要理解任何底层协议概念。"
            />
          )}
        </section>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  )
}

function formatDateTime(value?: string) {
  if (!value) {
    return '暂无时间'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function fallbackMessageCopy(messageType?: string) {
  switch (messageType) {
    case 'image':
      return '图片消息'
    case 'video':
      return '视频消息'
    case 'audio':
      return '语音或音频消息'
    case 'document':
      return '文件消息'
    case 'sticker':
      return '贴纸消息'
    case 'reaction':
      return '表情反馈'
    default:
      return '暂无可直接展示的文本内容'
  }
}
