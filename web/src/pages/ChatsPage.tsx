import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  analyzeStatusCard,
  getChatMessages,
  getMediaAssetUrl,
  getStatusCard,
  listAccounts,
  listAvailableSystemAgentConfigs,
  listChats,
  sendAgentRun,
  sendChatMedia,
  sendChatMessage,
  streamGenerateAgentRun,
  subscribeLiveUpdates,
  translateText,
  type AccountView,
  type AgentRunView,
  type ChatHeader,
  type ChatSummary,
  type ChatType,
  type LiveUpdate,
  type MessageHistoryResponse,
  type MessageView,
  type SendChatMediaType,
  type StatusCardView,
  type SystemAgentConfigView,
  type TranslationView,
} from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { Icon, type IconName } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'

const chatTypeOptions: Array<{ value: ChatType | ''; label: string }> = [
  { value: '', label: '全部' },
  { value: 'direct', label: '单聊' },
  { value: 'group', label: '群聊' },
  { value: 'broadcast', label: '广播' },
  { value: 'status', label: '状态' },
]

type ChatDisplaySource = {
  wa_chat_jid: string
  chat_type: ChatType
  title?: string
  participant_count?: number
}

type TranslationState = {
  loading?: boolean
  error?: string
  translation?: TranslationView
}

type StoredMessageTranslation = {
  cached_at: string
  translation: TranslationView
}

type AttachmentAction =
  | 'document'
  | 'media'
  | 'camera'
  | 'audio'

const languageOptions = [
  { code: 'en', name: '英语' },
  { code: 'ja', name: '日语' },
  { code: 'ko', name: '韩语' },
  { code: 'th', name: '泰语' },
  { code: 'vi', name: '越南语' },
  { code: 'id', name: '印尼语' },
  { code: 'ms', name: '马来语' },
  { code: 'tl', name: '菲律宾语' },
  { code: 'ar', name: '阿拉伯语' },
  { code: 'es', name: '西班牙语' },
  { code: 'fr', name: '法语' },
  { code: 'pt', name: '葡萄牙语' },
]

const attachmentActions: Array<{
  key: AttachmentAction
  label: string
  icon: IconName
  tone: string
}> = [
  { key: 'document', label: '文档', icon: 'document', tone: 'purple' },
  { key: 'media', label: '照片和视频', icon: 'image', tone: 'blue' },
  { key: 'camera', label: '相机', icon: 'camera', tone: 'pink' },
  { key: 'audio', label: '音频', icon: 'audio', tone: 'orange' },
]

const messageTranslationCacheStorageKey = 'whatsapp.messageTranslations.v1'
const messageTranslationCacheLimit = 800

function getAssistantRunNotice(run: AgentRunView) {
  if (run.status === 'ready_for_review') {
    return '草稿已生成，可以写回输入框或直接发送。'
  }
  if (run.status === 'blocked') {
    return '草稿被安全策略拦截，请先检查 Agent 边界。'
  }
  if (run.status === 'failed') {
    return run.block_reason || 'Agent 生成失败。'
  }
  return `Agent 状态：${run.status}`
}

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
  const [sending, setSending] = useState(false)
  const [draftMessage, setDraftMessage] = useState('')
  const [error, setError] = useState<string>()
  const [composeNotice, setComposeNotice] = useState<string>()
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false)
  const [assistantRun, setAssistantRun] = useState<AgentRunView>()
  const [assistantDraft, setAssistantDraft] = useState('')
  const [messageTranslations, setMessageTranslations] =
    useState<Record<string, TranslationState>>(loadMessageTranslationCache)
  const [draftTargetLanguage, setDraftTargetLanguage] = useState('en')
  const [draftTargetLanguageName, setDraftTargetLanguageName] = useState('英语')
  const [translatedDraft, setTranslatedDraft] = useState('')
  const [draftTranslationBusy, setDraftTranslationBusy] = useState(false)
  const [assistantContextEnabled, setAssistantContextEnabled] = useState(true)
  const [assistantContextLimit, setAssistantContextLimit] = useState(12)
  const [replyAgents, setReplyAgents] = useState<SystemAgentConfigView[]>([])
  const [translationAgents, setTranslationAgents] = useState<SystemAgentConfigView[]>([])
  const [statusCardAgents, setStatusCardAgents] = useState<SystemAgentConfigView[]>([])
  const [selectedReplyAgentId, setSelectedReplyAgentId] = useState('')
  const [statusCard, setStatusCard] = useState<StatusCardView>()
  const [statusCardBusy, setStatusCardBusy] = useState(false)
  const [statusCardNotice, setStatusCardNotice] = useState<string>()
  const [agentConfigsLoading, setAgentConfigsLoading] = useState(true)
  const [assistantBusy, setAssistantBusy] = useState(false)
  const [assistantSending, setAssistantSending] = useState(false)
  const [assistantNotice, setAssistantNotice] = useState<string>()
  const timelineRef = useRef<HTMLDivElement>(null)
  const assistantDraftRef = useRef<HTMLTextAreaElement>(null)
  const composeAttachmentRef = useRef<HTMLDivElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const pendingMessageTranslationKeysRef = useRef<Set<string>>(new Set())
  const keepTimelinePinnedRef = useRef(true)
  const pendingScrollModeRef = useRef<'bottom' | 'preserve' | 'none'>('bottom')
  const statusCardRequestSeqRef = useRef(0)
  const previousTimelineMetricsRef = useRef<
    { scrollHeight: number; scrollTop: number } | undefined
  >(undefined)

  const scrollTimelineToBottom = useCallback(() => {
    const timeline = timelineRef.current
    if (!timeline) {
      return
    }

    timeline.scrollTop = timeline.scrollHeight
    keepTimelinePinnedRef.current = true
  }, [])

  const loadAccountsList = useCallback(async () => {
    try {
      const response = await listAccounts()
      setAccounts(response.accounts)
      setSelectedAccountId((current) =>
        response.accounts.some((account) => account.id === current)
          ? current
          : response.accounts[0]?.id ?? '',
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载账号失败')
    }
  }, [])

  const loadAvailableAgentConfigs = useCallback(async () => {
    setAgentConfigsLoading(true)
    try {
      const [replyResponse, translationResponse, statusCardResponse] = await Promise.all([
        listAvailableSystemAgentConfigs({ purpose: 'reply' }),
        listAvailableSystemAgentConfigs({ purpose: 'translation' }),
        listAvailableSystemAgentConfigs({ purpose: 'status_card' }),
      ])
      setReplyAgents(replyResponse.configs)
      setTranslationAgents(translationResponse.configs)
      setStatusCardAgents(statusCardResponse.configs)
      setSelectedReplyAgentId((current) =>
        replyResponse.configs.some((config) => config.id === current)
          ? current
          : replyResponse.configs[0]?.id ?? '',
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载智能体配置失败')
    } finally {
      setAgentConfigsLoading(false)
    }
  }, [])

  const loadChatsList = useCallback(
    async (background = false) => {
      if (!background) {
        setListLoading(true)
        setError(undefined)
      }

      try {
        if (!selectedAccountId) {
          setChats([])
          setSelectedChatId(undefined)
          return
        }

        const response = await listChats({
          accountId: selectedAccountId,
          query: deferredSearch.trim() || undefined,
          chatType: selectedChatType,
          limit: 2000,
        })

        setChats(response.chats)
        setSelectedChatId((current) => choosePreferredChatId(response.chats, current))
      } catch (loadError) {
        if (!background) {
          setChats([])
          setError(loadError instanceof Error ? loadError.message : '加载会话失败')
        }
      } finally {
        if (!background) {
          setListLoading(false)
        }
      }
    },
    [deferredSearch, selectedAccountId, selectedChatType],
  )

  const loadHistory = useCallback(async (chatId: string, background = false) => {
    if (background) {
      const timeline = timelineRef.current
      const shouldStickToBottom = timeline ? isNearBottom(timeline) : keepTimelinePinnedRef.current
      keepTimelinePinnedRef.current = shouldStickToBottom
      pendingScrollModeRef.current = shouldStickToBottom ? 'bottom' : 'none'
    } else {
      pendingScrollModeRef.current = 'bottom'
      keepTimelinePinnedRef.current = true
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
        const latestWAIDs = new Set(
          response.messages
            .map((message) => message.wa_message_id?.trim())
            .filter((value): value is string => Boolean(value)),
        )
        const olderMessages = current.messages.filter((message) => {
          if (latestIDs.has(message.id)) {
            return false
          }

          const waMessageID = message.wa_message_id?.trim()
          if (waMessageID && latestWAIDs.has(waMessageID)) {
            return false
          }

          return true
        })

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

  const loadSavedStatusCard = useCallback(async (chatId: string) => {
    const requestSeq = statusCardRequestSeqRef.current + 1
    statusCardRequestSeqRef.current = requestSeq
    setStatusCard(undefined)
    setStatusCardNotice(undefined)
    try {
      const response = await getStatusCard(chatId)
      if (statusCardRequestSeqRef.current !== requestSeq) {
        return
      }
      setStatusCard(response.status_card ?? undefined)
    } catch (loadError) {
      if (statusCardRequestSeqRef.current !== requestSeq) {
        return
      }
      setStatusCardNotice(loadError instanceof Error ? loadError.message : '加载状态卡失败')
    }
  }, [])

  useEffect(() => {
    void loadAccountsList()
  }, [loadAccountsList])

  useEffect(() => {
    void loadAvailableAgentConfigs()
  }, [loadAvailableAgentConfigs])

  useEffect(() => {
    void loadChatsList()
  }, [loadChatsList])

  useEffect(() => {
    if (!selectedChatId) {
      statusCardRequestSeqRef.current += 1
      setHistory(undefined)
      setStatusCard(undefined)
      setStatusCardNotice(undefined)
      return
    }

    void loadHistory(selectedChatId)
    void loadSavedStatusCard(selectedChatId)
  }, [loadHistory, loadSavedStatusCard, selectedChatId])

  useEffect(() => {
    setAssistantRun(undefined)
    setAssistantDraft('')
    setTranslatedDraft('')
    setAssistantNotice(undefined)
    setComposeNotice(undefined)
    setAttachmentMenuOpen(false)
  }, [selectedChatId])

  useEffect(() => {
    if (!attachmentMenuOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (composeAttachmentRef.current?.contains(event.target as Node)) {
        return
      }
      setAttachmentMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [attachmentMenuOpen])

  useEffect(() => {
    if (!assistantBusy || !assistantDraftRef.current) {
      return
    }
    assistantDraftRef.current.scrollTop = assistantDraftRef.current.scrollHeight
  }, [assistantBusy, assistantDraft])

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
          scrollTimelineToBottom()
          break
        default:
          break
      }

      keepTimelinePinnedRef.current = isNearBottom(timeline)
      previousTimelineMetricsRef.current = undefined
      pendingScrollModeRef.current = 'none'
    })

    return () => window.cancelAnimationFrame(frame)
  }, [history, scrollTimelineToBottom])

  useEffect(() => {
    const timeline = timelineRef.current
    if (!timeline) {
      return
    }

    const handleScroll = () => {
      keepTimelinePinnedRef.current = isNearBottom(timeline)
    }

    handleScroll()
    timeline.addEventListener('scroll', handleScroll)
    return () => timeline.removeEventListener('scroll', handleScroll)
  }, [selectedChatId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadChatsList(true)
      if (selectedChatId) {
        void loadHistory(selectedChatId, true)
      }
    }, 5000)

    return () => window.clearInterval(timer)
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

  async function handleSendMessage() {
    if (!selectedChatId || !history || !selectedChat) {
      return
    }

    const content = draftMessage.trim()
    if (!content || sending) {
      return
    }

    if (!isChatSendable(history.chat.wa_chat_jid, history.chat.chat_type)) {
      setError(getChatSendBlockedReason(history.chat.wa_chat_jid, history.chat.chat_type))
      return
    }

    setSending(true)
    setError(undefined)

    try {
      const response = await sendChatMessage(selectedChatId, { message_text: content })
      appendOptimisticMessage(response, history.chat, selectedChat)
      setDraftMessage('')
      setComposeNotice(undefined)
      pendingScrollModeRef.current = 'bottom'
      keepTimelinePinnedRef.current = true
      void loadHistory(selectedChatId, true)
      void loadChatsList(true)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '发送消息失败')
    } finally {
      setSending(false)
    }
  }

  function handleAttachmentAction(action: AttachmentAction) {
    setAttachmentMenuOpen(false)

    switch (action) {
      case 'document':
        documentInputRef.current?.click()
        return
      case 'media':
        mediaInputRef.current?.click()
        return
      case 'camera':
        cameraInputRef.current?.click()
        return
      case 'audio':
        audioInputRef.current?.click()
        return
    }
  }

  async function handleAttachmentFiles(kind: AttachmentAction, files: FileList | null) {
    if (!selectedChatId || !history || !selectedChat) {
      return
    }

    const selectedFiles = Array.from(files ?? [])
    if (selectedFiles.length === 0) {
      return
    }
    if (sending) {
      return
    }
    if (!isChatSendable(history.chat.wa_chat_jid, history.chat.chat_type)) {
      setError(getChatSendBlockedReason(history.chat.wa_chat_jid, history.chat.chat_type))
      return
    }

    setSending(true)
    setError(undefined)

    const caption = kind === 'audio' ? '' : draftMessage.trim()

    try {
      for (const [index, file] of selectedFiles.entries()) {
        setComposeNotice(`正在发送${getAttachmentActionLabel(kind)}：${file.name}`)
        await sendChatMedia(selectedChatId, {
          file,
          mediaType: resolveAttachmentMediaType(kind, file),
          caption: index === 0 ? caption : '',
        })
      }

      if (caption) {
        setDraftMessage('')
      }
      setComposeNotice(`${selectedFiles.length > 1 ? `${selectedFiles.length} 个文件` : selectedFiles[0].name}已发送。`)
      pendingScrollModeRef.current = 'bottom'
      keepTimelinePinnedRef.current = true
      void loadHistory(selectedChatId, true)
      void loadChatsList(true)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '发送媒体失败')
    } finally {
      setSending(false)
    }
  }

  async function translateMessageToChinese(message: MessageView) {
    const text = message.text_content?.trim()
    const accountID = message.account_id || history?.chat.account_id
    const translationKey = getMessageTranslationKey(message, text)
    if (!text || !accountID || !translationKey) {
      return
    }
    if (translationAgents.length === 0) {
      setMessageTranslations((current) => ({
        ...current,
        [translationKey]: { error: '管理员后台还没有启用翻译智能体' },
      }))
      return
    }
    if (
      pendingMessageTranslationKeysRef.current.has(translationKey) ||
      isMessageTranslationLocked(messageTranslations[translationKey])
    ) {
      return
    }

    pendingMessageTranslationKeysRef.current.add(translationKey)
    setMessageTranslations((current) =>
      isMessageTranslationLocked(current[translationKey])
        ? current
        : {
            ...current,
            [translationKey]: { loading: true },
          },
    )

    try {
      const response = await translateText({
        account_id: accountID,
        text,
        target_language: 'zh-CN',
        target_language_name: '中文',
      })
      setMessageTranslations((current) => ({
        ...current,
        [translationKey]: { translation: response.translation },
      }))
      persistMessageTranslation(translationKey, response.translation)

      if (!isChineseLanguage(response.translation.source_language_code)) {
        const option = resolveLanguageOption(
          response.translation.source_language_code,
          response.translation.source_language_name,
        )
        setDraftTargetLanguage(option.code)
        setDraftTargetLanguageName(option.name)
      }
    } catch (translateError) {
      setMessageTranslations((current) => ({
        ...current,
        [translationKey]: {
          error: translateError instanceof Error ? translateError.message : '翻译失败',
        },
      }))
    } finally {
      pendingMessageTranslationKeysRef.current.delete(translationKey)
    }
  }

  async function translateDraftToTarget() {
    if (!history || !assistantDraft.trim() || draftTranslationBusy) {
      return
    }
    if (translationAgents.length === 0) {
      setAssistantNotice('管理员后台还没有启用翻译智能体')
      return
    }

    const option = resolveLanguageOption(draftTargetLanguage, draftTargetLanguageName)
    setDraftTranslationBusy(true)
    setTranslatedDraft('')

    try {
      const response = await translateText({
        account_id: history.chat.account_id,
        text: assistantDraft.trim(),
        target_language: option.code,
        target_language_name: option.name,
      })
      setTranslatedDraft(response.translation.translated_text)
      setAssistantNotice(`已翻译成${option.name}。`)
    } catch (translateError) {
      setAssistantNotice(translateError instanceof Error ? translateError.message : '翻译草稿失败')
    } finally {
      setDraftTranslationBusy(false)
    }
  }

  async function handleAnalyzeStatusCard() {
    if (!selectedChatId || statusCardBusy) {
      return
    }
    const activeAgent = statusCardAgents[0]
    if (!activeAgent) {
      setStatusCardNotice('管理员后台还没有启用状态卡智能体')
      return
    }

    setStatusCardBusy(true)
    setStatusCardNotice(undefined)
    setError(undefined)

    try {
      const response = await analyzeStatusCard({
        chat_id: selectedChatId,
        agent_id: activeAgent.id,
      })
      setStatusCard(response.status_card)
    } catch (analyzeError) {
      setStatusCardNotice(analyzeError instanceof Error ? analyzeError.message : '状态卡分析失败')
    } finally {
      setStatusCardBusy(false)
    }
  }

  async function handleGenerateAssistantDraft() {
    if (!selectedChatId || !history || assistantBusy) {
      return
    }

    setAssistantBusy(true)
    setAssistantNotice(undefined)
    setError(undefined)
    setAssistantRun(undefined)
    setAssistantDraft('')
    setTranslatedDraft('')

    try {
      if (!selectedReplyAgentId) {
        setAssistantNotice('请先选择回复智能体')
        return
      }

      await streamGenerateAgentRun(
        {
          chat_id: selectedChatId,
          agent_id: selectedReplyAgentId,
          context_enabled: assistantContextEnabled,
          context_message_limit: assistantContextLimit,
        },
        {
          onStart: (run) => {
            setAssistantRun(run)
          },
          onDelta: (text) => {
            setAssistantDraft((current) => current + text)
          },
          onComplete: (run) => {
            setAssistantRun(run)
            setAssistantDraft((current) => run.output_draft ?? current)
            setAssistantNotice(getAssistantRunNotice(run))
          },
          onError: (message, run) => {
            if (run) {
              setAssistantRun(run)
              setAssistantDraft((current) => run.output_draft ?? current)
            }
            setAssistantNotice(message)
          },
        },
      )

      void loadChatsList(true)
      void loadHistory(selectedChatId, true)
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : '生成 Agent 草稿失败')
    } finally {
      setAssistantBusy(false)
    }
  }

  function handleWriteAssistantDraft() {
    const content = getOutboundDraft(assistantDraft, translatedDraft)
    if (!content) {
      return
    }

    setDraftMessage(content)
    setAssistantNotice('已写回输入框，发送前还能继续改。')
  }

  async function handleSendAssistantDraft() {
    const outboundDraft = getOutboundDraft(assistantDraft, translatedDraft)
    if (!selectedChatId || !assistantRun || !outboundDraft || assistantSending) {
      return
    }

    setAssistantSending(true)
    setAssistantNotice(undefined)
    setError(undefined)

    try {
      const response = await sendAgentRun(assistantRun.id, {
        message_text: outboundDraft,
      })
      setAssistantRun(response.run)
      setAssistantDraft(response.run.output_draft ?? assistantDraft)
      setAssistantNotice('Agent 草稿已发送。')
      pendingScrollModeRef.current = 'bottom'
      keepTimelinePinnedRef.current = true
      void loadHistory(selectedChatId, true)
      void loadChatsList(true)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '发送 Agent 草稿失败')
    } finally {
      setAssistantSending(false)
    }
  }

  function appendOptimisticMessage(
    response: {
      chat_id: string
      wa_chat_jid: string
      wa_message_id: string
      message_text: string
      sent_at: string
    },
    chatHeader: ChatHeader,
    chatSummary: ChatSummary,
  ) {
    const optimisticMessage: MessageView = {
      id: `optimistic-${response.wa_message_id}`,
      account_id: chatHeader.account_id,
      chat_id: chatHeader.id,
      wa_message_id: response.wa_message_id,
      sender_jid: 'me',
      from_me: true,
      message_type: 'text',
      text_content: response.message_text,
      sent_at: response.sent_at,
      media: [],
    }

    setHistory((current) => {
      if (!current || current.chat.id !== response.chat_id) {
        return current
      }

      const deduped = current.messages.filter(
        (message) => message.wa_message_id !== response.wa_message_id,
      )

      return {
        ...current,
        chat: {
          ...current.chat,
          last_message_at: response.sent_at,
        },
        messages: [...deduped, optimisticMessage],
      }
    })

    setChats((current) =>
      current.map((chat) =>
        chat.id === chatSummary.id
          ? {
              ...chat,
              last_message_at: response.sent_at,
              latest_message_preview: response.message_text,
              latest_message_type: 'text',
              latest_from_me: true,
            }
          : chat,
      ),
    )
  }

  function handleMediaLayoutReady() {
    if (!isNearBottom(timelineRef.current)) {
      keepTimelinePinnedRef.current = false
      return
    }

    window.requestAnimationFrame(() => {
      scrollTimelineToBottom()
    })
  }

  const activeStatusCardAgent = statusCardAgents[0]
  const selectedChat = chats.find((item) => item.id === selectedChatId)
  const hasSystemAssistantFallback = Boolean(history && selectedChat)
  const canGenerateAssistantDraft = Boolean(
    selectedChatId &&
      history &&
      hasSystemAssistantFallback &&
      selectedReplyAgentId &&
      !assistantBusy,
  )
  const canUseAssistantDraft = Boolean(
    assistantRun?.status === 'ready_for_review' && assistantDraft.trim(),
  )
  const canSendInCurrentChat = Boolean(
    history && isChatSendable(history.chat.wa_chat_jid, history.chat.chat_type),
  )
  const canSendMessage = Boolean(canSendInCurrentChat && draftMessage.trim() && !sending)
  const canAnalyzeStatusCard = Boolean(selectedChatId && history && activeStatusCardAgent && !statusCardBusy)
  const sendBlockReason =
    history && !canSendInCurrentChat
      ? getChatSendBlockedReason(history.chat.wa_chat_jid, history.chat.chat_type)
      : undefined

  return (
    <div className="page page-chats whatsapp-chat-page">
      <section className="chat-frame whatsapp-chat-frame">
        <aside className="panel chat-sidebar-panel whatsapp-chat-sidebar">
          <div className="whatsapp-chat-sidebar-header">
            <div>
              <h2>聊天</h2>
            </div>
            <span className="subtle-text">{listLoading ? '同步中...' : `${chats.length} 个会话`}</span>
          </div>

          <label className="field whatsapp-chat-search-field">
            <span className="visually-hidden">搜索会话</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索或开始新聊天"
            />
          </label>

          <div className="whatsapp-chat-filter-bar">
            <label className="field compact-field">
              <span>账号</span>
              <select
                value={selectedAccountId}
                onChange={(event) => {
                  setSelectedAccountId(event.target.value)
                  setSelectedChatId(undefined)
                }}
              >
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
          </div>

          {chats.length > 0 ? (
            <div className="chat-list-scroll whatsapp-chat-list-scroll">
              <div className="chat-list whatsapp-chat-list">
                {chats.map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    className={`chat-row whatsapp-chat-row${selectedChatId === chat.id ? ' selected' : ''}`}
                    onClick={() => startTransition(() => setSelectedChatId(chat.id))}
                  >
                    <div className="whatsapp-chat-avatar" aria-hidden="true">
                      {getChatAvatarLabel(getChatDisplayName(chat))}
                    </div>

                    <div className="whatsapp-chat-row-content">
                      <div className="chat-row-header whatsapp-chat-row-header">
                        <strong>{getChatDisplayName(chat)}</strong>
                        <small>{formatDateTime(chat.last_message_at)}</small>
                      </div>

                      <div className="chat-row-meta whatsapp-chat-row-meta">
                        <p>{getChatPreviewText(chat)}</p>
                        <StatusBadge status={chat.chat_type} />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <EmptyPanel
              title="没有找到会话"
              description="先确认账号已成功接入，再按账号、类型或关键字筛选。"
            />
          )}
        </aside>

        <section className="panel chat-main-panel whatsapp-chat-main">
          {selectedChat && history ? (
            <>
              <div className="chat-stage-header whatsapp-chat-stage-header">
                <div className="whatsapp-chat-contact">
                  <div className="whatsapp-chat-avatar large" aria-hidden="true">
                    {getChatAvatarLabel(getChatDisplayName(history.chat))}
                  </div>
                  <div>
                    <h3>{getChatDisplayName(history.chat)}</h3>
                    <p className="subtle-text">{history.chat.wa_chat_jid}</p>
                  </div>
                </div>

                <div className="chat-stage-meta whatsapp-chat-stage-meta">
                  <StatusBadge status={history.chat.chat_type} />
                  <span>{history.messages.length} 条已加载消息</span>
                </div>
              </div>

              <div className="whatsapp-history-toolbar">
                {history.has_more ? (
                  <button className="secondary-button" type="button" onClick={() => void loadMoreMessages()}>
                    {historyLoading ? '正在加载更早消息...' : '查看更多消息'}
                  </button>
                ) : null}
              </div>

              <div ref={timelineRef} className="message-timeline whatsapp-message-timeline">
                {history.messages.map((message) => {
                  const textContent = message.text_content?.trim()
                  const hasMedia = message.media.length > 0

                  return (
                    <article
                      key={message.id}
                      className={`message-card whatsapp-message-card${message.from_me ? ' own' : ''}${hasMedia ? ' media-message' : ''}`}
                    >
                      {!message.from_me ? (
                        <div className="message-meta">
                          <strong>{getMessageSenderName(message)}</strong>
                          <span>{formatDateTime(message.sent_at)}</span>
                        </div>
                      ) : null}

                      {hasMedia ? (
                        <div className="media-block-list">
                          {message.media.map((media) => renderMediaAttachment(media, handleMediaLayoutReady))}
                        </div>
                      ) : null}

                      {textContent ? (
                        <p className={hasMedia ? 'message-caption' : undefined}>{textContent}</p>
                      ) : !hasMedia ? (
                        <p className="message-fallback">{fallbackMessageCopy(message.message_type)}</p>
                      ) : null}

                      {renderMessageTranslation(
                        messageTranslations[getMessageTranslationKey(message)],
                        canOfferMessageTranslation(message) && translationAgents.length > 0
                          ? () => void translateMessageToChinese(message)
                          : undefined,
                      )}

                      <div className="whatsapp-message-foot">
                        <span>{formatDateTime(message.sent_at)}</span>
                        {message.from_me ? <span className="whatsapp-message-check">✓✓</span> : null}
                      </div>
                    </article>
                  )
                })}
              </div>

              <div className="chat-compose-panel whatsapp-chat-compose">
                {sendBlockReason ? <div className="warning-banner">{sendBlockReason}</div> : null}

                <div className="whatsapp-chat-compose-shell">
                  <div className="whatsapp-compose-attachment" ref={composeAttachmentRef}>
                    <button
                      className={`whatsapp-compose-utility${attachmentMenuOpen ? ' active' : ''}`}
                      type="button"
                      aria-label="更多操作"
                      aria-haspopup="menu"
                      aria-expanded={attachmentMenuOpen}
                      onClick={() => setAttachmentMenuOpen((current) => !current)}
                      disabled={!canSendInCurrentChat || sending}
                    >
                      <Icon name="plus" />
                    </button>

                    {attachmentMenuOpen ? (
                      <div className="whatsapp-attachment-menu" role="menu">
                        {attachmentActions.map((action) => (
                          <button
                            key={action.key}
                            className="whatsapp-attachment-item"
                            type="button"
                            role="menuitem"
                            onClick={() => handleAttachmentAction(action.key)}
                          >
                            <span className={`attachment-icon tone-${action.tone}`} aria-hidden="true">
                              <Icon name={action.icon} />
                            </span>
                            <span>{action.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <input
                      ref={documentInputRef}
                      className="visually-hidden"
                      type="file"
                      onChange={(event) => {
                        void handleAttachmentFiles('document', event.currentTarget.files)
                        event.currentTarget.value = ''
                      }}
                    />
                    <input
                      ref={mediaInputRef}
                      className="visually-hidden"
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      onChange={(event) => {
                        void handleAttachmentFiles('media', event.currentTarget.files)
                        event.currentTarget.value = ''
                      }}
                    />
                    <input
                      ref={cameraInputRef}
                      className="visually-hidden"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(event) => {
                        void handleAttachmentFiles('camera', event.currentTarget.files)
                        event.currentTarget.value = ''
                      }}
                    />
                    <input
                      ref={audioInputRef}
                      className="visually-hidden"
                      type="file"
                      accept="audio/*"
                      onChange={(event) => {
                        void handleAttachmentFiles('audio', event.currentTarget.files)
                        event.currentTarget.value = ''
                      }}
                    />
                  </div>

                  <div className="chat-compose-box whatsapp-chat-compose-box">
                    <textarea
                      value={draftMessage}
                      onChange={(event) => setDraftMessage(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          void handleSendMessage()
                        }
                      }}
                      placeholder={canSendInCurrentChat ? '输入消息' : '当前会话不支持发送消息'}
                      rows={3}
                      disabled={!canSendInCurrentChat}
                    />
                  </div>

                  <button
                    className="primary-button whatsapp-send-button"
                    type="button"
                    onClick={() => void handleSendMessage()}
                    disabled={!canSendMessage}
                  >
                    <Icon name="send" />
                    <span>{sending ? '发送中...' : '发送'}</span>
                  </button>
                </div>

                <div className="whatsapp-compose-meta">
                  <span className="field-hint">当前会话：{getChatDisplayName(history.chat)}</span>
                </div>
                {composeNotice ? <div className="compose-attachment-notice">{composeNotice}</div> : null}
              </div>
            </>
          ) : (
            <EmptyPanel
              title="先选择一个聊天"
              description="左边点一条会话，右边就会进入固定高度的聊天工作区。"
            />
          )}
        </section>

        <aside className="panel chat-assistant-panel whatsapp-chat-assistant">
          <div className="whatsapp-assistant-header">
            <div className="assistant-header-title">
              <p className="eyebrow">AI 助手</p>
              <h3>对话辅助</h3>
            </div>
            <div className="assistant-header-controls">
              {replyAgents.length ? (
                <select
                  className="assistant-header-select"
                  value={selectedReplyAgentId}
                  onChange={(event) => {
                    setSelectedReplyAgentId(event.target.value)
                    setAssistantRun(undefined)
                    setAssistantDraft('')
                    setTranslatedDraft('')
                  }}
                  disabled={assistantBusy}
                >
                  {replyAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              ) : null}

              <label className="checkbox-row assistant-context-toggle">
                <input
                  type="checkbox"
                  checked={assistantContextEnabled}
                  onChange={(event) => setAssistantContextEnabled(event.target.checked)}
                />
                <span>携带上下文</span>
              </label>

              <label className="field compact-field assistant-context-limit-field">
                <span>历史条数</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={assistantContextLimit}
                  disabled={!assistantContextEnabled}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    setAssistantContextLimit(Number.isFinite(next) ? next : 12)
                  }}
                />
              </label>
            </div>
          </div>

          {selectedChat && history ? (
            <div className="assistant-panel-body whatsapp-assistant-body">
              <div className="assistant-reply-column">
                <section className="assistant-card assistant-reply-card">
                  {agentConfigsLoading ? (
                    <div className="warning-banner">加载中...</div>
                  ) : replyAgents.length ? null : (
                    <div className="warning-banner">未启用回复智能体。</div>
                  )}

                  {replyAgents.length ? (
                    <button
                      className="secondary-button assistant-action-button"
                      type="button"
                      onClick={() => void handleGenerateAssistantDraft()}
                      disabled={!canGenerateAssistantDraft}
                    >
                      {assistantBusy ? '生成中...' : '生成回复建议'}
                    </button>
                  ) : null}

                  {assistantRun ? (
                    <div className="assistant-chip-row">
                      <StatusBadge status={assistantRun.status} />
                    </div>
                  ) : null}
                </section>

                <section className="assistant-card assistant-draft-card">
                  <div className="assistant-card-header-row">
                    <span className="assistant-section-label">草稿</span>
                    <div className="assistant-inline-actions">
                      <button
                        className="secondary-button assistant-mini-button"
                        type="button"
                        onClick={handleWriteAssistantDraft}
                        disabled={!canUseAssistantDraft}
                      >
                        写回
                      </button>
                      <button
                        className="primary-button assistant-mini-button"
                        type="button"
                        onClick={() => void handleSendAssistantDraft()}
                        disabled={!canUseAssistantDraft || !canSendInCurrentChat || assistantSending}
                      >
                        {assistantSending ? '发送中...' : '发送'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="assistant-draft-box"
                    ref={assistantDraftRef}
                    value={assistantDraft}
                    onChange={(event) => setAssistantDraft(event.target.value)}
                    placeholder="生成后会出现在这里"
                    rows={7}
                  />
                  <div className="assistant-translation-row">
                    <label className="field compact-field">
                      <span>译文语种</span>
                      <select
                        value={draftTargetLanguage}
                        onChange={(event) => {
                          const option = resolveLanguageOption(event.target.value)
                          setDraftTargetLanguage(option.code)
                          setDraftTargetLanguageName(option.name)
                          setTranslatedDraft('')
                        }}
                      >
                        {languageOptions.map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="secondary-button assistant-action-button"
                      type="button"
                      onClick={() => void translateDraftToTarget()}
                      disabled={!assistantDraft.trim() || translationAgents.length === 0 || draftTranslationBusy}
                    >
                      {draftTranslationBusy ? '翻译中...' : '翻译草稿'}
                    </button>
                  </div>
                  {translatedDraft ? (
                    <textarea
                      className="assistant-draft-box assistant-translated-draft"
                      value={translatedDraft}
                      onChange={(event) => setTranslatedDraft(event.target.value)}
                      rows={5}
                    />
                  ) : null}
                  {assistantRun?.block_reason ? (
                    <div className="warning-banner">{assistantRun.block_reason}</div>
                  ) : null}
                  {assistantNotice ? <div className="success-banner">{assistantNotice}</div> : null}
                </section>
              </div>

              <div className="assistant-status-column">
                <section className="assistant-card assistant-status-card">
                  <div className="assistant-card-header-row">
                    <div className="assistant-title-stack">
                      <span className="assistant-section-label">用户状态卡</span>
                      {statusCard ? (
                        <span className="assistant-muted-count">{statusCard.message_count} 条记录</span>
                      ) : null}
                    </div>
                    <button
                      className="secondary-button assistant-mini-button"
                      type="button"
                      onClick={() => void handleAnalyzeStatusCard()}
                      disabled={!canAnalyzeStatusCard}
                    >
                      {statusCardBusy ? '分析中...' : statusCard ? '重分析' : '分析'}
                    </button>
                  </div>

                  {agentConfigsLoading ? (
                    <div className="warning-banner">加载中...</div>
                  ) : !activeStatusCardAgent ? (
                    <div className="warning-banner">未启用状态卡智能体。</div>
                  ) : statusCard ? (
                    <div className="assistant-status-body">
                      <div className="assistant-status-metrics">
                        <StatusMetric label="当前阶段" value={statusCard.current_stage || '未判断'} />
                        <StatusMetric
                          label="当前风险"
                          value={statusCard.current_risk || '未判断'}
                          tone={getRiskTone(statusCard.current_risk)}
                        />
                      </div>
                      <div className="assistant-status-group">
                        <span>客户类型</span>
                        <div className="assistant-chip-row">
                          {(statusCard.customer_types.length ? statusCard.customer_types : ['未判断']).map((item) => (
                            <span className="toolbar-chip" key={item}>
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                      {statusCard.summary ? <p className="assistant-status-summary">{statusCard.summary}</p> : null}
                      {statusCard.evidence.length ? (
                        <ul className="assistant-evidence-list">
                          {statusCard.evidence.slice(0, 3).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ) : null}
                      {statusCard.next_action ? (
                        <div className="assistant-next-action">
                          <span>下一步</span>
                          <p>{statusCard.next_action}</p>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="assistant-status-empty">未分析</p>
                  )}

                  {statusCardNotice ? <div className="warning-banner">{statusCardNotice}</div> : null}
                </section>
              </div>

            </div>
          ) : (
            <EmptyPanel title="先选一个会话" description="右侧助手会基于当前聊天上下文工作。" />
          )}
        </aside>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  )
}

function StatusMetric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'low' | 'medium' | 'high'
}) {
  return (
    <div className={`assistant-status-metric${tone ? ` tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function getRiskTone(value: string): 'low' | 'medium' | 'high' | undefined {
  const normalized = value.trim()
  if (normalized === '高') {
    return 'high'
  }
  if (normalized === '中') {
    return 'medium'
  }
  if (normalized === '低') {
    return 'low'
  }
  return undefined
}

function renderMessageTranslation(state?: TranslationState, onTranslate?: () => void) {
  if (state?.translation) {
    return (
      <div className="message-translation-box">
        <span className="message-translation-label">
          {formatTranslationSourceLabel(state.translation)}
        </span>
        <p className="message-translation-text">{state.translation.translated_text}</p>
      </div>
    )
  }

  if (state?.loading) {
    return <div className="message-translation-box muted">翻译中...</div>
  }

  if (state?.error) {
    return (
      <div className="message-translation-box muted">
        <span>{state.error}</span>
        {onTranslate ? (
          <button className="message-translation-action" type="button" onClick={onTranslate}>
            重新翻译
          </button>
        ) : null}
      </div>
    )
  }

  if (onTranslate) {
    return (
      <div className="message-translation-box">
        <button className="message-translation-action" type="button" onClick={onTranslate}>
          翻译成中文
        </button>
      </div>
    )
  }

  return null
}

function renderMediaAttachment(
  media: MessageView['media'][number],
  onMediaLayoutReady: () => void,
) {
  const mediaUrl = getMediaAssetUrl(media.id)
  const label = media.file_name || media.media_type

  if (
    (media.media_type === 'image' || media.media_type === 'sticker') &&
    media.download_status === 'ready'
  ) {
    return (
      <figure key={media.id} className={`media-preview-card ${media.media_type}`}>
        <img
          className={`media-preview-image${media.media_type === 'sticker' ? ' sticker' : ''}`}
          src={mediaUrl}
          alt={label}
          loading="lazy"
          onLoad={onMediaLayoutReady}
        />
      </figure>
    )
  }

  if (media.media_type === 'video' && media.download_status === 'ready') {
    return (
      <figure key={media.id} className="media-preview-card video">
        <video
          className="media-preview-video"
          src={mediaUrl}
          controls
          preload="metadata"
          onLoadedMetadata={onMediaLayoutReady}
        />
      </figure>
    )
  }

  if (media.media_type === 'audio' && media.download_status === 'ready') {
    return (
      <figure key={media.id} className="media-preview-card audio">
        <audio
          className="media-preview-audio"
          src={mediaUrl}
          controls
          preload="metadata"
          onLoadedMetadata={onMediaLayoutReady}
        />
      </figure>
    )
  }

  if (media.download_status === 'ready') {
    return (
      <a
        key={media.id}
        className="media-document-card"
        href={mediaUrl}
        target="_blank"
        rel="noreferrer"
      >
        <span className="media-document-icon" aria-hidden="true">
          <Icon name={getMediaDocumentIconName(media.media_type)} />
        </span>
        <span>
          <strong>{label}</strong>
          <small>{media.media_type}</small>
        </span>
      </a>
    )
  }

  return (
    <span key={media.id} className={`media-chip status-${media.download_status}`}>
      {media.file_name || media.media_type}
      {media.download_status === 'failed' ? ' · 下载失败' : ' · 下载中'}
    </span>
  )
}

function getMediaDocumentIconName(mediaType: string): IconName {
  if (mediaType === 'audio') {
    return 'audio'
  }
  if (mediaType === 'video') {
    return 'video'
  }
  if (mediaType === 'image' || mediaType === 'sticker') {
    return 'image'
  }
  return 'fileText'
}

function choosePreferredChatId(chats: ChatSummary[], current?: string) {
  if (current && chats.some((chat) => chat.id === current)) {
    return current
  }

  const firstSendable = chats.find((chat) => isChatSendable(chat.wa_chat_jid, chat.chat_type))
  return firstSendable?.id ?? chats[0]?.id
}

function getChatDisplayName(chat: ChatDisplaySource) {
  const title = chat.title?.trim()
  if (title && isRawChatTitle(title, chat.wa_chat_jid) && chat.chat_type === 'group') {
    return formatGroupFallback(chat)
  }

  if (title && title !== '0') {
    return title
  }

  if (chat.chat_type === 'group') {
    return formatGroupFallback(chat)
  }

  if (!isChatSendable(chat.wa_chat_jid, chat.chat_type)) {
    return '系统会话'
  }

  return formatChatIdentifier(chat.wa_chat_jid)
}

function getChatPreviewText(chat: ChatSummary) {
  const preview = chat.latest_message_preview?.trim()
  if (preview) {
    return preview
  }

  if (!isChatSendable(chat.wa_chat_jid, chat.chat_type)) {
    return '系统消息'
  }

  return fallbackMessageCopy(chat.latest_message_type)
}

function getMessageSenderName(message: MessageView) {
  const senderName = message.sender_name?.trim()
  if (senderName && senderName !== '0') {
    return senderName
  }

  return formatChatIdentifier(message.sender_jid)
}

function isRawChatTitle(title: string, chatJID: string) {
  const normalizedTitle = title.trim().toLowerCase()
  const normalizedJID = chatJID.trim().toLowerCase()
  const [jidUser] = normalizedJID.split('@')

  return normalizedTitle === normalizedJID || normalizedTitle === jidUser
}

function formatGroupFallback(chat: ChatDisplaySource) {
  if (chat.participant_count && chat.participant_count > 0) {
    return `群聊 · ${chat.participant_count}人`
  }

  return '群聊'
}

function formatChatIdentifier(chatJID: string) {
  const trimmed = chatJID.trim()
  if (!trimmed) {
    return '未知联系人'
  }

  const [user] = trimmed.split('@')
  return user || trimmed
}

function isChatSendable(chatJID: string, chatType: ChatType) {
  const normalized = chatJID.trim().toLowerCase()

  if (!normalized) {
    return false
  }

  if (chatType === 'status' || chatType === 'broadcast') {
    return false
  }

  if (normalized === '0@s.whatsapp.net') {
    return false
  }

  if (normalized.startsWith('status@')) {
    return false
  }

  return true
}

function getChatSendBlockedReason(chatJID: string, chatType: ChatType) {
  if (chatType === 'status' || chatType === 'broadcast') {
    return '当前会话属于系统广播 / 状态同步，不支持直接发送消息。'
  }

  if (chatJID.trim().toLowerCase() === '0@s.whatsapp.net') {
    return '这是 WhatsApp 的系统会话，不是可直接聊天的联系人，所以不能发送消息。'
  }

  return '当前会话不支持发送消息，请切换到真实联系人或群聊。'
}

function isNearBottom(element: HTMLDivElement | null) {
  if (!element) {
    return true
  }

  const distance = element.scrollHeight - element.scrollTop - element.clientHeight
  return distance < 56
}

function getMessageTranslationKey(message: MessageView, rawText?: string) {
  const text = (rawText ?? message.text_content ?? '').trim()
  if (!message.account_id || !message.id || !text) {
    return ''
  }

  return `${message.account_id}:${message.id}:${hashText(text)}`
}

function canOfferMessageTranslation(message: MessageView) {
  const text = message.text_content?.trim()
  return Boolean(text && needsChineseTranslation(text))
}

function isMessageTranslationLocked(state?: TranslationState) {
  return Boolean(state?.loading || state?.translation)
}

function hashText(value: string) {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}

function loadMessageTranslationCache(): Record<string, TranslationState> {
  const stored = readStoredMessageTranslationCache()
  return Object.fromEntries(
    Object.entries(stored).map(([key, value]) => [key, { translation: value.translation }]),
  )
}

function persistMessageTranslation(key: string, translation: TranslationView) {
  if (!key) {
    return
  }

  const stored = readStoredMessageTranslationCache()
  stored[key] = {
    cached_at: new Date().toISOString(),
    translation,
  }

  writeStoredMessageTranslationCache(trimStoredMessageTranslationCache(stored))
}

function readStoredMessageTranslationCache(): Record<string, StoredMessageTranslation> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(messageTranslationCacheStorageKey)
    if (!raw) {
      return {}
    }
    const decoded = JSON.parse(raw)
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(decoded).filter((entry): entry is [string, StoredMessageTranslation] => {
        const value = entry[1]
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return false
        }
        const candidate = value as Partial<StoredMessageTranslation>
        return Boolean(candidate.cached_at && isTranslationView(candidate.translation))
      }),
    )
  } catch {
    return {}
  }
}

function writeStoredMessageTranslationCache(cache: Record<string, StoredMessageTranslation>) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(messageTranslationCacheStorageKey, JSON.stringify(cache))
  } catch {
    // Ignore local cache write failures; translation still renders from in-memory state.
  }
}

function trimStoredMessageTranslationCache(cache: Record<string, StoredMessageTranslation>) {
  const entries = Object.entries(cache)
  if (entries.length <= messageTranslationCacheLimit) {
    return cache
  }

  return Object.fromEntries(
    entries
      .sort((left, right) => left[1].cached_at.localeCompare(right[1].cached_at))
      .slice(-messageTranslationCacheLimit),
  )
}

function isTranslationView(value: unknown): value is TranslationView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const candidate = value as Partial<TranslationView>
  return typeof candidate.translated_text === 'string'
}

function formatTranslationSourceLabel(translation: TranslationView) {
  const code = translation.source_language_code?.trim()
  const name = getLocalizedLanguageName(code, translation.source_language_name)

  if (code && code.toLowerCase() !== 'unknown') {
    return `原文语种：${name} (${code}) · 中文翻译`
  }

  return `原文语种：${name} · 中文翻译`
}

function getLocalizedLanguageName(code?: string, fallback?: string) {
  const normalizedCode = code?.trim()
  if (normalizedCode && normalizedCode.toLowerCase() !== 'unknown') {
    try {
      return new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of(normalizedCode) ?? normalizedCode
    } catch {
      return fallback?.trim() || normalizedCode
    }
  }

  const normalizedFallback = fallback?.trim()
  if (normalizedFallback && normalizedFallback.toLowerCase() !== 'unknown') {
    return normalizedFallback
  }

  return '未识别'
}

function needsChineseTranslation(text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    return false
  }
  return !/[\u3400-\u9fff]/.test(trimmed)
}

function isChineseLanguage(languageCode?: string) {
  return (languageCode ?? '').trim().toLowerCase().startsWith('zh')
}

function resolveLanguageOption(code?: string, name?: string) {
  const normalized = (code ?? '').trim().toLowerCase()
  const exact = languageOptions.find((option) => option.code === normalized)
  if (exact) {
    return exact
  }

  const prefix = languageOptions.find((option) => normalized.startsWith(option.code))
  if (prefix) {
    return prefix
  }

  if (normalized && !isChineseLanguage(normalized)) {
    return { code: normalized, name: name?.trim() || normalized }
  }

  return languageOptions[0]
}

function getOutboundDraft(chineseDraft: string, translatedText: string) {
  return (translatedText.trim() || chineseDraft.trim())
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

function getChatAvatarLabel(value?: string) {
  const trimmed = (value ?? '').trim()
  if (!trimmed) {
    return '聊'
  }

  const first = trimmed[0]
  if (/[a-z0-9]/i.test(first)) {
    return first.toUpperCase()
  }

  return first
}

function getAttachmentActionLabel(action: AttachmentAction) {
  return attachmentActions.find((item) => item.key === action)?.label ?? '附件'
}

function resolveAttachmentMediaType(kind: AttachmentAction, file: File): SendChatMediaType {
  const mimeType = file.type.toLowerCase()
  if (kind === 'document') {
    return 'document'
  }
  if (kind === 'audio' || mimeType.startsWith('audio/')) {
    return 'audio'
  }
  if (kind === 'camera' || mimeType.startsWith('image/')) {
    return 'image'
  }
  if (mimeType.startsWith('video/')) {
    return 'video'
  }

  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(extension)) {
    return 'image'
  }
  if (extension && ['mp4', 'mov', 'm4v', 'webm', 'mkv'].includes(extension)) {
    return 'video'
  }

  return 'document'
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
    case 'system':
      return '系统消息'
    default:
      return '暂无可直接展示的文本内容'
  }
}
