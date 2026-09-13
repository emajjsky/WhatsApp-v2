import { type FormEvent, useCallback, useEffect, useState } from 'react'
import {
  createLocalProxy,
  deleteLocalProxy,
  getDesktopProxyRuntimeStatus,
  listLocalProxies,
  testLocalProxy,
  updateLocalProxy,
  type DesktopProxyRuntimeView,
  type LocalProxyView,
} from '../api/client'
import { Icon } from '../components/Icon'

type Scheme = 'http' | 'https' | 'socks5'
type RouteMode = 'auto' | 'direct' | 'system'

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
  routeMode: 'auto' as RouteMode,
  connectionString: '',
}

const mockRuntimeStatus: DesktopProxyRuntimeView = {
  mode: 'auto',
  status: 'detected',
  proxy_url: 'http://127.0.0.1:7890',
  proxy_display_url: 'http://127.0.0.1:7890',
  proxy_rules: 'PROXY 127.0.0.1:7890',
  endpoint_reachable: true,
  exit_ip: '188.166.248.178',
  route_key: 'mock-system-proxy',
  checked_at: '2026-09-13T11:42:02+08:00',
  message: '已检测到系统代理',
}

const mockLocalProxies: LocalProxyView[] = [
  createMockProxy(1, '202.155.70.75', '印度尼西亚-雅加达', 'system'),
  createMockProxy(2, '110.44.172.216', '印度尼西亚-日惹', 'auto'),
  createMockProxy(3, '45.198.228.105', '印度尼西亚-泗水', 'auto'),
  createMockProxy(4, '45.198.138.32', '印度尼西亚-万隆', 'direct'),
  createMockProxy(5, '178.93.218.53', '印度尼西亚-雅加达', 'auto'),
  createMockProxy(6, '103.28.52.86', '印度尼西亚-棉兰', 'system'),
  createMockProxy(7, '36.95.142.18', '印度尼西亚-巴厘岛', 'auto', false),
  createMockProxy(8, '182.253.124.77', '印度尼西亚-三宝垄', 'auto'),
]

function toDateTimeLocal(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function createMockProxy(
  index: number,
  exitIP: string,
  country: string,
  routeMode: RouteMode,
  enabled = true,
): LocalProxyView {
  const suffix = String(index).padStart(2, '0')
  return {
    id: `mock-proxy-${suffix}`,
    name: `印尼代理 ${suffix}`,
    scheme: 'socks5',
    host: `static-${suffix}.s5proxy.example`,
    port: 6600 + index,
    username: `customer_${suffix}`,
    exit_ip: exitIP,
    country,
    enabled,
    expires_at: '2026-10-13T23:59:59+08:00',
    last_checked_at: index === 8 ? undefined : `2026-09-${String(13 - index).padStart(2, '0')}T16:20:00+08:00`,
    last_check_error: index === 8 ? '等待首次链路检测' : undefined,
    has_credentials: true,
    route_mode: routeMode,
    created_at: '2026-09-01T09:00:00+08:00',
    updated_at: '2026-09-13T11:42:02+08:00',
  }
}

function waitForMockAction() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 360))
}

export function ProxyPoolPage() {
  const mockMode = import.meta.env.DEV && new URLSearchParams(window.location.search).get('mock') === '1'
  const [items, setItems] = useState<LocalProxyView[]>(mockMode ? mockLocalProxies : [])
  const [form, setForm] = useState(initialForm)
  const [editingID, setEditingID] = useState<string>()
  const [proxyModalOpen, setProxyModalOpen] = useState(false)
  const [loading, setLoading] = useState(!mockMode)
  const [saving, setSaving] = useState(false)
  const [busyID, setBusyID] = useState<string>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [runtimeStatus, setRuntimeStatus] = useState<DesktopProxyRuntimeView | undefined>(mockMode ? mockRuntimeStatus : undefined)
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const isDesktopRuntime = mockMode || Boolean((window as Window & { desktopRuntime?: unknown }).desktopRuntime)

  const loadRuntimeStatus = useCallback(async (force = false) => {
    if (!isDesktopRuntime) return
    if (mockMode) {
      setRuntimeLoading(force)
      if (force) {
        await waitForMockAction()
      }
      setRuntimeStatus({ ...mockRuntimeStatus, checked_at: new Date().toISOString() })
      setRuntimeLoading(false)
      return
    }
    setRuntimeLoading(true)
    setRuntimeStatus((current) => ({
      mode: current?.mode ?? 'auto',
      status: 'checking',
      proxy_url: current?.proxy_url ?? '',
      proxy_display_url: current?.proxy_display_url ?? '',
      proxy_rules: current?.proxy_rules ?? '',
      endpoint_reachable: false,
      exit_ip: '',
      route_key: '',
      checked_at: '',
      message: force ? '正在强制重新检测本机系统代理...' : '正在检测本机系统代理...',
    }))
    try {
      const response = await getDesktopProxyRuntimeStatus(force)
      setRuntimeStatus(response)
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : '读取本机代理状态失败'
      setRuntimeStatus((current) => ({
        mode: current?.mode ?? 'auto',
        status: 'error',
        proxy_url: current?.proxy_url ?? '',
        proxy_display_url: current?.proxy_display_url ?? '',
        proxy_rules: current?.proxy_rules ?? '',
        endpoint_reachable: false,
        exit_ip: '',
        route_key: '',
        checked_at: new Date().toISOString(),
        message,
      }))
    } finally {
      setRuntimeLoading(false)
    }
  }, [isDesktopRuntime, mockMode])

  const load = useCallback(async () => {
    if (mockMode) {
      setLoading(false)
      return
    }
    try {
      const response = await listLocalProxies()
      setItems(response.proxies)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载代理池失败')
    } finally {
      setLoading(false)
    }
  }, [mockMode])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!isDesktopRuntime) return
    void loadRuntimeStatus()
    if (mockMode) return
    const timer = window.setInterval(() => {
      void loadRuntimeStatus(true)
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [isDesktopRuntime, loadRuntimeStatus, mockMode])

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
        route_mode: form.routeMode,
      }
      if (mockMode && editingID) {
        setItems((current) => current.map((item) => item.id === editingID ? {
          ...item,
          ...payload,
          has_credentials: Boolean(form.password.trim()) || item.has_credentials,
          updated_at: new Date().toISOString(),
        } : item))
        setNotice('代理已更新，账号绑定关系保持不变')
      } else if (mockMode) {
        const timestamp = new Date().toISOString()
        setItems((current) => [{
          id: `mock-proxy-${Date.now()}`,
          ...payload,
          enabled: true,
          has_credentials: Boolean(form.username.trim() || form.password.trim()),
          created_at: timestamp,
          updated_at: timestamp,
        }, ...current])
        setNotice('代理已保存到本机演示列表')
      } else if (editingID) {
        await updateLocalProxy(editingID, { ...payload, password: form.password.trim() || undefined })
        setNotice('代理已更新，账号绑定关系保持不变')
      } else {
        await createLocalProxy({ ...payload, password: form.password })
        setNotice('代理已保存到本机')
      }
      setForm(initialForm)
      setEditingID(undefined)
      setProxyModalOpen(false)
      if (!mockMode) {
        await load()
      }
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
      routeMode: item.route_mode ?? 'auto',
      connectionString: '',
    })
    setProxyModalOpen(true)
    setError('')
    setNotice('已载入代理配置，密码留空则保持原密码')
  }

  function openCreateModal() {
    setEditingID(undefined)
    setForm(initialForm)
    setError('')
    setNotice('')
    setProxyModalOpen(true)
  }

  function closeProxyModal() {
    if (saving) return
    setEditingID(undefined)
    setForm(initialForm)
    setError('')
    setNotice('')
    setProxyModalOpen(false)
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
      if (mockMode) {
        await waitForMockAction()
        const checkedAt = new Date().toISOString()
        setItems((current) => current.map((candidate) => candidate.id === item.id ? {
          ...candidate,
          exit_ip: candidate.exit_ip || '202.155.70.75',
          last_checked_at: checkedAt,
          last_check_error: undefined,
          updated_at: checkedAt,
        } : candidate))
        setNotice(`${item.name} 连接正常，出口 IP：${item.exit_ip ?? '202.155.70.75'}`)
        return
      }
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
      if (mockMode) {
        setItems((current) => current.filter((candidate) => candidate.id !== item.id))
        setNotice(`${item.name} 已从演示列表删除`)
      } else {
        await deleteLocalProxy(item.id)
        await load()
      }
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
      if (mockMode) {
        setItems((current) => current.map((candidate) => candidate.id === item.id ? {
          ...candidate,
          enabled: !candidate.enabled,
          updated_at: new Date().toISOString(),
        } : candidate))
      } else {
        await updateLocalProxy(item.id, { enabled: !item.enabled })
      }
      setNotice(item.enabled ? `${item.name} 已停用` : `${item.name} 已启用`)
      if (!mockMode) {
        await load()
      }
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : '更新代理状态失败')
    } finally {
      setBusyID(undefined)
    }
  }

  return (
    <div className="page page-proxies proxy-pool-redesign">
      <div className="page-heading">
        <div>
          <p className="eyebrow">本机连接配置</p>
          <h1>IP 代理池</h1>
        </div>
        <div className="proxy-page-actions">
          <span className="subtle-text">代理账号密码只保存在当前电脑</span>
          <button className="primary-button" type="button" onClick={openCreateModal}><Icon name="plus" />添加代理</button>
        </div>
      </div>

      {isDesktopRuntime ? (
        <section className="panel desktop-proxy-runtime-panel">
          <div className="desktop-proxy-runtime-heading">
            <div>
              <p className="eyebrow">第一层：本机网络</p>
              <h3>Clash / 系统代理状态</h3>
            </div>
            <div className="desktop-proxy-runtime-actions">
              <span className={`proxy-runtime-badge proxy-runtime-${runtimeStatus?.status ?? 'checking'}`}>
                {runtimeLoading || runtimeStatus?.status === 'checking' ? '检测中' : runtimeStatusLabel(runtimeStatus?.status)}
              </span>
              <button className="secondary-button" type="button" disabled={runtimeLoading} onClick={() => void loadRuntimeStatus(true)}>
                <Icon name="shield" />
                {runtimeLoading ? '检测中...' : '检测第一层 Clash'}
              </button>
            </div>
          </div>
          <div className="desktop-proxy-runtime-grid">
            <div><span>本机连接模式</span><strong>{runtimeModeLabel(runtimeStatus?.mode)}</strong></div>
            <div><span>Clash 入口</span><strong>{runtimeStatus?.endpoint_reachable ? '已发现，端口可达' : runtimeStatus?.status === 'direct' ? '未发现 Windows 规则' : '未确认'}</strong></div>
            <div><span>第一层地址</span><strong className="proxy-runtime-value">{runtimeStatus?.proxy_display_url || '无'}</strong></div>
            <div><span>第一层出口 IP</span><strong>{runtimeStatus?.exit_ip || '未返回'}</strong></div>
            <div><span>最近检测</span><strong>{runtimeStatus?.checked_at ? formatDateTime(runtimeStatus.checked_at) : '尚未完成'}</strong></div>
          </div>
          <div className="desktop-proxy-runtime-rules">
            <span>Clash 代理规则</span>
            <code>{runtimeStatus?.proxy_rules || '等待检测结果'}</code>
          </div>
        </section>
      ) : null}

      <section className="panel proxy-library-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">第二层：账号网络</p><h3>账号独立代理</h3></div>
          <span className="subtle-text">{loading ? '加载中...' : `${items.length} 个代理`}</span>
        </div>
        <div className="proxy-list-scroll">
          {items.length === 0 && !loading ? <p className="subtle-text proxy-empty-state">还没有添加代理，点击右上角“添加代理”开始配置。</p> : (
            <div className="proxy-card-grid">{items.map((item) => (
              <article className="proxy-card" key={item.id}>
                <header>
                  <strong>{item.name}</strong>
                  <span className={item.enabled ? 'proxy-card-status enabled' : 'proxy-card-status disabled'}>{item.enabled ? '已启用' : '已停用'}</span>
                </header>
                <p className="proxy-card-endpoint">{item.scheme.toUpperCase()} · {item.host}:{item.port}</p>
                <dl>
                  <div><dt>出口 IP</dt><dd>{item.exit_ip || '未检测'}</dd></div>
                  <div><dt>地区</dt><dd>{item.country || '未设置'}</dd></div>
                  <div><dt>连接方式</dt><dd>{routeModeLabel(item.route_mode)}</dd></div>
                  <div><dt>账号认证</dt><dd>{item.has_credentials ? '已保存' : '未配置'}</dd></div>
                </dl>
                <p className={`proxy-card-check ${item.last_check_error ? 'failed' : item.last_checked_at ? 'passed' : ''}`}>{proxyCheckLabel(item)}</p>
                {item.last_check_error ? <p className="proxy-card-error" title={item.last_check_error}>{item.last_check_error}</p> : null}
                <footer>
                  <button className="secondary-button" type="button" disabled={busyID === item.id} onClick={() => handleEdit(item)}><Icon name="edit" />编辑</button>
                  <button className="secondary-button" title="检测当前静态代理到 WhatsApp 的完整连接路径" type="button" disabled={busyID === item.id} onClick={() => void handleTest(item)}><Icon name="shield" />{busyID === item.id ? '检测中...' : '检测链路'}</button>
                  <button className="secondary-button" type="button" disabled={busyID === item.id} onClick={() => void handleToggle(item)}>{item.enabled ? '停用' : '启用'}</button>
                  <button className="danger-button" type="button" disabled={busyID === item.id} onClick={() => void handleDelete(item)}><Icon name="delete" />删除</button>
                </footer>
              </article>
            ))}</div>
          )}
        </div>
      </section>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      {proxyModalOpen ? (
        <div className="account-modal-backdrop proxy-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeProxyModal()}>
          <section className="account-modal proxy-modal" role="dialog" aria-modal="true" aria-labelledby="proxy-modal-title">
            <header className="account-modal-header">
              <div><p className="eyebrow">{editingID ? '编辑代理' : '新增代理'}</p><h2 id="proxy-modal-title">{editingID ? '更新固定出口配置' : '添加固定出口'}</h2></div>
              <button className="secondary-button account-modal-close" type="button" onClick={closeProxyModal}>关闭</button>
            </header>
            <div className="account-modal-body">
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
                <label className="field"><span>连接方式</span><select value={form.routeMode} onChange={(e) => setForm({ ...form, routeMode: e.target.value as RouteMode })}><option value="auto">自动选择（有 Clash 就链式）</option><option value="direct">直接连接账号代理</option><option value="system">强制链式（必须经过 Clash）</option></select></label>
                <div className="button-row"><button className="primary-button" type="submit" disabled={saving}><Icon name={editingID ? 'check' : 'plus'} />{saving ? '保存中...' : editingID ? '保存修改' : '保存到本机'}</button><button className="secondary-button" type="button" onClick={closeProxyModal} disabled={saving}>取消</button></div>
              </form>
              {notice ? <div className="success-banner">{notice}</div> : null}
              {error ? <div className="error-banner">{error}</div> : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

function routeModeLabel(value: LocalProxyView['route_mode']) {
  switch (value) {
    case 'direct':
      return '直连'
    case 'system':
      return '强制链式'
    default:
      return '自动链式'
  }
}

function runtimeModeLabel(value: DesktopProxyRuntimeView['mode'] | undefined) {
  switch (value) {
    case 'direct':
      return '直连'
    case 'manual':
      return '手动代理'
    default:
      return '自动检测'
  }
}

function runtimeStatusLabel(value: DesktopProxyRuntimeView['status'] | undefined) {
  switch (value) {
    case 'detected':
      return '已检测到'
    case 'direct':
      return '直连生效'
    case 'manual':
      return '手动生效'
    case 'unavailable':
      return '不可用'
    case 'error':
      return '检测失败'
    default:
      return '待检测'
  }
}

function proxyCheckLabel(item: LocalProxyView) {
  if (item.last_check_error) return '链路检测失败'
  if (item.last_checked_at) return `链路检测通过 · ${formatDateTime(item.last_checked_at)}`
  return '尚未检测真实链路'
}

function formatDateTime(value?: string) {
  if (!value) return '未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未记录'
  return date.toLocaleString('zh-CN', { hour12: false })
}
