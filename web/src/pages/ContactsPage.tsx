import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getStatusCard,
  listAccounts,
  listChats,
  subscribeLiveUpdates,
  type AccountView,
  type ChatSummary,
  type StatusCardView,
} from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { Icon } from '../components/Icon'

export function ContactsPage() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [accountId, setAccountId] = useState('')
  const [contacts, setContacts] = useState<ChatSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [statusCard, setStatusCard] = useState<StatusCardView>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const selected = useMemo(
    () => contacts.find((contact) => contact.id === selectedId) ?? contacts[0],
    [contacts, selectedId],
  )

  useEffect(() => {
    void listAccounts()
      .then((response) => {
        const nextAccounts = Array.isArray(response.accounts) ? response.accounts : []
        setAccounts(nextAccounts)
        setAccountId(nextAccounts[0]?.id ?? '')
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '加载账号失败'))
  }, [])

  const loadContacts = useCallback(async (background = false) => {
    if (!accountId) {
      setContacts([])
      setLoading(false)
      return
    }
    if (!background) {
      setLoading(true)
      setError(undefined)
    }
    try {
      const response = await listChats({
        accountId,
        query: deferredQuery.trim() || undefined,
        chatType: 'direct',
        limit: 2000,
      })
      setContacts(response.chats)
      setSelectedId((current) => response.chats.some((item) => item.id === current) ? current : response.chats[0]?.id ?? '')
    } catch (loadError) {
      if (!background) setError(loadError instanceof Error ? loadError.message : '加载联系人失败')
    } finally {
      if (!background) setLoading(false)
    }
  }, [accountId, deferredQuery])

  useEffect(() => {
    void loadContacts()
  }, [loadContacts])

  useEffect(() => {
    if (!accountId) return
    const timer = window.setInterval(() => void loadContacts(true), 5000)
    return () => window.clearInterval(timer)
  }, [accountId, loadContacts])

  useEffect(() => subscribeLiveUpdates((update) => {
    if (update.account_id === accountId) void loadContacts(true)
  }), [accountId, loadContacts])

  useEffect(() => {
    if (!selected?.id) {
      setStatusCard(undefined)
      return
    }
    let cancelled = false
    const load = () => void getStatusCard(selected.id)
      .then((response) => {
        if (!cancelled) setStatusCard(response.status_card ?? undefined)
      })
      .catch(() => {
        if (!cancelled) setStatusCard(undefined)
      })
    load()
    const timer = window.setInterval(load, 8000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [selected?.id])

  return (
    <div className="page page-contacts">
      <section className="panel contacts-directory">
        <header className="contacts-toolbar">
          <div><p className="eyebrow">联系人</p><h2>{loading ? '同步中' : `${contacts.length} 位联系人`}</h2></div>
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="选择账号">
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.display_name}</option>)}
          </select>
        </header>

        <label className="contacts-search">
          <Icon name="search" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、手机号、WhatsApp ID 或备注" />
        </label>

        <div className="contacts-list">
          {contacts.map((contact) => (
            <button key={contact.id} type="button" className={`contact-list-item${selected?.id === contact.id ? ' active' : ''}`} onClick={() => setSelectedId(contact.id)}>
              <span className="contact-avatar">{getContactDisplayName(contact).trim()[0]?.toUpperCase() || '联'}</span>
              <span className="contact-list-copy">
                <strong>{getContactDisplayName(contact)}</strong>
                <small>{contact.phone_number || contact.wa_chat_jid}</small>
                {contact.note ? <span>{contact.note}</span> : null}
              </span>
              <span className="contact-list-time">{formatContactTime(contact.last_message_at)}</span>
            </button>
          ))}
          {!loading && !contacts.length ? <EmptyPanel title="没有联系人" description="联系人会在 WhatsApp 消息同步后显示。" /> : null}
        </div>
      </section>

      <section className="panel contact-detail-panel">
        {selected ? (
          <>
            <header className="contact-profile-head">
              <span className="contact-avatar large">{getContactDisplayName(selected).trim()[0]?.toUpperCase() || '联'}</span>
              <div><h2>{getContactDisplayName(selected)}</h2><p>{selected.phone_number || selected.wa_chat_jid}</p></div>
              <button className="primary-button" type="button" onClick={() => navigate(`/chats?account_id=${selected.account_id}&chat_id=${selected.id}`)}><Icon name="chat" />进入对话</button>
            </header>

            <dl className="contact-facts">
              <div><dt>WhatsApp ID</dt><dd>{selected.wa_chat_jid}</dd></div>
              <div><dt>最近沟通</dt><dd>{formatContactTime(selected.last_message_at)}</dd></div>
              <div><dt>会话标签</dt><dd>{selected.labels.length ? selected.labels.map((label) => label.name).join('、') : '暂无'}</dd></div>
            </dl>

            {selected.note ? <section className="contact-note-summary"><span>会话备注</span><p>{selected.note}</p></section> : null}

            {statusCard ? (
              <section className="contact-status-card">
                <header><strong>用户状态卡</strong><span>{statusCard.message_count} 条记录</span></header>
                <div className="contact-status-metrics">
                  <div><span>当前阶段</span><strong>{statusCard.current_stage || '未判断'}</strong></div>
                  <div><span>当前风险</span><strong>{statusCard.current_risk || '未判断'}</strong></div>
                  <div><span>客户类型</span><strong>{statusCard.customer_types.join('、') || '未判断'}</strong></div>
                </div>
                {statusCard.summary ? <div className="contact-status-copy"><span>摘要</span><p>{statusCard.summary}</p></div> : null}
                {statusCard.next_action ? <div className="contact-status-copy"><span>建议</span><p>{statusCard.next_action}</p></div> : null}
              </section>
            ) : null}

            <section className="contact-latest-message"><span>最近消息</span><p>{selected.latest_message_preview || getContactPreview(selected)}</p></section>
          </>
        ) : <EmptyPanel title="选择联系人" description="左侧选择联系人后查看资料。" />}
        {error ? <div className="error-banner">{error}</div> : null}
      </section>
    </div>
  )
}

function formatContactTime(value?: string) {
  if (!value) return '暂无记录'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function getContactDisplayName(chat: ChatSummary) {
  return chat.title?.trim() || chat.phone_number?.trim() || chat.wa_chat_jid
}

function getContactPreview(chat: ChatSummary) {
  if (chat.latest_message_type && chat.latest_message_type !== 'text') return `收到${chat.latest_message_type}消息`
  return '暂无文字消息'
}
