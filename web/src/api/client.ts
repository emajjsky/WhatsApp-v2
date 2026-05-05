export type AccountStatus =
  | 'pending'
  | 'pairing'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'logged_out'
  | 'failed'

export type PairingMethod = 'qr' | 'pairing_code'

export interface PairingArtifact {
  method: PairingMethod
  qr_code?: string
  pairing_code?: string
  instruction: string
  expires_at: string
}

export interface SessionView {
  status: AccountStatus
  last_error?: string
  updated_at: string
  connected_at?: string
  pairing?: PairingArtifact
}

export interface AccountView {
  id: string
  user_id?: string
  display_name: string
  phone_number?: string
  status: AccountStatus
  platform_label?: string
  last_seen_at?: string
  created_at: string
  updated_at: string
  session?: SessionView
}

export interface HealthResponse {
  service: string
  environment: string
  status: string
  timestamp: string
}

export type SystemHealthStatus = 'ok' | 'degraded' | 'down'
export type SystemComponentStatus = 'ok' | 'warn' | 'down'

export interface SystemHealthComponent {
  name: string
  status: SystemComponentStatus
  summary: string
  details?: Record<string, unknown>
}

export interface SystemHealthResponse {
  service: string
  environment: string
  status: SystemHealthStatus
  timestamp: string
  components: SystemHealthComponent[]
  metrics: Record<string, number>
}

export type ChatType = 'direct' | 'group' | 'broadcast' | 'status'

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'reaction'
  | 'system'
  | 'location'
  | 'contact'
  | 'poll'
  | 'unknown'

export interface ChatSummary {
  id: string
  account_id: string
  wa_chat_jid: string
  chat_type: ChatType
  title?: string
  participant_count?: number
  archived: boolean
  last_message_at?: string
  latest_message_preview?: string
  latest_message_type?: MessageType
  latest_sender_jid?: string
  latest_from_me?: boolean
}

export interface ChatListResponse {
  chats: ChatSummary[]
  total: number
  limit: number
  offset: number
}

export interface ChatHeader {
  id: string
  account_id: string
  wa_chat_jid: string
  chat_type: ChatType
  title?: string
  participant_count?: number
  archived: boolean
  last_message_at?: string
}

export type MediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'thumbnail' | 'other'
export type DownloadStatus = 'pending' | 'ready' | 'failed' | 'expired'

export interface MediaAttachment {
  id: string
  message_id: string
  media_type: MediaType
  mime_type?: string
  file_name?: string
  byte_size?: number
  sha256?: string
  storage_key?: string
  download_status: DownloadStatus
}

export interface MessageView {
  id: string
  account_id: string
  chat_id: string
  wa_message_id: string
  sender_jid: string
  sender_name?: string
  from_me: boolean
  message_type: MessageType
  text_content?: string
  reply_to_wa_message_id?: string
  sent_at: string
  delivered_at?: string
  read_at?: string
  media: MediaAttachment[]
}

export interface MessageHistoryResponse {
  chat: ChatHeader
  messages: MessageView[]
  limit: number
  has_more: boolean
  next_before?: string
}

export interface SendChatMessagePayload {
  message_text: string
}

export interface SendChatMessageResponse {
  chat_id: string
  wa_chat_jid: string
  wa_message_id: string
  message_text: string
  sent_at: string
}

export type UserRole = 'admin' | 'user'
export type UserStatus = 'active' | 'disabled'
export type UserPermission = 'accounts' | 'chats' | 'scripts' | 'exports'
export type InvitationStatus = 'active' | 'disabled'

export interface AuthUser {
  id: string
  email: string
  display_name: string
  role: UserRole
  status: UserStatus
  permissions?: UserPermission[]
  last_login_at?: string
  created_at: string
  updated_at: string
}

export interface AuthSessionResponse {
  authenticated: boolean
  user?: AuthUser
  registration_enabled: boolean
}

export interface LoginPayload {
  email: string
  password: string
}

export interface RegisterPayload {
  email: string
  password: string
  display_name: string
  invite_code: string
}

export type SendChatMediaType = 'image' | 'video' | 'audio' | 'document'

export interface SendChatMediaPayload {
  file: File
  mediaType: SendChatMediaType
  caption?: string
}

export interface SendChatMediaResponse {
  chat_id: string
  wa_chat_jid: string
  wa_message_id: string
  message_type: MessageType
  media_type: SendChatMediaType
  file_name?: string
  mime_type?: string
  caption?: string
  sent_at: string
}

export type ExportFormat = 'json' | 'markdown' | 'html'
export type ExportStatus = 'queued' | 'running' | 'completed' | 'failed'
export type ExportScopeType = 'chat' | 'chat_batch'

export interface ExportJobView {
  id: string
  account_id: string
  chat_id: string
  account_ids: string[]
  chat_ids: string[]
  date_from?: string
  date_to?: string
  scope_type: ExportScopeType
  format: ExportFormat
  include_media: boolean
  status: ExportStatus
  artifact_path?: string
  error_message?: string
  created_at: string
  started_at?: string
  completed_at?: string
}

export interface ScriptDocumentView {
  id: string
  title: string
  file_name: string
  content_type: string
  byte_size: number
  created_at: string
}

export type LiveUpdateType = 'session_changed' | 'chat_stored' | 'message_stored'

export interface LiveUpdate {
  type: LiveUpdateType
  account_id: string
  status?: string
  chat_id?: string
  message_id?: string
  occurred_at: string
  summary: string
}

export type AgentReplyMode = 'manual' | 'suggest' | 'auto_send'
export type AgentMatchMode = 'any' | 'all'
export type AgentPurpose = 'reply' | 'translation' | 'status_card'
export type AgentRunStatus =
  | 'queued'
  | 'generating'
  | 'blocked'
  | 'ready_for_review'
  | 'sent'
  | 'failed'

export interface AgentScopeFilter {
  chat_ids: string[]
  chat_types: ChatType[]
}

export interface AgentTriggerFilter {
  keywords: string[]
  match_mode: AgentMatchMode
  ignore_from_me: boolean
  min_message_chars: number
}

export interface AgentBlacklistFilter {
  blocked_keywords: string[]
  sensitive_topics: string[]
}

export interface AgentKnowledgeBinding {
  summary?: string
  references: string[]
}

export type AgentProviderConfig = Record<string, unknown>

export interface AgentRuleView {
  id: string
  account_id: string
  account_ids: string[]
  purpose: AgentPurpose
  name: string
  enabled: boolean
  scope_filter: AgentScopeFilter
  trigger_filter: AgentTriggerFilter
  reply_mode: AgentReplyMode
  cooldown_seconds: number
  max_auto_replies_per_thread: number
  blacklist_filter: AgentBlacklistFilter
  prompt_template: string
  provider_config: AgentProviderConfig
  knowledge_binding?: AgentKnowledgeBinding
  created_at: string
  updated_at: string
}

export interface AgentSettingsView {
  account_id: string
  provider: string
  model: string
  base_url: string
  api_key: string
  prompt_template: string
  created_at: string
  updated_at: string
}

export interface AgentRunView {
  id: string
  rule_id: string
  rule_name: string
  account_id: string
  chat_id: string
  chat_title?: string
  wa_chat_jid?: string
  trigger_message_id: string
  trigger_preview?: string
  status: AgentRunStatus
  output_draft?: string
  block_reason?: string
  created_at: string
  completed_at?: string
}

export interface AgentRunListResponse {
  runs: AgentRunView[]
  total: number
  limit: number
  offset: number
}

export interface AuditEntry {
  id: string
  actor_type: 'user' | 'system' | 'agent'
  actor_id?: string
  action: string
  target_type: string
  target_id: string
  outcome: 'success' | 'denied' | 'blocked' | 'failed'
  detail: Record<string, unknown>
  created_at: string
}

export interface AuditListResponse {
  entries: AuditEntry[]
  total: number
  limit: number
  offset: number
}

export interface UpsertAgentRulePayload {
  id?: string
  account_id: string
  account_ids?: string[]
  purpose?: AgentPurpose
  name: string
  enabled: boolean
  scope_filter: AgentScopeFilter
  trigger_filter: AgentTriggerFilter
  reply_mode: AgentReplyMode
  cooldown_seconds: number
  max_auto_replies_per_thread: number
  blacklist_filter: AgentBlacklistFilter
  prompt_template: string
  provider_config?: AgentProviderConfig
  knowledge_binding?: AgentKnowledgeBinding
}

export interface SystemAgentConfigView {
  id: string
  name: string
  purpose: AgentPurpose
  enabled: boolean
  provider_config: AgentProviderConfig
  prompt_template: string
  created_at: string
  updated_at: string
}

export interface UpsertSystemAgentConfigPayload {
  id?: string
  name: string
  purpose: AgentPurpose
  enabled: boolean
  provider_config: AgentProviderConfig
  prompt_template: string
}

export interface UpsertAgentSettingsPayload {
  account_id: string
  provider: string
  model: string
  base_url: string
  api_key: string
  prompt_template: string
}

export interface GenerateAgentRunPayload {
  chat_id: string
  agent_id?: string
  rule_id?: string
  message_text?: string
  context_enabled?: boolean
  context_message_limit?: number
}

export interface AgentRunStreamHandlers {
  onStart?: (run: AgentRunView) => void
  onDelta?: (text: string) => void
  onComplete?: (run: AgentRunView) => void
  onError?: (message: string, run?: AgentRunView) => void
}

export interface TranslateTextPayload {
  account_id: string
  agent_id?: string
  text: string
  target_language: string
  target_language_name?: string
}

export interface TranslationView {
  source_language_code: string
  source_language_name: string
  target_language: string
  target_language_name: string
  translated_text: string
}

export interface StatusCardView {
  agent_id: string
  agent_name: string
  current_stage: string
  customer_types: string[]
  current_risk: '低' | '中' | '高' | string
  summary: string
  evidence: string[]
  next_action: string
  confidence?: string
  message_count: number
  history_limit: number
  analyzed_at: string
}

export interface AnalyzeStatusCardPayload {
  chat_id: string
  agent_id?: string
  context_message_limit?: number
}

export interface CreateAccountPayload {
  display_name: string
  phone_number?: string
  platform_label?: string
}

export interface CreateUserPayload {
  email: string
  password: string
  display_name: string
  role: UserRole
  status: UserStatus
  permissions?: UserPermission[]
}

export interface UpdateUserPayload {
  display_name?: string
  role?: UserRole
  status?: UserStatus
  permissions?: UserPermission[]
}

export interface ResetPasswordPayload {
  password: string
}

export interface InvitationCodeView {
  id: string
  code: string
  status: InvitationStatus
  max_uses: number
  used_count: number
  expires_at?: string
  note: string
  created_by?: string
  last_used_at?: string
  created_at: string
  updated_at: string
}

export interface CreateInvitationPayload {
  code?: string
  max_uses: number
  expires_at?: string
  note?: string
}

export interface UpdateInvitationPayload {
  status?: InvitationStatus
  max_uses?: number
  expires_at?: string
  note?: string
}

interface RequestOptions extends RequestInit {
  jsonBody?: unknown
  timeoutMs?: number
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { jsonBody, timeoutMs, ...fetchOptions } = options
  const hasFormDataBody = fetchOptions.body instanceof FormData
  const timeoutController = timeoutMs ? new AbortController() : undefined
  const timeoutHandle = timeoutController
    ? window.setTimeout(() => timeoutController.abort(), timeoutMs)
    : undefined

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...fetchOptions,
      credentials: fetchOptions.credentials ?? 'include',
      headers: hasFormDataBody
        ? fetchOptions.headers
        : {
            'Content-Type': 'application/json',
            ...(fetchOptions.headers ?? {}),
          },
      body: jsonBody !== undefined ? JSON.stringify(jsonBody) : fetchOptions.body,
      signal: timeoutController?.signal ?? fetchOptions.signal,
    })

    if (!response.ok) {
      let message = '请求失败'
      try {
        const payload = (await response.json()) as { error?: string }
        if (payload.error) {
          message = payload.error
        }
      } catch {
        message = response.statusText || message
      }

      throw new ApiError(response.status, message)
    }

    if (response.status === 204) {
      return undefined as T
    }

    return (await response.json()) as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试')
    }

    throw error
  } finally {
    if (timeoutHandle !== undefined) {
      window.clearTimeout(timeoutHandle)
    }
  }
}

export async function getHealth() {
  return request<HealthResponse>('/healthz')
}

export async function getSystemHealth() {
  return request<SystemHealthResponse>('/api/system/health')
}

export async function getAuthSession() {
  return request<AuthSessionResponse>('/api/auth/session')
}

export async function login(payload: LoginPayload) {
  return request<{ user: AuthUser; expires_at: string }>('/api/auth/login', {
    method: 'POST',
    jsonBody: payload,
  })
}

export async function register(payload: RegisterPayload) {
  return request<{ user: AuthUser; expires_at: string }>('/api/auth/register', {
    method: 'POST',
    jsonBody: payload,
  })
}

export async function logout() {
  return request<void>('/api/auth/logout', { method: 'POST' })
}

export async function listUsers() {
  return request<{ users: AuthUser[] }>('/api/admin/users')
}

export async function createUser(payload: CreateUserPayload) {
  return request<{ user: AuthUser }>('/api/admin/users', {
    method: 'POST',
    jsonBody: payload,
  })
}

export async function updateUser(userId: string, payload: UpdateUserPayload) {
  return request<{ user: AuthUser }>(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    jsonBody: payload,
  })
}

export async function resetUserPassword(userId: string, password: string) {
  return request<void>(`/api/admin/users/${userId}/password`, {
    method: 'POST',
    jsonBody: { password },
  })
}

export async function listInvitations() {
  return request<{ invitations: InvitationCodeView[] }>('/api/admin/invitations')
}

export async function createInvitation(payload: CreateInvitationPayload) {
  return request<{ invitation: InvitationCodeView }>('/api/admin/invitations', {
    method: 'POST',
    jsonBody: payload,
  })
}

export async function updateInvitation(invitationId: string, payload: UpdateInvitationPayload) {
  return request<{ invitation: InvitationCodeView }>(`/api/admin/invitations/${invitationId}`, {
    method: 'PATCH',
    jsonBody: payload,
  })
}

export async function listAccounts() {
  return request<{ accounts: AccountView[] }>('/api/accounts')
}

export async function createAccount(payload: CreateAccountPayload) {
  return request<{ account: AccountView }>('/api/accounts', {
    method: 'POST',
    jsonBody: payload,
  })
}

export async function startPairing(accountId: string, method: PairingMethod) {
  return request<{ account: AccountView }>(`/api/accounts/${accountId}/pair`, {
    method: 'POST',
    jsonBody: { method },
  })
}

export async function logoutAccount(accountId: string) {
  return request<{ account: AccountView }>(`/api/accounts/${accountId}/logout`, {
    method: 'POST',
    timeoutMs: 15000,
  })
}

export async function deleteAccount(accountId: string) {
  return request<void>(`/api/accounts/${accountId}`, { method: 'DELETE' })
}

export async function getAccountStatus(accountId: string) {
  return request<{ account: AccountView }>(`/api/accounts/${accountId}/status`)
}

export async function listChats(params: {
  accountId?: string
  query?: string
  chatType?: ChatType | ''
  limit?: number
  offset?: number
}) {
  const searchParams = new URLSearchParams()
  if (params.accountId) {
    searchParams.set('account_id', params.accountId)
  }
  if (params.query) {
    searchParams.set('query', params.query)
  }
  if (params.chatType) {
    searchParams.set('chat_type', params.chatType)
  }
  if (params.limit) {
    searchParams.set('limit', String(params.limit))
  }
  if (params.offset) {
    searchParams.set('offset', String(params.offset))
  }

  const queryString = searchParams.toString()
  return request<ChatListResponse>(`/api/chats${queryString ? `?${queryString}` : ''}`)
}

export async function getChatMessages(chatId: string, params?: { limit?: number; before?: string }) {
  const searchParams = new URLSearchParams()
  if (params?.limit) {
    searchParams.set('limit', String(params.limit))
  }
  if (params?.before) {
    searchParams.set('before', params.before)
  }

  const queryString = searchParams.toString()
  return request<MessageHistoryResponse>(
    `/api/chats/${chatId}/messages${queryString ? `?${queryString}` : ''}`,
  )
}

export async function sendChatMessage(chatId: string, payload: SendChatMessagePayload) {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), 12000)

  try {
    return await request<SendChatMessageResponse>(`/api/chats/${chatId}/messages`, {
      method: 'POST',
      jsonBody: payload,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('发送超时，请稍后重试')
    }
    throw error
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export function subscribeLiveUpdates(
  onUpdate: (update: LiveUpdate) => void,
  onError?: (event: Event) => void,
) {
  const eventSource = new EventSource(`${baseUrl}/api/live`, { withCredentials: true })

  eventSource.onmessage = (event) => {
    if (!event.data) {
      return
    }

    try {
      onUpdate(JSON.parse(event.data) as LiveUpdate)
    } catch (error) {
      console.warn('failed to parse live update payload', error)
    }
  }

  if (onError) {
    eventSource.onerror = (event) => {
      onError(event)
    }
  }

  return () => {
    eventSource.close()
  }
}

export async function sendChatMedia(chatId: string, payload: SendChatMediaPayload) {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), 75000)
  const formData = new FormData()
  formData.set('file', payload.file)
  formData.set('media_type', payload.mediaType)
  if (payload.file.type) {
    formData.set('mime_type', payload.file.type)
  }
  if (payload.caption?.trim()) {
    formData.set('caption', payload.caption.trim())
  }

  try {
    const response = await fetch(`${baseUrl}/api/chats/${chatId}/messages`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      credentials: 'include',
    })

    if (!response.ok) {
      let message = '发送媒体失败'
      try {
        const errorPayload = (await response.json()) as { error?: string }
        if (errorPayload.error) {
          message = errorPayload.error
        }
      } catch {
        message = response.statusText || message
      }
      throw new ApiError(response.status, message)
    }

    return (await response.json()) as SendChatMediaResponse
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('媒体发送超时，请稍后重试')
    }
    throw error
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export function getMediaAssetUrl(mediaId: string) {
  return `${baseUrl}/api/media/${mediaId}/content`
}

export async function listExportJobs() {
  return request<{ jobs: ExportJobView[] }>('/api/exports')
}

export async function createExportJob(payload: {
  account_ids: string[]
  chat_ids: string[]
  date_from?: string
  date_to?: string
  format: ExportFormat
  include_media: boolean
}) {
  return request<{ job: ExportJobView }>('/api/exports', {
    method: 'POST',
    jsonBody: payload,
  })
}

export async function deleteExportJob(jobId: string) {
  return request<void>(`/api/exports/${jobId}`, { method: 'DELETE' })
}

export function getExportArtifactUrl(jobId: string) {
  return `${baseUrl}/api/exports/${jobId}/artifact`
}

export async function downloadExportArtifact(jobId: string) {
  return downloadBlob(getExportArtifactUrl(jobId), {
    fallbackFilename: `whatsapp-export-${jobId}`,
  })
}

export async function downloadExportArchive(jobIds: string[]) {
  return downloadBlob('/api/exports/archive', {
    method: 'POST',
    jsonBody: { job_ids: jobIds },
    fallbackFilename: 'whatsapp-exports.zip',
  })
}

export async function listScripts() {
  return request<{ scripts: ScriptDocumentView[] }>('/api/scripts')
}

export async function uploadScript(payload: { title?: string; file?: File; content?: string }) {
  const formData = new FormData()
  if (payload.title) {
    formData.set('title', payload.title)
  }
  if (payload.file) {
    formData.set('file', payload.file)
  }
  if (payload.content) {
    formData.set('content', payload.content)
  }

  return request<{ script: ScriptDocumentView }>('/api/scripts', {
    method: 'POST',
    body: formData,
  })
}

export async function deleteScript(scriptId: string) {
  return request<void>(`/api/scripts/${scriptId}`, { method: 'DELETE' })
}

export async function listAgentRules(params?: { accountId?: string; enabled?: boolean }) {
  const searchParams = new URLSearchParams()
  if (params?.accountId) {
    searchParams.set('account_id', params.accountId)
  }
  if (params?.enabled !== undefined) {
    searchParams.set('enabled', String(params.enabled))
  }

  const queryString = searchParams.toString()
  return request<{ rules: AgentRuleView[] }>(
    `/api/agents/rules${queryString ? `?${queryString}` : ''}`,
  )
}

export async function getAgentSettings(accountId: string) {
  const searchParams = new URLSearchParams({ account_id: accountId })
  return request<{ settings: AgentSettingsView }>(`/api/agents/settings?${searchParams.toString()}`)
}

export async function upsertAgentSettings(payload: UpsertAgentSettingsPayload) {
  return request<{ settings: AgentSettingsView }>('/api/agents/settings', {
    method: 'POST',
    jsonBody: payload,
  })
}

export async function upsertAgentRule(payload: UpsertAgentRulePayload) {
  return request<{ rule: AgentRuleView }>('/api/agents/rules', {
    method: 'POST',
    jsonBody: payload,
  })
}

export async function enableAgentRule(ruleId: string) {
  return request<{ rule: AgentRuleView }>(`/api/agents/rules/${ruleId}/enable`, {
    method: 'POST',
  })
}

export async function disableAgentRule(ruleId: string) {
  return request<{ rule: AgentRuleView }>(`/api/agents/rules/${ruleId}/disable`, {
    method: 'POST',
  })
}

export async function deleteAgentRule(ruleId: string) {
  return request<void>(`/api/agents/rules/${ruleId}`, { method: 'DELETE' })
}

export async function listAgentRuns(params?: {
  accountId?: string
  ruleId?: string
  chatId?: string
  status?: AgentRunStatus | ''
  limit?: number
  offset?: number
}) {
  const searchParams = new URLSearchParams()
  if (params?.accountId) {
    searchParams.set('account_id', params.accountId)
  }
  if (params?.ruleId) {
    searchParams.set('rule_id', params.ruleId)
  }
  if (params?.chatId) {
    searchParams.set('chat_id', params.chatId)
  }
  if (params?.status) {
    searchParams.set('status', params.status)
  }
  if (params?.limit) {
    searchParams.set('limit', String(params.limit))
  }
  if (params?.offset) {
    searchParams.set('offset', String(params.offset))
  }

  const queryString = searchParams.toString()
  return request<AgentRunListResponse>(`/api/agent-runs${queryString ? `?${queryString}` : ''}`)
}

export async function listSystemAgentConfigs() {
  return request<{ configs: SystemAgentConfigView[] }>('/api/admin/agent-configs')
}

export async function listAvailableSystemAgentConfigs(params?: { purpose?: AgentPurpose }) {
  const searchParams = new URLSearchParams()
  if (params?.purpose) {
    searchParams.set('purpose', params.purpose)
  }

  const queryString = searchParams.toString()
  return request<{ configs: SystemAgentConfigView[] }>(
    `/api/agent-configs${queryString ? `?${queryString}` : ''}`,
  )
}

export async function upsertSystemAgentConfig(payload: UpsertSystemAgentConfigPayload) {
  return request<{ config: SystemAgentConfigView }>('/api/admin/agent-configs', {
    method: 'POST',
    jsonBody: payload,
  })
}

export async function deleteSystemAgentConfig(configId: string) {
  return request<void>(`/api/admin/agent-configs/${configId}`, { method: 'DELETE' })
}

export async function generateAgentRun(payload: GenerateAgentRunPayload) {
  return request<{ run: AgentRunView }>('/api/agent-runs/generate', {
    method: 'POST',
    jsonBody: payload,
  })
}

export async function streamGenerateAgentRun(
  payload: GenerateAgentRunPayload,
  handlers: AgentRunStreamHandlers,
) {
  const response = await fetch(`${baseUrl}/api/agent-runs/generate/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    let message = '请求失败'
    try {
      const errorPayload = (await response.json()) as { error?: string }
      if (errorPayload.error) {
        message = errorPayload.error
      }
    } catch {
      message = response.statusText || message
    }
    throw new ApiError(response.status, message)
  }

  if (!response.body) {
    throw new ApiError(response.status, '浏览器不支持流式读取')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let streamError: Error | undefined

  const dispatchEvent = (rawEvent: string) => {
    const lines = rawEvent.split(/\r?\n/)
    let eventName = 'message'
    const dataLines: string[] = []

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart())
      }
    }

    if (dataLines.length === 0) {
      return
    }

    const eventPayload = JSON.parse(dataLines.join('\n')) as {
      run?: AgentRunView
      text?: string
      message?: string
    }

    if (eventName === 'start' && eventPayload.run) {
      handlers.onStart?.(eventPayload.run)
      return
    }
    if (eventName === 'delta') {
      handlers.onDelta?.(eventPayload.text ?? '')
      return
    }
    if (eventName === 'complete' && eventPayload.run) {
      handlers.onComplete?.(eventPayload.run)
      return
    }
    if (eventName === 'error') {
      const message = eventPayload.message || 'Agent 生成失败'
      handlers.onError?.(message, eventPayload.run)
      streamError = new Error(message)
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })

    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() ?? ''
    for (const event of events) {
      dispatchEvent(event)
    }

    if (done) {
      break
    }
  }

  if (buffer.trim()) {
    dispatchEvent(buffer)
  }
  if (streamError) {
    throw streamError
  }
}

export async function translateText(payload: TranslateTextPayload) {
  return request<{ translation: TranslationView }>('/api/agent-translations', {
    method: 'POST',
    jsonBody: payload,
  })
}

export async function analyzeStatusCard(payload: AnalyzeStatusCardPayload) {
  return request<{ status_card: StatusCardView }>('/api/agent-status-card', {
    method: 'POST',
    jsonBody: payload,
  })
}

export async function getStatusCard(chatId: string) {
  const searchParams = new URLSearchParams({ chat_id: chatId })
  return request<{ status_card: StatusCardView | null }>(`/api/agent-status-card?${searchParams.toString()}`)
}

export async function sendAgentRun(runId: string, payload?: { message_text?: string }) {
  return request<{ run: AgentRunView }>(`/api/agent-runs/${runId}/send`, {
    method: 'POST',
    jsonBody: payload ?? {},
  })
}

export async function listAuditEntries(params?: {
  action?: string
  targetType?: string
  targetId?: string
  outcome?: AuditEntry['outcome'] | ''
  actorType?: AuditEntry['actor_type'] | ''
  limit?: number
  offset?: number
}) {
  const searchParams = new URLSearchParams()
  if (params?.action) {
    searchParams.set('action', params.action)
  }
  if (params?.targetType) {
    searchParams.set('target_type', params.targetType)
  }
  if (params?.targetId) {
    searchParams.set('target_id', params.targetId)
  }
  if (params?.outcome) {
    searchParams.set('outcome', params.outcome)
  }
  if (params?.actorType) {
    searchParams.set('actor_type', params.actorType)
  }
  if (params?.limit) {
    searchParams.set('limit', String(params.limit))
  }
  if (params?.offset) {
    searchParams.set('offset', String(params.offset))
  }

  const queryString = searchParams.toString()
  return request<AuditListResponse>(`/api/audit${queryString ? `?${queryString}` : ''}`)
}

async function downloadBlob(
  path: string,
  options: {
    method?: 'GET' | 'POST'
    jsonBody?: unknown
    fallbackFilename: string
  },
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.jsonBody !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.jsonBody !== undefined ? JSON.stringify(options.jsonBody) : undefined,
  })

  if (!response.ok) {
    throw new ApiError(response.status, response.statusText || '下载导出文件失败')
  }

  const disposition = response.headers.get('content-disposition') ?? ''
  const match = disposition.match(/filename="([^"]+)"/i)
  const filename = match?.[1] ?? options.fallbackFilename

  return {
    blob: await response.blob(),
    filename,
  }
}
