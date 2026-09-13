import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  analyzeStatusCard,
  createChatLabel,
  createAssistantUsageLog,
  getFirstChatMessageByDate,
  getChatMessages,
  getMediaAssetUrl,
  getStatusCard,
  listAccounts,
  listAvailableSystemAgentConfigs,
  listChatLabels,
  listChats,
  markChatRead,
  searchChatMessages,
  sendAgentRun,
  sendChatMedia,
  sendChatMessage,
  streamGenerateAgentRun,
  subscribeLiveUpdates,
  translateText,
  updateChatMetadata,
  type AssistantUsageAction,
  type CreateAssistantUsageLogPayload,
  type AccountView,
  type AgentRunView,
  type ChatHeader,
  type ChatLabel,
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

type ChatContextMenuState = {
  chatId: string
  x: number
  y: number
  source: 'row' | 'toolbar'
  submenu?: 'mute' | 'lists'
}

type ChatPrimaryFilter = 'all' | 'unread' | 'groups' | 'favorites'

type StoredChatNavigation = {
  accountId: string
  chatIdsByAccount: Record<string, string>
  chatView: 'active' | 'archived' | 'unread'
  chatType: ChatType | ''
  labelId: string
  search: string
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
const favoriteListName = '特别关注'
const chatSidebarWidthStorageKey = 'whatsapp.chatSidebarWidth.v1'
const assistantPanelCollapsedStorageKey = 'whatsapp.assistantPanelCollapsed.v1'
const assistantReplyRatioStorageKey = 'whatsapp.assistantReplyRatio.v1'
const assistantPanelWidthStorageKey = 'whatsapp.assistantPanelWidth.v1'
const chatNavigationStorageKey = 'whatsapp.chatNavigation.v1'
const defaultChatSidebarWidth = 280
const minChatSidebarWidth = 240
const minChatMainWidth = 320
const minAssistantPanelWidth = 450
const defaultAssistantPanelWidth = 520
const defaultAssistantReplyRatio = 40
const minAssistantReplyWidth = 150
const minAssistantDraftWidth = 240

function isConfiguredSystemAgent(config: SystemAgentConfigView) {
  const providerConfig = config.provider_config ?? {}
  return Boolean(
    config.enabled
      && typeof providerConfig.preset_id === 'string'
      && providerConfig.preset_id.trim()
      && typeof providerConfig.model === 'string'
      && providerConfig.model.trim(),
  )
}

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
  const [searchParams] = useSearchParams()
  const requestedAccountId = searchParams.get('account_id')?.trim() ?? ''
  const requestedChatId = searchParams.get('chat_id')?.trim() ?? ''
  const [initialNavigation] = useState(readStoredChatNavigation)
  const initialAccountId = requestedAccountId || initialNavigation.accountId
  const initialChatId = requestedChatId || initialNavigation.chatIdsByAccount[initialAccountId]
  const restoreStoredFilters = !requestedChatId
  const requestedChatIdRef = useRef(requestedChatId)
  const chatNavigationRef = useRef(initialNavigation)
  const shouldRevealRestoredChatRef = useRef(Boolean(initialChatId))
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState(initialAccountId)
  const [selectedChatType, setSelectedChatType] = useState<ChatType | ''>(
    restoreStoredFilters ? initialNavigation.chatType : '',
  )
  const [chatView, setChatView] = useState<'active' | 'archived' | 'unread'>(
    restoreStoredFilters ? initialNavigation.chatView : 'active',
  )
  const [chatLabels, setChatLabels] = useState<ChatLabel[]>([])
  const [selectedLabelId, setSelectedLabelId] = useState(
    restoreStoredFilters ? initialNavigation.labelId : '',
  )
  const [chatFilterCounts, setChatFilterCounts] = useState({ unread: 0, groups: 0, favorites: 0 })
  const [chatMetadataBusy, setChatMetadataBusy] = useState(false)
  const [chatNote, setChatNote] = useState('')
  const [labelEditorOpen, setLabelEditorOpen] = useState(false)
  const [newLabelName, setNewLabelName] = useState('')
  const [chatInfoOpen, setChatInfoOpen] = useState(false)
  const [chatContextMenu, setChatContextMenu] = useState<ChatContextMenuState>()
  const [noteEditorChatId, setNoteEditorChatId] = useState<string>()
  const [noteEditorDraft, setNoteEditorDraft] = useState('')
  const [listMenuOpen, setListMenuOpen] = useState(false)
  const [listCreatorOpen, setListCreatorOpen] = useState(false)
  const [listNameDraft, setListNameDraft] = useState('')
  const [listChatIds, setListChatIds] = useState<string[]>([])
  const [listCandidates, setListCandidates] = useState<ChatSummary[]>([])
  const [listCandidatesLoading, setListCandidatesLoading] = useState(false)
  const [listBusy, setListBusy] = useState(false)
  const [chatSidebarWidth, setChatSidebarWidth] = useState(readStoredChatSidebarWidth)
  const [assistantPanelCollapsed, setAssistantPanelCollapsed] = useState(readStoredAssistantPanelCollapsed)
  const [assistantPanelWidth, setAssistantPanelWidth] = useState(readStoredAssistantPanelWidth)
  const [assistantReplyRatio, setAssistantReplyRatio] = useState(readStoredAssistantReplyRatio)
  const [search, setSearch] = useState(restoreStoredFilters ? initialNavigation.search : '')
  const deferredSearch = useDeferredValue(search)
  const [messageSearchOpen, setMessageSearchOpen] = useState(false)
  const [messageSearch, setMessageSearch] = useState('')
  const deferredMessageSearch = useDeferredValue(messageSearch)
  const [messageSearchResults, setMessageSearchResults] = useState<MessageView[]>([])
  const [messageSearchLoading, setMessageSearchLoading] = useState(false)
  const [messageSearchError, setMessageSearchError] = useState<string>()
  const [messageDatePickerOpen, setMessageDatePickerOpen] = useState(false)
  const [messageDateMonth, setMessageDateMonth] = useState(startOfLocalMonth)
  const [selectedMessageDate, setSelectedMessageDate] = useState<Date>()
  const [messageDateLoading, setMessageDateLoading] = useState(false)
  const [messageJumpBusyId, setMessageJumpBusyId] = useState<string>()
  const [messageJumpError, setMessageJumpError] = useState<string>()
  const [highlightedMessageId, setHighlightedMessageId] = useState<string>()
  const [selectedChatId, setSelectedChatId] = useState<string | undefined>(initialChatId || undefined)
  const [history, setHistory] = useState<MessageHistoryResponse>()
  const [historyLoading, setHistoryLoading] = useState(false)
  const [sendingByChatId, setSendingByChatId] = useState<Record<string, boolean>>({})
  const [draftMessageByChatId, setDraftMessageByChatId] = useState<Record<string, string>>({})
  const [replyToMessageByChatId, setReplyToMessageByChatId] = useState<Record<string, MessageView | undefined>>({})
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
  const [statusCardOpen, setStatusCardOpen] = useState(false)
  const [statusCardCollapsed, setStatusCardCollapsed] = useState(false)
  const [visibleCustomListCount, setVisibleCustomListCount] = useState(0)
  const [agentConfigsLoading, setAgentConfigsLoading] = useState(true)
  const [assistantBusyByChatId, setAssistantBusyByChatId] = useState<Record<string, boolean>>({})
  const [assistantSendingByChatId, setAssistantSendingByChatId] = useState<Record<string, boolean>>({})
  const [assistantNotice, setAssistantNotice] = useState<string>()
  const timelineRef = useRef<HTMLDivElement>(null)
  const chatFrameRef = useRef<HTMLElement>(null)
  const assistantPanelBodyRef = useRef<HTMLDivElement>(null)
  const assistantDraftRef = useRef<HTMLTextAreaElement>(null)
  const assistantWorkspaceCacheRef = useRef<Record<string, StoredAssistantWorkspace>>(
    readStoredAssistantWorkspaceCache(),
  )
  const activeAssistantChatIdRef = useRef<string | undefined>(undefined)
  const composeAttachmentRef = useRef<HTMLDivElement>(null)
  const chatContextMenuRef = useRef<HTMLDivElement>(null)
  const statusCardPanelRef = useRef<HTMLElement>(null)
  const listMenuRef = useRef<HTMLDivElement>(null)
  const chatSearchRef = useRef<HTMLInputElement>(null)
  const chatListScrollRef = useRef<HTMLDivElement>(null)
  const assistantPanelBeforeSearchRef = useRef<boolean | undefined>(undefined)
  const messageSearchRequestSeqRef = useRef(0)
  const messageDateRequestSeqRef = useRef(0)
  const messageJumpRequestSeqRef = useRef(0)
  const pendingJumpMessageIdRef = useRef<string | undefined>(undefined)
  const messageHighlightTimerRef = useRef<number | undefined>(undefined)
  const messageElementRefs = useRef<Map<string, HTMLElement>>(new Map())
  const documentInputRef = useRef<HTMLInputElement>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const pendingMessageTranslationKeysRef = useRef<Set<string>>(new Set())
  const keepTimelinePinnedRef = useRef(true)
  const pendingScrollModeRef = useRef<'bottom' | 'preserve' | 'none'>('bottom')
  const historyRequestSeqRef = useRef(0)
  const statusCardRequestSeqRef = useRef(0)
  const listCandidatesRequestSeqRef = useRef(0)
  const previousTimelineMetricsRef = useRef<
    { scrollHeight: number; scrollTop: number } | undefined
  >(undefined)
  const assistantBusy = selectedChatId ? Boolean(assistantBusyByChatId[selectedChatId]) : false
  const draftTranslationBusy = selectedChatId ? Boolean(draftTranslationBusyByChatId[selectedChatId]) : false
  const assistantSending = selectedChatId ? Boolean(assistantSendingByChatId[selectedChatId]) : false
  const sending = selectedChatId ? Boolean(sendingByChatId[selectedChatId]) : false
  const draftMessage = selectedChatId ? draftMessageByChatId[selectedChatId] ?? '' : ''
  const replyToMessage = selectedChatId ? replyToMessageByChatId[selectedChatId] : undefined
  const composeNotice = selectedChatId ? composeNoticeByChatId[selectedChatId] : undefined
  const statusCardBusy = selectedChatId ? Boolean(statusCardBusyByChatId[selectedChatId]) : false
  const favoriteList = chatLabels.find((label) => label.name.trim() === favoriteListName)
  const customLists = chatLabels.filter((label) => label.id !== favoriteList?.id)
  const messageCalendarDays = buildCalendarDays(messageDateMonth)

  const openMessageSearch = useCallback(() => {
    if (!messageSearchOpen) {
      assistantPanelBeforeSearchRef.current = assistantPanelCollapsed
    }
    setMessageSearchOpen(true)
    setAssistantPanelCollapsed(true)
  }, [assistantPanelCollapsed, messageSearchOpen])

  const closeMessageSearch = useCallback(() => {
    messageSearchRequestSeqRef.current += 1
    messageDateRequestSeqRef.current += 1
    messageJumpRequestSeqRef.current += 1
    setMessageSearchOpen(false)
    setMessageSearch('')
    setMessageSearchResults([])
    setMessageSearchError(undefined)
    setMessageSearchLoading(false)
    setMessageDatePickerOpen(false)
    setMessageDateLoading(false)
    setSelectedMessageDate(undefined)
    setMessageJumpBusyId(undefined)
    setMessageJumpError(undefined)
    const previousCollapsed = assistantPanelBeforeSearchRef.current
    if (typeof previousCollapsed === 'boolean') {
      setAssistantPanelCollapsed(previousCollapsed)
      assistantPanelBeforeSearchRef.current = undefined
    }
  }, [])

  const scrollToMessage = useCallback((messageId: string) => {
    const messageElement = messageElementRefs.current.get(messageId)
    if (!messageElement) {
      return false
    }

    messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedMessageId(messageId)
    if (messageHighlightTimerRef.current !== undefined) {
      window.clearTimeout(messageHighlightTimerRef.current)
    }
    messageHighlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId((current) => current === messageId ? undefined : current)
      messageHighlightTimerRef.current = undefined
    }, 2200)
    return true
  }, [])

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
      const nextAccounts = Array.isArray(response.accounts) ? response.accounts : []
      setAccounts(nextAccounts)
      setSelectedAccountId((current) =>
        nextAccounts.some((account) => account.id === current)
          ? current
          : nextAccounts.some((account) => account.id === requestedAccountId)
            ? requestedAccountId
            : nextAccounts[0]?.id ?? '',
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载账号失败')
    }
  }, [requestedAccountId])

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

        if (selectedLabelId === '__favorites__') {
          setChats([])
          setSelectedChatId(undefined)
          return
        }

        const response = await listChats({
          accountId: selectedAccountId,
          query: deferredSearch.trim() || undefined,
          chatType: selectedChatType,
          labelId: selectedLabelId || undefined,
          archived: chatView === 'archived' ? true : chatView === 'active' ? false : undefined,
          unreadOnly: chatView === 'unread',
          limit: 2000,
        })

        setChats(response.chats)
        setSelectedChatId((current) => {
          const initialChatId = requestedChatIdRef.current
          if (initialChatId && response.chats.some((chat) => chat.id === initialChatId)) {
            requestedChatIdRef.current = ''
            return initialChatId
          }
          return choosePreferredChatId(response.chats, current)
        })
      } catch (loadError) {
        if (!background) {
          setChats([])
          setError(loadError instanceof Error ? loadError.message : '加载会话失败')
        }
      } finally {
        // Chat list refresh is silent after removing the header counter.
      }
    },
    [chatView, deferredSearch, selectedAccountId, selectedChatType, selectedLabelId],
  )

  const loadChatFilterCounts = useCallback(async () => {
    if (!selectedAccountId) {
      setChatFilterCounts({ unread: 0, groups: 0, favorites: 0 })
      return
    }

    try {
      const favoriteLabel = chatLabels.find((label) => label.name.trim() === favoriteListName)
      const [unreadResponse, groupResponse, favoriteResponse] = await Promise.all([
        listChats({ accountId: selectedAccountId, archived: false, unreadOnly: true, limit: 1 }),
        listChats({ accountId: selectedAccountId, archived: false, chatType: 'group', limit: 1 }),
        favoriteLabel
          ? listChats({ accountId: selectedAccountId, archived: false, labelId: favoriteLabel.id, limit: 1 })
          : Promise.resolve({ total: 0 }),
      ])
      setChatFilterCounts({
        unread: unreadResponse.total,
        groups: groupResponse.total,
        favorites: favoriteResponse.total,
      })
    } catch {
      // Counts are supplementary; the conversation list remains usable if they fail.
    }
  }, [chatLabels, selectedAccountId])

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
    if (!selectedAccountId) {
      setChatLabels([])
      return
    }
    void listChatLabels(selectedAccountId)
      .then((response) => {
        setChatLabels(response.labels)
        setSelectedLabelId((current) => (
          current && current !== '__favorites__' && !response.labels.some((label) => label.id === current)
            ? ''
            : current
        ))
      })
      .catch(() => setChatLabels([]))
  }, [selectedAccountId])

  useEffect(() => {
    void loadAvailableAgentConfigs()
  }, [loadAvailableAgentConfigs])

  useEffect(() => {
    void loadChatsList()
  }, [loadChatsList])

  useEffect(() => {
    void loadChatFilterCounts()
  }, [loadChatFilterCounts])

  useEffect(() => {
    const chatIdsByAccount = { ...chatNavigationRef.current.chatIdsByAccount }
    if (
      selectedAccountId
      && selectedChatId
      && chats.some((chat) => chat.id === selectedChatId && chat.account_id === selectedAccountId)
    ) {
      chatIdsByAccount[selectedAccountId] = selectedChatId
    }

    const navigation: StoredChatNavigation = {
      accountId: selectedAccountId,
      chatIdsByAccount,
      chatView,
      chatType: selectedChatType,
      labelId: selectedLabelId,
      search,
    }
    chatNavigationRef.current = navigation
    writeStoredChatNavigation(navigation)
  }, [chatView, chats, search, selectedAccountId, selectedChatId, selectedChatType, selectedLabelId])

  useEffect(() => {
    if (!shouldRevealRestoredChatRef.current || !selectedChatId || !chats.length) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const selectedRow = Array.from(
        chatListScrollRef.current?.querySelectorAll<HTMLButtonElement>('[data-chat-id]') ?? [],
      ).find((row) => row.dataset.chatId === selectedChatId)
      selectedRow?.scrollIntoView({ block: 'center' })
      shouldRevealRestoredChatRef.current = false
    })
    return () => window.cancelAnimationFrame(frame)
  }, [chats, selectedChatId])

  useEffect(() => {
    window.localStorage.setItem(chatSidebarWidthStorageKey, String(Math.round(chatSidebarWidth)))
  }, [chatSidebarWidth])

  useEffect(() => {
    window.localStorage.setItem(assistantPanelCollapsedStorageKey, String(assistantPanelCollapsed))
    const clampSidebarWidth = () => {
      if (window.innerWidth <= 1100) return
      const frameWidth = chatFrameRef.current?.getBoundingClientRect().width
      if (!frameWidth) return
      setChatSidebarWidth((current) => clampChatSidebarWidth(current, frameWidth, assistantPanelCollapsed))
      if (!assistantPanelCollapsed) {
        setAssistantPanelWidth((current) => clampAssistantPanelWidth(current, frameWidth, chatSidebarWidth))
      }
    }
    clampSidebarWidth()
    window.addEventListener('resize', clampSidebarWidth)
    return () => window.removeEventListener('resize', clampSidebarWidth)
  }, [assistantPanelCollapsed, chatSidebarWidth])

  useEffect(() => {
    window.localStorage.setItem(assistantPanelWidthStorageKey, String(Math.round(assistantPanelWidth)))
  }, [assistantPanelWidth])

  useEffect(() => {
    window.localStorage.setItem(assistantReplyRatioStorageKey, String(assistantReplyRatio))
  }, [assistantReplyRatio])

  useEffect(() => {
    if (assistantPanelCollapsed) return
    const body = assistantPanelBodyRef.current
    if (!body) return

    const clampReplyRatio = () => {
      const bodyWidth = body.getBoundingClientRect().width
      if (!bodyWidth) return
      setAssistantReplyRatio((current) => clampAssistantReplyRatio(current, bodyWidth))
    }
    clampReplyRatio()
    const observer = new ResizeObserver(clampReplyRatio)
    observer.observe(body)
    return () => observer.disconnect()
  }, [assistantPanelCollapsed, selectedChatId])

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
    void markChatRead(selectedChatId).then((response) => {
      setChats((current) => current.map((chat) => chat.id === response.chat.id ? response.chat : chat))
      setHistory((current) => current && current.chat.id === response.chat.id ? { ...current, chat: response.chat } : current)
      void loadChatFilterCounts()
    }).catch(() => {
      // Read receipts are best effort; loading the conversation must not fail.
    })
  }, [loadChatFilterCounts, loadHistory, loadSavedStatusCard, selectedChatId])

  useEffect(() => {
    activeAssistantChatIdRef.current = selectedChatId
    restoreAssistantWorkspace(
      selectedChatId
        ? assistantWorkspaceCacheRef.current[selectedChatId] ?? emptyAssistantWorkspace()
        : emptyAssistantWorkspace(),
    )
    setAttachmentMenuOpen(false)
    setStatusCardOpen(false)
  }, [emptyAssistantWorkspace, restoreAssistantWorkspace, selectedChatId])

  useEffect(() => {
    messageSearchRequestSeqRef.current += 1
    messageDateRequestSeqRef.current += 1
    messageJumpRequestSeqRef.current += 1
    pendingJumpMessageIdRef.current = undefined
    setMessageSearchResults([])
    setMessageSearchError(undefined)
    setMessageSearchLoading(false)
    setMessageSearch('')
    setMessageDatePickerOpen(false)
    setMessageDateLoading(false)
    setSelectedMessageDate(undefined)
    setMessageJumpBusyId(undefined)
    setMessageJumpError(undefined)
    setHighlightedMessageId(undefined)
  }, [selectedChatId])

  useEffect(() => {
    const query = deferredMessageSearch.trim()
    if (!messageSearchOpen || !selectedChatId || !query) {
      setMessageSearchResults([])
      setMessageSearchError(undefined)
      setMessageSearchLoading(false)
      return
    }

    const requestSeq = messageSearchRequestSeqRef.current + 1
    messageSearchRequestSeqRef.current = requestSeq
    const requestChatId = selectedChatId
    setMessageSearchLoading(true)
    setMessageSearchError(undefined)
    setMessageJumpError(undefined)

    void searchChatMessages(requestChatId, query).then((response) => {
      if (messageSearchRequestSeqRef.current !== requestSeq || selectedChatId !== requestChatId) {
        return
      }
      setMessageSearchResults(response.messages)
    }).catch((searchError) => {
      if (messageSearchRequestSeqRef.current !== requestSeq || selectedChatId !== requestChatId) {
        return
      }
      setMessageSearchResults([])
      setMessageSearchError(searchError instanceof Error ? searchError.message : '搜索消息失败')
    }).finally(() => {
      if (messageSearchRequestSeqRef.current === requestSeq) {
        setMessageSearchLoading(false)
      }
    })
  }, [deferredMessageSearch, messageSearchOpen, selectedChatId])

  useEffect(() => {
    const pendingMessageId = pendingJumpMessageIdRef.current
    if (!pendingMessageId) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      if (scrollToMessage(pendingMessageId)) {
        pendingJumpMessageIdRef.current = undefined
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [history, scrollToMessage])

  useEffect(() => () => {
    if (messageHighlightTimerRef.current !== undefined) {
      window.clearTimeout(messageHighlightTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!messageSearchOpen) {
      return
    }

    const handleSearchKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && messageDatePickerOpen) {
        setMessageDatePickerOpen(false)
      } else if (event.key === 'Escape') {
        closeMessageSearch()
      }
    }
    document.addEventListener('keydown', handleSearchKeyDown)
    return () => document.removeEventListener('keydown', handleSearchKeyDown)
  }, [closeMessageSearch, messageDatePickerOpen, messageSearchOpen])

  useEffect(() => {
    const currentChat = chats.find((chat) => chat.id === selectedChatId)
    setChatNote(currentChat?.note ?? '')
  }, [chats, selectedChatId])

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
    if (!listMenuOpen) {
      return
    }

    const closeListMenu = (event: MouseEvent) => {
      if (!listMenuRef.current?.contains(event.target as Node)) {
        setListMenuOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setListMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', closeListMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeListMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [listMenuOpen])

  useEffect(() => {
    if (!chatContextMenu) {
      return
    }

    const closeMenu = (event: MouseEvent) => {
      if (chatContextMenuRef.current?.contains(event.target as Node)) {
        return
      }
      setChatContextMenu(undefined)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChatContextMenu(undefined)
      }
    }

    const closeOnWindowBlur = () => setChatContextMenu(undefined)

    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', closeOnWindowBlur)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', closeOnWindowBlur)
    }
  }, [chatContextMenu])

  useEffect(() => {
    if (!statusCardOpen) {
      return
    }

    const closePanel = (event: MouseEvent) => {
      if (!statusCardPanelRef.current?.contains(event.target as Node)) {
        setStatusCardOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setStatusCardOpen(false)
      }
    }

    document.addEventListener('mousedown', closePanel)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closePanel)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [statusCardOpen])

  useEffect(() => {
    const shell = listMenuRef.current
    if (!shell) {
      return
    }

    const updateVisibleLists = () => {
      const availableWidth = shell.clientWidth
      if (!availableWidth) {
        return
      }

      // Keep the four official filters and the overflow menu on one line.
      const fixedWidth = 176
      const overflowWidth = 32
      const gapWidth = 10
      let remaining = Math.max(0, availableWidth - fixedWidth - overflowWidth - gapWidth)
      let count = 0
      const favoriteLabel = chatLabels.find((label) => label.name.trim() === favoriteListName)
      const availableLists = chatLabels.filter((label) => label.id !== favoriteLabel?.id)
      for (const label of availableLists) {
        const itemWidth = Math.min(116, Math.max(54, label.name.trim().length * 12 + 18))
        if (remaining < itemWidth) {
          break
        }
        remaining -= itemWidth + 3
        count += 1
      }
      setVisibleCustomListCount(count)
    }

    updateVisibleLists()
    const observer = new ResizeObserver(updateVisibleLists)
    observer.observe(shell)
    return () => observer.disconnect()
  }, [chatLabels])

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

  async function handleJumpToSearchMessage(message: MessageView) {
    if (!selectedChatId || !history || history.chat.id !== selectedChatId || message.chat_id !== selectedChatId) {
      return
    }

    messageJumpRequestSeqRef.current += 1
    setMessageJumpError(undefined)
    if (scrollToMessage(message.id)) {
      setMessageJumpBusyId(undefined)
      return
    }

    const requestSeq = messageJumpRequestSeqRef.current
    const requestChatId = selectedChatId
    const targetTime = new Date(message.sent_at)
    if (Number.isNaN(targetTime.getTime())) {
      setMessageJumpError('这条消息的时间信息无效，暂时无法定位')
      return
    }

    targetTime.setMilliseconds(targetTime.getMilliseconds() + 1)
    setMessageJumpBusyId(message.id)
    try {
      const response = await getChatMessages(requestChatId, {
        limit: 100,
        before: targetTime.toISOString(),
      })
      if (messageJumpRequestSeqRef.current !== requestSeq || activeAssistantChatIdRef.current !== requestChatId) {
        return
      }

      pendingScrollModeRef.current = 'none'
      pendingJumpMessageIdRef.current = message.id
      setHistory((current) => {
        if (!current || current.chat.id !== requestChatId || response.chat.id !== requestChatId) {
          return current
        }
        return {
          ...current,
          chat: response.chat,
          messages: mergeMessagesChronologically(current.messages, response.messages, [message]),
          limit: response.limit,
          has_more: response.has_more,
          next_before: response.next_before,
        }
      })
    } catch (jumpError) {
      if (messageJumpRequestSeqRef.current === requestSeq) {
        setMessageJumpError(jumpError instanceof Error ? jumpError.message : '加载目标消息失败')
      }
    } finally {
      if (messageJumpRequestSeqRef.current === requestSeq) {
        setMessageJumpBusyId(undefined)
      }
    }
  }

  async function handleJumpToDate(date: Date) {
    if (!selectedChatId || isFutureLocalDate(date)) {
      return
    }

    const requestSeq = messageDateRequestSeqRef.current + 1
    messageDateRequestSeqRef.current = requestSeq
    const requestChatId = selectedChatId
    const { from, to } = getLocalDayRange(date)
    setSelectedMessageDate(date)
    setMessageDateLoading(true)
    setMessageJumpError(undefined)

    try {
      const response = await getFirstChatMessageByDate(requestChatId, from, to)
      if (messageDateRequestSeqRef.current !== requestSeq || activeAssistantChatIdRef.current !== requestChatId) {
        return
      }
      if (!response.message) {
        setMessageJumpError(`${formatCalendarDate(date)}没有消息`)
        return
      }
      setMessageDatePickerOpen(false)
      await handleJumpToSearchMessage(response.message)
    } catch (dateError) {
      if (messageDateRequestSeqRef.current === requestSeq) {
        setMessageJumpError(dateError instanceof Error ? dateError.message : '按日期定位消息失败')
      }
    } finally {
      if (messageDateRequestSeqRef.current === requestSeq) {
        setMessageDateLoading(false)
      }
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
      const response = await sendChatMessage(requestChatId, {
        message_text: content,
        reply_to_wa_message_id: replyToMessage?.wa_message_id,
      })
      appendOptimisticMessage(response, requestHistory.chat, requestSelectedChat)
      setDraftMessageForChat(requestChatId, '')
      setReplyToMessageByChatId((current) => {
        const next = { ...current }
        delete next[requestChatId]
        return next
      })
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

  async function copyMessage(message: MessageView) {
    const text = message.text_content?.trim()
    if (!text) {
      setComposeNoticeForChat(selectedChatId ?? '', '该消息没有可复制的文字')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setComposeNoticeForChat(selectedChatId ?? '', '消息已复制')
    } catch {
      setComposeNoticeForChat(selectedChatId ?? '', '复制失败，请手动选择文字')
    }
  }

  function setReplyToMessage(message: MessageView) {
    if (!selectedChatId) return
    setReplyToMessageByChatId((current) => ({ ...current, [selectedChatId]: message }))
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
    if (!translationAgentConfigured) {
      setMessageTranslations((current) => ({
        ...current,
        [translationKey]: { error: '管理员后台还没有配置可用的翻译 Provider 或模型' },
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
    if (!translationAgentConfigured) {
      setAssistantNoticeState('管理员后台还没有配置可用的翻译 Provider 或模型')
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
  const visibleCustomLists = customLists.slice(0, visibleCustomListCount)
  const overflowCustomLists = customLists.slice(visibleCustomListCount)
  const translationAgentConfigured = translationAgents.some(isConfiguredSystemAgent)
  const activePrimaryFilter: ChatPrimaryFilter = chatView === 'unread'
    ? 'unread'
    : selectedChatType === 'group'
      ? 'groups'
      : favoriteList && selectedLabelId === favoriteList.id
        ? 'favorites'
        : 'all'
  const auxiliaryFilterActive = chatView === 'archived'
    || Boolean(selectedLabelId && selectedLabelId !== favoriteList?.id)
  const sendBlockReason =
    activeHistory && !canSendInCurrentChat
      ? getChatSendBlockedReason(activeHistory.chat.wa_chat_jid, activeHistory.chat.chat_type)
      : undefined
  const hasAdoptedAssistantReply = adoptedReplyIndex !== undefined

  async function saveChatMetadataFor(chat: ChatSummary, patch: Partial<{
    note: string
    pinned: boolean
    archived: boolean
    marked_unread: boolean
    muted_until: string | null
    label_ids: string[]
  }>) {
    if (chatMetadataBusy) return false
    setChatMetadataBusy(true)
    setError(undefined)
    try {
      const response = await updateChatMetadata(chat.id, {
        note: patch.note ?? chat.note,
        pinned: patch.pinned ?? chat.pinned,
        archived: patch.archived ?? chat.archived,
        marked_unread: patch.marked_unread ?? chat.marked_unread,
        muted_until: patch.muted_until !== undefined ? patch.muted_until : chat.muted_until ?? null,
        label_ids: patch.label_ids ?? chat.labels.map((label) => label.id),
      })
      setChats((current) => current.map((item) => item.id === chat.id ? { ...item, ...response.chat } : item))
      setHistory((current) => current?.chat.id === chat.id ? { ...current, chat: response.chat } : current)
      if (selectedChatId === chat.id) {
        setChatNote(response.chat.note)
      }
      void loadChatsList(true)
      void loadChatFilterCounts()
      return true
    } catch (metadataError) {
      setError(metadataError instanceof Error ? metadataError.message : '保存会话设置失败')
      return false
    } finally {
      setChatMetadataBusy(false)
    }
  }

  async function saveChatMetadata(patch: Partial<{
    note: string
    pinned: boolean
    archived: boolean
    marked_unread: boolean
    muted_until: string | null
    label_ids: string[]
  }>) {
    if (!selectedChat) return
    await saveChatMetadataFor(selectedChat, patch)
  }

  function openChatContextMenu(event: ReactMouseEvent, chat: ChatSummary) {
    event.preventDefault()
    openChatContextMenuAt(chat, event.clientX, event.clientY, 'row')
  }

  function openChatContextMenuAt(
    chat: ChatSummary,
    clientX: number,
    clientY: number,
    source: ChatContextMenuState['source'],
  ) {
    const menuWidth = 210
    const menuHeight = source === 'toolbar' ? 410 : 360
    setChatContextMenu({
      chatId: chat.id,
      x: Math.max(8, Math.min(clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(clientY, window.innerHeight - menuHeight - 8)),
      source,
    })
  }

  function openNoteEditor(chat: ChatSummary) {
    setChatContextMenu(undefined)
    setNoteEditorChatId(chat.id)
    setNoteEditorDraft(chat.note)
  }

  async function saveNoteEditor() {
    const chat = chats.find((item) => item.id === noteEditorChatId)
    if (!chat) return
    if (await saveChatMetadataFor(chat, { note: noteEditorDraft })) {
      setNoteEditorChatId(undefined)
    }
  }

  async function toggleChatReadState(chat: ChatSummary) {
    setChatContextMenu(undefined)
    if (!chat.marked_unread) {
      await saveChatMetadataFor(chat, { marked_unread: true })
      return
    }
    setChatMetadataBusy(true)
    setError(undefined)
    try {
      const response = await markChatRead(chat.id)
      setChats((current) => current.map((item) => item.id === chat.id ? { ...item, ...response.chat } : item))
      setHistory((current) => current?.chat.id === chat.id ? { ...current, chat: response.chat } : current)
      void loadChatsList(true)
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : '更新已读状态失败')
    } finally {
      setChatMetadataBusy(false)
    }
  }

  function selectPrimaryFilter(filter: ChatPrimaryFilter) {
    startTransition(() => {
      setChatView(filter === 'unread' ? 'unread' : 'active')
      setSelectedChatType(filter === 'groups' ? 'group' : '')
      setSelectedLabelId(filter === 'favorites' ? favoriteList?.id ?? '__favorites__' : '')
      setListMenuOpen(false)
    })
  }

  function selectCustomList(labelId: string) {
    startTransition(() => {
      setChatView('active')
      setSelectedChatType('')
      setSelectedLabelId(labelId)
      setListMenuOpen(false)
    })
  }

  function closeListCreator() {
    listCandidatesRequestSeqRef.current += 1
    setListCreatorOpen(false)
    setListCandidatesLoading(false)
  }

  async function openListCreator(chatId?: string) {
    const requestSeq = listCandidatesRequestSeqRef.current + 1
    listCandidatesRequestSeqRef.current = requestSeq
    setChatContextMenu(undefined)
    setListMenuOpen(false)
    setListNameDraft('')
    setListChatIds(chatId ? [chatId] : [])
    setListCandidates([])
    setListCandidatesLoading(Boolean(selectedAccountId))
    setListCreatorOpen(true)
    if (!selectedAccountId) return
    try {
      const response = await listChats({ accountId: selectedAccountId, archived: false, limit: 2000 })
      if (listCandidatesRequestSeqRef.current !== requestSeq) return
      setListCandidates(response.chats)
    } catch {
      if (listCandidatesRequestSeqRef.current !== requestSeq) return
      // Keep the currently visible conversations available if refreshing fails.
      setListCandidates(chats)
    } finally {
      if (listCandidatesRequestSeqRef.current === requestSeq) {
        setListCandidatesLoading(false)
      }
    }
  }

  async function ensureFavoriteList() {
    if (favoriteList) {
      return favoriteList
    }
    const response = await createChatLabel(selectedAccountId, favoriteListName, '#25d366')
    setChatLabels((current) => [...current, response.label].sort(compareChatLabels))
    setSelectedLabelId((current) => current === '__favorites__' ? response.label.id : current)
    return response.label
  }

  async function toggleFavorite(chat: ChatSummary) {
    setChatContextMenu(undefined)
    setError(undefined)
    try {
      const label = await ensureFavoriteList()
      const hasFavorite = chat.labels.some((item) => item.id === label.id)
      await saveChatMetadataFor(chat, {
        label_ids: hasFavorite
          ? chat.labels.filter((item) => item.id !== label.id).map((item) => item.id)
          : [...chat.labels.map((item) => item.id), label.id],
      })
    } catch (favoriteError) {
      setError(favoriteError instanceof Error ? favoriteError.message : '更新特别关注失败')
    }
  }

  async function toggleChatList(chat: ChatSummary, label: ChatLabel) {
    const isIncluded = chat.labels.some((item) => item.id === label.id)
    setChatContextMenu(undefined)
    await saveChatMetadataFor(chat, {
      label_ids: isIncluded
        ? chat.labels.filter((item) => item.id !== label.id).map((item) => item.id)
        : [...chat.labels.map((item) => item.id), label.id],
    })
  }

  async function muteChat(chat: ChatSummary, duration: 'eight-hours' | 'one-week' | 'always' | 'off') {
    setChatContextMenu(undefined)
    const mutedUntil = duration === 'off' ? null : createMutedUntil(duration)
    await saveChatMetadataFor(chat, { muted_until: mutedUntil })
  }

  async function handleCreateList() {
    const name = listNameDraft.trim()
    if (!selectedAccountId || !name || !listChatIds.length || listBusy) {
      return
    }
    setListBusy(true)
    setError(undefined)
    try {
      const response = await createChatLabel(selectedAccountId, name)
      const selectedChats = listCandidates.filter((chat) => listChatIds.includes(chat.id))
      const updatedChats = await Promise.all(selectedChats.map(async (chat) => {
        const result = await updateChatMetadata(chat.id, {
          note: chat.note,
          pinned: chat.pinned,
          archived: chat.archived,
          marked_unread: chat.marked_unread,
          muted_until: chat.muted_until ?? null,
          label_ids: [...chat.labels.map((label) => label.id), response.label.id],
        })
        return result.chat
      }))
      const updatedById = new Map(updatedChats.map((chat) => [chat.id, chat]))
      setChatLabels((current) => [...current, response.label].sort(compareChatLabels))
      setChats((current) => current.map((chat) => updatedById.get(chat.id) ?? chat))
      setHistory((current) => current && updatedById.has(current.chat.id)
        ? { ...current, chat: updatedById.get(current.chat.id) as ChatHeader }
        : current)
      setChatView('active')
      setSelectedChatType('')
      setSelectedLabelId(response.label.id)
      closeListCreator()
      setListNameDraft('')
      setListChatIds([])
    } catch (listError) {
      setError(listError instanceof Error ? listError.message : '创建列表失败')
    } finally {
      setListBusy(false)
    }
  }

  async function handleCreateLabel() {
    if (!selectedAccountId || !newLabelName.trim()) return
    setError(undefined)
    try {
      const response = await createChatLabel(selectedAccountId, newLabelName.trim())
      setChatLabels((current) => [...current, response.label].sort(compareChatLabels))
      setNewLabelName('')
    } catch (labelError) {
      setError(labelError instanceof Error ? labelError.message : '创建标签失败')
    }
  }

  function handleChatSidebarResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const frame = chatFrameRef.current
    if (!frame) return

    event.preventDefault()
    const startX = event.clientX
    const startWidth = chatSidebarWidth
    const frameWidth = frame.getBoundingClientRect().width
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setChatSidebarWidth(clampChatSidebarWidth(
        startWidth + moveEvent.clientX - startX,
        frameWidth,
        assistantPanelCollapsed,
      ))
    }
    const stopResize = () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', stopResize)
      document.removeEventListener('pointercancel', stopResize)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', stopResize)
    document.addEventListener('pointercancel', stopResize)
  }

  function handleChatSidebarResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const frameWidth = chatFrameRef.current?.getBoundingClientRect().width
    if (!frameWidth) return
    event.preventDefault()
    const delta = event.key === 'ArrowLeft' ? -20 : 20
    setChatSidebarWidth((current) => clampChatSidebarWidth(
      current + delta,
      frameWidth,
      assistantPanelCollapsed,
    ))
  }

  function handleAssistantPanelResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const frame = chatFrameRef.current
    if (!frame || assistantPanelCollapsed) return

    event.preventDefault()
    const startX = event.clientX
    const startWidth = assistantPanelWidth
    const frameWidth = frame.getBoundingClientRect().width
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setAssistantPanelWidth(clampAssistantPanelWidth(
        startWidth - (moveEvent.clientX - startX),
        frameWidth,
        chatSidebarWidth,
      ))
    }
    const stopResize = () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', stopResize)
      document.removeEventListener('pointercancel', stopResize)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', stopResize)
    document.addEventListener('pointercancel', stopResize)
  }

  function handleAssistantPanelResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const frameWidth = chatFrameRef.current?.getBoundingClientRect().width
    if (!frameWidth || assistantPanelCollapsed) return
    event.preventDefault()
    const delta = event.key === 'ArrowLeft' ? 20 : -20
    setAssistantPanelWidth((current) => clampAssistantPanelWidth(
      current + delta,
      frameWidth,
      chatSidebarWidth,
    ))
  }

  function handleAssistantColumnResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const body = assistantPanelBodyRef.current
    if (!body) return

    event.preventDefault()
    const startX = event.clientX
    const startRatio = assistantReplyRatio
    const bodyWidth = body.getBoundingClientRect().width
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaRatio = ((moveEvent.clientX - startX) / bodyWidth) * 100
      setAssistantReplyRatio(clampAssistantReplyRatio(startRatio + deltaRatio, bodyWidth))
    }
    const stopResize = () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', stopResize)
      document.removeEventListener('pointercancel', stopResize)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', stopResize)
    document.addEventListener('pointercancel', stopResize)
  }

  function handleAssistantColumnResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const bodyWidth = assistantPanelBodyRef.current?.getBoundingClientRect().width
    if (!bodyWidth) return
    event.preventDefault()
    const delta = event.key === 'ArrowLeft' ? -2 : 2
    setAssistantReplyRatio((current) => clampAssistantReplyRatio(current + delta, bodyWidth))
  }

  return (
    <div className="page page-chats whatsapp-chat-page">
      <section
        ref={chatFrameRef}
        className={`chat-frame whatsapp-chat-frame${assistantPanelCollapsed ? ' assistant-panel-collapsed' : ''}`}
        style={{
          '--chat-sidebar-width': `${chatSidebarWidth}px`,
          '--assistant-panel-width': `${assistantPanelWidth}px`,
        } as CSSProperties}
      >
        <aside className="panel chat-sidebar-panel whatsapp-chat-sidebar">
          <header className="whatsapp-chat-sidebar-header">
            <h2>聊天</h2>
            <label className="whatsapp-chat-sidebar-account">
              <span className="visually-hidden">WhatsApp 账号</span>
              <select
                value={selectedAccountId}
                onChange={(event) => {
                  const nextAccountId = event.target.value
                  setSelectedAccountId(nextAccountId)
                  setSelectedChatId(chatNavigationRef.current.chatIdsByAccount[nextAccountId] || undefined)
                  setChatView('active')
                  setSelectedChatType('')
                  setSelectedLabelId('')
                  setSearch('')
                }}
                aria-label="WhatsApp 账号"
              >
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.display_name}</option>)}
              </select>
            </label>
          </header>
          <label className="field whatsapp-chat-search-field">
            <span className="visually-hidden">搜索会话</span>
            <Icon name="search" />
            <input
              ref={chatSearchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索或开始新聊天"
            />
          </label>

          <div className="whatsapp-chat-filter-shell" ref={listMenuRef}>
            <div className="chat-view-tabs whatsapp-primary-filters" role="tablist" aria-label="会话筛选">
              {([
                ['all', '全部'],
                ['unread', '未读'],
                ['groups', '群组'],
                ['favorites', favoriteListName],
              ] as Array<[ChatPrimaryFilter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={activePrimaryFilter === value && !auxiliaryFilterActive}
                  className={activePrimaryFilter === value && !auxiliaryFilterActive ? 'active' : ''}
                  onClick={() => selectPrimaryFilter(value)}
                >
                  {label}
                  {getPrimaryFilterCount(value, chatFilterCounts) > 0
                    ? <span className="chat-filter-count">{getPrimaryFilterCount(value, chatFilterCounts)}</span>
                    : null}
                </button>
              ))}
              {visibleCustomLists.map((label) => (
                <button
                  key={label.id}
                  type="button"
                  role="tab"
                  aria-selected={selectedLabelId === label.id}
                  className={selectedLabelId === label.id ? 'active' : ''}
                  onClick={() => selectCustomList(label.id)}
                  title={label.name}
                >
                  {label.name}
                </button>
              ))}
              <button
                className={`chat-list-add-button${listMenuOpen || auxiliaryFilterActive ? ' active' : ''}`}
                type="button"
                aria-label="更多列表"
                title="更多列表"
                aria-haspopup="menu"
                aria-expanded={listMenuOpen}
                onClick={() => setListMenuOpen((current) => !current)}
              >
                <Icon name="chevronDown" />
              </button>
            </div>

            {listMenuOpen ? (
              <div className="chat-list-menu" role="menu" aria-label="列表管理">
                <button type="button" role="menuitem" className={chatView === 'archived' ? 'selected' : ''} onClick={() => { setChatView('archived'); setSelectedChatType(''); setSelectedLabelId(''); setListMenuOpen(false) }}>
                  <span className="chat-list-menu-icon"><Icon name="archive" /></span>
                  <span><strong>已归档</strong></span>
                </button>
                {overflowCustomLists.length ? <div className="chat-list-menu-divider" /> : null}
                {overflowCustomLists.map((label) => (
                  <button key={label.id} type="button" role="menuitem" className={selectedLabelId === label.id ? 'selected' : ''} onClick={() => selectCustomList(label.id)}>
                    <span className="chat-list-menu-icon"><Icon name="list" /></span>
                    <span><strong>{label.name}</strong></span>
                  </button>
                ))}
                <div className="chat-list-menu-divider" />
                <button type="button" role="menuitem" onClick={() => void openListCreator()}>
                  <span className="chat-list-menu-icon"><Icon name="plus" /></span>
                  <span><strong>新列表</strong></span>
                </button>
              </div>
            ) : null}
          </div>

          {chats.length > 0 ? (
            <div ref={chatListScrollRef} className="chat-list-scroll whatsapp-chat-list-scroll">
              <div className="chat-list whatsapp-chat-list">
                {chats.map((chat) => (
                  <button
                    key={chat.id}
                    data-chat-id={chat.id}
                    type="button"
                    className={`chat-row whatsapp-chat-row${selectedChatId === chat.id ? ' selected' : ''}`}
                    onClick={() => startTransition(() => setSelectedChatId(chat.id))}
                    onContextMenu={(event) => openChatContextMenu(event, chat)}
                  >
                    <ChatAvatar chat={chat} />

                    <div className="whatsapp-chat-row-content">
                      <div className="chat-row-header whatsapp-chat-row-header">
                        <strong>{getChatDisplayName(chat)}</strong>
                        <small>{formatChatTimestamp(chat.last_message_at)}</small>
                      </div>

                      {chat.note ? <span className="whatsapp-chat-row-note">{chat.note}</span> : null}

                      <div className="chat-row-meta whatsapp-chat-row-meta">
                        <p>{chat.latest_from_me ? <span className="chat-preview-check">✓✓</span> : null}{getChatPreviewText(chat)}</p>
                        <span className="chat-row-indicators" aria-label="会话状态">
                          {isChatMuted(chat) ? <Icon name="bellOff" /> : null}
                          {chat.pinned ? <Icon name="pin" /> : null}
                          {chat.marked_unread ? <span className="chat-unread-dot" title="未读" /> : null}
                        </span>
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

        <div
          className="chat-sidebar-resizer"
          role="separator"
          aria-label="调整会话列表宽度"
          aria-orientation="vertical"
          aria-valuemin={minChatSidebarWidth}
          aria-valuemax={Math.round(chatFrameRef.current?.getBoundingClientRect().width
            ? getChatSidebarMaxWidth(chatFrameRef.current.getBoundingClientRect().width, assistantPanelCollapsed)
            : minChatSidebarWidth)}
          aria-valuenow={Math.round(chatSidebarWidth)}
          tabIndex={0}
          title="拖动调整会话列表宽度"
          onPointerDown={handleChatSidebarResizeStart}
          onKeyDown={handleChatSidebarResizeKeyDown}
        />

        <section className="panel chat-main-panel whatsapp-chat-main">
          {selectedChat && activeHistory ? (
            <>
              <header className="chat-contact-toolbar">
                <button className="chat-contact-identity" type="button" onClick={() => setChatInfoOpen((current) => !current)}>
                  <ChatAvatar chat={selectedChat} />
                  <span><strong>{getChatDisplayName(selectedChat)}</strong><small>{selectedChat.note || selectedChat.phone_number || selectedChat.wa_chat_jid}</small></span>
                </button>
                {statusCard ? (
                  <div className="chat-contact-status-tags" aria-label="客户状态">
                    <span title={`当前阶段：${statusCard.current_stage}`}>{statusCard.current_stage || '阶段未判断'}</span>
                    <span className={`tone-${getRiskTone(statusCard.current_risk) ?? 'neutral'}`} title={`当前风险：${statusCard.current_risk}`}>{statusCard.current_risk || '风险未判断'}</span>
                    <span title={`客户类型：${statusCard.customer_types.join('、')}`}>{statusCard.customer_types[0] || '类型未判断'}</span>
                  </div>
                ) : null}
                <div className="chat-contact-toolbar-actions">
                  <button type="button" onClick={openMessageSearch} title="搜索消息" aria-label="搜索消息"><Icon name="search" /></button>
                  <button type="button" onClick={(event) => openChatContextMenuAt(selectedChat, event.clientX, event.clientY + 12, 'toolbar')} title="更多操作" aria-label="更多操作"><Icon name="moreVertical" /></button>
                  {assistantPanelCollapsed && !messageSearchOpen ? (
                    <button className="assistant-panel-open-button" type="button" onClick={() => setAssistantPanelCollapsed(false)} title="展开智能体面板" aria-label="展开智能体面板"><Icon name="chevronRight" /></button>
                  ) : null}
                </div>
              </header>

              {messageSearchOpen ? (
                <aside className="chat-message-search-panel" aria-label="搜索消息">
                  <header className="chat-message-search-header">
                    <strong>搜索消息</strong>
                    <button type="button" onClick={closeMessageSearch} aria-label="关闭搜索消息" title="关闭搜索消息">×</button>
                  </header>
                  <div className="chat-message-search-controls">
                    <button
                      className={messageDatePickerOpen ? 'active' : ''}
                      type="button"
                      onClick={() => {
                        setMessageDateMonth(startOfLocalMonth())
                        setMessageDatePickerOpen((current) => !current)
                      }}
                      aria-label="按日期查找消息"
                      title="按日期查找消息"
                    >
                      <Icon name="calendar" />
                    </button>
                    <label className="chat-message-search-field">
                      <Icon name="search" />
                      <input
                        autoFocus
                        value={messageSearch}
                        onChange={(event) => setMessageSearch(event.target.value)}
                        placeholder="搜索当前会话"
                        aria-label="搜索当前会话消息"
                      />
                    </label>
                  </div>
                  {messageDatePickerOpen ? (
                    <section className="chat-message-date-picker" aria-label="选择消息日期">
                      <header>
                        <strong>{formatCalendarMonth(messageDateMonth)}</strong>
                        <div>
                          <button className="previous" type="button" onClick={() => setMessageDateMonth((current) => addLocalMonths(current, -1))} aria-label="上个月" title="上个月"><Icon name="chevronRight" /></button>
                          <button type="button" disabled={!canMoveToNextMonth(messageDateMonth)} onClick={() => setMessageDateMonth((current) => addLocalMonths(current, 1))} aria-label="下个月" title="下个月"><Icon name="chevronRight" /></button>
                        </div>
                      </header>
                      <div className="chat-message-date-weekdays" aria-hidden="true">
                        {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((weekday) => <span key={weekday}>{weekday}</span>)}
                      </div>
                      <div className="chat-message-date-grid">
                        {messageCalendarDays.map((date) => {
                          const future = isFutureLocalDate(date)
                          const outsideMonth = date.getMonth() !== messageDateMonth.getMonth()
                          const selected = selectedMessageDate ? isSameLocalDate(date, selectedMessageDate) : false
                          return (
                            <button
                              key={toLocalDateKey(date)}
                              className={`${outsideMonth ? 'outside-month ' : ''}${selected ? 'selected' : ''}`.trim()}
                              type="button"
                              disabled={future || messageDateLoading}
                              onClick={() => void handleJumpToDate(date)}
                              aria-label={`定位到${formatCalendarDate(date)}的第一条消息`}
                            >
                              {date.getDate()}
                            </button>
                          )
                        })}
                      </div>
                      {messageDateLoading ? <p>正在定位当天第一条消息...</p> : null}
                    </section>
                  ) : null}
                  <div className="chat-message-search-results">
                    {messageJumpError ? (
                      <p className="chat-message-search-jump-error">{messageJumpError}</p>
                    ) : null}
                    {!messageSearch.trim() ? (
                      <p className="chat-message-search-empty">输入关键词搜索当前会话消息</p>
                    ) : messageSearchLoading ? (
                      <p className="chat-message-search-empty">搜索中...</p>
                    ) : messageSearchError ? (
                      <p className="chat-message-search-empty error-text">{messageSearchError}</p>
                    ) : messageSearchResults.length ? (
                      messageSearchResults.map((message) => (
                        <button
                          className={`chat-message-search-result${messageJumpBusyId === message.id ? ' loading' : ''}`}
                          key={message.id}
                          type="button"
                          onClick={() => void handleJumpToSearchMessage(message)}
                          aria-busy={messageJumpBusyId === message.id}
                          aria-label={`定位消息：${message.text_content?.trim() || fallbackMessageCopy(message.message_type)}`}
                        >
                          <div>
                            <strong>{message.from_me ? '你' : getMessageSenderName(message)}</strong>
                            <time dateTime={message.sent_at}>{formatMessageDateTime(message.sent_at)}</time>
                          </div>
                          <p>{messageJumpBusyId === message.id ? '正在定位消息...' : message.text_content?.trim() || fallbackMessageCopy(message.message_type)}</p>
                        </button>
                      ))
                    ) : (
                      <p className="chat-message-search-empty">没有找到消息</p>
                    )}
                  </div>
                </aside>
              ) : null}

              {chatInfoOpen ? (
                <aside className="chat-info-drawer">
                  <div className="chat-info-drawer-head"><strong>会话资料</strong><button type="button" onClick={() => setChatInfoOpen(false)}>×</button></div>
                  <div className="chat-info-profile"><span className="whatsapp-chat-avatar large">{getChatAvatarLabel(getChatDisplayName(selectedChat))}</span><div><h3>{getChatDisplayName(selectedChat)}</h3><p>{selectedChat.phone_number || selectedChat.wa_chat_jid}</p></div></div>
                  <section className="chat-customer-section">
                    <div className="chat-customer-section-head"><strong>标签</strong><button type="button" onClick={() => setLabelEditorOpen((current) => !current)}><Icon name="plus" />管理</button></div>
                    <div className="chat-label-row">
                      {selectedChat.labels.map((label) => <button key={label.id} type="button" className="chat-label-chip" style={{ '--label-color': label.color } as CSSProperties} onClick={() => void saveChatMetadata({ label_ids: selectedChat.labels.filter((item) => item.id !== label.id).map((item) => item.id) })}>{label.name} ×</button>)}
                      {!selectedChat.labels.length ? <small>暂无标签</small> : null}
                    </div>
                    {labelEditorOpen ? <div className="chat-label-editor">
                      <div className="chat-label-options">{chatLabels.map((label) => <button key={label.id} type="button" className={selectedChat.labels.some((item) => item.id === label.id) ? 'selected' : ''} onClick={() => void saveChatMetadata({ label_ids: selectedChat.labels.some((item) => item.id === label.id) ? selectedChat.labels.filter((item) => item.id !== label.id).map((item) => item.id) : [...selectedChat.labels.map((item) => item.id), label.id] })}>{label.name}</button>)}</div>
                      <div className="chat-label-create"><input value={newLabelName} onChange={(event) => setNewLabelName(event.target.value)} placeholder="新标签名称" /><button type="button" onClick={() => void handleCreateLabel()}>新增</button></div>
                    </div> : null}
                  </section>
                  <label className="field chat-customer-note"><span>会话备注</span><textarea rows={6} value={chatNote} onChange={(event) => setChatNote(event.target.value)} placeholder="客户身份、偏好和跟进事项" /></label>
                  <button className="primary-button" type="button" onClick={() => void saveChatMetadata({ note: chatNote })} disabled={chatMetadataBusy}>{chatMetadataBusy ? '保存中...' : '保存资料'}</button>
                </aside>
              ) : null}

              {statusCardOpen ? (
                <aside ref={statusCardPanelRef} className="chat-status-popover" aria-label="用户状态卡">
                  <header>
                    <div>
                      <strong>用户状态卡</strong>
                      <span>{statusCard ? `${statusCard.message_count} 条记录` : `${activeHistory.messages.length} 条已加载消息`}</span>
                    </div>
                    <div className="chat-status-popover-actions">
                      <button
                        className="primary-button chat-status-analyze-button"
                        type="button"
                        onClick={() => void handleAnalyzeStatusCard()}
                        disabled={!canAnalyzeStatusCard}
                      >
                        {statusCardBusy ? '分析中...' : statusCard ? '重分析' : '分析'}
                      </button>
                      <button className="chat-status-close-button" type="button" onClick={() => setStatusCardOpen(false)} aria-label="关闭用户状态卡">×</button>
                    </div>
                  </header>
                  {agentConfigsLoading ? (
                    <div className="warning-banner">正在加载状态卡配置...</div>
                  ) : !activeStatusCardAgent ? (
                    <div className="warning-banner">管理员后台尚未启用状态卡智能体。</div>
                  ) : null}
                  <div className="chat-status-overview-row">
                    <StatusMetric label="当前阶段" value={statusCard?.current_stage || '未判断'} />
                    <StatusMetric label="当前风险" value={statusCard?.current_risk || '未判断'} tone={getRiskTone(statusCard?.current_risk || '')} />
                    <div className="assistant-status-metric assistant-status-type-metric">
                      <span>客户类型</span>
                      <div className="assistant-chip-row">
                        {(statusCard?.customer_types.length ? statusCard.customer_types : ['未判断']).map((item) => <span className="toolbar-chip" key={item}>{item}</span>)}
                      </div>
                    </div>
                  </div>
                  <button
                    className="chat-status-detail-toggle"
                    type="button"
                    onClick={() => setStatusCardCollapsed((current) => !current)}
                    aria-expanded={!statusCardCollapsed}
                  >
                    <span>摘要与建议</span>
                    <Icon name="chevronDown" className={statusCardCollapsed ? '' : 'rotate-180'} />
                  </button>
                  {!statusCardCollapsed ? (
                    <div className="chat-status-popover-detail">
                      {statusCard?.summary ? <p className="assistant-status-summary"><strong>摘要</strong><span>{statusCard.summary}</span></p> : <p className="assistant-status-empty">点击分析后显示客户状态摘要。</p>}
                      {statusCard?.next_action ? <p className="assistant-status-summary"><strong>建议</strong><span>{statusCard.next_action}</span></p> : null}
                      {statusCard?.evidence.length ? <ul className="assistant-evidence-list">{statusCard.evidence.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul> : null}
                    </div>
                  ) : null}
                  {statusCardNotice ? <div className="warning-banner">{statusCardNotice}</div> : null}
                </aside>
              ) : null}

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
                      ref={(element) => {
                        if (element) {
                          messageElementRefs.current.set(message.id, element)
                        } else {
                          messageElementRefs.current.delete(message.id)
                        }
                      }}
                      className={`message-card whatsapp-message-card${message.from_me ? ' own' : ''}${hasMedia ? ' media-message' : ''}${highlightedMessageId === message.id ? ' search-highlighted' : ''}`}
                    >
                      {!message.from_me ? (
                        <div className="message-meta">
                          <strong>{getMessageSenderName(message)}</strong>
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
                        canOfferMessageTranslation(message) && translationAgentConfigured
                          ? () => void translateMessageToChinese(message)
                          : undefined,
                      )}

                      <div className="whatsapp-message-actions">
                        {textContent ? (
                          <button type="button" onClick={() => void copyMessage(message)} title="复制消息">
                            <Icon name="copy" />
                          </button>
                        ) : null}
                        <button type="button" onClick={() => setReplyToMessage(message)} title="引用回复">
                          <Icon name="reply" />
                        </button>
                      </div>

                      <div className="whatsapp-message-foot">
                        <span>{formatMessageTime(message.sent_at)}</span>
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
                    {replyToMessage ? (
                      <div className="whatsapp-reply-preview">
                        <span><Icon name="reply" />引用：{replyToMessage.text_content || fallbackMessageCopy(replyToMessage.message_type)}</span>
                        <button type="button" onClick={() => setReplyToMessageByChatId((current) => ({ ...current, [selectedChatId ?? '']: undefined }))} title="取消引用">×</button>
                      </div>
                    ) : null}
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
                      rows={1}
                      disabled={!canSendInCurrentChat}
                    />
                  </div>

                  <button
                    className="primary-button whatsapp-send-button"
                    type="button"
                    onClick={() => void handleSendMessage()}
                    disabled={!canSendMessage}
                    aria-label={sending ? '发送中' : '发送消息'}
                    title={sending ? '发送中' : '发送消息'}
                  >
                    <Icon name="send" />
                  </button>
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

        {!assistantPanelCollapsed ? (
          <div
            className="chat-assistant-resizer"
            role="separator"
            aria-label="调整聊天和智能体面板宽度"
            aria-orientation="vertical"
            aria-valuemin={minAssistantPanelWidth}
            aria-valuemax={Math.round(chatFrameRef.current?.getBoundingClientRect().width
              ? getAssistantPanelMaxWidth(chatFrameRef.current.getBoundingClientRect().width, chatSidebarWidth)
              : minAssistantPanelWidth)}
            aria-valuenow={Math.round(assistantPanelWidth)}
            tabIndex={0}
            title="拖动调整聊天和智能体面板宽度"
            onPointerDown={handleAssistantPanelResizeStart}
            onKeyDown={handleAssistantPanelResizeKeyDown}
          />
        ) : null}

        <aside className="panel chat-assistant-panel whatsapp-chat-assistant" aria-hidden={assistantPanelCollapsed}>
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
            <button className="assistant-panel-close-button" type="button" onClick={() => setAssistantPanelCollapsed(true)} title="隐藏智能体面板" aria-label="隐藏智能体面板"><Icon name="chevronRight" /></button>
          </div>

          {selectedChat && activeHistory ? (
            <div
              ref={assistantPanelBodyRef}
              className="assistant-panel-body whatsapp-assistant-body"
              style={{ '--assistant-reply-width': `${assistantReplyRatio}%` } as CSSProperties}
            >
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

              <div
                className="assistant-column-resizer"
                role="separator"
                aria-label="调整回复方案和采纳区宽度"
                aria-orientation="vertical"
                aria-valuemin={Math.round(getAssistantReplyRatioBounds(assistantPanelBodyRef.current?.getBoundingClientRect().width ?? 0).min)}
                aria-valuemax={Math.round(getAssistantReplyRatioBounds(assistantPanelBodyRef.current?.getBoundingClientRect().width ?? 0).max)}
                aria-valuenow={Math.round(assistantReplyRatio)}
                tabIndex={0}
                title="拖动调整回复方案和采纳区宽度"
                onPointerDown={handleAssistantColumnResizeStart}
                onKeyDown={handleAssistantColumnResizeKeyDown}
              />

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
                      disabled={!assistantDraft.trim() || !translationAgentConfigured || draftTranslationBusy}
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

      {chatContextMenu ? (() => {
        const chat = chats.find((item) => item.id === chatContextMenu.chatId)
        if (!chat) return null
        return (
          <div
            ref={chatContextMenuRef}
            className="chat-context-menu"
            role="menu"
            style={{ left: chatContextMenu.x, top: chatContextMenu.y }}
          >
            {chatContextMenu.source === 'toolbar' ? (
              <>
                <button type="button" role="menuitem" onClick={() => { setChatContextMenu(undefined); setStatusCardOpen(true) }}>
                  <Icon name="user" /><span>用户状态卡</span>
                </button>
                <div className="chat-context-divider" />
              </>
            ) : null}
            <button type="button" role="menuitem" onClick={() => { setChatContextMenu(undefined); void saveChatMetadataFor(chat, { archived: !chat.archived }) }}>
              <Icon name="archive" /><span>{chat.archived ? '取消归档' : '归档聊天'}</span>
            </button>
            <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={chatContextMenu.submenu === 'mute'} onClick={() => setChatContextMenu((current) => current ? { ...current, submenu: current.submenu === 'mute' ? undefined : 'mute' } : current)}>
              <Icon name="bellOff" /><span>{isChatMuted(chat) ? '已静音' : '静音通知'}</span><Icon name="chevronRight" />
            </button>
            {chatContextMenu.submenu === 'mute' ? (
              <div className="chat-context-submenu" role="menu" aria-label="静音时长">
                {isChatMuted(chat) ? <button type="button" role="menuitem" onClick={() => void muteChat(chat, 'off')}><span>取消静音</span></button> : null}
                <button type="button" role="menuitem" onClick={() => void muteChat(chat, 'eight-hours')}><span>8 小时</span></button>
                <button type="button" role="menuitem" onClick={() => void muteChat(chat, 'one-week')}><span>1 周</span></button>
                <button type="button" role="menuitem" onClick={() => void muteChat(chat, 'always')}><span>始终</span></button>
              </div>
            ) : null}
            <button type="button" role="menuitem" onClick={() => { setChatContextMenu(undefined); void saveChatMetadataFor(chat, { pinned: !chat.pinned }) }}>
              <Icon name="pin" /><span>{chat.pinned ? '取消置顶' : '置顶聊天'}</span>
            </button>
            <button type="button" role="menuitem" onClick={() => void toggleChatReadState(chat)}>
              <Icon name={chat.marked_unread ? 'check' : 'bellOff'} /><span>{chat.marked_unread ? '标记已读' : '标记为未读'}</span>
            </button>
            <button type="button" role="menuitem" onClick={() => void toggleFavorite(chat)}>
              <Icon name="heart" /><span>{favoriteList && chat.labels.some((label) => label.id === favoriteList.id) ? `从“${favoriteListName}”移除` : `添加到“${favoriteListName}”`}</span>
            </button>
            <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={chatContextMenu.submenu === 'lists'} onClick={() => setChatContextMenu((current) => current ? { ...current, submenu: current.submenu === 'lists' ? undefined : 'lists' } : current)}>
              <Icon name="list" /><span>更改列表</span><Icon name="chevronRight" />
            </button>
            {chatContextMenu.submenu === 'lists' ? (
              <div className="chat-context-submenu" role="menu" aria-label="更改列表">
                {customLists.map((label) => (
                  <button key={label.id} type="button" role="menuitemcheckbox" aria-checked={chat.labels.some((item) => item.id === label.id)} onClick={() => void toggleChatList(chat, label)}>
                    <Icon name={chat.labels.some((item) => item.id === label.id) ? 'check' : 'list'} />
                    <span>{label.name}</span>
                  </button>
                ))}
                <button type="button" role="menuitem" onClick={() => void openListCreator(chat.id)}><Icon name="plus" /><span>创建新列表</span></button>
              </div>
            ) : null}
            <div className="chat-context-divider" />
            <button type="button" role="menuitem" onClick={() => openNoteEditor(chat)}>
              <Icon name="edit" /><span>{chat.note ? '修改备注' : '添加备注'}</span>
            </button>
          </div>
        )
      })() : null}

      {listCreatorOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !listBusy) closeListCreator()
        }}>
          <section className="chat-list-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-list-dialog-title">
            <header>
              <button type="button" className="icon-button" onClick={closeListCreator} aria-label="返回"><Icon name="chevronRight" /></button>
              <h2 id="chat-list-dialog-title">创建新列表</h2>
            </header>
            <label className="chat-list-name-field">
              <span>列表名称</span>
              <input autoFocus maxLength={50} value={listNameDraft} onChange={(event) => setListNameDraft(event.target.value)} placeholder="列表名称" />
              <small>{listNameDraft.length}/50</small>
            </label>
            <div className="chat-list-members-heading">
              <strong>已包含</strong>
              <span>{listChatIds.length} 个会话</span>
            </div>
            <div className="chat-list-member-picker">
              {listCandidatesLoading ? (
                <div className="chat-list-member-state">正在加载会话...</div>
              ) : listCandidates.length === 0 ? (
                <div className="chat-list-member-state">暂无可添加的会话</div>
              ) : listCandidates.map((chat) => {
                const checked = listChatIds.includes(chat.id)
                return (
                  <label key={chat.id} className={checked ? 'selected' : ''}>
                    <input type="checkbox" checked={checked} onChange={() => setListChatIds((current) => checked ? current.filter((id) => id !== chat.id) : [...current, chat.id])} />
                    <ChatAvatar chat={chat} />
                    <span><strong>{getChatDisplayName(chat)}</strong><small>{chat.chat_type === 'group' ? '群组' : chat.phone_number || '单聊'}</small></span>
                  </label>
                )
              })}
            </div>
            <footer>
              <button type="button" className="primary-button" disabled={!listNameDraft.trim() || !listChatIds.length || listBusy} onClick={() => void handleCreateList()}>{listBusy ? '创建中...' : '创建列表'}</button>
            </footer>
          </section>
        </div>
      ) : null}

      {noteEditorChatId ? (() => {
        const chat = chats.find((item) => item.id === noteEditorChatId)
        if (!chat) return null
        return (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setNoteEditorChatId(undefined)
          }}>
            <section className="chat-note-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-note-title">
              <header>
                <div><span>会话备注</span><strong id="chat-note-title">{getChatDisplayName(chat)}</strong></div>
                <button type="button" className="icon-button" onClick={() => setNoteEditorChatId(undefined)} aria-label="关闭">×</button>
              </header>
              <textarea
                autoFocus
                rows={6}
                maxLength={2000}
                value={noteEditorDraft}
                onChange={(event) => setNoteEditorDraft(event.target.value)}
                placeholder="记录客户身份、偏好和后续跟进事项"
              />
              <footer>
                <button type="button" className="secondary-button" onClick={() => setNoteEditorDraft('')} disabled={!noteEditorDraft}>清空</button>
                <span>{noteEditorDraft.length}/2000</span>
                <button type="button" className="secondary-button" onClick={() => setNoteEditorChatId(undefined)}>取消</button>
                <button type="button" className="primary-button" onClick={() => void saveNoteEditor()} disabled={chatMetadataBusy}>{chatMetadataBusy ? '保存中...' : '保存'}</button>
              </footer>
            </section>
          </div>
        )
      })() : null}
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

function ChatAvatar({ chat }: { chat: ChatSummary }) {
  return (
    <span className="whatsapp-chat-avatar" aria-hidden="true">
      {chat.profile_photo_url ? <img src={chat.profile_photo_url} alt="" /> : getChatAvatarLabel(getChatDisplayName(chat))}
    </span>
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

function readStoredChatNavigation(): StoredChatNavigation {
  const fallback: StoredChatNavigation = {
    accountId: '',
    chatIdsByAccount: {},
    chatView: 'active',
    chatType: '',
    labelId: '',
    search: '',
  }

  try {
    const raw = window.sessionStorage.getItem(chatNavigationStorageKey)
    if (!raw) {
      return fallback
    }

    const parsed = JSON.parse(raw) as Partial<StoredChatNavigation>
    const chatIdsByAccount = Object.fromEntries(
      Object.entries(parsed.chatIdsByAccount ?? {}).filter(
        ([accountId, chatId]) => Boolean(accountId.trim()) && typeof chatId === 'string' && Boolean(chatId.trim()),
      ),
    )
    const chatViews: StoredChatNavigation['chatView'][] = ['active', 'archived', 'unread']
    const chatTypes: StoredChatNavigation['chatType'][] = ['', 'direct', 'group', 'broadcast', 'status']

    return {
      accountId: typeof parsed.accountId === 'string' ? parsed.accountId.trim() : '',
      chatIdsByAccount,
      chatView: chatViews.includes(parsed.chatView as StoredChatNavigation['chatView'])
        ? parsed.chatView as StoredChatNavigation['chatView']
        : 'active',
      chatType: chatTypes.includes(parsed.chatType as StoredChatNavigation['chatType'])
        ? parsed.chatType as StoredChatNavigation['chatType']
        : '',
      labelId: typeof parsed.labelId === 'string' ? parsed.labelId.trim() : '',
      search: typeof parsed.search === 'string' ? parsed.search : '',
    }
  } catch {
    return fallback
  }
}

function writeStoredChatNavigation(navigation: StoredChatNavigation) {
  try {
    window.sessionStorage.setItem(chatNavigationStorageKey, JSON.stringify(navigation))
  } catch {
    // Navigation persistence is best effort; chat loading remains usable if storage is unavailable.
  }
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

function formatChatTimestamp(value?: string) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const now = new Date()
  if (isSameLocalDate(date, now)) {
    return formatMessageTime(value)
  }

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameLocalDate(date, yesterday)) {
    return '昨天'
  }

  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function formatMessageTime(value?: string) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).format(date)
}

function formatMessageDateTime(value?: string) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).format(date)
}

function isSameLocalDate(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function startOfLocalMonth() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

function addLocalMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function canMoveToNextMonth(date: Date) {
  const now = new Date()
  return date.getFullYear() < now.getFullYear()
    || (date.getFullYear() === now.getFullYear() && date.getMonth() < now.getMonth())
}

function buildCalendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1)
  const mondayOffset = (firstDay.getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, index) => (
    new Date(month.getFullYear(), month.getMonth(), index - mondayOffset + 1)
  ))
}

function isFutureLocalDate(date: Date) {
  const today = new Date()
  const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return candidate.getTime() > currentDay.getTime()
}

function getLocalDayRange(date: Date) {
  const from = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const to = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  return { from: from.toISOString(), to: to.toISOString() }
}

function toLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatCalendarMonth(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}

function formatCalendarDate(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function mergeMessagesChronologically(...messageGroups: MessageView[][]) {
  const messagesByKey = new Map<string, MessageView>()
  for (const messages of messageGroups) {
    for (const message of messages) {
      const waMessageID = message.wa_message_id?.trim()
      const key = waMessageID ? `wa:${waMessageID}` : `id:${message.id}`
      messagesByKey.set(key, message)
    }
  }

  return [...messagesByKey.values()].sort((left, right) => {
    const timeDifference = new Date(left.sent_at).getTime() - new Date(right.sent_at).getTime()
    return timeDifference || left.id.localeCompare(right.id)
  })
}

function compareChatLabels(left: ChatLabel, right: ChatLabel) {
  if (left.name === favoriteListName) return -1
  if (right.name === favoriteListName) return 1
  return left.name.localeCompare(right.name, 'zh-CN')
}

function readStoredChatSidebarWidth() {
  const stored = Number(window.localStorage.getItem(chatSidebarWidthStorageKey))
  return Number.isFinite(stored) && stored >= minChatSidebarWidth ? stored : defaultChatSidebarWidth
}

function readStoredAssistantPanelCollapsed() {
  if (window.innerWidth <= 1100) {
    return true
  }
  return window.localStorage.getItem(assistantPanelCollapsedStorageKey) === 'true'
}

function readStoredAssistantReplyRatio() {
  const storedValue = window.localStorage.getItem(assistantReplyRatioStorageKey)
  if (!storedValue) return defaultAssistantReplyRatio
  const stored = Number(storedValue)
  return Number.isFinite(stored) && stored > 0 && stored < 100 ? stored : defaultAssistantReplyRatio
}

function readStoredAssistantPanelWidth() {
  const stored = Number(window.localStorage.getItem(assistantPanelWidthStorageKey))
  return Number.isFinite(stored) && stored >= minAssistantPanelWidth ? stored : defaultAssistantPanelWidth
}

function getChatSidebarMaxWidth(frameWidth: number, assistantPanelCollapsed: boolean) {
  const reservedWidth = minChatMainWidth + (assistantPanelCollapsed ? 0 : minAssistantPanelWidth) + 24
  return Math.max(minChatSidebarWidth, Math.min(frameWidth * 0.4, frameWidth - reservedWidth))
}

function clampChatSidebarWidth(width: number, frameWidth: number, assistantPanelCollapsed: boolean) {
  return Math.min(
    Math.max(width, minChatSidebarWidth),
    getChatSidebarMaxWidth(frameWidth, assistantPanelCollapsed),
  )
}

function getAssistantPanelMaxWidth(frameWidth: number, sidebarWidth: number) {
  const availableWidth = frameWidth - sidebarWidth - minChatMainWidth - 12
  return Math.max(
    minAssistantPanelWidth,
    Math.min(frameWidth * 0.55, availableWidth),
  )
}

function clampAssistantPanelWidth(width: number, frameWidth: number, sidebarWidth: number) {
  return Math.min(
    Math.max(width, minAssistantPanelWidth),
    getAssistantPanelMaxWidth(frameWidth, sidebarWidth),
  )
}

function getAssistantReplyRatioBounds(bodyWidth: number) {
  if (bodyWidth <= 0) {
    return { min: 0, max: 100 }
  }
  const dividerAndGapsWidth = 18
  const min = (minAssistantReplyWidth / bodyWidth) * 100
  const max = ((bodyWidth - minAssistantDraftWidth - dividerAndGapsWidth) / bodyWidth) * 100
  return { min, max: Math.max(min, max) }
}

function clampAssistantReplyRatio(ratio: number, bodyWidth: number) {
  const bounds = getAssistantReplyRatioBounds(bodyWidth)
  return Math.min(Math.max(ratio, bounds.min), bounds.max)
}

function getPrimaryFilterCount(
  filter: ChatPrimaryFilter,
  counts: { unread: number; groups: number; favorites: number },
) {
  if (filter === 'all') return 0
  return counts[filter]
}

function isChatMuted(chat: Pick<ChatSummary, 'muted_until'>) {
  if (!chat.muted_until) {
    return false
  }
  const mutedUntil = new Date(chat.muted_until)
  return !Number.isNaN(mutedUntil.getTime()) && mutedUntil.getTime() > Date.now()
}

function createMutedUntil(duration: 'eight-hours' | 'one-week' | 'always') {
  const mutedUntil = new Date()
  if (duration === 'eight-hours') {
    mutedUntil.setHours(mutedUntil.getHours() + 8)
  } else if (duration === 'one-week') {
    mutedUntil.setDate(mutedUntil.getDate() + 7)
  } else {
    mutedUntil.setFullYear(mutedUntil.getFullYear() + 100)
  }
  return mutedUntil.toISOString()
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
