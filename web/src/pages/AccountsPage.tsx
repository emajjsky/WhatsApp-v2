import QRCode from 'qrcode'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import {
  createAccount,
  deleteAccount,
  getAccountProxy,
  getLocalExitIP,
  listLocalProxies,
  listAccounts,
  logoutAccount,
  setAccountProxy,
  startPairing,
  subscribeLiveUpdates,
  type AccountView,
  type AccountStatus,
  type LocalProxyView,
  type PairingMethod,
} from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { Icon } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'

const initialForm = {
  displayName: '',
  phoneNumber: '',
  platformLabel: '',
}

const mockProxyBindings: Record<string, string> = {
  'mock-account-7': 'mock-proxy-1',
  'mock-account-6': 'mock-proxy-1',
  'mock-account-5': 'mock-proxy-2',
  'mock-account-4': 'mock-proxy-2',
  'mock-account-3': 'mock-proxy-3',
}

const mockProxies: LocalProxyView[] = [
  {
    id: 'mock-proxy-1',
    name: '印尼静态 01',
    scheme: 'socks5',
    host: 'id-static.example.com',
    port: 50014,
    country: '印度尼西亚',
    exit_ip: '45.198.228.105',
    enabled: true,
    last_checked_at: '2026-09-12T13:40:00+08:00',
    has_credentials: true,
    route_mode: 'auto',
    created_at: '2026-08-20T09:00:00+08:00',
    updated_at: '2026-09-12T13:40:00+08:00',
  },
  {
    id: 'mock-proxy-2',
    name: '印尼静态 02',
    scheme: 'socks5',
    host: 'id-static-02.example.com',
    port: 50015,
    country: '印度尼西亚',
    exit_ip: '45.198.138.32',
    enabled: true,
    last_checked_at: '2026-09-12T13:39:00+08:00',
    has_credentials: true,
    route_mode: 'auto',
    created_at: '2026-08-20T09:00:00+08:00',
    updated_at: '2026-09-12T13:39:00+08:00',
  },
  {
    id: 'mock-proxy-3',
    name: '美国静态 01',
    scheme: 'socks5',
    host: 'us-static.example.com',
    port: 6688,
    country: '美国',
    exit_ip: '178.93.218.53',
    enabled: true,
    last_checked_at: '2026-09-12T13:38:00+08:00',
    has_credentials: true,
    route_mode: 'direct',
    created_at: '2026-08-20T09:00:00+08:00',
    updated_at: '2026-09-12T13:38:00+08:00',
  },
]

const mockAccountSeeds: Array<[string, string, string, string, AccountStatus]> = [
  ['mock-account-7', '售后服务群', '8613800000007', '售后 1 号机', 'connected'],
  ['mock-account-6', '印尼运营群', '6281372396886', '印尼运营', 'connected'],
  ['mock-account-5', '重点客户群', '120363144038483', '重点客户', 'connected'],
  ['mock-account-4', '客服测试号', '8613800000004', '夜班客服', 'connected'],
  ['mock-account-3', '营销备用号', '8613800000003', '营销备用', 'connected'],
  ['mock-account-2', '内容发布号', '8613800000002', '内容发布', 'reconnecting'],
  ['mock-account-1', '新建测试号', '8613800000001', '待配对', 'pending'],
  ...Array.from({ length: 15 }, (_, index) => [
    `mock-account-extra-${index + 1}`,
    `备用客服号 ${String(index + 1).padStart(2, '0')}`,
    `861380000${String(index + 10).padStart(3, '0')}`,
    index % 2 === 0 ? '客服备用' : '运营备用',
    index % 5 === 0 ? 'reconnecting' : 'connected',
  ] as [string, string, string, string, AccountStatus]),
]

const mockAccounts: AccountView[] = mockAccountSeeds.map(([id, displayName, phoneNumber, platformLabel, status], index) => ({
  id,
  display_name: displayName,
  phone_number: phoneNumber,
  platform_label: platformLabel,
  status,
  last_seen_at: `2026-09-12T13:${String(42 - index).padStart(2, '0')}:00+08:00`,
  created_at: '2026-08-25T23:25:00+08:00',
  updated_at: `2026-09-12T13:${String(42 - index).padStart(2, '0')}:00+08:00`,
  session: {
    status,
    updated_at: `2026-09-12T13:${String(42 - index).padStart(2, '0')}:00+08:00`,
    connected_at: status === 'connected' ? '2026-08-25T23:30:00+08:00' : undefined,
  },
}))

export function AccountsPage() {
  const mockMode = new URLSearchParams(window.location.search).get('mock') === '1'
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [busyAction, setBusyAction] = useState<{
    accountId: string
    method: PairingMethod | 'logout' | 'delete'
  }>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [form, setForm] = useState(initialForm)
  const [qrDataUrl, setQrDataUrl] = useState<string>()
  const [localProxies, setLocalProxies] = useState<LocalProxyView[]>([])
  const [accountProxyIDs, setAccountProxyIDs] = useState<Record<string, string>>({})
  const accountProxyIDsRef = useRef<Record<string, string>>({})
  const [selectedProxyID, setSelectedProxyID] = useState('')
  const [localTestAccounts, setLocalTestAccounts] = useState<Record<string, boolean>>({})
  const [loadingAccountProxy, setLoadingAccountProxy] = useState(false)
  const [savingAccountProxy, setSavingAccountProxy] = useState(false)
  const [localExitIP, setLocalExitIP] = useState('')
  const [modal, setModal] = useState<'create' | 'account'>()
  const [createFlowAccountId, setCreateFlowAccountId] = useState<string>()

  const selectedAccount = accounts.find((item) => item.id === selectedAccountId) ?? accounts[0]
  const isDesktopRuntime = mockMode || Boolean((window as Window & { desktopRuntime?: unknown }).desktopRuntime)
  const selectedProxy = localProxies.find((item) => item.id === selectedProxyID)
  const localTestModeSelected = Boolean(selectedAccount?.id && localTestAccounts[selectedAccount.id] && !selectedProxyID)
  const selectedProxyReady = Boolean(
    selectedProxy?.enabled && selectedProxy.last_checked_at && !selectedProxy.last_check_error,
  )
  const pairingBlocked = Boolean(
    !mockMode && isDesktopRuntime && (!selectedProxyID ? !localTestModeSelected : !selectedProxyReady),
  )
  const selectedBusyAction = busyAction && busyAction.accountId === selectedAccount?.id ? busyAction.method : undefined
  const isSelectedAccountBusy = selectedBusyAction !== undefined

  useEffect(() => {
    const account = createFlowAccountId ? accounts.find((item) => item.id === createFlowAccountId) : undefined
    if (modal !== 'create' || !account || account.status !== 'connected') {
      return undefined
    }

    const timer = window.setTimeout(() => {
      setModal(undefined)
      setCreateFlowAccountId(undefined)
      setNotice(undefined)
    }, 450)

    return () => window.clearTimeout(timer)
  }, [accounts, createFlowAccountId, modal])

  const loadAccounts = useCallback(async (preferredAccountId?: string, background = false) => {
    if (mockMode) {
      setAccounts(mockAccounts)
      setSelectedAccountId((current) => preferredAccountId ?? current ?? mockAccounts[0]?.id)
      setAccountProxyIDs(mockProxyBindings)
      accountProxyIDsRef.current = mockProxyBindings
      setLoading(false)
      return
    }
    if (!background) {
      setLoading(true)
    }

    try {
      const response = await listAccounts()
      setAccounts(response.accounts)
      const activeAccountIDs = new Set(response.accounts.map((item) => item.id))
      const nextProxyIDs = { ...accountProxyIDsRef.current }
      Object.keys(nextProxyIDs).forEach((accountID) => {
        if (!activeAccountIDs.has(accountID)) {
          delete nextProxyIDs[accountID]
        }
      })
      const pendingAccounts = response.accounts.filter((item) => !(item.id in nextProxyIDs))
      if (pendingAccounts.length > 0) {
        const bindings = await Promise.all(
          pendingAccounts.map(async (account) => {
            try {
              const binding = await getAccountProxy(account.id)
              return [account.id, binding.proxy?.id ?? ''] as const
            } catch {
              return [account.id, ''] as const
            }
          }),
        )
        bindings.forEach(([accountID, proxyID]) => {
          nextProxyIDs[accountID] = proxyID
        })
      }
      accountProxyIDsRef.current = nextProxyIDs
      setAccountProxyIDs(nextProxyIDs)
      setSelectedAccountId((current) => {
        if (preferredAccountId) {
          return preferredAccountId
        }
        return response.accounts.some((item) => item.id === current) ? current : response.accounts[0]?.id
      })

      if (!background) {
        setError(undefined)
      }
    } catch (loadError) {
      if (!background) {
        setError(loadError instanceof Error ? loadError.message : '加载账号失败')
      }
    } finally {
      if (!background) {
        setLoading(false)
      }
    }
  }, [mockMode])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    let cancelled = false

    if (mockMode) {
      setLocalExitIP('45.198.228.105')
      return () => {
        cancelled = true
      }
    }

    async function loadLocalExitIP() {
      try {
        const response = await getLocalExitIP()
        if (!cancelled) {
          setLocalExitIP(response.ip.trim())
        }
      } catch {
        if (!cancelled) {
          setLocalExitIP('')
        }
      }
    }

    void loadLocalExitIP()
    const timer = window.setInterval(() => {
      void loadLocalExitIP()
    }, 20000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [mockMode])

  useEffect(() => {
    let cancelled = false

    if (mockMode) {
      setLocalProxies(mockProxies)
      return () => {
        cancelled = true
      }
    }

    async function loadProxyPool() {
      try {
        const response = await listLocalProxies()
        if (!cancelled) {
          setLocalProxies(response.proxies)
        }
      } catch {
        if (!cancelled) {
          setLocalProxies([])
        }
      }
    }
    void loadProxyPool()
    return () => {
      cancelled = true
    }
  }, [mockMode])

  useEffect(() => {
    if (!selectedAccount?.id) {
      setSelectedProxyID('')
      return
    }
    let cancelled = false
    if (mockMode) {
      const proxyID = mockProxyBindings[selectedAccount.id] ?? ''
      setSelectedProxyID(proxyID)
      setLoadingAccountProxy(false)
      return () => {
        cancelled = true
      }
    }
    setLoadingAccountProxy(true)
    void getAccountProxy(selectedAccount.id)
      .then((response) => {
        if (!cancelled) {
          const proxyID = response.proxy?.id ?? ''
          setSelectedProxyID(proxyID)
          accountProxyIDsRef.current = { ...accountProxyIDsRef.current, [selectedAccount.id]: proxyID }
          setAccountProxyIDs(accountProxyIDsRef.current)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedProxyID('')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAccountProxy(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [mockMode, selectedAccount?.id])

  useEffect(() => {
    if (mockMode) {
      return undefined
    }
    const timer = window.setInterval(() => {
      void loadAccounts(undefined, true)
    }, 4000)

    return () => window.clearInterval(timer)
  }, [loadAccounts, mockMode])

  useEffect(() => {
    if (mockMode) {
      return undefined
    }
    return subscribeLiveUpdates(() => {
      void loadAccounts(undefined, true)
    })
  }, [loadAccounts, mockMode])

  useEffect(() => {
    let cancelled = false

    async function renderQRCode() {
      const qrContent = selectedAccount?.session?.pairing?.qr_code?.trim()
      if (!qrContent) {
        setQrDataUrl(undefined)
        return
      }

      try {
        const dataUrl = await QRCode.toDataURL(qrContent, {
          width: 280,
          margin: 1,
          color: {
            dark: '#16343a',
            light: '#fcfbf6',
          },
        })

        if (!cancelled) {
          setQrDataUrl(dataUrl)
        }
      } catch {
        if (!cancelled) {
          setQrDataUrl(undefined)
        }
      }
    }

    void renderQRCode()

    return () => {
      cancelled = true
    }
  }, [selectedAccount?.session?.pairing?.qr_code])

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)

    try {
      if (mockMode) {
        const mockAccount: AccountView = {
          id: `mock-account-${Date.now()}`,
          display_name: form.displayName.trim() || '新建模拟账号',
          phone_number: form.phoneNumber.trim() || undefined,
          platform_label: form.platformLabel.trim() || undefined,
          status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          session: { status: 'pending', updated_at: new Date().toISOString() },
        }
        setAccounts((current) => [mockAccount, ...current])
        setSelectedAccountId(mockAccount.id)
        setCreateFlowAccountId(mockAccount.id)
        setForm(initialForm)
        setNotice('模拟账号已创建（仅用于本地预览）')
        return
      }
      const response = await createAccount({
        display_name: form.displayName.trim(),
        phone_number: form.phoneNumber.trim() || undefined,
        platform_label: form.platformLabel.trim() || undefined,
      })

      setForm(initialForm)
      await loadAccounts(response.account.id)
      setCreateFlowAccountId(response.account.id)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '创建账号失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSaveAccountProxy(value: string) {
    if (!selectedAccount) return
    setSavingAccountProxy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      if (mockMode) {
        setSelectedProxyID(value)
        setAccountProxyIDs((current) => ({ ...current, [selectedAccount.id]: value }))
        setNotice(value ? '模拟代理已切换（仅用于本地预览）' : '已切换为本机网络（仅用于本地预览）')
        return
      }
      await setAccountProxy(selectedAccount.id, value)
      setSelectedProxyID(value)
      if (!value) {
        setLocalTestAccounts((current) => ({ ...current, [selectedAccount.id]: true }))
      } else {
        setLocalTestAccounts((current) => ({ ...current, [selectedAccount.id]: false }))
      }
      accountProxyIDsRef.current = { ...accountProxyIDsRef.current, [selectedAccount.id]: value }
      setAccountProxyIDs(accountProxyIDsRef.current)
      setNotice(value ? '账号代理已保存，重新连接后生效' : '已选择本机网络，重新连接后生效')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存账号代理失败')
    } finally {
      setSavingAccountProxy(false)
    }
  }

  async function runAccountAction(accountId: string, method: PairingMethod | 'logout' | 'delete') {
    setBusyAction({ accountId, method })
    setError(undefined)

    try {
      if (mockMode) {
        if (method === 'delete') {
          setAccounts((current) => current.filter((account) => account.id !== accountId))
          setSelectedAccountId(undefined)
          if (createFlowAccountId === accountId) {
            setModal(undefined)
            setCreateFlowAccountId(undefined)
          }
          setNotice('模拟账号已删除（仅用于本地预览）')
        } else if (method === 'qr' || method === 'pairing_code') {
          const now = new Date()
          const pairing = {
            method,
            qr_code: method === 'qr' ? `mock-pairing-${accountId}-${Date.now()}` : undefined,
            pairing_code: method === 'pairing_code' ? '481 726 395' : undefined,
            instruction: method === 'qr' ? '请用 WhatsApp 扫描二维码完成连接' : '请在 WhatsApp 中输入这组配对码',
            expires_at: new Date(now.getTime() + 120000).toISOString(),
          }
          setAccounts((current) => current.map((account) => (
            account.id === accountId
              ? { ...account, status: 'pairing', updated_at: now.toISOString(), session: { ...account.session, status: 'pairing', updated_at: now.toISOString(), pairing } }
              : account
          )))
          setNotice('模拟配对内容已生成（仅用于本地预览）')
          window.setTimeout(() => {
            const connectedAt = new Date().toISOString()
            setAccounts((current) => current.map((account) => (
              account.id === accountId
                ? { ...account, status: 'connected', last_seen_at: connectedAt, updated_at: connectedAt, session: { status: 'connected', updated_at: connectedAt, connected_at: connectedAt } }
                : account
            )))
          }, 1800)
        } else {
          setNotice(`模拟${method === 'logout' ? '退出登录' : '配对操作'}已触发（仅用于本地预览）`)
        }
        return
      }
      if (method === 'delete') {
        const account = accounts.find((item) => item.id === accountId)
        const name = account?.display_name ?? accountId
        const confirmed = window.confirm(
          `确定删除账号“${name}”吗？\n\n这会清理该账号的会话凭据、聊天记录和导出任务。`,
        )

        if (!confirmed) {
          return
        }

        await deleteAccount(accountId)
        await loadAccounts()
        return
      }

      if (method === 'logout') {
        await logoutAccount(accountId)
      } else {
        await startPairing(accountId, method, accountId === selectedAccount?.id && localTestModeSelected)
      }

      await loadAccounts(accountId)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '执行账号操作失败')
    } finally {
      setBusyAction(undefined)
    }
  }

  const modalAccount = createFlowAccountId
    ? accounts.find((account) => account.id === createFlowAccountId)
    : selectedAccount
  const modalProxyID = modalAccount
    ? modalAccount.id === selectedAccount?.id
      ? selectedProxyID
      : accountProxyIDs[modalAccount.id] ?? ''
    : ''
  const modalProxy = localProxies.find((proxy) => proxy.id === modalProxyID)

  function closeModal() {
    setModal(undefined)
    setCreateFlowAccountId(undefined)
    setError(undefined)
  }

  function openCreateModal() {
    setForm(initialForm)
    setSelectedAccountId(undefined)
    setCreateFlowAccountId(undefined)
    setNotice(undefined)
    setError(undefined)
    setModal('create')
  }

  function openAccountModal(accountId: string) {
    setSelectedAccountId(accountId)
    setCreateFlowAccountId(undefined)
    setNotice(undefined)
    setError(undefined)
    setModal('account')
  }

  return (
    <div className="page page-accounts accounts-page-modern accounts-page-redesign">
      <header className="accounts-page-header">
        <div>
          <p className="eyebrow">账号管理</p>
          <h1>WhatsApp 账号</h1>
          <p className="accounts-page-subtitle">每个账号独立管理连接状态与网络出口</p>
        </div>
        <button className="primary-button accounts-create-button" type="button" onClick={openCreateModal}>
          <Icon name="plus" />
          创建账号
        </button>
      </header>

      {notice ? <div className="success-banner accounts-feedback">{notice}</div> : null}
      {error ? <div className="error-banner accounts-feedback">{error}</div> : null}

      <section className="panel account-list-panel account-list-panel-redesign">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">账号列表</p>
            <h3>已配置账号</h3>
          </div>
          <span className="subtle-text">{loading ? '正在读取...' : `共 ${accounts.length} 个账号`}</span>
        </div>

        {accounts.length > 0 ? (
          <div className="account-list-scroll account-list-scroll-vertical">
            <div className="account-card-grid account-card-grid-vertical">
              {accounts.map((account) => {
                const proxy = localProxies.find((item) => item.id === accountProxyIDs[account.id])
                return (
                  <button
                    key={account.id}
                    type="button"
                    className="account-card account-card-redesign"
                    onClick={() => openAccountModal(account.id)}
                  >
                    <div className="account-card-header">
                      <strong>{account.display_name}</strong>
                      <StatusBadge status={account.session?.status ?? account.status} />
                    </div>
                    <p>{account.platform_label ?? '未填写内部标签'}</p>
                    <dl className="account-card-details">
                      <div>
                        <dt>手机号</dt>
                        <dd>{account.phone_number ?? '未填写'}</dd>
                      </div>
                      <div>
                        <dt>出口 IP</dt>
                        <dd>{proxy?.exit_ip ?? '本机网络'}</dd>
                      </div>
                    </dl>
                    <div className="account-card-footer">
                      <small>{formatDateTime(account.session?.updated_at ?? account.updated_at)}</small>
                      <span>查看详情 <Icon name="chevronRight" /></span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <EmptyPanel title="还没有账号" description="点击右上角“创建账号”开始配置。" />
        )}
      </section>

      {modal ? (
        <div className="account-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
          <section className="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-modal-title">
            <header className="account-modal-header">
              <div>
                <p className="eyebrow">{modal === 'create' ? '新建账号' : '账号详情'}</p>
                <h2 id="account-modal-title">{modal === 'create' && !createFlowAccountId ? '创建账号' : modalAccount?.display_name}</h2>
              </div>
              <button className="secondary-button account-modal-close" type="button" onClick={closeModal}>关闭</button>
            </header>

            {modal === 'create' && !createFlowAccountId ? (
              <form className="account-create-form" onSubmit={handleCreateAccount}>
                <label className="field">
                  <span>账号名称</span>
                  <input
                    value={form.displayName}
                    onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                    placeholder="例如：售后 1 号机"
                    required
                    autoFocus
                  />
                </label>
                <label className="field">
                  <span>手机号</span>
                  <input
                    value={form.phoneNumber}
                    onChange={(event) => setForm((current) => ({ ...current, phoneNumber: event.target.value }))}
                    placeholder="配对码模式建议填写国际格式，例如 86138..."
                  />
                </label>
                <label className="field">
                  <span>内部标签</span>
                  <input
                    value={form.platformLabel}
                    onChange={(event) => setForm((current) => ({ ...current, platformLabel: event.target.value }))}
                    placeholder="例如：深圳门店 / 夜班"
                  />
                </label>
                <div className="account-modal-actions">
                  <button className="primary-button" type="submit" disabled={submitting}>
                    <Icon name="plus" />
                    {submitting ? '正在创建...' : '创建并继续配对'}
                  </button>
                </div>
              </form>
            ) : modalAccount ? (
              <div className="account-modal-body">
                <div className="account-modal-account-head">
                  <div>
                    <strong>{modalAccount.platform_label ?? '未填写内部标签'}</strong>
                    <span>{modalAccount.phone_number ?? '未填写手机号'}</span>
                  </div>
                  <StatusBadge status={modalAccount.session?.status ?? modalAccount.status} />
                </div>

                <dl className="account-modal-info">
                  <div><dt>最近状态</dt><dd>{formatDateTime(modalAccount.session?.updated_at ?? modalAccount.updated_at)}</dd></div>
                  <div><dt>最后在线</dt><dd>{formatDateTime(modalAccount.last_seen_at)}</dd></div>
                  <div><dt>账号出口</dt><dd>{modalProxy?.exit_ip ?? (localExitIP || '本机网络')}</dd></div>
                  <div><dt>连接路径</dt><dd>{modalProxy ? routeModeLabel(modalProxy.route_mode) : '本机网络'}</dd></div>
                </dl>

                {isDesktopRuntime ? (
                  <div className="desktop-network-card account-modal-network">
                    <div className="desktop-network-head">
                      <div>
                        <strong>网络出口</strong>
                        <span>只修改当前账号，不会影响其他账号</span>
                      </div>
                      <strong className="account-exit-ip">{modalProxy?.exit_ip ?? (localExitIP || '未返回')}</strong>
                    </div>
                    <label className="field compact-field">
                      <span>选择网络出口</span>
                      <select
                        value={modalProxyID}
                        disabled={loadingAccountProxy || savingAccountProxy}
                        onChange={(event) => void handleSaveAccountProxy(event.target.value)}
                      >
                        <option value="">本机网络</option>
                        {localProxies.map((proxy) => (
                          <option key={proxy.id} value={proxy.id} disabled={!proxy.enabled}>
                            {proxy.name} · {proxy.country ?? proxy.host} · {routeModeLabel(proxy.route_mode)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}

                {modalAccount.session?.last_error ? <div className="warning-banner">{modalAccount.session.last_error}</div> : null}

                {modalAccount.session?.pairing ? (
                  <div className="account-pairing-modal">
                    <div>
                      <p className="eyebrow">等待连接</p>
                      <h3>{modalAccount.session.pairing.method === 'qr' ? '请扫码连接' : '请输入配对码'}</h3>
                    </div>
                    {modalAccount.session.pairing.qr_code && qrDataUrl ? <img className="pairing-qr-image" src={qrDataUrl} alt="WhatsApp 配对二维码" /> : null}
                    <strong className="pairing-value">{modalAccount.session.pairing.qr_code ?? modalAccount.session.pairing.pairing_code}</strong>
                    <p>{modalAccount.session.pairing.instruction}</p>
                    <small>有效期至 {formatDateTime(modalAccount.session.pairing.expires_at)}</small>
                  </div>
                ) : null}

                <div className="account-modal-actions account-modal-action-row">
                  <button className="primary-button" type="button" disabled={isSelectedAccountBusy || pairingBlocked} onClick={() => void runAccountAction(modalAccount.id, 'qr')}>
                    <Icon name="qr" />
                    {selectedBusyAction === 'qr' ? '生成中...' : '二维码配对'}
                  </button>
                  <button className="secondary-button" type="button" disabled={isSelectedAccountBusy || pairingBlocked} onClick={() => void runAccountAction(modalAccount.id, 'pairing_code')}>
                    <Icon name="key" />
                    {selectedBusyAction === 'pairing_code' ? '生成中...' : '生成配对码'}
                  </button>
                  <button className="secondary-button" type="button" disabled={isSelectedAccountBusy} onClick={() => void runAccountAction(modalAccount.id, 'logout')}>
                    <Icon name="logout" />
                    退出登录
                  </button>
                  <button className="danger-button" type="button" disabled={isSelectedAccountBusy} onClick={() => void runAccountAction(modalAccount.id, 'delete')}>
                    <Icon name="delete" />
                    删除账号
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  )
}

function formatDateTime(value?: string) {
  if (!value) {
    return '暂未记录'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function routeModeLabel(value: LocalProxyView['route_mode']) {
  switch (value) {
    case 'direct':
      return '直连代理'
    case 'system':
      return '强制链式'
    default:
      return '自动链式'
  }
}
