import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  getChatMessages,
  getMediaAssetUrl,
  listAccounts,
  listChats,
  subscribeLiveUpdates,
  type AccountView,
  type ChatSummary,
  type ChatType,
  type LiveUpdate,
  type MessageHistoryResponse,
} from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { StatusBadge } from '../components/StatusBadge'

const chatTypeOptions: Array<{ value: ChatType | ''; label: string }> = [
  { value: '', label: '全部类型' },
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
  const timelineRef = useRef<HTMLDivElement>(null)
  const pendingScrollModeRef = useRef<'bottom' | 'preserve' | 'none'>('bottom')
  const previousTimelineMetricsRef = useRef<
    { scrollHeight: number; scrollTop: number } | undefined
  >(undefined)

  const loadAccountsList = useCallback(async () => {
    try {
      const response = await listAccounts()
      setAccounts(response.accounts)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载账号失败')
    }
  }, [])

  const loadChatsList = useCallback(
    async (background = false) => {
      if (!background) {
        setListLoading(true)
        setError(undefined)
      }

      try {
        const response = await listChats({
          accountId: selectedAccountId || undefined,
          query: deferredSearch.trim() || undefined,
          chatType: selectedChatType,
          limit: 400,
        })

        setChats(response.chats)

        const currentStillVisible = response.chats.some((item) => item.id === selectedChatId)
        const nextChatId = currentStillVisible ? selectedChatId : response.chats[0]?.id
        startTransition(() => setSelectedChatId(nextChatId))
      } catch (loadError) {
        if (!background) {
          setChats([])
          setError(loadError instanceof Error ? loadError.message : '加载聊天失败')
        }
      } finally {
        if (!background) {
          setListLoading(false)
        }
      }
    },
    [deferredSearch, selectedAccountId, selectedChatId, selectedChatType],
  )

  const loadHistory = useCallback(async (chatId: string, background = false) => {
    if (background) {
      pendingScrollModeRef.current = isNearBottom(timelineRef.current) ? 'bottom' : 'none'
    } else {
      pendingScrollModeRef.current = 'bottom'
    }

    if (!background) {
      setHistoryLoading(true)
      setError(undefined)
    }

    try {
      const response = await getChatMessages(chatId, { limit: 60 })
      setHistory((current) => {
        if (!current || current.chat.id !== response.chat.id || !background) {
          return response
        }

        const latestIDs = new Set(response.messages.map((message) => message.id))
        const olderMessages = current.messages.filter((message) => !latestIDs.has(message.id))

        return {
          ...response,
          messages: [...olderMessages, ...response.messages],
        }
      })
    } catch (loadError) {
      if (!background) {
        setHistory(undefined)
        setError(loadError instanceof Error ? loadError.message : '加载消息失败')
      }
    } finally {
      if (!background) {
        setHistoryLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void loadAccountsList()
  }, [loadAccountsList])

  useEffect(() => {
    void loadChatsList()
  }, [loadChatsList])

  useEffect(() => {
    if (!selectedChatId) {
      setHistory(undefined)
      return
    }

    void loadHistory(selectedChatId)
  }, [loadHistory, selectedChatId])

  useEffect(() => {
    const timeline = timelineRef.current
    if (!timeline || !history) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      switch (pendingScrollModeRef.current) {
        case 'preserve': {
          const previous = previousTimelineMetricsRef.current
          if (previous) {
            const delta = timeline.scrollHeight - previous.scrollHeight
            timeline.scrollTop = previous.scrollTop + delta
          }
          break
        }
        case 'bottom':
          timeline.scrollTop = timeline.scrollHeight
          break
        default:
          break
      }

      previousTimelineMetricsRef.current = undefined
      pendingScrollModeRef.current = 'none'
    })

    return () => window.cancelAnimationFrame(frame)
  }, [history])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadChatsList(true)
      if (selectedChatId) {
        void loadHistory(selectedChatId, true)
      }
    }, 5000)

    return () => {
      window.clearInterval(timer)
    }
  }, [loadChatsList, loadHistory, selectedChatId])

  useEffect(() => {
    function handleLiveUpdate(update: LiveUpdate) {
      if (selectedAccountId && update.account_id !== selectedAccountId) {
        return
      }

      void loadChatsList(true)

      if (update.type === 'message_stored' && selectedChatId && update.chat_id === selectedChatId) {
        void loadHistory(selectedChatId, true)
      }
    }

    return subscribeLiveUpdates(handleLiveUpdate)
  }, [loadChatsList, loadHistory, selectedAccountId, selectedChatId])

  async function loadMoreMessages() {
    if (!selectedChatId || !history?.next_before) {
      return
    }

    if (timelineRef.current) {
      previousTimelineMetricsRef.current = {
        scrollHeight: timelineRef.current.scrollHeight,
        scrollTop: timelineRef.current.scrollTop,
      }
    }
    pendingScrollModeRef.current = 'preserve'
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
      setError(loadError instanceof Error ? loadError.message : '加载更早消息失败')
    } finally {
      setHistoryLoading(false)
    }
  }

  const selectedChat = chats.find((item) => item.id === selectedChatId)

  return (
    <div className="page page-chats">
      <section className="chat-frame">
        <aside className="panel chat-sidebar-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">筛选区</p>
              <h3>会话列表</h3>
            </div>
            <span className="subtle-text">{listLoading ? '同步中...' : `${chats.length} 条结果`}</span>
          </div>

          <div className="chat-filter-grid">
            <label className="field compact-field">
              <span>账号</span>
              <select value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)}>
                <option value="">全部账号</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.display_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field compact-field">
              <span>类型</span>
              <select
                value={selectedChatType}
                onChange={(event) => setSelectedChatType(event.target.value as ChatType | '')}
              >
                {chatTypeOptions.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field compact-field chat-search-field">
              <span>搜索</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜联系人、群聊名、消息预览"
              />
            </label>
          </div>

          {chats.length > 0 ? (
            <div className="chat-list-scroll">
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
                    <div className="chat-row-meta">
                      <span>{chat.wa_chat_jid}</span>
                      <small>{formatDateTime(chat.last_message_at)}</small>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <EmptyPanel
              title="没有找到会话"
              description="先确认账号已成功接入，再按账号、类型或关键词筛选。"
            />
          )}
        </aside>

        <section className="panel chat-main-panel">
          {selectedChat && history ? (
            <>
              <div className="chat-stage-header">
                <div>
                  <p className="eyebrow">当前会话</p>
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

              <div className="chat-stage-toolbar">
                {history.has_more ? (
                  <button className="secondary-button" type="button" onClick={() => void loadMoreMessages()}>
                    {historyLoading ? '正在加载更早消息...' : '加载更早消息'}
                  </button>
                ) : (
                  <span className="subtle-text">更早消息已经到底了</span>
                )}
                <span className="subtle-text">新消息会在你靠近底部时自动贴底</span>
              </div>

              <div ref={timelineRef} className="message-timeline">
                {history.messages.map((message) => (
                  <article key={message.id} className={`message-card${message.from_me ? ' own' : ''}`}>
                    <div className="message-meta">
                      <strong>{message.from_me ? '本机发送' : message.sender_jid}</strong>
                      <span>{formatDateTime(message.sent_at)}</span>
                    </div>
                    <p>{message.text_content || fallbackMessageCopy(message.message_type)}</p>

                    {message.media.length > 0 ? (
                      <div className="media-block-list">
                        {message.media.map((media) => {
                          const mediaUrl = getMediaAssetUrl(media.id)
                          const label = media.file_name || media.media_type

                          if (
                            (media.media_type === 'image' || media.media_type === 'sticker') &&
                            media.download_status === 'ready'
                          ) {
                            return (
                              <figure key={media.id} className="media-preview-card">
                                <img
                                  className={`media-preview-image${media.media_type === 'sticker' ? ' sticker' : ''}`}
                                  src={mediaUrl}
                                  alt={label}
                                  loading="lazy"
                                />
                                <figcaption>{label}</figcaption>
                              </figure>
                            )
                          }

                          if (media.media_type === 'video' && media.download_status === 'ready') {
                            return (
                              <figure key={media.id} className="media-preview-card">
                                <video className="media-preview-video" src={mediaUrl} controls preload="metadata" />
                                <figcaption>{label}</figcaption>
                              </figure>
                            )
                          }

                          if (media.media_type === 'audio' && media.download_status === 'ready') {
                            return (
                              <figure key={media.id} className="media-preview-card">
                                <audio className="media-preview-audio" src={mediaUrl} controls preload="metadata" />
                                <figcaption>{label}</figcaption>
                              </figure>
                            )
                          }

                          if (media.download_status === 'ready') {
                            return (
                              <a
                                key={media.id}
                                className="media-link"
                                href={mediaUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                打开附件 · {label}
                              </a>
                            )
                          }

                          return (
                            <span key={media.id} className={`media-chip status-${media.download_status}`}>
                              {media.media_type}
                              {media.file_name ? ` · ${media.file_name}` : ''}
                              {media.download_status === 'failed' ? ' · 下载失败' : ' · 下载中'}
                            </span>
                          )
                        })}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </>
          ) : (
            <EmptyPanel
              title="右侧还没有内容"
              description="左边点一条会话，右边就会按固定高度展示时间线，滚动逻辑会保持最新消息在底部。"
            />
          )}
        </section>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  )
}

function isNearBottom(element: HTMLDivElement | null) {
  if (!element) {
    return true
  }

  const distance = element.scrollHeight - element.scrollTop - element.clientHeight
  return distance < 56
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
