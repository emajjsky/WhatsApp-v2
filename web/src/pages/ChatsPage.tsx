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
  listAgentRuns,
  listChats,
  sendAgentRun,
  type AccountView,
  type AgentRunView,
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
  const [draftRun, setDraftRun] = useState<AgentRunView>()
  const [draftText, setDraftText] = useState('')
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftSending, setDraftSending] = useState(false)
  const [draftError, setDraftError] = useState<string>()
  const [listLoading, setListLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [error, setError] = useState<string>()
  const timelineRef = useRef<HTMLDivElement>(null)
  const pendingScrollModeRef = useRef<'bottom' | 'preserve' | 'none'>('bottom')
  const previousTimelineMetricsRef = useRef<{ scrollHeight: number; scrollTop: number } | undefined>(
    undefined,
  )
  const draftRunIdRef = useRef<string | undefined>(undefined)

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
          limit: 60,
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

  const loadHistory = useCallback(
    async (chatId: string, background = false) => {
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
        const response = await getChatMessages(chatId, { limit: 50 })
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
    },
    [],
  )

  const loadDraftRun = useCallback(async (chatId: string | undefined, background = false) => {
    if (!chatId) {
      setDraftRun(undefined)
      setDraftText('')
      setDraftError(undefined)
      draftRunIdRef.current = undefined
      return
    }

    if (!background) {
      setDraftLoading(true)
      setDraftError(undefined)
    }

    try {
      const response = await listAgentRuns({ chatId, status: 'ready_for_review', limit: 1 })
      const run = response.runs[0]
      setDraftRun(run)

      if (!run) {
        setDraftText('')
        draftRunIdRef.current = undefined
        return
      }

      if (draftRunIdRef.current !== run.id) {
        setDraftText(run.output_draft ?? '')
        draftRunIdRef.current = run.id
      }
    } catch (loadError) {
      if (!background) {
        setDraftRun(undefined)
        setDraftText('')
        setDraftError(loadError instanceof Error ? loadError.message : '加载草稿失败')
        draftRunIdRef.current = undefined
      }
    } finally {
      if (!background) {
        setDraftLoading(false)
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
      void loadDraftRun(undefined)
      return
    }

    void loadHistory(selectedChatId)
    void loadDraftRun(selectedChatId)
  }, [loadDraftRun, loadHistory, selectedChatId])

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
        void loadDraftRun(selectedChatId, true)
      }
    }, 5000)

    return () => {
      window.clearInterval(timer)
    }
  }, [loadChatsList, loadDraftRun, loadHistory, selectedChatId])

  async function handleSendDraft() {
    if (!selectedChatId || !draftRun) {
      return
    }

    const messageText = draftText.trim()
    if (!messageText) {
      setDraftError('草稿内容为空')
      return
    }

    setDraftSending(true)
    setDraftError(undefined)

    try {
      await sendAgentRun(draftRun.id, { message_text: messageText })
      await loadHistory(selectedChatId, true)
      await loadDraftRun(selectedChatId, true)
    } catch (sendError) {
      setDraftError(sendError instanceof Error ? sendError.message : '发送草稿失败')
    } finally {
      setDraftSending(false)
    }
  }

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

              <section className="panel highlight-panel agent-draft-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Agent 草稿</p>
                    <h3>建议回复</h3>
                  </div>
                  <span className="subtle-text">
                    {draftLoading ? '生成中...' : draftRun ? `规则：${draftRun.rule_name}` : '暂无草稿'}
                  </span>
                </div>

                {draftRun ? (
                  <div className="detail-stack">
                    <label className="field">
                      <span>草稿内容</span>
                      <textarea
                        value={draftText}
                        onChange={(event) => setDraftText(event.target.value)}
                        rows={4}
                        placeholder="等 Agent 生成草稿后，这里会出现可编辑的回复内容。"
                      />
                    </label>

                    <div className="button-row">
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => void handleSendDraft()}
                        disabled={draftSending || draftLoading || !draftText.trim()}
                      >
                        {draftSending ? '发送中...' : '一键发送'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="subtle-text">
                    没有可发送草稿。等客户发新消息并命中 Agent 规则后，这里会自动出现建议回复。
                  </p>
                )}

                {draftError ? <div className="error-banner">{draftError}</div> : null}
              </section>

              {history.has_more ? (
                <button className="secondary-button align-start" type="button" onClick={() => void loadMoreMessages()}>
                  {historyLoading ? '正在加载更早消息...' : '加载更早消息'}
                </button>
              ) : null}

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
              description="先在左边点开一条聊天。新员工只需要看右侧时间线，不需要理解任何底层协议概念。"
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
