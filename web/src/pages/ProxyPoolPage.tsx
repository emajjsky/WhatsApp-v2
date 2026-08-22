import { type FormEvent, useEffect, useState } from 'react'
import {
  createLocalProxy,
  deleteLocalProxy,
  listLocalProxies,
  testLocalProxy,
  updateLocalProxy,
  type LocalProxyView,
} from '../api/client'
import { Icon } from '../components/Icon'

type Scheme = 'http' | 'https' | 'socks5'

const initialForm = {
  name: '',
  scheme: 'socks5' as Scheme,
  host: '',
  port: '',
  username: '',
  password: '',
  exitIP: '',
  country: '',
  expiresAt: '',
  connectionString: '',
}

function toDateTimeLocal(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function ProxyPoolPage() {
  const [items, setItems] = useState<LocalProxyView[]>([])
  const [form, setForm] = useState(initialForm)
  const [editingID, setEditingID] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyID, setBusyID] = useState<string>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    try {
      const response = await listLocalProxies()
      setItems(response.proxies)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载代理池失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const payload = {
        name: form.name.trim(),
        scheme: form.scheme,
        host: form.host.trim(),
        port: Number(form.port),
        username: form.username.trim() || undefined,
        exit_ip: form.exitIP.trim() || undefined,
        country: form.country.trim() || undefined,
        expires_at: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
      }
      if (editingID) {
        await updateLocalProxy(editingID, { ...payload, password: form.password.trim() || undefined })
        setNotice('代理已更新，账号绑定关系保持不变')
      } else {
        await createLocalProxy({ ...payload, password: form.password })
        setNotice('代理已保存到本机')
      }
      setForm(initialForm)
      setEditingID(undefined)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存代理失败')
    } finally {
      setSaving(false)
    }
  }

  function handleEdit(item: LocalProxyView) {
    setEditingID(item.id)
    setForm({
      name: item.name,
      scheme: item.scheme,
      host: item.host,
      port: String(item.port),
      username: item.username ?? '',
      password: '',
      exitIP: item.exit_ip ?? '',
      country: item.country ?? '',
      expiresAt: item.expires_at ? toDateTimeLocal(item.expires_at) : '',
      connectionString: '',
    })
    setError('')
    setNotice('已载入代理配置，密码留空则保持原密码')
  }

  function cancelEdit() {
    setEditingID(undefined)
    setForm(initialForm)
    setError('')
    setNotice('已取消编辑')
  }

  function parseConnectionString() {
    const value = form.connectionString.trim()
    if (!value) return
    try {
      const separator = value.indexOf('://')
      if (separator < 1) throw new Error('缺少协议')
      const sourceScheme = value.slice(0, separator).toLowerCase()
      let raw = value
      if (sourceScheme === 'socks' && !value.slice(separator + 3).includes('@')) {
        raw = `socks5://${window.atob(value.slice(separator + 3))}`
      } else if (sourceScheme === 'socks') {
        raw = `socks5://${value.slice(separator + 3)}`
      }
      const parsed = new URL(raw)
      if (!parsed.hostname || !parsed.port) throw new Error('缺少地址或端口')
      setForm((current) => ({
        ...current,
        scheme: (parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.protocol.slice(0, -1) : 'socks5') as Scheme,
        host: parsed.hostname,
        port: parsed.port,
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
      }))
      setNotice('已解析代理连接串，请核对后保存')
      setError('')
    } catch {
      setError('代理连接串无法解析，请确认格式为 socks://编码串 或 socks5://账号:密码@地址:端口')
    }
  }

  async function handleTest(item: LocalProxyView) {
    setBusyID(item.id)
    setError('')
    setNotice('')
    try {
      const response = await testLocalProxy(item.id)
      setNotice(`${item.name} 连接正常，出口 IP：${response.proxy.exit_ip ?? '未返回'}`)
      await load()
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : '代理检测失败')
      await load()
    } finally {
      setBusyID(undefined)
    }
  }

  async function handleDelete(item: LocalProxyView) {
    if (!window.confirm(`确定删除代理“${item.name}”吗？\n\n删除会同时解除它与当前电脑上 WhatsApp 账号的绑定，但不会删除账号或聊天记录。`)) return
    setBusyID(item.id)
    setError('')
    try {
      await deleteLocalProxy(item.id)
      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除代理失败')
    } finally {
      setBusyID(undefined)
    }
  }

  async function handleToggle(item: LocalProxyView) {
    setBusyID(item.id)
    setError('')
    setNotice('')
    try {
      await updateLocalProxy(item.id, { enabled: !item.enabled })
      setNotice(item.enabled ? `${item.name} 已停用` : `${item.name} 已启用`)
      await load()
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : '更新代理状态失败')
    } finally {
      setBusyID(undefined)
    }
  }

  return (
    <div className="page page-proxies">
      <div className="page-heading">
        <div>
          <p className="eyebrow">本机连接配置</p>
          <h1>IP 代理池</h1>
        </div>
        <span className="subtle-text">代理账号密码只保存在当前电脑</span>
      </div>

      <section className="proxy-workspace">
        <article className="panel proxy-form-panel">
          <div className="panel-heading"><div><p className="eyebrow">{editingID ? '编辑代理' : '新增代理'}</p><h3>{editingID ? '更新固定出口配置' : '添加一个固定出口'}</h3></div></div>
          <form className="form-grid proxy-form-grid" onSubmit={handleSubmit}>
            <label className="field"><span>名称</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="印尼代理 01" required /></label>
            <label className="field proxy-connection-field"><span>完整连接串（可选）</span><input value={form.connectionString} onChange={(e) => setForm({ ...form, connectionString: e.target.value })} placeholder="粘贴 socks://..." /><button className="secondary-button" type="button" onClick={parseConnectionString}>解析</button></label>
            <label className="field"><span>协议</span><select value={form.scheme} onChange={(e) => setForm({ ...form, scheme: e.target.value as Scheme })}><option value="socks5">SOCKS5</option><option value="http">HTTP</option><option value="https">HTTPS</option></select></label>
            <label className="field"><span>代理地址</span><input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="st01.loongproxy.com" required /></label>
            <label className="field"><span>代理端口</span><input type="number" min="1" max="65535" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder="50014" required /></label>
            <label className="field"><span>账号</span><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
            <label className="field"><span>密码{editingID ? '（留空不修改）' : ''}</span><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editingID} /></label>
            <label className="field"><span>出口 IP</span><input value={form.exitIP} onChange={(e) => setForm({ ...form, exitIP: e.target.value })} placeholder="可选，用于展示" /></label>
            <label className="field"><span>国家地区</span><input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="印度尼西亚-日惹" /></label>
            <label className="field"><span>有效期</span><input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></label>
            <div className="button-row"><button className="primary-button" type="submit" disabled={saving}><Icon name={editingID ? 'check' : 'plus'} />{saving ? '保存中...' : editingID ? '保存修改' : '保存到本机'}</button>{editingID ? <button className="secondary-button" type="button" onClick={cancelEdit}>取消编辑</button> : null}</div>
          </form>
        </article>

        <article className="panel proxy-saved-panel">
          <div className="panel-heading"><div><p className="eyebrow">已保存</p><h3>本机代理列表</h3></div><span className="subtle-text">{loading ? '加载中...' : `${items.length} 个代理`}</span></div>
          <div className="proxy-list-scroll">
            {items.length === 0 && !loading ? <p className="subtle-text proxy-empty-state">还没有添加代理。</p> : <div className="proxy-list">{items.map((item) => (
              <div className="proxy-row" key={item.id}>
                <div><strong>{item.name}</strong><span>{item.scheme.toUpperCase()} · {item.host}:{item.port}</span><span className={item.enabled ? 'proxy-status-enabled' : 'proxy-status-disabled'}>{item.enabled ? '已启用' : '已停用'}</span></div>
                <div><span>{item.country ?? '未设置地区'}</span><span>{item.exit_ip ? `出口 ${item.exit_ip}` : '未检测'}</span>{item.last_check_error ? <span className="proxy-error-text">检测失败：{item.last_check_error}</span> : null}</div>
                <div className="button-row"><button className="secondary-button" type="button" disabled={busyID === item.id} onClick={() => handleEdit(item)}><Icon name="edit" />编辑</button><button className="secondary-button" type="button" disabled={busyID === item.id} onClick={() => void handleTest(item)}><Icon name="shield" />{busyID === item.id ? '检测中...' : '检测'}</button><button className="secondary-button" type="button" disabled={busyID === item.id} onClick={() => void handleToggle(item)}>{item.enabled ? '停用' : '启用'}</button><button className="danger-button" type="button" disabled={busyID === item.id} onClick={() => void handleDelete(item)}><Icon name="delete" />删除</button></div>
              </div>
            ))}</div>}
          </div>
        </article>
      </section>

      <section className="panel proxy-help-panel">
        <div className="panel-heading"><div><p className="eyebrow">使用规则</p><h3>账号连接说明</h3></div></div>
        <div className="proxy-rules-grid">
          <div className="proxy-rule-item"><strong>绑定后</strong><p>账号直接使用所选出口 IP，不依赖 Clash。</p></div>
          <div className="proxy-rule-item"><strong>不绑定</strong><p>账号使用本机网络或 Clash 系统代理。</p></div>
          <div className="proxy-rule-item"><strong>代理失败</strong><p>不会自动回退到本机 IP。</p></div>
          <div className="proxy-rule-item"><strong>切换代理</strong><p>退出并重新连接账号后生效。</p></div>
        </div>
      </section>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  )
}
