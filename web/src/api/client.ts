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

export type ExportFormat = 'json' | 'markdown' | 'html'
export type ExportStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface ExportJobView {
  id: string
  account_id: string
  chat_id: string
  scope_type: 'chat'
  format: ExportFormat
  include_media: boolean
  status: ExportStatus
  artifact_path?: string
  error_message?: string
  created_at: string
  started_at?: string
  completed_at?: string
}

export type AgentReplyMode = 'suggest' | 'auto_send'
export type AgentMatchMode = 'any' | 'all'
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

export interface AgentRuleView {
  id: string
  account_id: string
  name: string
  enabled: boolean
  scope_filter: AgentScopeFilter
  trigger_filter: AgentTriggerFilter
  reply_mode: AgentReplyMode
  cooldown_seconds: number
  max_auto_replies_per_thread: number
  blacklist_filter: AgentBlacklistFilter
  prompt_template: string
  knowledge_binding?: AgentKnowledgeBinding
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

export interface UpsertAgentRulePayload {
  id?: string
  account_id: string
  name: string
  enabled: boolean
  scope_filter: AgentScopeFilter
  trigger_filter: AgentTriggerFilter
  reply_mode: AgentReplyMode
  cooldown_seconds: number
  max_auto_replies_per_thread: number
  blacklist_filter: AgentBlacklistFilter
  prompt_template: string
  knowledge_binding?: AgentKnowledgeBinding
}

export interface CreateAccountPayload {
  display_name: string
  phone_number?: string
  platform_label?: string
}

interface RequestOptions extends RequestInit {
  jsonBody?: unknown
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
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    body: options.jsonBody !== undefined ? JSON.stringify(options.jsonBody) : options.body,
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
}

export async function getHealth() {
  return request<HealthResponse>('/healthz')
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
  })
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

export async function listExportJobs() {
  return request<{ jobs: ExportJobView[] }>('/api/exports')
}

export async function createExportJob(payload: {
  chat_id: string
  format: ExportFormat
  include_media: boolean
}) {
  return request<{ job: ExportJobView }>('/api/exports', {
    method: 'POST',
    jsonBody: payload,
  })
}

export function getExportArtifactUrl(jobId: string) {
  return `${baseUrl}/api/exports/${jobId}/artifact`
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

export async function listAgentRuns(params?: {
  accountId?: string
  ruleId?: string
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
