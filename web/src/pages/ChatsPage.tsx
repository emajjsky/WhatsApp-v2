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
  createAssistantUsageLog,
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
  type AssistantUsageAction,
  type CreateAssistantUsageLogPayload,
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

type AssistantReplyOption = {
  title: string
  strategy?: string
  content: string
}

type AssistantWorkspaceState = {
  run?: AgentRunView
  rawDraft: string
  replyOptions: AssistantReplyOption[]
  adoptedReplyIndex?: number
  draft: string
  translatedDraft: string
  translatedSourceDraft: string
  targetLanguage: string
  targetLanguageName: string
  notice?: string
}

type StoredAssistantWorkspace = AssistantWorkspaceState & {
  cached_at: string
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
  { code: 'es-MX', name: '墨西哥语' },
  { code: 'fr', name: '法语' },
  { code: 'pt', name: '葡萄牙语' },
]

const defaultDraftLanguage = languageOptions[0]
const defaultAssistantContextLimit = 20

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
const assistantWorkspaceStorageKey = 'whatsapp.assistantWorkspace.v2'
const assistantWorkspaceCacheLimit = 160

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
  const [historyLoading, setHistoryLoading] = useState(false)
  const [sendingByChatId, setSendingByChatId] = useState<Record<string, boolean>>({})
  const [draftMessageByChatId, setDraftMessageByChatId] = useState<Record<string, string>>({})
  const [error, setError] = useState<string>()
  const [composeNoticeByChatId, setComposeNoticeByChatId] = useState<Record<string, string>>({})
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false)
  const [assistantRun, setAssistantRun] = useState<AgentRunView>()
  const [, setAssistantRawDraft] = useState('')
  const [assistantReplyOptions, setAssistantReplyOptions] = useState<AssistantReplyOption[]>([])
  const [adoptedReplyIndex, setAdoptedReplyIndex] = useState<number>()
  const [assistantDraft, setAssistantDraft] = useState('')
  const [messageTranslations, setMessageTranslations] =
    useState<Record<string, TranslationState>>(loadMessageTranslationCache)
  const [draftTargetLanguage, setDraftTargetLanguage] = useState(defaultDraftLanguage.code)
  const [draftTargetLanguageName, setDraftTargetLanguageName] = useState(defaultDraftLanguage.name)
  const [translatedDraft, setTranslatedDraft] = useState('')
  const [translatedSourceDraft, setTranslatedSourceDraft] = useState('')
  const [draftTranslationBusyByChatId, setDraftTranslationBusyByChatId] = useState<Record<string, boolean>>({})
  const [assistantContextEnabled, setAssistantContextEnabled] = useState(true)
  const [assistantContextLimit, setAssistantContextLimit] = useState(defaultAssistantContextLimit)
  const [replyAgents, setReplyAgents] = useState<SystemAgentConfigView[]>([])
  const [translationAgents, setTranslationAgents] = useState<SystemAgentConfigView[]>([])
  const [statusCardAgents, setStatusCardAgents] = useState<SystemAgentConfigView[]>([])
  const [selectedReplyAgentId, setSelectedReplyAgentId] = useState('')
  const [statusCard, setStatusCard] = useState<StatusCardView>()
  const [statusCardBusyByChatId, setStatusCardBusyByChatId] = useState<Record<string, boolean>>({})
  const [statusCardNotice, setStatusCardNotice] = useState<string>()
  const [statusCardCollapsed, setStatusCardCollapsed] = useState(false)
  const [agentConfigsLoading, setAgentConfigsLoading] = useState(true)
  const [assistantBusyByChatId, setAssistantBusyByChatId] = useState<Record<string, boolean>>({})
  const [assistantSendingByChatId, setAssistantSendingByChatId] = useState<Record<string, boolean>>({})
  const [assistantNotice, setAssistantNotice] = useState<string>()
  const timelineRef = useRef<HTMLDivElement>(null)
  const assistantDraftRef = useRef<HTMLTextAreaElement>(null)
  const assistantWorkspaceCacheRef = useRef<Record<string, StoredAssistantWorkspace>>(
    readStoredAssistantWorkspaceCache(),
  )
  const activeAssistantChatIdRef = useRef<string | undefined>(undefined)
  const composeAttachmentRef = useRef<HTMLDivElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const pendingMessageTranslationKeysRef = useRef<Set<string>>(new Set())
  const keepTimelinePinnedRef = useRef(true)
  const pendingScrollModeRef = useRef<'bottom' | 'preserve' | 'none'>('bottom')
  const historyRequestSeqRef = useRef(0)
  const statusCardRequestSeqRef = useRef(0)
  const previousTimelineMetricsRef = useRef<
    { scrollHeight: number; scrollTop: number } | undefined
  >(undefined)
  const assistantBusy = selectedChatId ? Boolean(assistantBusyByChatId[selectedChatId]) : false
  const draftTranslationBusy = selectedChatId ? Boolean(draftTranslationBusyByChatId[selectedChatId]) : false
  const assistantSending = selectedChatId ? Boolean(assistantSendingByChatId[selectedChatId]) : false
  const sending = selectedChatId ? Boolean(sendingByChatId[selectedChatId]) : false
  const draftMessage = selectedChatId ? draftMessageByChatId[selectedChatId] ?? '' : ''
  const composeNotice = selectedChatId ? composeNoticeByChatId[selectedChatId] : undefined
  const statusCardBusy = selectedChatId ? Boolean(statusCardBusyByChatId[selectedChatId]) : false

  const scrollTimelineToBottom = useCallback(() => {
    const timeline = timelineRef.current
    if (!timeline) {
      return
    }

    timeline.scrollTop = timeline.scrollHeight
    keepTimelinePinnedRef.current = true
  }, [])

  const setDraftMessageForChat = useCallback((chatId: string, value: string) => {
    const trimmedChatId = chatId.trim()
    if (!trimmedChatId) {
      return
    }
    setDraftMessageByChatId((current) => {
      if (!value) {
        const next = { ...current }
        delete next[trimmedChatId]
        return next
      }
      return { ...current, [trimmedChatId]: value }
    })
  }, [])

  const setCurrentDraftMessage = useCallback((value: string) => {
    if (!selectedChatId) {
      return
    }
    setDraftMessageForChat(selectedChatId, value)
  }, [selectedChatId, setDraftMessageForChat])

  const setComposeNoticeForChat = useCallback((chatId: string, value?: string) => {
    const trimmedChatId = chatId.trim()
    if (!trimmedChatId) {
      return
    }
    setComposeNoticeByChatId((current) => {
      if (!value) {
        const next = { ...current }
        delete next[trimmedChatId]
        return next
      }
      return { ...current, [trimmedChatId]: value }
    })
  }, [])

  const emptyAssistantWorkspace = useCallback(
    (): AssistantWorkspaceState => ({
      rawDraft: '',
      replyOptions: [],
      adoptedReplyIndex: undefined,
      draft: '',
      translatedDraft: '',
      translatedSourceDraft: '',
      targetLanguage: defaultDraftLanguage.code,
      targetLanguageName: defaultDraftLanguage.name,
    }),
    [],
  )

  const restoreAssistantWorkspace = useCallback((state: AssistantWorkspaceState) => {
    setAssistantRun(state.run)
    setAssistantRawDraft(state.rawDraft)
    setAssistantReplyOptions(state.replyOptions)
    setAdoptedReplyIndex(state.adoptedReplyIndex)
    setAssistantDraft(state.draft)
    setTranslatedDraft(state.translatedDraft)
    setTranslatedSourceDraft(state.translatedSourceDraft)
    setDraftTargetLanguage(state.targetLanguage)
    setDraftTargetLanguageName(state.targetLanguageName)
    setAssistantNotice(state.notice)
  }, [])

  const updateAssistantWorkspaceCache = useCallback((patch: Partial<AssistantWorkspaceState>) => {
    const chatId = activeAssistantChatIdRef.current
    if (!chatId) {
      return
    }
    const current = assistantWorkspaceCacheRef.current[chatId] ?? emptyAssistantWorkspace()
    assistantWorkspaceCacheRef.current[chatId] = {
      ...current,
      ...patch,
      cached_at: new Date().toISOString(),
    }
    writeStoredAssistantWorkspaceCache(trimStoredAssistantWorkspaceCache(assistantWorkspaceCacheRef.current))
  }, [emptyAssistantWorkspace])

  const updateAssistantWorkspaceCacheForChat = useCallback((chatId: string, patch: Partial<AssistantWorkspaceState>) => {
    const trimmedChatId = chatId.trim()
    if (!trimmedChatId) {
      return
    }
    const current = assistantWorkspaceCacheRef.current[trimmedChatId] ?? emptyAssistantWorkspace()
    assistantWorkspaceCacheRef.current[trimmedChatId] = {
      ...current,
      ...patch,
      cached_at: new Date().toISOString(),
    }
    writeStoredAssistantWorkspaceCache(trimStoredAssistantWorkspaceCache(assistantWorkspaceCacheRef.current))
  }, [emptyAssistantWorkspace])

  const getAssistantWorkspaceForChat = useCallback((chatId: string): AssistantWorkspaceState => {
    const trimmedChatId = chatId.trim()
    if (!trimmedChatId) {
      return emptyAssistantWorkspace()
    }
    if (activeAssistantChatIdRef.current === trimmedChatId) {
      return {
        run: assistantRun,
        rawDraft: '',
        replyOptions: assistantReplyOptions,
        adoptedReplyIndex,
        draft: assistantDraft,
        translatedDraft,
        translatedSourceDraft,
        targetLanguage: draftTargetLanguage,
        targetLanguageName: draftTargetLanguageName,
        notice: assistantNotice,
      }
    }
    return assistantWorkspaceCacheRef.current[trimmedChatId] ?? emptyAssistantWorkspace()
  }, [
    adoptedReplyIndex,
    assistantDraft,
    assistantNotice,
    assistantReplyOptions,
    assistantRun,
    draftTargetLanguage,
    draftTargetLanguageName,
    emptyAssistantWorkspace,
    translatedDraft,
    translatedSourceDraft,
  ])

  const applyAssistantWorkspacePatch = useCallback((chatId: string, patch: Partial<AssistantWorkspaceState>) => {
    updateAssistantWorkspaceCacheForChat(chatId, patch)
    if (activeAssistantChatIdRef.current !== chatId) {
      return
    }
    if ('run' in patch) {
      setAssistantRun(patch.run)
    }
    if ('rawDraft' in patch && patch.rawDraft !== undefined) {
      setAssistantRawDraft(patch.rawDraft)
    }
    if ('replyOptions' in patch && patch.replyOptions !== undefined) {
      setAssistantReplyOptions(patch.replyOptions)
    }
    if ('adoptedReplyIndex' in patch) {
      setAdoptedReplyIndex(patch.adoptedReplyIndex)
    }
    if ('draft' in patch && patch.draft !== undefined) {
      setAssistantDraft(patch.draft)
    }
    if ('translatedDraft' in patch && patch.translatedDraft !== undefined) {
      setTranslatedDraft(patch.translatedDraft)
    }
    if ('translatedSourceDraft' in patch && patch.translatedSourceDraft !== undefined) {
      setTranslatedSourceDraft(patch.translatedSourceDraft)
    }
    if ('targetLanguage' in patch && patch.targetLanguage !== undefined) {
      setDraftTargetLanguage(patch.targetLanguage)
    }
    if ('targetLanguageName' in patch && patch.targetLanguageName !== undefined) {
      setDraftTargetLanguageName(patch.targetLanguageName)
    }
    if ('notice' in patch) {
      setAssistantNotice(patch.notice)
    }
  }, [updateAssistantWorkspaceCacheForChat])

  const setAssistantRunState = useCallback((run?: AgentRunView) => {
    setAssistantRun(run)
    updateAssistantWorkspaceCache({ run })
  }, [updateAssistantWorkspaceCache])

  const setAssistantRawDraftState = useCallback((rawDraft: string) => {
    setAssistantRawDraft(rawDraft)
    updateAssistantWorkspaceCache({ rawDraft })
  }, [updateAssistantWorkspaceCache])

  const setAssistantReplyOptionsState = useCallback((replyOptions: AssistantReplyOption[]) => {
    setAssistantReplyOptions(replyOptions)
    updateAssistantWorkspaceCache({ replyOptions })
  }, [updateAssistantWorkspaceCache])

  const setAdoptedReplyIndexState = useCallback((nextAdoptedReplyIndex?: number) => {
    setAdoptedReplyIndex(nextAdoptedReplyIndex)
    updateAssistantWorkspaceCache({ adoptedReplyIndex: nextAdoptedReplyIndex })
  }, [updateAssistantWorkspaceCache])

  const setAssistantDraftState = useCallback((draft: string) => {
    setAssistantDraft(draft)
    updateAssistantWorkspaceCache({ draft })
  }, [updateAssistantWorkspaceCache])

  const setTranslatedDraftState = useCallback((nextTranslatedDraft: string) => {
    setTranslatedDraft(nextTranslatedDraft)
    updateAssistantWorkspaceCache({ translatedDraft: nextTranslatedDraft })
  }, [updateAssistantWorkspaceCache])

  const setTranslatedSourceDraftState = useCallback((nextTranslatedSourceDraft: string) => {
    setTranslatedSourceDraft(nextTranslatedSourceDraft)
    updateAssistantWorkspaceCache({ translatedSourceDraft: nextTranslatedSourceDraft })
  }, [updateAssistantWorkspaceCache])

  const setDraftTargetLanguageState = useCallback((targetLanguage: string, targetLanguageName: string) => {
    setDraftTargetLanguage(targetLanguage)
    setDraftTargetLanguageName(targetLanguageName)
    updateAssistantWorkspaceCache({ targetLanguage, targetLanguageName })
  }, [updateAssistantWorkspaceCache])

  const setAssistantNoticeState = useCallback((notice?: string) => {
    setAssistantNotice(notice)
    updateAssistantWorkspaceCache({ notice })
  }, [updateAssistantWorkspaceCache])

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
        // Chat list refresh is silent after removing the header counter.
      }
    },
    [deferredSearch, selectedAccountId, selectedChatType],
  )

  const loadHistory = useCallback(async (chatId: string, background = false) => {
    const requestSeq = historyRequestSeqRef.current + 1
    historyRequestSeqRef.current = requestSeq
    const requestChatId = chatId.trim()
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
      const response = await getChatMessages(requestChatId, { limit: 60 })
      if (historyRequestSeqRef.current !== requestSeq || activeAssistantChatIdRef.current !== requestChatId) {
        return
      }
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
      if (historyRequestSeqRef.current !== requestSeq || activeAssistantChatIdRef.current !== requestChatId) {
        return
      }
      if (!background) {
        setHistory(undefined)
        setError(loadError instanceof Error ? loadError.message : '加载消息失败')
      }
    } finally {
      if (!background && activeAssistantChatIdRef.current === requestChatId) {
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
      if (statusCardRequestSeqRef.current !== requestSeq || activeAssistantChatIdRef.current !== chatId) {
        return
      }
      setStatusCard(response.status_card ?? undefined)
    } catch (loadError) {
      if (statusCardRequestSeqRef.current !== requestSeq || activeAssistantChatIdRef.current !== chatId) {
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
      historyRequestSeqRef.current += 1
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
    activeAssistantChatIdRef.current = selectedChatId
    restoreAssistantWorkspace(
      selectedChatId
        ? assistantWorkspaceCacheRef.current[selectedChatId] ?? emptyAssistantWorkspace()
        : emptyAssistantWorkspace(),
    )
    setAttachmentMenuOpen(false)
  }, [emptyAssistantWorkspace, restoreAssistantWorkspace, selectedChatId])

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
    if (!selectedChatId || !history?.next_before || history.chat.id !== selectedChatId) {
      return
    }
    const requestChatId = selectedChatId
    const requestBefore = history.next_before
    const requestLimit = history.limit

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
      const response = await getChatMessages(requestChatId, {
        limit: requestLimit,
        before: requestBefore,
      })

      setHistory((current) => {
        if (!current || current.chat.id !== requestChatId || response.chat.id !== requestChatId) {
          return current
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
    if (!selectedChatId || !history || !selectedChat || history.chat.id !== selectedChatId) {
      return
    }

    const requestChatId = selectedChatId
    const requestHistory = history
    const requestSelectedChat = selectedChat
    const content = draftMessage.trim()
    if (!content || sending) {
      return
    }

    if (!isChatSendable(requestHistory.chat.wa_chat_jid, requestHistory.chat.chat_type)) {
      setError(getChatSendBlockedReason(requestHistory.chat.wa_chat_jid, requestHistory.chat.chat_type))
      return
    }

    setSendingByChatId((current) => ({ ...current, [requestChatId]: true }))
    setError(undefined)

    try {
      const response = await sendChatMessage(requestChatId, { message_text: content })
      appendOptimisticMessage(response, requestHistory.chat, requestSelectedChat)
      setDraftMessageForChat(requestChatId, '')
      setComposeNoticeForChat(requestChatId, undefined)
      pendingScrollModeRef.current = 'bottom'
      keepTimelinePinnedRef.current = true
      if (activeAssistantChatIdRef.current === requestChatId) {
        void loadHistory(requestChatId, true)
      }
      void loadChatsList(true)
    } catch (sendError) {
      if (activeAssistantChatIdRef.current === requestChatId) {
        setError(sendError instanceof Error ? sendError.message : '发送消息失败')
      }
    } finally {
      setSendingByChatId((current) => {
        const next = { ...current }
        delete next[requestChatId]
        return next
      })
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
    if (!selectedChatId || !history || !selectedChat || history.chat.id !== selectedChatId) {
      return
    }

    const requestChatId = selectedChatId
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

    setSendingByChatId((current) => ({ ...current, [requestChatId]: true }))
    setError(undefined)

    const caption = kind === 'audio' ? '' : draftMessage.trim()

    try {
      for (const [index, file] of selectedFiles.entries()) {
        setComposeNoticeForChat(requestChatId, `正在发送${getAttachmentActionLabel(kind)}：${file.name}`)
        await sendChatMedia(requestChatId, {
          file,
          mediaType: resolveAttachmentMediaType(kind, file),
          caption: index === 0 ? caption : '',
        })
      }

      if (caption) {
        setDraftMessageForChat(requestChatId, '')
      }
      setComposeNoticeForChat(
        requestChatId,
        `${selectedFiles.length > 1 ? `${selectedFiles.length} 个文件` : selectedFiles[0].name}已发送。`,
      )
      pendingScrollModeRef.current = 'bottom'
      keepTimelinePinnedRef.current = true
      if (activeAssistantChatIdRef.current === requestChatId) {
        void loadHistory(requestChatId, true)
      }
      void loadChatsList(true)
    } catch (sendError) {
      if (activeAssistantChatIdRef.current === requestChatId) {
        setError(sendError instanceof Error ? sendError.message : '发送媒体失败')
      }
    } finally {
      setSendingByChatId((current) => {
        const next = { ...current }
        delete next[requestChatId]
        return next
      })
    }
  }

  async function translateMessageToChinese(message: MessageView) {
    const text = message.text_content?.trim()
    const accountID = message.account_id || history?.chat.account_id
    const requestChatId = message.chat_id
    const translationKey = getMessageTranslationKey(message, text)
    if (!text || !accountID || !requestChatId || !translationKey) {
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
        applyAssistantWorkspacePatch(requestChatId, {
          targetLanguage: option.code,
          targetLanguageName: option.name,
        })
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
    if (!selectedChatId || !history || history.chat.id !== selectedChatId || !assistantDraft.trim() || draftTranslationBusy) {
      return
    }
    if (translationAgents.length === 0) {
      setAssistantNoticeState('管理员后台还没有启用翻译智能体')
      return
    }

    const requestChatId = selectedChatId
    const requestAccountId = history.chat.account_id
    const option = resolveLanguageOption(draftTargetLanguage, draftTargetLanguageName)
    const sourceDraft = assistantDraft.trim()
    setDraftTranslationBusyByChatId((current) => ({ ...current, [requestChatId]: true }))
    applyAssistantWorkspacePatch(requestChatId, {
      notice: undefined,
      translatedDraft: '',
      translatedSourceDraft: sourceDraft,
      targetLanguage: option.code,
      targetLanguageName: option.name,
    })

    try {
      const response = await translateText({
        account_id: requestAccountId,
        text: sourceDraft,
        target_language: option.code,
        target_language_name: option.name,
      })
      const cachedWorkspace = assistantWorkspaceCacheRef.current[requestChatId]
      if (cachedWorkspace?.translatedSourceDraft === sourceDraft) {
        applyAssistantWorkspacePatch(requestChatId, {
          translatedDraft: response.translation.translated_text,
          notice: undefined,
        })
      }
    } catch (translateError) {
      applyAssistantWorkspacePatch(requestChatId, {
        notice: translateError instanceof Error ? translateError.message : '翻译草稿失败',
      })
    } finally {
      setDraftTranslationBusyByChatId((current) => {
        const next = { ...current }
        delete next[requestChatId]
        return next
      })
    }
  }

  async function handleAnalyzeStatusCard() {
    if (!selectedChatId || !history || history.chat.id !== selectedChatId || statusCardBusy) {
      return
    }
    const requestChatId = selectedChatId
    const activeAgent = statusCardAgents[0]
    if (!activeAgent) {
      setStatusCardNotice('管理员后台还没有启用状态卡智能体')
      return
    }

    const requestSeq = statusCardRequestSeqRef.current + 1
    statusCardRequestSeqRef.current = requestSeq
    setStatusCardBusyByChatId((current) => ({ ...current, [requestChatId]: true }))
    setStatusCardNotice(undefined)
    setError(undefined)

    try {
      const response = await analyzeStatusCard({
        chat_id: requestChatId,
        agent_id: activeAgent.id,
      })
      if (statusCardRequestSeqRef.current !== requestSeq || activeAssistantChatIdRef.current !== requestChatId) {
        return
      }
      setStatusCard(response.status_card)
    } catch (analyzeError) {
      if (statusCardRequestSeqRef.current !== requestSeq || activeAssistantChatIdRef.current !== requestChatId) {
        return
      }
      setStatusCardNotice(analyzeError instanceof Error ? analyzeError.message : '状态卡分析失败')
    } finally {
      setStatusCardBusyByChatId((current) => {
        const next = { ...current }
        delete next[requestChatId]
        return next
      })
    }
  }

  async function handleGenerateAssistantDraft() {
    if (!selectedChatId || !history || history.chat.id !== selectedChatId || assistantBusy) {
      return
    }

    const requestChatId = selectedChatId
    setAssistantBusyByChatId((current) => ({ ...current, [requestChatId]: true }))
    setError(undefined)
    applyAssistantWorkspacePatch(requestChatId, {
      run: undefined,
      rawDraft: '',
      replyOptions: [],
      adoptedReplyIndex: undefined,
      draft: '',
      translatedDraft: '',
      translatedSourceDraft: '',
      notice: undefined,
    })

    try {
      if (!selectedReplyAgentId) {
        applyAssistantWorkspacePatch(requestChatId, { notice: '请先选择回复智能体' })
        return
      }

      let streamedDraft = ''
      await streamGenerateAgentRun(
        {
          chat_id: requestChatId,
          agent_id: selectedReplyAgentId,
          context_enabled: assistantContextEnabled,
          context_message_limit: assistantContextLimit,
        },
        {
          onStart: (run) => {
            applyAssistantWorkspacePatch(requestChatId, { run })
          },
          onDelta: (text) => {
            streamedDraft += text
            applyAssistantWorkspacePatch(requestChatId, { rawDraft: streamedDraft })
          },
          onComplete: (run) => {
            const finalDraft = run.output_draft ?? streamedDraft
            const options = parseAssistantReplyOptions(finalDraft)
            applyAssistantWorkspacePatch(requestChatId, {
              run,
              rawDraft: finalDraft,
              replyOptions: options,
              draft: options.length ? '' : finalDraft,
              notice: options.length
                ? undefined
                : `${getAssistantRunNotice(run)} 未识别到可拆分回复，已放入草稿。`,
            })
          },
          onError: (message, run) => {
            if (run) {
              const finalDraft = run.output_draft ?? streamedDraft
              const options = parseAssistantReplyOptions(finalDraft)
              applyAssistantWorkspacePatch(requestChatId, {
                run,
                rawDraft: finalDraft,
                replyOptions: options,
                draft: options.length ? '' : finalDraft,
              })
            }
            applyAssistantWorkspacePatch(requestChatId, { notice: message })
          },
        },
      )

      void loadChatsList(true)
      if (activeAssistantChatIdRef.current === requestChatId) {
        void loadHistory(requestChatId, true)
      }
    } catch (generateError) {
      applyAssistantWorkspacePatch(requestChatId, {
        notice: generateError instanceof Error ? generateError.message : '生成 Agent 草稿失败',
      })
    } finally {
      setAssistantBusyByChatId((current) => {
        const next = { ...current }
        delete next[requestChatId]
        return next
      })
    }
  }

  async function handleWriteAssistantDraft() {
    if (!selectedChatId || !history || !selectedChat || history.chat.id !== selectedChatId) {
      return
    }

    const requestChatId = selectedChatId
    const workspace = getAssistantWorkspaceForChat(requestChatId)
    const content = getOutboundDraft(workspace.draft, workspace.translatedDraft)
    if (!content) {
      return
    }

    setDraftMessageForChat(requestChatId, content)
    const logResult = await recordAssistantUsage('writeback', {
      history,
      selectedChat,
      workspace,
      selectedReplyAgentId,
    })
    applyAssistantWorkspacePatch(requestChatId, {
      notice: logResult.ok ? undefined : logResult.error || '采纳数据保存失败。',
    })
  }

  async function handleSendAssistantDraft() {
    if (!selectedChatId || !history || !selectedChat || history.chat.id !== selectedChatId || assistantSending) {
      return
    }

    const requestChatId = selectedChatId
    const requestHistory = history
    const requestSelectedChat = selectedChat
    const workspace = getAssistantWorkspaceForChat(requestChatId)
    const requestRun = workspace.run
    const outboundDraft = getOutboundDraft(workspace.draft, workspace.translatedDraft)
    if (
      !requestRun ||
      requestRun.chat_id !== requestChatId ||
      requestRun.status !== 'ready_for_review' ||
      !outboundDraft
    ) {
      return
    }

    setAssistantSendingByChatId((current) => ({ ...current, [requestChatId]: true }))
    applyAssistantWorkspacePatch(requestChatId, { notice: undefined })
    setError(undefined)

    try {
      const response = await sendAgentRun(requestRun.id, {
        message_text: outboundDraft,
      })
      applyAssistantWorkspacePatch(requestChatId, { run: response.run })
      const logResult = await recordAssistantUsage('send', {
        history: requestHistory,
        selectedChat: requestSelectedChat,
        workspace,
        selectedReplyAgentId,
      })
      applyAssistantWorkspacePatch(requestChatId, {
        notice: logResult.ok ? undefined : logResult.error || '采纳数据保存失败。',
      })
      pendingScrollModeRef.current = 'bottom'
      keepTimelinePinnedRef.current = true
      if (activeAssistantChatIdRef.current === requestChatId) {
        void loadHistory(requestChatId, true)
      }
      void loadChatsList(true)
    } catch (sendError) {
      applyAssistantWorkspacePatch(requestChatId, {
        notice: sendError instanceof Error ? sendError.message : '发送 Agent 草稿失败',
      })
    } finally {
      setAssistantSendingByChatId((current) => {
        const next = { ...current }
        delete next[requestChatId]
        return next
      })
    }
  }

  async function recordAssistantUsage(
    action: AssistantUsageAction,
    snapshot: {
      history: MessageHistoryResponse
      selectedChat: ChatSummary
      workspace: AssistantWorkspaceState
      selectedReplyAgentId: string
    },
  ) {
    const payload = buildAssistantUsagePayload({
      action,
      history: snapshot.history,
      selectedChat: snapshot.selectedChat,
      accounts,
      replyAgents,
      selectedReplyAgentId: snapshot.selectedReplyAgentId,
      assistantReplyOptions: snapshot.workspace.replyOptions,
      adoptedReplyIndex: snapshot.workspace.adoptedReplyIndex,
      assistantDraft: snapshot.workspace.draft,
      translatedDraft: snapshot.workspace.translatedDraft,
      translatedSourceDraft: snapshot.workspace.translatedSourceDraft,
      draftTargetLanguage: snapshot.workspace.targetLanguage,
      draftTargetLanguageName: snapshot.workspace.targetLanguageName,
    })
    if (!payload) {
      return { ok: false, error: '采纳数据保存失败。' }
    }

    try {
      await createAssistantUsageLog(payload)
      return { ok: true }
    } catch (logError) {
      console.warn('failed to record assistant usage', logError)
      return {
        ok: false,
        error: logError instanceof Error
          ? `采纳数据保存失败：${logError.message}`
          : '采纳数据保存失败：未知错误',
      }
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
  const activeHistory = history && selectedChatId && history.chat.id === selectedChatId ? history : undefined
  const hasSystemAssistantFallback = Boolean(activeHistory && selectedChat)
  const canGenerateAssistantDraft = Boolean(
    selectedChatId &&
      activeHistory &&
      hasSystemAssistantFallback &&
      selectedReplyAgentId &&
      !assistantBusy,
  )
  const canUseAssistantDraft = Boolean(
    selectedChatId &&
      assistantRun?.chat_id === selectedChatId &&
      assistantRun.status === 'ready_for_review' &&
      getOutboundDraft(assistantDraft, translatedDraft),
  )
  const canSendInCurrentChat = Boolean(
    activeHistory && isChatSendable(activeHistory.chat.wa_chat_jid, activeHistory.chat.chat_type),
  )
  const canSendMessage = Boolean(canSendInCurrentChat && draftMessage.trim() && !sending)
  const canAnalyzeStatusCard = Boolean(selectedChatId && activeHistory && activeStatusCardAgent && !statusCardBusy)
  const sendBlockReason =
    activeHistory && !canSendInCurrentChat
      ? getChatSendBlockedReason(activeHistory.chat.wa_chat_jid, activeHistory.chat.chat_type)
      : undefined
  const hasAdoptedAssistantReply = adoptedReplyIndex !== undefined

  return (
    <div className="page page-chats whatsapp-chat-page">
      <section className="chat-frame whatsapp-chat-frame">
        <aside className="panel chat-sidebar-panel whatsapp-chat-sidebar">
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
          {selectedChat && activeHistory ? (
            <>
              <section className="chat-status-strip whatsapp-chat-status-strip">
                {agentConfigsLoading ? (
                  <div className="warning-banner">加载中...</div>
                ) : !activeStatusCardAgent ? (
                  <div className="warning-banner">未启用状态卡智能体。</div>
                ) : (
                  <div className={`chat-status-card-grid${statusCardCollapsed ? ' collapsed' : ''}`}>
                    <div className="chat-status-top-row">
                      <div className="chat-status-title-row">
                        <span>用户状态卡</span>
                        {statusCard ? (
                          <span>{statusCard.message_count} 条记录</span>
                        ) : (
                          <span>{activeHistory.messages.length} 条已加载消息</span>
                        )}
                      </div>
                      <StatusBadge status={activeHistory.chat.chat_type} />
                      <button
                        className="secondary-button assistant-mini-button chat-status-collapse-button"
                        type="button"
                        onClick={() => setStatusCardCollapsed((current) => !current)}
                        aria-expanded={!statusCardCollapsed}
                        title={statusCardCollapsed ? '展开摘要和建议' : '收起摘要和建议'}
                      >
                        <Icon name="chevronDown" className={statusCardCollapsed ? '' : 'rotate-180'} />
                        <span>{statusCardCollapsed ? '展开' : '收起'}</span>
                      </button>
                      <button
                        className="primary-button assistant-mini-button chat-status-analyze-button"
                        type="button"
                        onClick={() => void handleAnalyzeStatusCard()}
                        disabled={!canAnalyzeStatusCard}
                      >
                        {statusCardBusy ? '分析中...' : statusCard ? '重分析' : '分析'}
                      </button>
                    </div>
                    <div className="chat-status-overview-row">
                      <StatusMetric label="当前阶段" value={statusCard?.current_stage || '未判断'} />
                      <StatusMetric
                        label="当前风险"
                        value={statusCard?.current_risk || '未判断'}
                        tone={getRiskTone(statusCard?.current_risk || '')}
                      />
                      <div className="assistant-status-metric assistant-status-type-metric">
                        <span>客户类型</span>
                        <div className="assistant-chip-row">
                          {(statusCard?.customer_types.length ? statusCard.customer_types : ['未判断']).map(
                            (item) => (
                              <span className="toolbar-chip" key={item}>
                                {item}
                              </span>
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                    {!statusCardCollapsed ? (
                      <div className="assistant-status-text-scroll">
                        {statusCard?.summary ? (
                          <p className="assistant-status-summary">
                            <strong>摘要</strong>
                            <span>{statusCard.summary}</span>
                          </p>
                        ) : (
                          <p className="assistant-status-empty">点击分析后显示客户状态摘要。</p>
                        )}
                        {statusCard?.next_action ? (
                          <p className="assistant-status-summary">
                            <strong>建议</strong>
                            <span>{statusCard.next_action}</span>
                          </p>
                        ) : null}
                        {statusCard?.evidence.length ? (
                          <ul className="assistant-evidence-list">
                            {statusCard.evidence.slice(0, 3).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )}

                {statusCardNotice ? <div className="warning-banner">{statusCardNotice}</div> : null}
              </section>

              <div className="whatsapp-history-toolbar">
                {activeHistory.has_more ? (
                  <button className="secondary-button" type="button" onClick={() => void loadMoreMessages()}>
                    {historyLoading ? '正在加载更早消息...' : '查看更多消息'}
                  </button>
                ) : null}
              </div>

              <div ref={timelineRef} className="message-timeline whatsapp-message-timeline">
                {activeHistory.messages.map((message) => {
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
                      onChange={(event) => setCurrentDraftMessage(event.target.value)}
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
                  <span className="field-hint">当前会话：{getChatDisplayName(activeHistory.chat)}</span>
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
            <div className="assistant-header-controls">
              <span className="assistant-toolbar-title">选择智能体客服</span>
              {replyAgents.length ? (
                <select
                  className="assistant-header-select"
                  value={selectedReplyAgentId}
                  onChange={(event) => {
                    setSelectedReplyAgentId(event.target.value)
                    setAssistantRunState(undefined)
                    setAssistantRawDraftState('')
                    setAssistantReplyOptionsState([])
                    setAdoptedReplyIndexState(undefined)
                    setAssistantDraftState('')
                    setTranslatedDraftState('')
                    setTranslatedSourceDraftState('')
                  }}
                  disabled={assistantBusy}
                >
                  {replyAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="assistant-header-empty">未配置</span>
              )}

              <label className="checkbox-row assistant-context-toggle">
                <input
                  type="checkbox"
                  checked={assistantContextEnabled}
                  onChange={(event) => setAssistantContextEnabled(event.target.checked)}
                />
                <span>携带上下文</span>
              </label>

              <label className="field compact-field assistant-context-limit-field">
                <span>历史对话（轮）</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={assistantContextLimit}
                  disabled={!assistantContextEnabled}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    setAssistantContextLimit(Number.isFinite(next) ? next : defaultAssistantContextLimit)
                  }}
                />
              </label>

              <button
                className="primary-button assistant-header-generate"
                type="button"
                onClick={() => void handleGenerateAssistantDraft()}
                disabled={!canGenerateAssistantDraft}
              >
                {assistantBusy ? '生成中...' : '生成回复建议'}
              </button>
            </div>
          </div>

          {selectedChat && activeHistory ? (
            <div className="assistant-panel-body whatsapp-assistant-body">
              <div className="assistant-reply-column">
                <section className="assistant-card assistant-options-card">
                  <div className="assistant-card-header-row">
                    <span className="assistant-section-label">回复方案</span>
                    {hasAdoptedAssistantReply ? (
                      <span className="assistant-stage-pill stage-adopted">已采纳</span>
                    ) : null}
                  </div>
                  {agentConfigsLoading ? (
                    <div className="warning-banner">加载中...</div>
                  ) : replyAgents.length ? null : (
                    <div className="warning-banner">未启用回复智能体。</div>
                  )}

                  {assistantReplyOptions.length ? (
                    <div className="assistant-option-list">
                      {[0, 1, 2].map((index) => {
                        const option = assistantReplyOptions[index]
                        const isAdopted = adoptedReplyIndex === index
                        return option ? (
                          <article
                            className={`assistant-option-card${isAdopted ? ' adopted' : ''}`}
                            key={`${option.title}-${index}`}
                          >
                            <div className="assistant-option-header">
                              <div>
                                <strong>{option.title || `回复方案 ${index + 1}`}</strong>
                                {option.strategy ? <span>{option.strategy}</span> : null}
                              </div>
                              <button
                                className={`secondary-button assistant-mini-button assistant-adopt-button${isAdopted ? ' adopted' : ''}`}
                                type="button"
                                onClick={() => {
                                  setAssistantDraftState(option.content)
                                  setTranslatedDraftState('')
                                  setTranslatedSourceDraftState('')
                                  setAdoptedReplyIndexState(index)
                                  setAssistantNoticeState(undefined)
                                }}
                                disabled={isAdopted}
                              >
                                {isAdopted ? '已采纳' : '采纳'}
                              </button>
                            </div>
                            <p>{option.content}</p>
                          </article>
                        ) : (
                          <article className="assistant-option-card assistant-option-placeholder-card" key={index}>
                            <div className="assistant-option-header">
                              <div>
                                <strong>{`回复方案 ${index + 1}`}</strong>
                              </div>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="assistant-option-list assistant-option-placeholder-list">
                      {[0, 1, 2].map((index) => (
                        <article className="assistant-option-card assistant-option-placeholder-card" key={index}>
                          <div className="assistant-option-header">
                            <div>
                              <strong>{`回复方案 ${index + 1}`}</strong>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <div className="assistant-draft-column">
                <section className="assistant-card assistant-draft-card">
                  <div className="assistant-card-header-row">
                    <span className="assistant-section-label">采纳区</span>
                    {hasAdoptedAssistantReply ? (
                      <span className="assistant-stage-pill stage-adopted">已采纳</span>
                    ) : null}
                  </div>
                  <textarea
                    className="assistant-draft-box"
                    ref={assistantDraftRef}
                    value={assistantDraft}
                    onChange={(event) => {
                      setAssistantDraftState(event.target.value)
                      setTranslatedDraftState('')
                      setTranslatedSourceDraftState('')
                    }}
                    placeholder="点击左侧方案的采纳，或直接在这里编辑草稿"
                    rows={7}
                  />
                  <div className="assistant-translation-row">
                    <label className="field compact-field">
                      <span>译文语种</span>
                      <select
                        value={draftTargetLanguage}
                        onChange={(event) => {
                          const option = resolveLanguageOption(event.target.value)
                          setDraftTargetLanguageState(option.code, option.name)
                          setTranslatedDraftState('')
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
                      className="primary-button assistant-action-button"
                      type="button"
                      onClick={() => void translateDraftToTarget()}
                      disabled={!assistantDraft.trim() || translationAgents.length === 0 || draftTranslationBusy}
                    >
                      {draftTranslationBusy ? '翻译中...' : '翻译草稿'}
                    </button>
                  </div>
                  <textarea
                    className="assistant-draft-box assistant-translated-draft"
                    value={translatedDraft}
                    onChange={(event) => setTranslatedDraftState(event.target.value)}
                    placeholder="翻译结果会显示在这里，也可以直接编辑。"
                    rows={5}
                  />
                  <div className="assistant-submit-actions">
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
                  {assistantRun?.block_reason ? (
                    <div className="warning-banner">{assistantRun.block_reason}</div>
                  ) : null}
                  {assistantNotice ? <div className="error-banner assistant-panel-error">{assistantNotice}</div> : null}
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

function readStoredAssistantWorkspaceCache(): Record<string, StoredAssistantWorkspace> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(assistantWorkspaceStorageKey)
    if (!raw) {
      return {}
    }
    const decoded = JSON.parse(raw)
    if (!isPlainRecord(decoded)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(decoded).filter((entry): entry is [string, StoredAssistantWorkspace] => {
        const value = entry[1]
        if (!isPlainRecord(value)) {
          return false
        }
        const candidate = value as Partial<StoredAssistantWorkspace>
        return (
          typeof candidate.cached_at === 'string' &&
          typeof candidate.rawDraft === 'string' &&
          Array.isArray(candidate.replyOptions) &&
          typeof candidate.draft === 'string' &&
          typeof candidate.translatedDraft === 'string' &&
          typeof candidate.translatedSourceDraft === 'string' &&
          typeof candidate.targetLanguage === 'string' &&
          typeof candidate.targetLanguageName === 'string'
        )
      }),
    )
  } catch {
    return {}
  }
}

function writeStoredAssistantWorkspaceCache(cache: Record<string, StoredAssistantWorkspace>) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(assistantWorkspaceStorageKey, JSON.stringify(cache))
  } catch {
    // Keep the current in-memory assistant workspace even if local persistence is unavailable.
  }
}

function trimStoredAssistantWorkspaceCache(cache: Record<string, StoredAssistantWorkspace>) {
  const entries = Object.entries(cache)
  if (entries.length <= assistantWorkspaceCacheLimit) {
    return cache
  }

  return Object.fromEntries(
    entries
      .sort((left, right) => left[1].cached_at.localeCompare(right[1].cached_at))
      .slice(-assistantWorkspaceCacheLimit),
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

function todayDateInput() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

function buildAssistantUsagePayload({
  action,
  history,
  selectedChat,
  accounts,
  replyAgents,
  selectedReplyAgentId,
  assistantReplyOptions,
  adoptedReplyIndex,
  assistantDraft,
  translatedDraft,
  translatedSourceDraft,
  draftTargetLanguage,
  draftTargetLanguageName,
}: {
  action: AssistantUsageAction
  history: MessageHistoryResponse
  selectedChat: ChatSummary
  accounts: AccountView[]
  replyAgents: SystemAgentConfigView[]
  selectedReplyAgentId: string
  assistantReplyOptions: AssistantReplyOption[]
  adoptedReplyIndex?: number
  assistantDraft: string
  translatedDraft: string
  translatedSourceDraft: string
  draftTargetLanguage: string
  draftTargetLanguageName: string
}): CreateAssistantUsageLogPayload | undefined {
  const sourceDraft = translatedSourceDraft.trim()
  const draftContent = assistantDraft.trim()
  const translatedContent = translatedDraft.trim()
  if (!sourceDraft && !draftContent && !translatedContent) {
    return undefined
  }

  const triggerMessages = findPendingCustomerMessages(history.messages)
  const latestMessage = triggerMessages[triggerMessages.length - 1] ?? findLatestCustomerMessage(history.messages)
  const adoptedOption =
    adoptedReplyIndex !== undefined ? assistantReplyOptions[adoptedReplyIndex] : undefined
  const outboundContent = translatedContent || draftContent || sourceDraft
  const account = accounts.find((item) => item.id === history.chat.account_id)
  const agent = replyAgents.find((item) => item.id === selectedReplyAgentId)
  const mediaRef = latestMessage ? formatMessageMediaRef(latestMessage) : ''
  const customerID = latestMessage?.sender_jid || selectedChat.wa_chat_jid
  const customerNickname =
    latestMessage?.sender_name?.trim() ||
    (history.chat.title?.trim() || selectedChat.title?.trim() || getChatDisplayName(selectedChat))

  return {
    ws_account_id: history.chat.account_id,
    ws_account_name: account?.display_name || '',
    chat_id: history.chat.id,
    customer_id: customerID,
    customer_nickname: customerNickname,
    latest_message_id: latestMessage?.id || '',
    latest_message_type: latestMessage?.message_type || '',
    latest_message_text:
      latestMessage?.text_content?.trim() ||
      (latestMessage ? fallbackMessageCopy(latestMessage.message_type) : ''),
    latest_message_media_ref: mediaRef,
    latest_message_received_at: latestMessage?.sent_at,
    trigger_messages: triggerMessages.map(formatAssistantUsageTriggerMessage),
    agent_id: agent?.id || selectedReplyAgentId,
    agent_name: agent?.name || '',
    adopted_option_index: adoptedReplyIndex !== undefined ? adoptedReplyIndex + 1 : undefined,
    adopted_option_content: adoptedOption?.content || '',
    translation_source_content: sourceDraft,
    final_draft_content: outboundContent,
    translated_content: translatedContent,
    target_language: translatedContent
      ? `${draftTargetLanguageName || draftTargetLanguage}(${draftTargetLanguage})`
      : '',
    action_type: action,
    log_date: todayDateInput(),
  }
}

function findPendingCustomerMessages(messages: MessageView[]) {
  const pending: MessageView[] = []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.from_me) {
      break
    }
    pending.unshift(message)
  }

  return pending
}

function formatAssistantUsageTriggerMessage(message: MessageView) {
  return {
    id: message.id,
    wa_message_id: message.wa_message_id,
    sender_jid: message.sender_jid,
    sender_name: message.sender_name?.trim() || undefined,
    message_type: message.message_type,
    text_content: message.text_content?.trim() || undefined,
    media_ref: formatMessageMediaRef(message) || undefined,
    sent_at: message.sent_at,
  }
}

function findLatestCustomerMessage(messages: MessageView[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (!messages[index].from_me) {
      return messages[index]
    }
  }

  return messages[messages.length - 1]
}

function formatMessageMediaRef(message: MessageView) {
  if (!message.media.length) {
    return ''
  }

  return message.media
    .map((media) =>
      [
        media.media_type,
        media.id,
        media.storage_key,
        media.file_name,
        media.mime_type,
      ]
        .filter(Boolean)
        .join(':'),
    )
    .join(' | ')
}

function parseAssistantReplyOptions(rawDraft: string): AssistantReplyOption[] {
  const text = rawDraft.trim()
  if (!text) {
    return []
  }

  const decoded = parseJsonValueFromText(text)
  const source = Array.isArray(decoded)
    ? decoded
    : isPlainRecord(decoded)
      ? decoded.replies ?? decoded.reply_options ?? decoded.options
      : undefined
  if (Array.isArray(source)) {
    return source
      .map((item, index) => normalizeAssistantReplyOption(item, index))
      .filter((item): item is AssistantReplyOption => Boolean(item?.content))
      .slice(0, 3)
  }

  return parseFallbackReplyOptions(text)
}

function parseJsonValueFromText(text: string): unknown {
  const normalized = stripJsonFence(text)
  try {
    return JSON.parse(normalized)
  } catch {
    const objectStart = normalized.indexOf('{')
    const objectEnd = normalized.lastIndexOf('}')
    const arrayStart = normalized.indexOf('[')
    const arrayEnd = normalized.lastIndexOf(']')
    const hasObject = objectStart >= 0 && objectEnd > objectStart
    const hasArray = arrayStart >= 0 && arrayEnd > arrayStart
    if (!hasObject && !hasArray) {
      return undefined
    }
    const useArray = hasArray && (!hasObject || arrayStart < objectStart)
    const start = useArray ? arrayStart : objectStart
    const end = useArray ? arrayEnd : objectEnd
    try {
      return JSON.parse(normalized.slice(start, end + 1))
    } catch {
      return undefined
    }
  }
}

function stripJsonFence(text: string) {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function normalizeAssistantReplyOption(value: unknown, index: number): AssistantReplyOption | undefined {
  if (typeof value === 'string') {
    const content = value.trim()
    return content ? { title: `回复方案 ${index + 1}`, content } : undefined
  }
  if (!isPlainRecord(value)) {
    return undefined
  }

  const content = readStringField(value, ['content', 'reply', 'text', 'message'])
  if (!content) {
    return undefined
  }

  return {
    title: readStringField(value, ['title', 'name']) || `回复方案 ${index + 1}`,
    strategy: readStringField(value, ['strategy', 'reason', 'angle']),
    content,
  }
}

function parseFallbackReplyOptions(text: string): AssistantReplyOption[] {
  const matches = Array.from(
    text.matchAll(
      /(?:^|\n)\s*(?:(?:回复方案|方案)\s*)?(#?\s*[1-3]|[一二三])(?:\s*[.、)]|\s*[：:])\s*([\s\S]*?)(?=\n\s*(?:(?:回复方案|方案)\s*)?(?:#?\s*[1-3]|[一二三])(?:\s*[.、)]|\s*[：:])|$)/g,
    ),
  )

  return matches
    .map((match, index) => ({
      title: `回复方案 ${index + 1}`,
      content: (match[2] ?? '').trim(),
    }))
    .filter((item) => item.content)
    .slice(0, 3)
}

function readStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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
