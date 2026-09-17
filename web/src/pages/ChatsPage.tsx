import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
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
  clearChat,
  createContact,
  createChatLabel,
  createAssistantUsageLog,
  deleteChat,
  deleteChatMessage,
  editChatMessage,
  forwardChatMessage,
  getFirstChatMessageByDate,
  getChatMessages,
  getMediaAssetUrl,
  getStatusCard,
  listAccounts,
  listAvailableSystemAgentConfigs,
  listChatLabels,
  listChats,
  listContacts,
  markChatRead,
  openDirectChat,
  reactToMessage,
  searchChatMessages,
  sendAgentRun,
  sendChatContact,
  sendChatMedia,
  sendChatMessage,
  sendChatPoll,
  streamGenerateAgentRun,
  subscribeLiveUpdates,
  transcribeAudio,
  translateText,
  updateChatMetadata,
  updateMessageMetadata,
  type AssistantUsageAction,
  type CreateAssistantUsageLogPayload,
  type AccountView,
  type AudioTranscriptionView,
  type AgentRunView,
  type ChatHeader,
  type ChatLabel,
  type ChatSummary,
  type ChatType,
  type ContactView,
  type LiveUpdate,
  type MessageHistoryResponse,
  type MessageView,
  type QuotedMessageView,
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

type VoiceTranscriptionState = {
  loading?: boolean
  error?: string
  transcription?: AudioTranscriptionView
  translationLoading?: boolean
  translationError?: string
  translation?: TranslationView
}

type StoredVoiceTranscription = {
  cached_at: string
  transcription: AudioTranscriptionView
  translation?: TranslationView
}

type ChatContextMenuState = {
  chatId: string
  x: number
  y: number
  source: 'row' | 'toolbar'
  submenu?: 'mute' | 'lists'
}

type MessageContextMenuState = {
  messageId: string
  x: number
  y: number
  placement: 'own' | 'incoming'
  reactionOnly?: boolean
}

type MessageDialogState =
  | { type: 'details'; messageId: string }
  | { type: 'delete'; messageIds: string[] }
  | { type: 'edit'; messageId: string; text: string }
  | { type: 'forward'; messageIds: string[] }

type ChatDestructiveDialogState = {
  type: 'clear' | 'delete'
  chatId: string
}

type EmojiCategory = {
  id: string
  label: string
  emojis: string[]
}

type ComposerPickerMode = 'emoji' | 'gif' | 'sticker'

type MediaLibraryTab = 'media' | 'documents' | 'links'

type MediaLibraryAttachment = {
  message: MessageView
  attachment: MessageView['media'][number]
}

type MediaLibraryLink = {
  message: MessageView
  url: string
}

type MediaLibraryContent = {
  media: MediaLibraryAttachment[]
  documents: MediaLibraryAttachment[]
  links: MediaLibraryLink[]
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

type FileAttachmentAction =
  | 'document'
  | 'media'
  | 'camera'
  | 'audio'
  | 'gif'
  | 'sticker'

type AttachmentAction = FileAttachmentAction | 'contact' | 'poll'

type AttachmentDialogState =
  | { type: 'contact' }
  | { type: 'poll' }

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
  { key: 'contact', label: '联系人', icon: 'contacts', tone: 'cyan' },
  { key: 'poll', label: '投票', icon: 'list', tone: 'yellow' },
]

const quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🙏']
const emojiCategories: EmojiCategory[] = [
  { id: 'recent', label: '常用', emojis: ['😀', '😂', '🥰', '😍', '😊', '😉', '😭', '🙏', '👍', '❤️', '🎉', '🔥'] },
  { id: 'people', label: '表情与人物', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😋', '😛', '🤔', '🤗', '🤫', '😐', '😑', '😶', '🙄', '😏', '😣', '😥', '😮', '🤐', '😯', '😪', '😫', '🥱', '😴', '😭', '😤', '😡', '🤯', '😳', '🥵', '🥶', '😱', '🤭', '🫢', '🫡'] },
  { id: 'gestures', label: '手势', emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👊', '🤝', '👏', '🙌', '🫶', '🙏'] },
  { id: 'nature', label: '动物与自然', emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🌱', '🌿', '🍀', '🌸', '🌻', '🌞', '🌙', '⭐', '✨', '🔥', '🌈'] },
  { id: 'food', label: '食物', emojis: ['🍎', '🍊', '🍋', '🍉', '🍇', '🍓', '🍒', '🥭', '🍍', '🥑', '🍔', '🍟', '🍕', '🌮', '🍜', '🍚', '🍰', '🍫', '☕', '🍺'] },
  { id: 'activity', label: '活动', emojis: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🏓', '🏸', '🥊', '🎮', '🎯', '🎨', '🎤', '🎧', '🎬', '🎉', '🏆'] },
  { id: 'travel', label: '旅行与地点', emojis: ['🚗', '🚕', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚲', '✈️', '🚀', '🚢', '🏠', '🏢', '🏖️', '🏔️', '🌍', '🗺️'] },
  { id: 'objects', label: '物品与符号', emojis: ['⌚', '📱', '💻', '⌨️', '🖥️', '📷', '💡', '📚', '📌', '✉️', '📦', '🔑', '🔒', '❤️', '💔', '✅', '❌', '⚠️'] },
]

const messageTranslationCacheStorageKey = 'whatsapp.messageTranslations.v1'
const messageTranslationCacheLimit = 800
const voiceTranscriptionCacheStorageKey = 'whatsapp.voiceTranscriptions.v1'
const voiceTranscriptionCacheLimit = 400
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
  const [chatInfoOpen, setChatInfoOpen] = useState(false)
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false)
  const [mediaLibraryTab, setMediaLibraryTab] = useState<MediaLibraryTab>('media')
  const [mediaLibraryMessages, setMediaLibraryMessages] = useState<MessageView[]>([])
  const [mediaLibraryLoading, setMediaLibraryLoading] = useState(false)
  const [mediaLibraryError, setMediaLibraryError] = useState<string>()
  const [contactEditorOpen, setContactEditorOpen] = useState(false)
  const [contactNameDraft, setContactNameDraft] = useState('')
  const [contactSaveBusy, setContactSaveBusy] = useState(false)
  const [chatContextMenu, setChatContextMenu] = useState<ChatContextMenuState>()
  const [messageContextMenu, setMessageContextMenu] = useState<MessageContextMenuState>()
  const [expandedReactionMessageId, setExpandedReactionMessageId] = useState<string>()
  const [messageDialog, setMessageDialog] = useState<MessageDialogState>()
  const [chatDestructiveDialog, setChatDestructiveDialog] = useState<ChatDestructiveDialogState>()
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([])
  const [messageActionBusy, setMessageActionBusy] = useState(false)
  const [forwardSearch, setForwardSearch] = useState('')
  const [forwardTargetChatIds, setForwardTargetChatIds] = useState<string[]>([])
  const [noteEditorChatId, setNoteEditorChatId] = useState<string>()
  const [noteEditorDraft, setNoteEditorDraft] = useState('')
  const [listMenuOpen, setListMenuOpen] = useState(false)
  const [listCreatorOpen, setListCreatorOpen] = useState(false)
  const [listPickerChat, setListPickerChat] = useState<ChatSummary>()
  const [listPickerLabelIds, setListPickerLabelIds] = useState<string[]>([])
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
  const [voiceRecording, setVoiceRecording] = useState(false)
  const [voiceRecordingSeconds, setVoiceRecordingSeconds] = useState(0)
  const [draftMessageByChatId, setDraftMessageByChatId] = useState<Record<string, string>>({})
  const [replyToMessageByChatId, setReplyToMessageByChatId] = useState<Record<string, MessageView | undefined>>({})
  const [error, setError] = useState<string>()
  const [composeNoticeByChatId, setComposeNoticeByChatId] = useState<Record<string, string>>({})
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false)
  const [attachmentDialog, setAttachmentDialog] = useState<AttachmentDialogState>()
  const [shareContacts, setShareContacts] = useState<ContactView[]>([])
  const [shareContactsLoading, setShareContactsLoading] = useState(false)
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [pollAllowMultiple, setPollAllowMultiple] = useState(false)
  const [structuredMessageBusy, setStructuredMessageBusy] = useState(false)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [composerPickerMode, setComposerPickerMode] = useState<ComposerPickerMode>('emoji')
  const [emojiSearch, setEmojiSearch] = useState('')
  const [activeEmojiCategory, setActiveEmojiCategory] = useState('recent')
  const [assistantRun, setAssistantRun] = useState<AgentRunView>()
  const [, setAssistantRawDraft] = useState('')
  const [assistantReplyOptions, setAssistantReplyOptions] = useState<AssistantReplyOption[]>([])
  const [adoptedReplyIndex, setAdoptedReplyIndex] = useState<number>()
  const [assistantDraft, setAssistantDraft] = useState('')
  const [messageTranslations, setMessageTranslations] =
    useState<Record<string, TranslationState>>(loadMessageTranslationCache)
  const [voiceTranscriptions, setVoiceTranscriptions] =
	useState<Record<string, VoiceTranscriptionState>>(loadVoiceTranscriptionCache)
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
  const messageContextMenuRef = useRef<HTMLDivElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
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
  const voiceRecorderRef = useRef<MediaRecorder | undefined>(undefined)
  const voiceStreamRef = useRef<MediaStream | undefined>(undefined)
  const voiceChunksRef = useRef<Blob[]>([])
  const voiceRecordingStartedAtRef = useRef<number>(0)
  const voiceRecordingCancelledRef = useRef(false)
  const gifInputRef = useRef<HTMLInputElement>(null)
  const stickerInputRef = useRef<HTMLInputElement>(null)
  const pendingMessageTranslationKeysRef = useRef<Set<string>>(new Set())
  const keepTimelinePinnedRef = useRef(true)
  const pendingScrollModeRef = useRef<'bottom' | 'preserve' | 'none'>('bottom')
  const historyRequestSeqRef = useRef(0)
  const mediaLibraryRequestSeqRef = useRef(0)
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

  const stopVoiceRecording = useCallback(() => {
    const recorder = voiceRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }, [])

  const cancelVoiceRecording = useCallback(() => {
    voiceRecordingCancelledRef.current = true
    stopVoiceRecording()
  }, [stopVoiceRecording])

  async function startVoiceRecording() {
    if (!selectedChatId || !history || !isChatSendable(history.chat.wa_chat_jid, history.chat.chat_type) || sending || voiceRecording) {
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('当前环境不支持录音，请使用文件附件发送音频')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const supportedMimeTypes = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm']
      const mimeType = supportedMimeTypes.find((item) => MediaRecorder.isTypeSupported(item))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const requestChatId = selectedChatId
      voiceChunksRef.current = []
      voiceStreamRef.current = stream
      voiceRecorderRef.current = recorder
      voiceRecordingStartedAtRef.current = Date.now()
      voiceRecordingCancelledRef.current = false
      setError(undefined)
      setVoiceRecording(true)
      setVoiceRecordingSeconds(0)

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data)
        }
      }
      recorder.onerror = () => {
        setError('录音失败，请检查麦克风权限')
        setVoiceRecording(false)
      }
      recorder.onstop = () => {
        const chunks = voiceChunksRef.current
        const durationSeconds = Math.max(1, Math.round((Date.now() - voiceRecordingStartedAtRef.current) / 1000))
        const recordedMimeType = recorder.mimeType || mimeType || 'audio/webm'
        voiceRecorderRef.current = undefined
        voiceChunksRef.current = []
        voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
        voiceStreamRef.current = undefined
        setVoiceRecording(false)
        setVoiceRecordingSeconds(0)
        if (voiceRecordingCancelledRef.current) {
          voiceRecordingCancelledRef.current = false
          return
        }
        if (!chunks.length) {
          setError('没有录到声音，请重试')
          return
        }

        const extension = recordedMimeType.includes('ogg') ? 'ogg' : 'webm'
        const file = new File(chunks, `voice-message.${extension}`, { type: recordedMimeType })
        void sendRecordedVoiceMessage(requestChatId, file, durationSeconds)
      }
      recorder.start()
    } catch (recordingError) {
      setVoiceRecording(false)
      setError(recordingError instanceof DOMException && recordingError.name === 'NotAllowedError'
        ? '麦克风权限被拒绝，请允许应用访问麦克风'
        : '无法开始录音，请检查麦克风设备')
    }
  }

  useEffect(() => () => {
    voiceRecordingCancelledRef.current = true
    const recorder = voiceRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  useEffect(() => {
    if (!voiceRecording) {
      return undefined
    }
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.floor((Date.now() - voiceRecordingStartedAtRef.current) / 1000))
      setVoiceRecordingSeconds(seconds)
      if (seconds >= 15 * 60) {
        stopVoiceRecording()
      }
    }, 250)
    return () => window.clearInterval(timer)
  }, [stopVoiceRecording, voiceRecording])

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
	  const availableAccounts = nextAccounts.filter(isChatAccountAvailable)
      setSelectedAccountId((current) =>
        availableAccounts.some((account) => account.id === current)
          ? current
          : availableAccounts.some((account) => account.id === requestedAccountId)
            ? requestedAccountId
            : availableAccounts[0]?.id ?? '',
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
    setEmojiPickerOpen(false)
    setMessageContextMenu(undefined)
    setExpandedReactionMessageId(undefined)
    setMessageDialog(undefined)
    setSelectedMessageIds([])
    setChatInfoOpen(false)
    mediaLibraryRequestSeqRef.current += 1
    setMediaLibraryOpen(false)
    setMediaLibraryMessages([])
    setMediaLibraryLoading(false)
    setMediaLibraryError(undefined)
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
    setContactNameDraft(currentChat ? getChatDisplayName(currentChat) : '')
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
    if (!messageContextMenu) return
    const closeMenu = (event: MouseEvent) => {
      if (!messageContextMenuRef.current?.contains(event.target as Node)) {
        setMessageContextMenu(undefined)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMessageContextMenu(undefined)
    }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [messageContextMenu])

  useEffect(() => {
    if (!emojiPickerOpen) return
    const closePicker = (event: MouseEvent) => {
      if (!emojiPickerRef.current?.contains(event.target as Node)) setEmojiPickerOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEmojiPickerOpen(false)
    }
    document.addEventListener('mousedown', closePicker)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closePicker)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [emojiPickerOpen])

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
    if (!error) return
    if (isSessionDisconnectedError(error)) {
      void loadAccountsList()
    }
    const timer = window.setTimeout(() => setError(undefined), 6000)
    return () => window.clearTimeout(timer)
  }, [error, loadAccountsList])

  useEffect(() => {
    function handleLiveUpdate(update: LiveUpdate) {
      if (update.type === 'session_changed') {
        void loadAccountsList()
      }
      if (selectedAccountId && update.account_id !== selectedAccountId) {
        return
      }

      void loadChatsList(true)

      if (update.type === 'message_stored' && selectedChatId && update.chat_id === selectedChatId) {
        void loadHistory(selectedChatId, true)
      }
    }

    return subscribeLiveUpdates(handleLiveUpdate)
  }, [loadAccountsList, loadChatsList, loadHistory, selectedAccountId, selectedChatId])

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
      appendOptimisticMessage(response, requestHistory.chat, requestSelectedChat, replyToMessage)
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
    setMessageContextMenu(undefined)
    setReplyToMessageByChatId((current) => ({ ...current, [selectedChatId]: message }))
  }

  function openMessageContextMenu(event: ReactMouseEvent, message: MessageView) {
    event.preventDefault()
    event.stopPropagation()
    const anchor = messageElementRefs.current.get(message.id)
      ?? (event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined)
    const anchorRect = anchor?.getBoundingClientRect()
    const menuWidth = 250
    const menuItemCount = 7 + (message.text_content?.trim() ? 2 : 0) + (message.media.some((media) => media.download_status === 'ready') ? 1 : 0)
    const menuHeight = Math.min(window.innerHeight - 16, 12 + menuItemCount * 40 + 16)
    const reactionBarHeight = 44
    const shellHeight = reactionBarHeight + 6 + menuHeight
    const placement = message.from_me ? 'own' : 'incoming'
    const preferredX = anchorRect
      ? placement === 'own' ? anchorRect.right - menuWidth : anchorRect.left
      : event.clientX
    const preferredY = anchorRect
      ? anchorRect.bottom + 8
      : event.clientY
    const y = preferredY + shellHeight <= window.innerHeight - 8
      ? preferredY
      : (anchorRect ? anchorRect.top - shellHeight - 8 : preferredY - shellHeight)
    setMessageContextMenu({
      messageId: message.id,
      x: Math.max(8, Math.min(preferredX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - shellHeight - 8)),
      placement,
      reactionOnly: false,
    })
  }

  function openMessageReactionPicker(event: ReactMouseEvent, message: MessageView) {
    event.preventDefault()
    event.stopPropagation()
    const anchor = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : undefined
    const width = 330
    setExpandedReactionMessageId(undefined)
    setMessageContextMenu({
      messageId: message.id,
      x: Math.max(8, Math.min(anchor ? anchor.left - width / 2 : event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, (anchor?.top ?? event.clientY) - 54),
      placement: message.from_me ? 'own' : 'incoming',
      reactionOnly: true,
    })
  }

  function downloadMessageMedia(message: MessageView) {
    const downloadableMedia = message.media.filter((media) => media.download_status === 'ready')
    if (!downloadableMedia.length) {
      setComposeNoticeForChat(message.chat_id, '该媒体暂不可保存')
      return
    }

    for (const media of downloadableMedia) {
      const link = document.createElement('a')
      link.href = getMediaAssetUrl(media.id)
      link.download = media.file_name || `${media.media_type}-${media.id}`
      link.rel = 'noreferrer'
      document.body.appendChild(link)
      link.click()
      link.remove()
    }
    setComposeNoticeForChat(message.chat_id, downloadableMedia.length > 1 ? `${downloadableMedia.length} 个媒体已开始下载` : '媒体已开始下载')
  }

  function openMessageMedia(message: MessageView) {
    const media = message.media.find((item) => item.download_status === 'ready')
    if (!media) return
    window.open(getMediaAssetUrl(media.id), '_blank', 'noopener,noreferrer')
    setMessageContextMenu(undefined)
  }

  async function shareMessageMedia(message: MessageView) {
    const media = message.media.find((item) => item.download_status === 'ready')
    if (!media) return
    setMessageContextMenu(undefined)
    try {
      const response = await fetch(getMediaAssetUrl(media.id), { credentials: 'include' })
      if (!response.ok) throw new Error('读取媒体失败')
      const blob = await response.blob()
      const file = new File([blob], media.file_name || `${media.media_type}-${media.id}`, { type: media.mime_type || blob.type })
      if (!navigator.share || (navigator.canShare && !navigator.canShare({ files: [file] }))) {
        throw new Error('当前系统不支持分享文件')
      }
      await navigator.share({ files: [file] })
    } catch (shareError) {
      setComposeNoticeForChat(message.chat_id, shareError instanceof Error ? shareError.message : '分享媒体失败')
    }
  }

  async function copyMessageImage(message: MessageView) {
    const media = message.media.find((item) => item.download_status === 'ready' && (item.media_type === 'image' || item.media_type === 'sticker'))
    if (!media) return
    setMessageContextMenu(undefined)
    try {
      const response = await fetch(getMediaAssetUrl(media.id), { credentials: 'include' })
      if (!response.ok) throw new Error('读取图像失败')
      const sourceBlob = await response.blob()
      const bitmap = await createImageBitmap(sourceBlob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
      bitmap.close()
      const pngBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('转换图像失败')), 'image/png'))
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
      setComposeNoticeForChat(message.chat_id, '图像已复制')
    } catch (copyError) {
      setComposeNoticeForChat(message.chat_id, copyError instanceof Error ? copyError.message : '复制图像失败')
    }
  }

  function openForwardDialog(messageIds: string[]) {
    setMessageContextMenu(undefined)
    setForwardSearch('')
    setForwardTargetChatIds([])
    setMessageDialog({ type: 'forward', messageIds })
  }

  function updateHistoryMessage(message: MessageView) {
    setHistory((current) => current?.chat.id === message.chat_id
      ? { ...current, messages: current.messages.map((item) => item.id === message.id ? message : item) }
      : current)
  }

  async function handleMessageReaction(message: MessageView, reaction: string) {
    setMessageContextMenu(undefined)
    setMessageActionBusy(true)
    setError(undefined)
    try {
      const response = await reactToMessage(message.chat_id, message.id, reaction)
      updateHistoryMessage(response.message)
      setComposeNoticeForChat(message.chat_id, reaction ? `已回应 ${reaction}` : '已移除回应')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '发送回应失败')
    } finally {
      setMessageActionBusy(false)
    }
  }

  async function handleMessageMetadata(message: MessageView, patch: Partial<Pick<MessageView, 'starred' | 'pinned'>>) {
    setMessageContextMenu(undefined)
    setMessageActionBusy(true)
    setError(undefined)
    try {
      const response = await updateMessageMetadata(
        message.chat_id,
        message.id,
        patch.starred ?? message.starred,
        patch.pinned ?? message.pinned,
      )
      updateHistoryMessage(response.message)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '更新消息状态失败')
    } finally {
      setMessageActionBusy(false)
    }
  }

  async function handleEditMessage(messageId: string, text: string) {
    if (!selectedChatId || messageActionBusy) return
    setMessageActionBusy(true)
    setError(undefined)
    try {
      const response = await editChatMessage(selectedChatId, messageId, text)
      updateHistoryMessage(response.message)
      setMessageDialog(undefined)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '编辑消息失败')
    } finally {
      setMessageActionBusy(false)
    }
  }

  async function handleDeleteMessages(messageIds: string[], forEveryone: boolean) {
    if (!selectedChatId || !messageIds.length || messageActionBusy) return
    setMessageActionBusy(true)
    setError(undefined)
    try {
      for (const messageId of messageIds) {
        await deleteChatMessage(selectedChatId, messageId, forEveryone)
      }
      setHistory((current) => current?.chat.id === selectedChatId
        ? { ...current, messages: current.messages.filter((message) => !messageIds.includes(message.id)) }
        : current)
      setSelectedMessageIds([])
      setMessageDialog(undefined)
      void loadChatsList(true)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '删除消息失败')
    } finally {
      setMessageActionBusy(false)
    }
  }

  async function handleForwardMessages(messageIds: string[], targetChatIds: string[]) {
    if (!selectedChatId || !targetChatIds.length || messageActionBusy) return
    setMessageActionBusy(true)
    setError(undefined)
    try {
      for (const targetChatId of targetChatIds) {
        for (const messageId of messageIds) {
          await forwardChatMessage(selectedChatId, messageId, targetChatId)
        }
      }
      setMessageDialog(undefined)
      setForwardTargetChatIds([])
      setSelectedMessageIds([])
      setComposeNoticeForChat(selectedChatId, `${messageIds.length} 条消息已转发到 ${targetChatIds.length} 个会话`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '转发消息失败')
    } finally {
      setMessageActionBusy(false)
    }
  }

  function toggleMessageSelection(messageId: string) {
    setMessageContextMenu(undefined)
    setSelectedMessageIds((current) => current.includes(messageId)
      ? current.filter((id) => id !== messageId)
      : [...current, messageId])
  }

  async function handleSaveContact() {
    if (!selectedChat || contactSaveBusy) return
    setContactSaveBusy(true)
    setError(undefined)
    try {
      const response = await createContact(selectedChat.id, contactNameDraft)
      setChats((current) => current.map((chat) => chat.id === selectedChat.id
        ? { ...chat, title: response.contact.display_name, phone_number: response.contact.phone_number }
        : chat))
      setComposeNoticeForChat(selectedChat.id, '联系人已保存')
    } catch (contactError) {
      setError(contactError instanceof Error ? contactError.message : '保存联系人失败')
    } finally {
      setContactSaveBusy(false)
    }
  }

  async function handleChatDestructiveAction() {
    if (!chatDestructiveDialog || messageActionBusy) return
    const { chatId, type } = chatDestructiveDialog
    setMessageActionBusy(true)
    setError(undefined)
    try {
      if (type === 'clear') {
        await clearChat(chatId)
        setHistory((current) => current?.chat.id === chatId ? { ...current, messages: [], has_more: false } : current)
      } else {
        await deleteChat(chatId)
        setChats((current) => current.filter((chat) => chat.id !== chatId))
        if (selectedChatId === chatId) setSelectedChatId(undefined)
      }
      setChatDestructiveDialog(undefined)
      void loadChatsList(true)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : type === 'clear' ? '清空聊天失败' : '删除聊天失败')
    } finally {
      setMessageActionBusy(false)
    }
  }

  function insertEmoji(emoji: string) {
    if (!selectedChatId) return
    setDraftMessageForChat(selectedChatId, `${draftMessage}${emoji}`)
  }

  async function handleAttachmentAction(action: AttachmentAction) {
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
      case 'sticker':
        stickerInputRef.current?.click()
        return
      case 'contact':
        if (!selectedChat) return
        setAttachmentDialog({ type: 'contact' })
        setShareContactsLoading(true)
        setError(undefined)
        try {
          const response = await listContacts({ accountId: selectedChat.account_id, limit: 200 })
          setShareContacts(response.contacts.filter((contact) => Boolean(contact.phone_number)))
        } catch (contactError) {
          setError(contactError instanceof Error ? contactError.message : '联系人加载失败')
          setShareContacts([])
        } finally {
          setShareContactsLoading(false)
        }
        return
      case 'poll':
        setPollQuestion('')
        setPollOptions(['', ''])
        setPollAllowMultiple(false)
        setAttachmentDialog({ type: 'poll' })
        return
    }
  }

  async function handleAttachmentFiles(kind: FileAttachmentAction, files: FileList | null) {
    if (!selectedChatId || !history || !selectedChat || history.chat.id !== selectedChatId) {
      return
    }

    const requestChatId = selectedChatId
    const selectedFiles = Array.from(files ?? [])
    if (selectedFiles.length === 0) {
      return
    }
    if (kind === 'gif' && selectedFiles.some((file) => file.type.toLowerCase() !== 'image/gif' && !file.name.toLowerCase().endsWith('.gif'))) {
      setError('请选择 GIF 文件')
      return
    }
    if (kind === 'sticker' && selectedFiles.some((file) => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type.toLowerCase()))) {
      setError('贴图仅支持 PNG、JPEG 或 WebP 图片')
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
    setEmojiPickerOpen(false)
    setError(undefined)

    const caption = kind === 'audio' || kind === 'gif' || kind === 'sticker' ? '' : draftMessage.trim()

    try {
      const uploadFiles = kind === 'sticker'
        ? await Promise.all(selectedFiles.map(convertImageToSticker))
        : selectedFiles
      for (const [index, file] of uploadFiles.entries()) {
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
        `${uploadFiles.length > 1 ? `${uploadFiles.length} 个文件` : uploadFiles[0].name}已发送。`,
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

  async function sendRecordedVoiceMessage(requestChatId: string, file: File, durationSeconds: number) {
    if (sendingByChatId[requestChatId]) {
      return
    }
    setSendingByChatId((current) => ({ ...current, [requestChatId]: true }))
    setError(undefined)
    setComposeNoticeForChat(requestChatId, '正在发送语音消息...')
    try {
      await sendChatMedia(requestChatId, {
        file,
        mediaType: 'audio',
        voiceMessage: true,
        durationSeconds,
      })
      setComposeNoticeForChat(requestChatId, '语音消息已发送')
      pendingScrollModeRef.current = 'bottom'
      keepTimelinePinnedRef.current = true
      if (activeAssistantChatIdRef.current === requestChatId) {
        void loadHistory(requestChatId, true)
      }
      void loadChatsList(true)
    } catch (sendError) {
      if (activeAssistantChatIdRef.current === requestChatId) {
        setError(sendError instanceof Error ? sendError.message : '语音消息发送失败')
      }
    } finally {
      setSendingByChatId((current) => {
        const next = { ...current }
        delete next[requestChatId]
        return next
      })
    }
  }

  async function handleSendContact(contact: ContactView) {
    if (!selectedChatId || !contact.phone_number || structuredMessageBusy) return
    setStructuredMessageBusy(true)
    setError(undefined)
    try {
      await sendChatContact(selectedChatId, contact.display_name, contact.phone_number)
      setAttachmentDialog(undefined)
      setComposeNoticeForChat(selectedChatId, `已发送联系人：${contact.display_name}`)
      pendingScrollModeRef.current = 'bottom'
      void loadHistory(selectedChatId, true)
      void loadChatsList(true)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '发送联系人失败')
    } finally {
      setStructuredMessageBusy(false)
    }
  }

  async function handleOpenContactChat(displayName: string, phoneNumber: string) {
    if (!selectedAccountId || !phoneNumber.trim()) return
    setError(undefined)
    try {
      const response = await openDirectChat(selectedAccountId, displayName, phoneNumber)
      const opened = chatHeaderToSummary(response.chat)
      setChatView('active')
      setSelectedChatType('')
      setSelectedLabelId('')
      setSearch('')
      setChats((current) => [opened, ...current.filter((chat) => chat.id !== opened.id)])
      setSelectedChatId(opened.id)
      setAttachmentDialog(undefined)
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : '打开联系人会话失败')
    }
  }

  async function handleSendPoll() {
    if (!selectedChatId || structuredMessageBusy) return
    const question = pollQuestion.trim()
    const options = pollOptions.map((option) => option.trim()).filter(Boolean)
    if (!question || new Set(options).size < 2) return
    setStructuredMessageBusy(true)
    setError(undefined)
    try {
      await sendChatPoll(selectedChatId, question, options, pollAllowMultiple)
      setAttachmentDialog(undefined)
      setComposeNoticeForChat(selectedChatId, '投票已发送')
      pendingScrollModeRef.current = 'bottom'
      void loadHistory(selectedChatId, true)
      void loadChatsList(true)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '发送投票失败')
    } finally {
      setStructuredMessageBusy(false)
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

  async function translateVoiceTranscription(
	mediaId: string,
	accountId: string,
	chatId: string,
	transcription: AudioTranscriptionView,
  ) {
	if (!translationAgentConfigured || voiceTranscriptions[mediaId]?.translationLoading) {
	  return
	}
	setVoiceTranscriptions((current) => ({
	  ...current,
	  [mediaId]: {
		...current[mediaId],
		transcription,
		translationLoading: true,
		translationError: undefined,
	  },
	}))
	try {
	  const response = await translateText({
		account_id: accountId,
		text: transcription.text,
		target_language: 'zh-CN',
		target_language_name: '中文',
	  })
	  setVoiceTranscriptions((current) => ({
		...current,
		[mediaId]: {
		  ...current[mediaId],
		  transcription,
		  translationLoading: false,
		  translation: response.translation,
		},
	  }))
	  persistVoiceTranscription(mediaId, transcription, response.translation)
	  if (!isChineseLanguage(response.translation.source_language_code)) {
		const option = resolveLanguageOption(
		  response.translation.source_language_code,
		  response.translation.source_language_name,
		)
		if (chatId) {
		  applyAssistantWorkspacePatch(chatId, {
			targetLanguage: option.code,
			targetLanguageName: option.name,
		  })
		}
	  }
	} catch (translateError) {
	  setVoiceTranscriptions((current) => ({
		...current,
		[mediaId]: {
		  ...current[mediaId],
		  transcription,
		  translationLoading: false,
		  translationError: translateError instanceof Error ? translateError.message : '翻译失败',
		},
	  }))
	}
  }

  async function transcribeVoiceMessage(message: MessageView, media: MessageView['media'][number]) {
	const accountId = message.account_id || history?.chat.account_id
	if (!accountId || media.download_status !== 'ready' || voiceTranscriptions[media.id]?.loading) {
	  return
	}
	setMessageContextMenu(undefined)
	setVoiceTranscriptions((current) => ({
	  ...current,
	  [media.id]: { ...current[media.id], loading: true, error: undefined },
	}))
	try {
	  const mediaResponse = await fetch(getMediaAssetUrl(media.id), { credentials: 'include' })
	  if (!mediaResponse.ok) {
		throw new Error('读取本地语音失败')
	  }
	  const audio = await mediaResponse.blob()
	  const response = await transcribeAudio(audio, media.file_name || `voice-${media.id}.ogg`)
	  setVoiceTranscriptions((current) => ({
		...current,
		[media.id]: { transcription: response.transcription },
	  }))
	  persistVoiceTranscription(media.id, response.transcription)
	  if (translationAgentConfigured) {
		await translateVoiceTranscription(media.id, accountId, message.chat_id, response.transcription)
	  }
	} catch (transcribeError) {
	  setVoiceTranscriptions((current) => ({
		...current,
		[media.id]: {
		  ...current[media.id],
		  loading: false,
		  error: transcribeError instanceof Error ? transcribeError.message : '语音转写失败',
		},
	  }))
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
    quotedMessage?: MessageView,
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
      reply_to_wa_message_id: quotedMessage?.wa_message_id,
      reply_to: quotedMessage ? messageToQuotedView(quotedMessage) : undefined,
      sent_at: response.sent_at,
      starred: false,
      pinned: false,
      reactions: {},
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

  async function openMediaLibrary() {
    if (!selectedChatId) return

    const requestChatId = selectedChatId
    const requestSeq = mediaLibraryRequestSeqRef.current + 1
    mediaLibraryRequestSeqRef.current = requestSeq
    const initialMessages = history?.chat.id === requestChatId ? history.messages : []
    const seenCursors = new Set<string>()
    let messages = mergeMessagesChronologically(initialMessages)
    let before: string | undefined
    let hasMore = true

    setMediaLibraryOpen(true)
    setMediaLibraryTab('media')
    setMediaLibraryMessages(messages)
    setMediaLibraryLoading(true)
    setMediaLibraryError(undefined)

    try {
      while (hasMore) {
        const response = await getChatMessages(requestChatId, { limit: 100, before })
        if (mediaLibraryRequestSeqRef.current !== requestSeq || selectedChatId !== requestChatId) return

        messages = mergeMessagesChronologically(messages, response.messages)
        setMediaLibraryMessages(messages)

        hasMore = Boolean(response.has_more && response.next_before && !seenCursors.has(response.next_before))
        if (!hasMore || !response.next_before) break
        seenCursors.add(response.next_before)
        before = response.next_before
      }
    } catch (loadError) {
      if (mediaLibraryRequestSeqRef.current === requestSeq) {
        setMediaLibraryError(loadError instanceof Error ? loadError.message : '加载媒体记录失败')
      }
    } finally {
      if (mediaLibraryRequestSeqRef.current === requestSeq) setMediaLibraryLoading(false)
    }
  }

  const activeStatusCardAgent = statusCardAgents[0]
  const chatAccounts = accounts.filter(isChatAccountAvailable)
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId)
  const selectedChat = chats.find((item) => item.id === selectedChatId)
  const activeHistory = history && selectedChatId && history.chat.id === selectedChatId ? history : undefined
  const mediaLibrary = useMemo(
    () => buildMediaLibrary(mediaLibraryMessages),
    [mediaLibraryMessages],
  )
  const chatInfoMediaContent = useMemo(
    () => mediaLibraryMessages.length ? mediaLibrary : buildMediaLibrary(activeHistory?.messages ?? []),
    [activeHistory?.messages, mediaLibrary, mediaLibraryMessages.length],
  )
  const chatInfoMediaCount = getMediaLibraryCount(chatInfoMediaContent)
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
    activeHistory
      && selectedAccount?.status === 'connected'
      && isChatSendable(activeHistory.chat.wa_chat_jid, activeHistory.chat.chat_type),
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
      ? selectedAccount?.status !== 'connected'
        ? selectedAccount?.status === 'reconnecting'
          ? '账号正在重新连接，连接恢复后才能发送消息'
          : '该账号已退出 WhatsApp，请先到账号管理重新登录'
        : getChatSendBlockedReason(activeHistory.chat.wa_chat_jid, activeHistory.chat.chat_type)
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

  function openChatListPicker(chat: ChatSummary) {
    const customListIDs = new Set(customLists.map((label) => label.id))
    setChatContextMenu(undefined)
    setListPickerChat(chat)
    setListPickerLabelIds(chat.labels.filter((label) => customListIDs.has(label.id)).map((label) => label.id))
  }

  async function saveChatListPicker() {
    if (!listPickerChat || chatMetadataBusy) return
    const customListIDs = new Set(customLists.map((label) => label.id))
    const preservedLabelIDs = listPickerChat.labels
      .filter((label) => !customListIDs.has(label.id))
      .map((label) => label.id)
    if (await saveChatMetadataFor(listPickerChat, {
      label_ids: [...preservedLabelIDs, ...listPickerLabelIds],
    })) {
      setListPickerChat(undefined)
    }
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
                {chatAccounts.map((account) => <option key={account.id} value={account.id}>{account.display_name}{account.status === 'reconnecting' ? '（重连中）' : ''}</option>)}
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
                        <span className="whatsapp-chat-row-identity">
                          <strong>{getChatDisplayName(chat)}</strong>
                          {chat.chat_type === 'direct' && chat.phone_number
                            ? <small>{formatDisplayPhone(chat.phone_number)}</small>
                            : null}
                        </span>
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
                  <span><strong>{getChatDisplayName(selectedChat)}</strong><small>{selectedChat.note || formatDisplayPhone(selectedChat.phone_number || selectedChat.wa_chat_jid)}</small></span>
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
                <aside className={`chat-info-drawer${mediaLibraryOpen ? ' media-library-drawer' : ''}`}>
                  {mediaLibraryOpen ? (
                    <ChatMediaLibrary
                      content={mediaLibrary}
                      activeTab={mediaLibraryTab}
                      loading={mediaLibraryLoading}
                      error={mediaLibraryError}
                      onTab={setMediaLibraryTab}
                      onBack={() => setMediaLibraryOpen(false)}
                    />
                  ) : (
                    <>
                  <div className="chat-info-drawer-head">
                    <button type="button" onClick={() => setChatInfoOpen(false)} aria-label="关闭"><Icon name="close" /></button>
                    <strong>{selectedChat.chat_type === 'group' ? '群组信息' : '联系人信息'}</strong>
                    {selectedChat.chat_type === 'direct' ? <button type="button" onClick={() => setContactEditorOpen((current) => !current)} aria-label="编辑联系人" title="编辑联系人"><Icon name="edit" /></button> : <span />}
                  </div>
                  <div className="chat-info-profile official">
                    <ChatAvatar chat={selectedChat} />
                    <h3>{getChatDisplayName(selectedChat)}</h3>
                    <p>{formatDisplayPhone(selectedChat.phone_number || selectedChat.wa_chat_jid)}</p>
                    {selectedChat.chat_type === 'group' && selectedChat.participant_count ? <small>{selectedChat.participant_count} 位成员</small> : null}
                  </div>
                  <div className="chat-info-quick-actions">
                    <button type="button" onClick={() => { setChatInfoOpen(false); openMessageSearch() }}><span><Icon name="search" /></span><small>搜索</small></button>
                  </div>
                  {contactEditorOpen && selectedChat.chat_type === 'direct' ? (
                    <section className="chat-contact-save-section">
                      <label className="field"><span>联系人名称</span><input value={contactNameDraft} maxLength={120} onChange={(event) => setContactNameDraft(event.target.value)} placeholder="输入联系人名称" /></label>
                      <button className="secondary-button" type="button" onClick={() => void handleSaveContact()} disabled={!contactNameDraft.trim() || contactSaveBusy}><Icon name="contacts" />{contactSaveBusy ? '保存中...' : '保存到联系人'}</button>
                    </section>
                  ) : null}
                  <section className="chat-info-section chat-info-media-section">
                    <button type="button" onClick={() => void openMediaLibrary()}>
                      <Icon name="image" /><span>影音内容、链接和文档</span><small>{chatInfoMediaCount || ''}</small><Icon name="chevronRight" />
                    </button>
                    <div className="chat-info-media-preview">
                      {activeHistory.messages.flatMap((message) => message.media).filter((media) => media.download_status === 'ready' && (media.media_type === 'image' || media.media_type === 'sticker')).slice(-3).map((media) => <button type="button" key={media.id} onClick={() => window.open(getMediaAssetUrl(media.id), '_blank', 'noopener,noreferrer')}><img src={getMediaAssetUrl(media.id)} alt="" /></button>)}
                    </div>
                  </section>
                  <section className="chat-info-section chat-info-menu-list">
                    <button type="button" onClick={() => {
                      const starred = activeHistory.messages.find((message) => message.starred)
                      if (starred) { setChatInfoOpen(false); void handleJumpToSearchMessage(starred) }
                    }} disabled={!activeHistory.messages.some((message) => message.starred)}><Icon name="star" /><span>已加星标消息</span><small>{activeHistory.messages.filter((message) => message.starred).length || ''}</small><Icon name="chevronRight" /></button>
                    <button type="button" onClick={() => void muteChat(selectedChat, isChatMuted(selectedChat) ? 'off' : 'always')}><Icon name="bellOff" /><span><strong>通知设置</strong><small>{isChatMuted(selectedChat) ? '已静音' : '已开启'}</small></span></button>
                    <button type="button" onClick={() => void toggleFavorite(selectedChat)}><Icon name="heart" /><span>{favoriteList && selectedChat.labels.some((label) => label.id === favoriteList.id) ? '从“特别关注”移除' : '添加到“特别关注”'}</span></button>
                    <button type="button" onClick={() => openChatListPicker(selectedChat)}><Icon name="list" /><span>添加到列表</span><Icon name="chevronRight" /></button>
                  </section>
                  <section className="chat-info-section chat-info-note-section">
                    <label className="field chat-customer-note"><span>会话备注</span><textarea rows={4} value={chatNote} onChange={(event) => setChatNote(event.target.value)} placeholder="客户身份、偏好和跟进事项" /></label>
                    <button className="secondary-button" type="button" onClick={() => void saveChatMetadata({ note: chatNote })} disabled={chatMetadataBusy}>{chatMetadataBusy ? '保存中...' : '保存备注'}</button>
                  </section>
                  <section className="chat-info-section chat-info-danger-list">
                    <button type="button" onClick={() => { setChatInfoOpen(false); setChatDestructiveDialog({ type: 'clear', chatId: selectedChat.id }) }}><Icon name="clear" /><span>清空聊天</span></button>
                    <button type="button" onClick={() => { setChatInfoOpen(false); setChatDestructiveDialog({ type: 'delete', chatId: selectedChat.id }) }}><Icon name="delete" /><span>删除聊天</span></button>
                  </section>
                    </>
                  )}
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
                  const reactionSummary = summarizeMessageReactions(message.reactions)

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
                      className={`message-card whatsapp-message-card${message.from_me ? ' own' : ''}${hasMedia ? ' media-message' : ''}${highlightedMessageId === message.id ? ' search-highlighted' : ''}${selectedMessageIds.includes(message.id) ? ' message-selected' : ''}`}
                      onClick={() => {
                        if (selectedMessageIds.length) toggleMessageSelection(message.id)
                      }}
                      onContextMenu={(event) => openMessageContextMenu(event, message)}
                    >
                      {selectedMessageIds.length ? (
                        <span className={`message-selection-check${selectedMessageIds.includes(message.id) ? ' selected' : ''}`} aria-hidden="true">
                          {selectedMessageIds.includes(message.id) ? <Icon name="check" /> : null}
                        </span>
                      ) : null}
                      {!message.from_me ? (
                        <div className="message-meta">
                          <strong>{getMessageSenderName(message)}</strong>
                        </div>
                      ) : null}

                      {message.reply_to ? (
                        <button
                          type="button"
                          className="message-quoted-block"
                          onClick={(event) => {
                            event.stopPropagation()
                            const quoted = activeHistory.messages.find((item) => item.wa_message_id === message.reply_to?.wa_message_id)
                            if (quoted) void handleJumpToSearchMessage(quoted)
                          }}
                          title="查看引用消息"
                        >
                          <strong>{message.reply_to.from_me ? '你' : message.reply_to.sender_name || getJIDDisplayName(message.reply_to.sender_jid)}</strong>
                          <span>{getQuotedMessageCopy(message.reply_to)}</span>
                        </button>
                      ) : message.reply_to_wa_message_id ? (
                        <div className="message-quoted-block unavailable"><strong>引用消息</strong><span>原消息未加载或已删除</span></div>
                      ) : null}

                      {hasMedia ? (
                        <div className="media-block-list">
                          {message.media.map((media) => renderMediaAttachment(media, handleMediaLayoutReady, {
                            name: message.from_me ? '你' : getMessageSenderName(message),
                            photoUrl: message.from_me ? undefined : selectedChat.profile_photo_url,
                          }, media.media_type === 'audio' ? {
							state: voiceTranscriptions[media.id],
							onTranscribe: () => void transcribeVoiceMessage(message, media),
							onTranslate: translationAgentConfigured && voiceTranscriptions[media.id]?.transcription
							  ? () => void translateVoiceTranscription(media.id, message.account_id || activeHistory.chat.account_id, message.chat_id, voiceTranscriptions[media.id].transcription!)
							  : undefined,
						  } : undefined))}
                        </div>
                      ) : null}

                      {message.message_type === 'poll' && message.poll ? (
                        <PollMessageCard poll={message.poll} />
                      ) : textContent ? (
                        message.message_type === 'contact'
                          ? <ContactMessageCards value={textContent} onMessage={handleOpenContactChat} />
                          : <p className={hasMedia ? 'message-caption' : undefined}>{textContent}</p>
                      ) : !hasMedia ? (
                        <p className="message-fallback">{fallbackMessageCopy(message.message_type)}</p>
                      ) : null}

                      {message.message_type !== 'contact' ? renderMessageTranslation(
                        messageTranslations[getMessageTranslationKey(message)],
                        canOfferMessageTranslation(message) && translationAgentConfigured
                          ? () => void translateMessageToChinese(message)
                          : undefined,
                      ) : null}

                      {reactionSummary.length ? (
                        <div className="message-reaction-summary" aria-label="消息回应">
                          {reactionSummary.map(({ emoji, count }) => <span key={emoji}>{emoji}{count > 1 ? <small>{count}</small> : null}</span>)}
                        </div>
                      ) : null}

                      <div className="whatsapp-message-actions">
                        <button type="button" onClick={(event) => openMessageReactionPicker(event, message)} title="回应" aria-label="回应">
                          <Icon name="smile" />
                        </button>
                        {message.from_me ? <button type="button" onClick={(event) => { event.stopPropagation(); openForwardDialog([message.id]) }} title="转发" aria-label="转发"><Icon name="forward" /></button> : null}
                      </div>

                      <button className="message-menu-trigger" type="button" onClick={(event) => openMessageContextMenu(event, message)} title="更多操作" aria-label="更多操作"><Icon name="chevronDown" /></button>

                      <div className="whatsapp-message-foot">
                        {message.pinned ? <Icon name="pin" aria-label="已置顶" /> : null}
                        {message.starred ? <Icon name="star" aria-label="已加星标" /> : null}
                        <span>{formatMessageTime(message.sent_at)}</span>
                        {message.from_me ? <span className="whatsapp-message-check">✓✓</span> : null}
                      </div>
                    </article>
                  )
                })}
              </div>

              {selectedMessageIds.length ? (
                <div className="message-selection-toolbar" role="toolbar" aria-label="已选消息操作">
                  <button type="button" onClick={() => setSelectedMessageIds([])} aria-label="取消选择" title="取消选择"><Icon name="close" /></button>
                  <strong>已选 {selectedMessageIds.length} 项</strong>
                  <span />
                  <button type="button" onClick={() => openForwardDialog(selectedMessageIds)} aria-label="转发" title="转发"><Icon name="forward" /></button>
                  <button type="button" onClick={() => setMessageDialog({ type: 'delete', messageIds: selectedMessageIds })} aria-label="删除" title="删除"><Icon name="delete" /></button>
                </div>
              ) : (
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
                            onClick={() => void handleAttachmentAction(action.key)}
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
                    <input
                      ref={gifInputRef}
                      className="visually-hidden"
                      type="file"
                      accept="image/gif,.gif"
                      onChange={(event) => {
                        void handleAttachmentFiles('gif', event.currentTarget.files)
                        event.currentTarget.value = ''
                      }}
                    />
                    <input
                      ref={stickerInputRef}
                      className="visually-hidden"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => {
                        void handleAttachmentFiles('sticker', event.currentTarget.files)
                        event.currentTarget.value = ''
                      }}
                    />
                  </div>

                  <div className="whatsapp-compose-emoji" ref={emojiPickerRef}>
                    <button
                      className={`whatsapp-compose-utility${emojiPickerOpen ? ' active' : ''}`}
                      type="button"
                      onClick={() => { setEmojiPickerOpen((current) => !current); setComposerPickerMode('emoji'); setAttachmentMenuOpen(false) }}
                      disabled={voiceRecording}
                      aria-label="表情、GIF 和贴图"
                      title="表情、GIF 和贴图"
                    >
                      <Icon name="smile" />
                    </button>
                    {emojiPickerOpen ? (
                      <EmojiPicker
                        search={emojiSearch}
                        activeCategory={activeEmojiCategory}
                        mode={composerPickerMode}
                        onSearch={setEmojiSearch}
                        onCategory={setActiveEmojiCategory}
                        onMode={setComposerPickerMode}
                        onSelect={insertEmoji}
                        onSelectGif={() => gifInputRef.current?.click()}
                        onSelectSticker={() => stickerInputRef.current?.click()}
                      />
                    ) : null}
                  </div>

                  <div className={`chat-compose-box whatsapp-chat-compose-box${voiceRecording ? ' voice-recording' : ''}`}>
                    {replyToMessage ? (
                      <div className="whatsapp-reply-preview">
                        <span><strong>{replyToMessage.from_me ? '你' : getMessageSenderName(replyToMessage)}</strong><small>{replyToMessage.text_content || fallbackMessageCopy(replyToMessage.message_type)}</small></span>
                        <button type="button" onClick={() => setReplyToMessageByChatId((current) => ({ ...current, [selectedChatId ?? '']: undefined }))} title="取消引用">×</button>
                      </div>
                    ) : null}
                    {voiceRecording ? (
                      <div className="whatsapp-voice-recording-status" role="status" aria-live="polite">
                        <button type="button" onClick={cancelVoiceRecording} aria-label="取消录音" title="取消录音"><Icon name="delete" /></button>
                        <span className="voice-recording-dot" aria-hidden="true" />
                        <time>{formatVoiceDuration(voiceRecordingSeconds)}</time>
                        <span>正在录音</span>
                      </div>
                    ) : <textarea
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
                    />}
                  </div>

                  {draftMessage.trim() ? (
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
                  ) : (
                    <button
                      className={`primary-button whatsapp-send-button whatsapp-voice-button${voiceRecording ? ' recording' : ''}`}
                      type="button"
                      onClick={() => voiceRecording ? stopVoiceRecording() : void startVoiceRecording()}
                      disabled={!canSendInCurrentChat || sending}
                      aria-label={voiceRecording ? '停止并发送语音' : '录制语音消息'}
                      title={voiceRecording ? '停止并发送' : '录制语音消息'}
                    >
                      <Icon name={voiceRecording ? 'stop' : 'audio'} />
                    </button>
                  )}
                </div>

                {composeNotice ? <div className="compose-attachment-notice">{composeNotice}</div> : null}
              </div>
              )}
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

      {error ? (
        <div className="chat-error-toast" role="status">
          <span>{getFriendlyChatError(error)}</span>
          <button type="button" onClick={() => setError(undefined)} aria-label="关闭提示" title="关闭"><Icon name="close" /></button>
        </div>
      ) : null}

      {attachmentDialog?.type === 'contact' ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !structuredMessageBusy) setAttachmentDialog(undefined) }}>
          <section className="message-action-dialog attachment-contact-dialog" role="dialog" aria-modal="true" aria-labelledby="attachment-contact-title">
            <header><strong id="attachment-contact-title">发送联系人</strong><button type="button" onClick={() => setAttachmentDialog(undefined)} aria-label="关闭"><Icon name="close" /></button></header>
            <div className="attachment-contact-list">
              {shareContactsLoading ? <p>正在加载联系人...</p> : shareContacts.length ? shareContacts.map((contact) => (
                <button key={contact.id} type="button" disabled={structuredMessageBusy} onClick={() => void handleSendContact(contact)}>
                  <span className="contact-share-avatar" aria-hidden="true">{getChatAvatarLabel(contact.display_name)}</span>
                  <span><strong>{contact.display_name}</strong><small>{contact.phone_number}</small></span>
                  <Icon name="send" />
                </button>
              )) : <p>当前账号没有可发送的联系人，请先在联系人详情中保存。</p>}
            </div>
          </section>
        </div>
      ) : null}

      {attachmentDialog?.type === 'poll' ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !structuredMessageBusy) setAttachmentDialog(undefined) }}>
          <section className="message-action-dialog attachment-poll-dialog" role="dialog" aria-modal="true" aria-labelledby="attachment-poll-title">
            <header><strong id="attachment-poll-title">创建投票</strong><button type="button" onClick={() => setAttachmentDialog(undefined)} aria-label="关闭"><Icon name="close" /></button></header>
            <label className="field"><span>问题</span><input autoFocus maxLength={255} value={pollQuestion} onChange={(event) => setPollQuestion(event.target.value)} placeholder="输入投票问题" /></label>
            <div className="poll-option-list">
              <strong>选项</strong>
              {pollOptions.map((option, index) => (
                <label key={index}>
                  <span>{index + 1}</span>
                  <input maxLength={100} value={option} onChange={(event) => setPollOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={`选项 ${index + 1}`} />
                  <button type="button" disabled={pollOptions.length <= 2} onClick={() => setPollOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`删除选项 ${index + 1}`} title="删除选项"><Icon name="delete" /></button>
                </label>
              ))}
              {pollOptions.length < 12 ? <button className="poll-add-option" type="button" onClick={() => setPollOptions((current) => [...current, ''])}><Icon name="plus" />添加选项</button> : null}
            </div>
            <label className="poll-multiple-toggle"><input type="checkbox" checked={pollAllowMultiple} onChange={(event) => setPollAllowMultiple(event.target.checked)} /><span>允许选择多个答案</span></label>
            <footer><button className="secondary-button" type="button" onClick={() => setAttachmentDialog(undefined)}>取消</button><button className="primary-button" type="button" disabled={!pollQuestion.trim() || new Set(pollOptions.map((option) => option.trim()).filter(Boolean)).size < 2 || structuredMessageBusy} onClick={() => void handleSendPoll()}>{structuredMessageBusy ? '发送中...' : '发送投票'}</button></footer>
          </section>
        </div>
      ) : null}

      {messageContextMenu && activeHistory ? (() => {
        const message = activeHistory.messages.find((item) => item.id === messageContextMenu.messageId)
        if (!message) return null
        const hasReadyMedia = message.media.some((media) => media.download_status === 'ready')
		const readyAudio = message.media.find((media) => media.media_type === 'audio' && media.download_status === 'ready')
        const isImageLike = message.message_type === 'image' || message.message_type === 'sticker'
        const isSticker = message.message_type === 'sticker'
        const editable = message.from_me
          && message.message_type === 'text'
          && Date.now() - new Date(message.sent_at).getTime() <= 20 * 60 * 1000
        return (
          <div
            ref={messageContextMenuRef}
            className={`message-context-shell ${messageContextMenu.placement}`}
            style={{ left: messageContextMenu.x, top: messageContextMenu.y }}
          >
            <div className="message-reaction-bar" aria-label="快捷回应">
              {quickReactions.map((reaction) => <button key={reaction} type="button" onClick={() => void handleMessageReaction(message, reaction)} disabled={messageActionBusy}>{reaction}</button>)}
              <button type="button" onClick={() => setExpandedReactionMessageId((current) => current === message.id ? undefined : message.id)} aria-label="更多回应"><Icon name="plus" /></button>
            </div>
            {expandedReactionMessageId === message.id ? (
              <div className="message-reaction-picker">
                {emojiCategories.flatMap((category) => category.emojis).filter((emoji, index, all) => all.indexOf(emoji) === index).map((reaction) => (
                  <button key={reaction} type="button" onClick={() => void handleMessageReaction(message, reaction)} disabled={messageActionBusy}>{reaction}</button>
                ))}
              </div>
            ) : null}
            {!messageContextMenu.reactionOnly ? <div className="message-context-menu" role="menu">
              {!isSticker ? <button type="button" role="menuitem" onClick={() => { setMessageContextMenu(undefined); setMessageDialog({ type: 'details', messageId: message.id }) }}><Icon name="info" /><span>消息详情</span></button> : null}
              <button type="button" role="menuitem" onClick={() => setReplyToMessage(message)}><Icon name="reply" /><span>回复</span></button>
              {message.text_content?.trim() ? <button type="button" role="menuitem" onClick={() => { setMessageContextMenu(undefined); void copyMessage(message) }}><Icon name="copy" /><span>复制</span></button> : null}
			  {readyAudio ? <button type="button" role="menuitem" onClick={() => void transcribeVoiceMessage(message, readyAudio)}><Icon name="fileText" /><span>{voiceTranscriptions[readyAudio.id]?.transcription ? '重新转录' : '转录语音'}</span></button> : null}
              <button type="button" role="menuitem" onClick={() => openForwardDialog([message.id])}><Icon name="forward" /><span>转发</span></button>
              <button type="button" role="menuitem" onClick={() => void handleMessageMetadata(message, { pinned: !message.pinned })}><Icon name="pin" /><span>{message.pinned ? '取消置顶' : '置顶'}</span></button>
              <button type="button" role="menuitem" onClick={() => void handleMessageMetadata(message, { starred: !message.starred })}><Icon name="star" /><span>{message.starred ? '取消星标' : '添加星标'}</span></button>
              {editable ? <button type="button" role="menuitem" onClick={() => { setMessageContextMenu(undefined); setMessageDialog({ type: 'edit', messageId: message.id, text: message.text_content ?? '' }) }}><Icon name="edit" /><span>编辑</span></button> : null}
              {isImageLike && hasReadyMedia ? <button type="button" role="menuitem" onClick={() => void copyMessageImage(message)}><Icon name="copy" /><span>{isSticker ? '复制贴图图像' : '复制图像'}</span></button> : null}
              {hasReadyMedia ? <button type="button" role="menuitem" onClick={() => { setMessageContextMenu(undefined); downloadMessageMedia(message) }}><Icon name="download" /><span>另存为</span></button> : null}
              {hasReadyMedia ? <button type="button" role="menuitem" onClick={() => void shareMessageMedia(message)}><Icon name="forward" /><span>分享</span></button> : null}
              {hasReadyMedia ? <button type="button" role="menuitem" onClick={() => openMessageMedia(message)}><Icon name="externalLink" /><span>打开方式</span></button> : null}
              <div className="chat-context-divider" />
              <button type="button" role="menuitem" onClick={() => toggleMessageSelection(message.id)}><Icon name="select" /><span>选择</span></button>
              <button className="destructive" type="button" role="menuitem" onClick={() => { setMessageContextMenu(undefined); setMessageDialog({ type: 'delete', messageIds: [message.id] }) }}><Icon name="delete" /><span>删除</span></button>
            </div> : null}
          </div>
        )
      })() : null}

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
            <div className="chat-context-divider" />
            <button className="destructive" type="button" role="menuitem" onClick={() => { setChatContextMenu(undefined); setChatDestructiveDialog({ type: 'clear', chatId: chat.id }) }}>
              <Icon name="clear" /><span>清空聊天</span>
            </button>
            <button className="destructive" type="button" role="menuitem" onClick={() => { setChatContextMenu(undefined); setChatDestructiveDialog({ type: 'delete', chatId: chat.id }) }}>
              <Icon name="delete" /><span>删除聊天</span>
            </button>
          </div>
        )
      })() : null}

      {messageDialog && activeHistory ? (() => {
        const dialogMessages = activeHistory.messages.filter((message) => (
          messageDialog.type === 'forward' || messageDialog.type === 'delete'
            ? messageDialog.messageIds.includes(message.id)
            : message.id === messageDialog.messageId
        ))
        const message = dialogMessages[0]
        if (!message) return null
        if (messageDialog.type === 'details') {
          return (
            <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMessageDialog(undefined) }}>
              <section className="message-action-dialog" role="dialog" aria-modal="true" aria-labelledby="message-details-title">
                <header><strong id="message-details-title">消息详情</strong><button type="button" onClick={() => setMessageDialog(undefined)} aria-label="关闭"><Icon name="close" /></button></header>
                <dl className="message-details-list">
                  <div><dt>发送者</dt><dd>{message.from_me ? '你' : getMessageSenderName(message)}</dd></div>
                  <div><dt>发送时间</dt><dd>{formatMessageDateTime(message.sent_at)}</dd></div>
                  <div><dt>消息类型</dt><dd>{fallbackMessageCopy(message.message_type)}</dd></div>
                  <div><dt>状态</dt><dd>{message.read_at ? '已读' : message.delivered_at ? '已送达' : '已发送'}</dd></div>
                  <div><dt>消息 ID</dt><dd className="message-id-value">{message.wa_message_id}</dd></div>
                </dl>
              </section>
            </div>
          )
        }
        if (messageDialog.type === 'edit') {
          return (
            <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !messageActionBusy) setMessageDialog(undefined) }}>
              <section className="message-action-dialog" role="dialog" aria-modal="true" aria-labelledby="message-edit-title">
                <header><strong id="message-edit-title">编辑消息</strong><button type="button" onClick={() => setMessageDialog(undefined)} aria-label="关闭"><Icon name="close" /></button></header>
                <textarea autoFocus rows={5} maxLength={4096} value={messageDialog.text} onChange={(event) => setMessageDialog({ ...messageDialog, text: event.target.value })} />
                <footer><button className="secondary-button" type="button" onClick={() => setMessageDialog(undefined)}>取消</button><button className="primary-button" type="button" disabled={!messageDialog.text.trim() || messageActionBusy} onClick={() => void handleEditMessage(message.id, messageDialog.text)}>{messageActionBusy ? '保存中...' : '保存'}</button></footer>
              </section>
            </div>
          )
        }
        if (messageDialog.type === 'forward') {
          const sendableChats = chats.filter((chat) => isChatSendable(chat.wa_chat_jid, chat.chat_type))
          const query = forwardSearch.trim().toLocaleLowerCase()
          const forwardChats = sendableChats.filter((chat) => {
            if (!query) return true
            return [getChatDisplayName(chat), chat.phone_number, chat.note]
              .filter(Boolean)
              .some((value) => value?.toLocaleLowerCase().includes(query))
          })
          return (
            <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !messageActionBusy) setMessageDialog(undefined) }}>
              <section className="message-action-dialog message-forward-dialog" role="dialog" aria-modal="true" aria-labelledby="message-forward-title">
                <header><strong id="message-forward-title">转发消息给</strong><button type="button" onClick={() => setMessageDialog(undefined)} aria-label="关闭"><Icon name="close" /></button></header>
                <label className="message-forward-search">
                  <Icon name="search" />
                  <input autoFocus value={forwardSearch} onChange={(event) => setForwardSearch(event.target.value)} placeholder="搜索姓名、电话号码或备注" />
                </label>
                <div className="message-forward-list">
                  <strong className="message-forward-section-title">最近聊天</strong>
                  {forwardChats.map((chat) => {
                    const selected = forwardTargetChatIds.includes(chat.id)
                    return (
                    <button key={chat.id} className={selected ? 'selected' : undefined} type="button" disabled={messageActionBusy} aria-pressed={selected} onClick={() => setForwardTargetChatIds((current) => selected ? current.filter((id) => id !== chat.id) : [...current, chat.id])}>
                      <span className={`message-forward-check${selected ? ' selected' : ''}`} aria-hidden="true">{selected ? <Icon name="check" /> : null}</span>
                      <ChatAvatar chat={chat} /><span><strong>{getChatDisplayName(chat)}</strong><small>{chat.note || chat.phone_number || (chat.chat_type === 'group' ? '群组' : '')}</small></span>
                    </button>
                    )
                  })}
                  {!forwardChats.length ? <p className="message-forward-empty">没有匹配的会话</p> : null}
                </div>
                <footer className="message-forward-footer"><span>{forwardTargetChatIds.length ? `已选择 ${forwardTargetChatIds.length} 个会话` : '请选择会话'}</span><button className="primary-button" type="button" disabled={!forwardTargetChatIds.length || messageActionBusy} onClick={() => void handleForwardMessages(messageDialog.messageIds, forwardTargetChatIds)}>{messageActionBusy ? '转发中...' : '转发'}</button></footer>
              </section>
            </div>
          )
        }
        const canDeleteForEveryone = dialogMessages.length > 0 && dialogMessages.every((item) => item.from_me)
        return (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !messageActionBusy) setMessageDialog(undefined) }}>
            <section className="message-action-dialog message-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="message-delete-title">
              <header><strong id="message-delete-title">删除消息？</strong><button type="button" onClick={() => setMessageDialog(undefined)} aria-label="关闭"><Icon name="close" /></button></header>
              <p>已选择 {dialogMessages.length} 条消息。</p>
              <div className="message-delete-actions">
                {canDeleteForEveryone ? <button className="danger-button" type="button" disabled={messageActionBusy} onClick={() => void handleDeleteMessages(messageDialog.messageIds, true)}>为所有人删除</button> : null}
                <button className="secondary-button" type="button" disabled={messageActionBusy} onClick={() => void handleDeleteMessages(messageDialog.messageIds, false)}>从我这端删除</button>
                <button className="secondary-button" type="button" onClick={() => setMessageDialog(undefined)}>取消</button>
              </div>
            </section>
          </div>
        )
      })() : null}

      {chatDestructiveDialog ? (() => {
        const chat = chats.find((item) => item.id === chatDestructiveDialog.chatId)
        if (!chat) return null
        const deleting = chatDestructiveDialog.type === 'delete'
        return (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !messageActionBusy) setChatDestructiveDialog(undefined) }}>
            <section className="message-action-dialog message-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-destructive-title">
              <header><strong id="chat-destructive-title">{deleting ? '删除聊天？' : '清空聊天？'}</strong><button type="button" onClick={() => setChatDestructiveDialog(undefined)} aria-label="关闭"><Icon name="close" /></button></header>
              <p>{deleting ? `“${getChatDisplayName(chat)}”将从本软件会话列表删除。` : `“${getChatDisplayName(chat)}”的本地消息记录将被清空。`} 此操作不会删除对方设备上的消息。</p>
              <footer><button className="secondary-button" type="button" onClick={() => setChatDestructiveDialog(undefined)}>取消</button><button className="danger-button" type="button" disabled={messageActionBusy} onClick={() => void handleChatDestructiveAction()}>{messageActionBusy ? '处理中...' : deleting ? '删除聊天' : '清空聊天'}</button></footer>
            </section>
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

      {listPickerChat ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !chatMetadataBusy) setListPickerChat(undefined)
        }}>
          <section className="chat-list-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-list-picker-title">
            <header>
              <div><span>管理列表</span><strong id="chat-list-picker-title">{getChatDisplayName(listPickerChat)}</strong></div>
              <button type="button" className="icon-button" onClick={() => setListPickerChat(undefined)} aria-label="关闭"><Icon name="close" /></button>
            </header>
            <div className="chat-list-picker-options">
              {customLists.length ? customLists.map((label) => {
                const checked = listPickerLabelIds.includes(label.id)
                return (
                  <label key={label.id} className={checked ? 'selected' : ''}>
                    <span className="chat-list-color" style={{ backgroundColor: label.color }} />
                    <span>{label.name}</span>
                    <input type="checkbox" checked={checked} onChange={() => setListPickerLabelIds((current) => checked ? current.filter((id) => id !== label.id) : [...current, label.id])} />
                  </label>
                )
              }) : <p>还没有自定义列表</p>}
              <button type="button" className="chat-list-picker-create" onClick={() => { const chatId = listPickerChat.id; setListPickerChat(undefined); void openListCreator(chatId) }}><Icon name="plus" /><span>创建新列表</span></button>
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setListPickerChat(undefined)}>取消</button>
              <button type="button" className="primary-button" disabled={chatMetadataBusy} onClick={() => void saveChatListPicker()}>{chatMetadataBusy ? '保存中...' : '保存'}</button>
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

function EmojiPicker({
  search,
  activeCategory,
  mode,
  onSearch,
  onCategory,
  onMode,
  onSelect,
  onSelectGif,
  onSelectSticker,
}: {
  search: string
  activeCategory: string
  mode: ComposerPickerMode
  onSearch: (value: string) => void
  onCategory: (value: string) => void
  onMode: (value: ComposerPickerMode) => void
  onSelect: (emoji: string) => void
  onSelectGif: () => void
  onSelectSticker: () => void
}) {
  const normalizedSearch = search.trim().toLowerCase()
  const active = emojiCategories.find((category) => category.id === activeCategory) ?? emojiCategories[0]
  const emojis = normalizedSearch
    ? emojiCategories
      .filter((category) => category.label.toLowerCase().includes(normalizedSearch) || category.id.includes(normalizedSearch))
      .flatMap((category) => category.emojis)
      .filter((emoji, index, all) => all.indexOf(emoji) === index)
    : active.emojis

  return (
    <section className={`emoji-picker mode-${mode}`} aria-label="表情、GIF 和贴图选择器">
      {mode === 'emoji' ? (
        <>
          <label className="emoji-picker-search"><Icon name="search" /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索表情分类" /></label>
          <strong>{normalizedSearch ? '搜索结果' : active.label}</strong>
          <div className="emoji-picker-grid">
            {emojis.map((emoji) => <button key={emoji} type="button" onClick={() => onSelect(emoji)}><span>{emoji}</span></button>)}
            {!emojis.length ? <span>没有找到表情</span> : null}
          </div>
          <div className="emoji-picker-categories" role="tablist" aria-label="表情分类">
            {emojiCategories.map((category) => (
              <button key={category.id} type="button" role="tab" aria-selected={category.id === active.id} className={category.id === active.id ? 'active' : ''} onClick={() => onCategory(category.id)} title={category.label}>
                <span>{category.emojis[0]}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="emoji-picker-library-action">
          <Icon name={mode === 'gif' ? 'image' : 'smile'} />
          <strong>{mode === 'gif' ? '选择 GIF' : '创建贴图'}</strong>
          <button type="button" className="primary-button" onClick={mode === 'gif' ? onSelectGif : onSelectSticker}>
            <Icon name="plus" />
            {mode === 'gif' ? '选择 GIF 文件' : '选择图片'}
          </button>
        </div>
      )}
      <div className="emoji-picker-mode-tabs" role="tablist" aria-label="素材类型">
        <button type="button" role="tab" aria-selected={mode === 'emoji'} className={mode === 'emoji' ? 'active' : ''} onClick={() => onMode('emoji')} title="表情" aria-label="表情"><Icon name="smile" /></button>
        <button type="button" role="tab" aria-selected={mode === 'gif'} className={mode === 'gif' ? 'active' : ''} onClick={() => onMode('gif')} title="GIF" aria-label="GIF"><span className="gif-tab-mark">GIF</span></button>
        <button type="button" role="tab" aria-selected={mode === 'sticker'} className={mode === 'sticker' ? 'active' : ''} onClick={() => onMode('sticker')} title="贴图" aria-label="贴图"><Icon name="image" /></button>
      </div>
    </section>
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

function ChatMediaLibrary({
  content,
  activeTab,
  loading,
  error,
  onTab,
  onBack,
}: {
  content: MediaLibraryContent
  activeTab: MediaLibraryTab
  loading: boolean
  error?: string
  onTab: (tab: MediaLibraryTab) => void
  onBack: () => void
}) {
  const tabs: Array<{ id: MediaLibraryTab; label: string; count: number }> = [
    { id: 'media', label: '影音内容', count: content.media.length },
    { id: 'documents', label: '文档', count: content.documents.length },
    { id: 'links', label: '链接', count: content.links.length },
  ]
  const activeItems = content[activeTab]
  const groupedItems = groupMediaLibraryItems(activeItems)

  return (
    <div className="chat-media-library">
      <header className="chat-media-library-head">
        <button type="button" onClick={onBack} aria-label="返回联系人信息"><Icon name="chevronRight" /></button>
        <strong>影音内容、链接和文档</strong>
      </header>
      <div className="chat-media-library-tabs" role="tablist" aria-label="媒体分类">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => onTab(tab.id)}
          >
            <span>{tab.label}</span>
            {tab.count ? <small>{tab.count}</small> : null}
          </button>
        ))}
      </div>
      {loading ? <div className="chat-media-library-loading">正在同步完整记录...</div> : null}
      {error ? <div className="chat-media-library-error">{error}</div> : null}
      <div className="chat-media-library-body">
        {groupedItems.length ? groupedItems.map((group) => (
          <section className="chat-media-library-group" key={group.label}>
            <h4>{group.label}</h4>
            {activeTab === 'media' ? (
              <div className="chat-media-library-grid">
                {group.items.filter(isMediaLibraryAttachment).map(({ attachment }) => (
                  <button
                    key={attachment.id}
                    type="button"
                    disabled={attachment.download_status !== 'ready'}
                    onClick={() => window.open(getMediaAssetUrl(attachment.id), '_blank', 'noopener,noreferrer')}
                    title={attachment.file_name || '打开媒体'}
                  >
                    {attachment.download_status === 'ready' && attachment.media_type === 'video' ? (
                      <video src={getMediaAssetUrl(attachment.id)} muted preload="metadata" />
                    ) : attachment.download_status === 'ready' ? (
                      <img src={getMediaAssetUrl(attachment.id)} alt={attachment.file_name || ''} loading="lazy" />
                    ) : (
                      <span className="chat-media-library-unavailable"><Icon name="image" />媒体不可用</span>
                    )}
                    {isGIFAttachment(attachment) ? <span className="chat-media-library-gif">GIF</span> : null}
                    {attachment.media_type === 'video' ? <span className="chat-media-library-video"><Icon name="play" /></span> : null}
                  </button>
                ))}
              </div>
            ) : activeTab === 'documents' ? (
              <div className="chat-media-library-list documents">
                {group.items.filter(isMediaLibraryAttachment).map(({ message, attachment }) => (
                  <button
                    key={attachment.id}
                    type="button"
                    disabled={attachment.download_status !== 'ready'}
                    onClick={() => window.open(getMediaAssetUrl(attachment.id), '_blank', 'noopener,noreferrer')}
                  >
                    <span className="chat-media-library-file-icon"><Icon name="fileText" /></span>
                    <span><strong>{attachment.file_name || '文档'}</strong><small>{formatFileSize(attachment.byte_size)} · {formatMessageDateTime(message.sent_at)}</small></span>
                    <Icon name="chevronRight" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="chat-media-library-list links">
                {group.items.filter(isMediaLibraryLink).map(({ message, url }) => (
                  <a key={`${message.id}-${url}`} href={url} target="_blank" rel="noreferrer">
                    <span className="chat-media-library-link-icon"><Icon name="externalLink" /></span>
                    <span><strong>{getURLHost(url)}</strong><small>{url}</small><time dateTime={message.sent_at}>{formatMessageDateTime(message.sent_at)}</time></span>
                  </a>
                ))}
              </div>
            )}
          </section>
        )) : !loading ? <EmptyPanel title={`没有${tabs.find((tab) => tab.id === activeTab)?.label ?? '记录'}`} description="当前会话中没有此类内容。" /> : null}
      </div>
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

function ContactMessageCards({ value, onMessage }: { value: string; onMessage: (name: string, phone: string) => void }) {
  const normalizedValue = value.replace(/\\n/g, '\n')
  const contacts = normalizedValue.split(/\n\s*\n/).map((block) => {
    const [name = '联系人', phone = ''] = block.split('\n').map((item) => item.trim()).filter(Boolean)
    return { name, phone }
  })

  return (
    <div className="message-contact-cards">
      {contacts.map((contact, index) => (
        <div className="message-contact-card" key={`${contact.name}-${contact.phone}-${index}`}>
          <div className="message-contact-card-main">
            <span className="message-contact-avatar" aria-hidden="true"><Icon name="user" /></span>
            <span><strong>{contact.name}</strong>{contact.phone ? <small>{formatDisplayPhone(contact.phone)}</small> : null}</span>
          </div>
          {contact.phone ? <button type="button" onClick={() => onMessage(contact.name, contact.phone)}><Icon name="chat" />发消息</button> : null}
        </div>
      ))}
    </div>
  )
}

function PollMessageCard({ poll }: { poll: NonNullable<MessageView['poll']> }) {
  return (
    <div className="message-poll-card">
      <strong>{poll.question}</strong>
      <div className="message-poll-options">
        {poll.options.map((option, index) => (
          <div key={`${option}-${index}`}>
            <span aria-hidden="true" />
            <p>{option}</p>
          </div>
        ))}
      </div>
      <small>{poll.allow_multiple ? '可选择多个选项' : '请选择一个选项'}</small>
    </div>
  )
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
  voiceIdentity?: { name: string; photoUrl?: string },
	voiceTools?: {
	  state?: VoiceTranscriptionState
	  onTranscribe: () => void
	  onTranslate?: () => void
	},
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
    return <VoiceMessagePlayer key={media.id} src={mediaUrl} identity={voiceIdentity} transcription={voiceTools?.state} onTranscribe={voiceTools?.onTranscribe} onTranslate={voiceTools?.onTranslate} onMediaLayoutReady={onMediaLayoutReady} />
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

function VoiceMessagePlayer({
  src,
  identity,
	transcription,
	onTranscribe,
	onTranslate,
  onMediaLayoutReady,
}: {
  src: string
  identity?: { name: string; photoUrl?: string }
	transcription?: VoiceTranscriptionState
	onTranscribe?: () => void
	onTranslate?: () => void
  onMediaLayoutReady: () => void
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  async function togglePlayback() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      try {
        await audio.play()
      } catch {
        setPlaying(false)
      }
    } else {
      audio.pause()
    }
  }

  return (
    <figure className="media-preview-card audio whatsapp-voice-message">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => {
          setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)
          onMediaLayoutReady()
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0) }}
      />
      <button type="button" className="voice-play-button" onClick={() => void togglePlayback()} aria-label={playing ? '暂停语音' : '播放语音'}>
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      <div className="voice-waveform-shell" style={{ '--voice-progress': `${progress}%` } as CSSProperties}>
        <input
          type="range"
          min="0"
          max={Math.max(duration, 1)}
          step="0.01"
          value={currentTime}
          onChange={(event) => {
            const next = Number(event.target.value)
            setCurrentTime(next)
            if (audioRef.current) audioRef.current.currentTime = next
          }}
          aria-label="语音播放进度"
        />
        <span className="voice-waveform" aria-hidden="true">{Array.from({ length: 34 }, (_, index) => <i key={index} style={{ height: `${7 + ((index * 13) % 18)}px` }} />)}</span>
        <time>{formatVoiceDuration(Math.round(playing ? currentTime : duration || currentTime))}</time>
      </div>
      <span className="voice-avatar" aria-hidden="true">
        {identity?.photoUrl
          ? <img src={identity.photoUrl} alt="" />
          : <span>{getChatAvatarLabel(identity?.name || '语音')}</span>}
        <i><Icon name="audio" /></i>
      </span>
	  <figcaption className="voice-transcription-panel">
		{transcription?.transcription ? (
		  <div className="voice-transcription-copy">
			<span>原文</span>
			<p>{transcription.transcription.text}</p>
		  </div>
		) : null}
		{transcription?.translation ? (
		  <div className="voice-transcription-copy translated">
			<span>中文</span>
			<p>{transcription.translation.translated_text}</p>
		  </div>
		) : null}
		{transcription?.loading ? <span className="voice-transcription-status">转录中...</span> : null}
		{transcription?.translationLoading ? <span className="voice-transcription-status">翻译中...</span> : null}
		{transcription?.error ? <div className="voice-transcription-error"><span>{transcription.error}</span>{onTranscribe ? <button type="button" onClick={onTranscribe}>重试转录</button> : null}</div> : null}
		{transcription?.translationError ? <div className="voice-transcription-error"><span>{transcription.translationError}</span>{onTranslate ? <button type="button" onClick={onTranslate}>重新翻译</button> : null}</div> : null}
		{!transcription?.transcription && !transcription?.loading && !transcription?.error && onTranscribe ? <button className="voice-transcription-action" type="button" onClick={onTranscribe}>转录</button> : null}
		{transcription?.transcription && !transcription.translation && !transcription.translationLoading && !transcription.translationError && onTranslate ? <button className="voice-transcription-action" type="button" onClick={onTranslate}>翻译成中文</button> : null}
	  </figcaption>
    </figure>
  )
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
    return chat.chat_type === 'direct' ? formatDisplayPhone(title) : title
  }

  if (chat.chat_type === 'group') {
    return formatGroupFallback(chat)
  }

  if (!isChatSendable(chat.wa_chat_jid, chat.chat_type)) {
    return '系统会话'
  }

  return formatDisplayPhone(formatChatIdentifier(chat.wa_chat_jid))
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

function isSessionDisconnectedError(message: string) {
  const normalized = message.trim().toLowerCase()
  return normalized.includes('whatsapp session is not connected')
    || normalized.includes('session is not connected')
}

function getFriendlyChatError(message: string) {
  if (isSessionDisconnectedError(message)) {
    return '当前账号连接已断开，正在刷新连接状态，请稍后重试或重新登录。'
  }
  return message
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
  if (message.message_type === 'contact') {
    return false
  }
  const text = message.text_content?.trim()
  return Boolean(text && needsChineseTranslation(text))
}

function buildMediaLibrary(messages: MessageView[]): MediaLibraryContent {
  const content: MediaLibraryContent = { media: [], documents: [], links: [] }
  const orderedMessages = [...messages].sort((left, right) => (
    new Date(right.sent_at).getTime() - new Date(left.sent_at).getTime()
  ))

  orderedMessages.forEach((message) => {
    message.media.forEach((attachment) => {
      if (attachment.media_type === 'image' || attachment.media_type === 'video' || attachment.media_type === 'sticker') {
        content.media.push({ message, attachment })
      } else if (attachment.media_type === 'document' || attachment.media_type === 'other') {
        content.documents.push({ message, attachment })
      }
    })

    const urls = extractHTTPURLs(message.text_content || '')
    urls.forEach((url) => content.links.push({ message, url }))
  })

  return content
}

function getMediaLibraryCount(content: MediaLibraryContent) {
  return content.media.length + content.documents.length + content.links.length
}

function extractHTTPURLs(value: string) {
  const matches = value.match(/https?:\/\/[^\s<>{}"'\]]+/gi) ?? []
  return Array.from(new Set(matches.map((url) => url.replace(/[),.!?;:]+$/g, ''))))
}

function groupMediaLibraryItems(items: ReadonlyArray<MediaLibraryAttachment | MediaLibraryLink>) {
  const groups = new Map<string, Array<MediaLibraryAttachment | MediaLibraryLink>>()
  items.forEach((item) => {
    const label = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(new Date(item.message.sent_at))
    const group = groups.get(label) ?? []
    group.push(item)
    groups.set(label, group)
  })
  return Array.from(groups, ([label, groupItems]) => ({ label, items: groupItems }))
}

function isMediaLibraryAttachment(item: MediaLibraryAttachment | MediaLibraryLink): item is MediaLibraryAttachment {
  return 'attachment' in item
}

function isMediaLibraryLink(item: MediaLibraryAttachment | MediaLibraryLink): item is MediaLibraryLink {
  return 'url' in item
}

function isGIFAttachment(attachment: MessageView['media'][number]) {
  return attachment.mime_type?.toLowerCase().includes('gif')
    || attachment.file_name?.toLowerCase().endsWith('.gif')
}

function formatFileSize(byteSize?: number) {
  if (!byteSize || byteSize < 1) return '大小未知'
  if (byteSize < 1024) return `${byteSize} B`
  if (byteSize < 1024 * 1024) return `${Math.round(byteSize / 1024)} KB`
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`
}

function getURLHost(value: string) {
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
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

function loadVoiceTranscriptionCache(): Record<string, VoiceTranscriptionState> {
  const stored = readStoredVoiceTranscriptionCache()
  return Object.fromEntries(
	Object.entries(stored).map(([key, value]) => [key, {
	  transcription: value.transcription,
	  translation: value.translation,
	}]),
  )
}

function persistVoiceTranscription(
  mediaId: string,
  transcription: AudioTranscriptionView,
  translation?: TranslationView,
) {
  if (!mediaId || !transcription.text.trim()) return
  const stored = readStoredVoiceTranscriptionCache()
  stored[mediaId] = {
	cached_at: new Date().toISOString(),
	transcription,
	translation,
  }
  writeStoredVoiceTranscriptionCache(trimStoredVoiceTranscriptionCache(stored))
}

function readStoredVoiceTranscriptionCache(): Record<string, StoredVoiceTranscription> {
  if (typeof window === 'undefined') return {}
  try {
	const raw = window.localStorage.getItem(voiceTranscriptionCacheStorageKey)
	if (!raw) return {}
	const decoded = JSON.parse(raw)
	if (!isPlainRecord(decoded)) return {}
	return Object.fromEntries(
	  Object.entries(decoded).filter((entry): entry is [string, StoredVoiceTranscription] => {
		const value = entry[1]
		if (!isPlainRecord(value)) return false
		const candidate = value as Partial<StoredVoiceTranscription>
		return typeof candidate.cached_at === 'string'
		  && isAudioTranscriptionView(candidate.transcription)
		  && (candidate.translation === undefined || isTranslationView(candidate.translation))
	  }),
	)
  } catch {
	return {}
  }
}

function writeStoredVoiceTranscriptionCache(cache: Record<string, StoredVoiceTranscription>) {
  if (typeof window === 'undefined') return
  try {
	window.localStorage.setItem(voiceTranscriptionCacheStorageKey, JSON.stringify(cache))
  } catch {
	// Keep the in-memory result when local persistence is unavailable.
  }
}

function trimStoredVoiceTranscriptionCache(cache: Record<string, StoredVoiceTranscription>) {
  const entries = Object.entries(cache)
  if (entries.length <= voiceTranscriptionCacheLimit) return cache
  return Object.fromEntries(
	entries
	  .sort((left, right) => left[1].cached_at.localeCompare(right[1].cached_at))
	  .slice(-voiceTranscriptionCacheLimit),
  )
}

function isAudioTranscriptionView(value: unknown): value is AudioTranscriptionView {
  if (!isPlainRecord(value)) return false
  return typeof value.text === 'string'
	&& typeof value.provider_name === 'string'
	&& typeof value.model === 'string'
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

function getJIDDisplayName(jid: string) {
  return formatDisplayPhone(formatChatIdentifier(jid))
}

function formatDisplayPhone(value: string) {
  const trimmed = value.trim()
  const raw = trimmed.includes('@') ? formatChatIdentifier(trimmed) : trimmed
  return /^\d{7,20}$/.test(raw) ? `+${raw}` : raw
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
  if (action === 'gif') return 'GIF'
  if (action === 'sticker') return '贴图'
  return attachmentActions.find((item) => item.key === action)?.label ?? '附件'
}

function messageToQuotedView(message: MessageView): QuotedMessageView {
  return {
    wa_message_id: message.wa_message_id,
    sender_jid: message.sender_jid,
    sender_name: message.sender_name,
    from_me: message.from_me,
    message_type: message.message_type,
    text_content: message.text_content,
  }
}

function getQuotedMessageCopy(message: QuotedMessageView) {
  return message.text_content?.trim() || fallbackMessageCopy(message.message_type)
}

function isChatAccountAvailable(account: AccountView) {
  return account.status === 'connected' || account.status === 'reconnecting'
}

function chatHeaderToSummary(chat: ChatHeader): ChatSummary {
  return {
    ...chat,
    labels: chat.labels ?? [],
  }
}

function formatVoiceDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function resolveAttachmentMediaType(kind: FileAttachmentAction, file: File): SendChatMediaType {
  const mimeType = file.type.toLowerCase()
  if (kind === 'sticker') {
    return 'sticker'
  }
  if (kind === 'gif') {
    return 'image'
  }
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

async function convertImageToSticker(file: File) {
  if (file.type === 'image/webp') {
    return file
  }
  const bitmap = await createImageBitmap(file)
  try {
    const size = 512
    const scale = Math.min(size / bitmap.width, size / bitmap.height)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('当前设备无法创建贴图画布')
    }
    context.drawImage(bitmap, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('贴图转换失败')), 'image/webp', 0.88)
    })
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'sticker'
    return new File([blob], `${baseName}.webp`, { type: 'image/webp', lastModified: Date.now() })
  } finally {
    bitmap.close()
  }
}

function summarizeMessageReactions(reactions?: Record<string, string>) {
  const counts = new Map<string, number>()
  for (const emoji of Object.values(reactions ?? {})) {
    if (!emoji) continue
    counts.set(emoji, (counts.get(emoji) ?? 0) + 1)
  }
  return Array.from(counts, ([emoji, count]) => ({ emoji, count }))
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
    case 'contact':
      return '联系人名片'
    case 'poll':
      return '投票消息'
    case 'location':
      return '位置消息'
    case 'system':
      return '系统消息'
    default:
      return '暂无可直接展示的文本内容'
  }
}
