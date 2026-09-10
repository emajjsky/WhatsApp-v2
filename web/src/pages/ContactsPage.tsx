import { useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  listAccounts,
  listContacts,
  updateContactNote,
  type AccountView,
  type ContactView,
} from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { Icon } from '../components/Icon'

export function ContactsPage() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [accountId, setAccountId] = useState('')
  const [contacts, setContacts] = useState<ContactView[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const selected = useMemo(
    () => contacts.find((contact) => contact.id === selectedId) ?? contacts[0],
    [contacts, selectedId],
  )

  useEffect(() => {
    void listAccounts()
      .then((response) => {
        setAccounts(response.accounts)
        setAccountId(response.accounts[0]?.id ?? '')
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '加载账号失败'))
  }, [])

  useEffect(() => {
    if (!accountId) {
      setContacts([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(undefined)
    void listContacts({ accountId, query: deferredQuery.trim() || undefined, limit: 2000 })
      .then((response) => {
        if (cancelled) return
        setContacts(response.contacts)
        setSelectedId((current) => response.contacts.some((item) => item.id === current) ? current : response.contacts[0]?.id ?? '')
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '加载联系人失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [accountId, deferredQuery])

  useEffect(() => {
    setNote(selected?.note ?? '')
    setNotice(undefined)
  }, [selected])

  async function saveNote() {
    if (!selected || saving) return
    setSaving(true)
    setError(undefined)
    try {
      const response = await updateContactNote(selected.id, note)
      setContacts((current) => current.map((item) => item.id === response.contact.id ? response.contact : item))
      setNotice('备注已保存')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存备注失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page page-contacts">
      <section className="panel contacts-directory">
        <header className="contacts-toolbar">
          <div>
            <p className="eyebrow">联系人</p>
            <h2>{loading ? '同步中' : `${contacts.length} 位联系人`}</h2>
          </div>
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
              <span className="contact-avatar">{contact.display_name.trim()[0]?.toUpperCase() || '联'}</span>
              <span className="contact-list-copy">
                <strong>{contact.display_name}</strong>
                <small>{contact.phone_number || contact.wa_jid}</small>
                <span>{contact.note || '暂无备注'}</span>
              </span>
              {contact.is_business ? <span className="contact-business">企业</span> : null}
            </button>
          ))}
          {!loading && !contacts.length ? <EmptyPanel title="没有联系人" description="联系人会在 WhatsApp 消息同步后显示。" /> : null}
        </div>
      </section>

      <section className="panel contact-detail-panel">
        {selected ? (
          <>
            <header className="contact-profile-head">
              <span className="contact-avatar large">{selected.display_name.trim()[0]?.toUpperCase() || '联'}</span>
              <div><h2>{selected.display_name}</h2><p>{selected.phone_number || selected.wa_jid}</p></div>
              {selected.chat_id ? (
                <button className="primary-button" type="button" onClick={() => navigate(`/chats?account_id=${selected.account_id}&chat_id=${selected.chat_id}`)}>
                  <Icon name="chat" />进入对话
                </button>
              ) : null}
            </header>
            <dl className="contact-facts">
              <div><dt>WhatsApp ID</dt><dd>{selected.wa_jid}</dd></div>
              <div><dt>账号类型</dt><dd>{selected.is_business ? 'WhatsApp Business' : '普通账号'}</dd></div>
              <div><dt>最近沟通</dt><dd>{formatContactTime(selected.last_message_at)}</dd></div>
            </dl>
            <section className="contact-label-section">
              <span>会话标签</span>
              <div className="chat-label-row">
                {selected.labels.length ? selected.labels.map((label) => <span key={label.id} className="chat-label-chip" style={{ '--label-color': label.color } as CSSProperties}>{label.name}</span>) : <small>暂无标签，可在对话页添加</small>}
              </div>
            </section>
            <label className="field contact-note-field">
              <span>联系人备注</span>
              <textarea rows={8} value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录客户身份、偏好、跟进事项等" />
            </label>
            <div className="contact-detail-actions">
              <button className="primary-button" type="button" onClick={() => void saveNote()} disabled={saving}>{saving ? '保存中...' : '保存备注'}</button>
              {notice ? <span className="inline-success">{notice}</span> : null}
            </div>
          </>
        ) : <EmptyPanel title="选择联系人" description="左侧选择联系人后查看资料并维护备注。" />}
        {error ? <div className="error-banner">{error}</div> : null}
      </section>
    </div>
  )
}

function formatContactTime(value?: string) {
  if (!value) return '暂无记录'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
