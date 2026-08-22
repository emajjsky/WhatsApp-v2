import QRCode from 'qrcode'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import {
  createAccount,
  deleteAccount,
  getAccountProxy,
  listLocalProxies,
  listAccounts,
  logoutAccount,
  setAccountProxy,
  startPairing,
  subscribeLiveUpdates,
  type AccountView,
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

export function AccountsPage() {
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
  const [selectedProxyID, setSelectedProxyID] = useState('')
  const [loadingAccountProxy, setLoadingAccountProxy] = useState(false)
  const [savingAccountProxy, setSavingAccountProxy] = useState(false)

  const selectedAccount = accounts.find((item) => item.id === selectedAccountId) ?? accounts[0]
  const selectedBusyAction = busyAction && busyAction.accountId === selectedAccount?.id ? busyAction.method : undefined
  const isSelectedAccountBusy = selectedBusyAction !== undefined
  const isDesktopRuntime = Boolean((window as Window & { desktopRuntime?: unknown }).desktopRuntime)

  const loadAccounts = useCallback(async (preferredAccountId?: string, background = false) => {
    if (!background) {
      setLoading(true)
    }

    try {
      const response = await listAccounts()
      setAccounts(response.accounts)
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
  }, [])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    let cancelled = false
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
  }, [])

  useEffect(() => {
    if (!selectedAccount?.id) {
      setSelectedProxyID('')
      return
    }
    let cancelled = false
    setLoadingAccountProxy(true)
    void getAccountProxy(selectedAccount.id)
      .then((response) => {
        if (!cancelled) {
          setSelectedProxyID(response.proxy?.id ?? '')
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
  }, [selectedAccount?.id])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadAccounts(undefined, true)
    }, 4000)

    return () => window.clearInterval(timer)
  }, [loadAccounts])

  useEffect(() => {
    return subscribeLiveUpdates(() => {
      void loadAccounts(undefined, true)
    })
  }, [loadAccounts])

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
      const response = await createAccount({
        display_name: form.displayName.trim(),
        phone_number: form.phoneNumber.trim() || undefined,
        platform_label: form.platformLabel.trim() || undefined,
      })

      setForm(initialForm)
      await loadAccounts(response.account.id)
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
      await setAccountProxy(selectedAccount.id, value)
      setSelectedProxyID(value)
      setNotice(value ? '账号代理已保存，重新连接后生效' : '已改为本机直连，重新连接后生效')
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
        await startPairing(accountId, method)
      }

      await loadAccounts(accountId)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '执行账号操作失败')
    } finally {
      setBusyAction(undefined)
    }
  }

  return (
    <div className="page page-accounts">
      <section className="page-top-grid accounts-top-grid">
        <article className="panel panel-stretch">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">第一步</p>
              <h3>创建账号卡片</h3>
            </div>
            <span className="subtle-text">先建卡，再配对</span>
          </div>

          <form className="form-grid" onSubmit={handleCreateAccount}>
            <label className="field">
              <span>账号名称</span>
              <input
                value={form.displayName}
                onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                placeholder="例如：售后 1 号机"
                required
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

            <button className="primary-button" type="submit" disabled={submitting}>
              <Icon name="plus" />
              {submitting ? '正在创建...' : '创建账号'}
            </button>
          </form>

          {isDesktopRuntime ? (
            <div className="desktop-network-card account-proxy-card">
              <div className="desktop-network-head">
                <div>
                  <strong>账号出口 IP</strong>
                  <span>{selectedAccount ? '每个 WhatsApp 账号单独选择' : '先选择账号'}</span>
                </div>
              </div>
              <label className="field compact-field">
                <span>当前账号使用的代理</span>
                <select
                  value={selectedProxyID}
                  disabled={!selectedAccount || loadingAccountProxy || savingAccountProxy}
                  onChange={(event) => void handleSaveAccountProxy(event.target.value)}
                >
                  <option value="">本机网络（自动检测系统代理）</option>
                  {localProxies.map((proxy) => (
                    <option key={proxy.id} value={proxy.id} disabled={!proxy.enabled}>
                      {proxy.name} · {proxy.country ?? proxy.host} · {proxy.route_mode === 'direct' ? '直连' : proxy.route_mode === 'system' ? '强制链式' : '自动链式'}
                    </option>
                  ))}
                </select>
              </label>
              <p className="field-hint">自动链式会检测本机 Clash/系统代理：检测到则先经过它，再连接此账号的独立出口；境外没有系统代理时自动直连。Clash 切换节点后已连接账号会自动重连。</p>
            </div>
          ) : null}

        </article>

        <article className="panel panel-stretch">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">第二步</p>
              <h3>账号状态与配对信息</h3>
            </div>
            <span className="subtle-text">{selectedAccount ? selectedAccount.display_name : '未选择账号'}</span>
          </div>

          {selectedAccount ? (
            <div className="account-detail-workbench">
              <div className="detail-card account-summary-card">
                <div className="detail-card-header">
                  <div>
                    <h4>{selectedAccount.display_name}</h4>
                    <p>{selectedAccount.platform_label ?? '未填写内部标签'}</p>
                  </div>
                  <StatusBadge status={selectedAccount.session?.status ?? selectedAccount.status} />
                </div>

                <dl className="detail-grid">
                  <div>
                    <dt>手机号</dt>
                    <dd>{selectedAccount.phone_number ?? '未填写'}</dd>
                  </div>
                  <div>
                    <dt>最近状态时间</dt>
                    <dd>{formatDateTime(selectedAccount.session?.updated_at ?? selectedAccount.updated_at)}</dd>
                  </div>
                  <div>
                    <dt>最后在线</dt>
                    <dd>{formatDateTime(selectedAccount.last_seen_at)}</dd>
                  </div>
                  <div>
                    <dt>创建时间</dt>
                    <dd>{formatDateTime(selectedAccount.created_at)}</dd>
                  </div>
                </dl>

                <div className="button-row">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={isSelectedAccountBusy}
                    onClick={() => void runAccountAction(selectedAccount.id, 'qr')}
                  >
                    <Icon name="qr" />
                    {selectedBusyAction === 'qr' ? '生成中...' : '二维码配对'}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={isSelectedAccountBusy}
                    onClick={() => void runAccountAction(selectedAccount.id, 'pairing_code')}
                  >
                    <Icon name="key" />
                    {selectedBusyAction === 'pairing_code' ? '生成中...' : '生成配对码'}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={isSelectedAccountBusy}
                    onClick={() => void runAccountAction(selectedAccount.id, 'logout')}
                  >
                    <Icon name="logout" />
                    {selectedBusyAction === 'logout' ? '退出中...' : '退出登录'}
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={isSelectedAccountBusy}
                    onClick={() => void runAccountAction(selectedAccount.id, 'delete')}
                  >
                    <Icon name="delete" />
                    {selectedBusyAction === 'delete' ? '删除中...' : '删除账号'}
                  </button>
                </div>
              </div>

              {selectedAccount.session?.last_error ? (
                <div className="warning-banner">{selectedAccount.session.last_error}</div>
              ) : null}

              {selectedAccount.session?.pairing ? (
                <div className="pairing-card account-pairing-card">
                  <p className="eyebrow">当前配对内容</p>
                  <h4>{selectedAccount.session.pairing.method === 'qr' ? '扫码配对' : '配对码'}</h4>

                  {selectedAccount.session.pairing.qr_code ? (
                    <div className="pairing-qr-stack">
                      {qrDataUrl ? (
                        <img className="pairing-qr-image" src={qrDataUrl} alt="WhatsApp 配对二维码" />
                      ) : (
                        <p className="pairing-value">二维码生成中...</p>
                      )}
                    </div>
                  ) : null}

                  <p className="pairing-value">
                    {selectedAccount.session.pairing.qr_code ??
                      selectedAccount.session.pairing.pairing_code ??
                      '暂时没有可展示内容'}
                  </p>
                  <p>{selectedAccount.session.pairing.instruction}</p>
                  <small>有效期至 {formatDateTime(selectedAccount.session.pairing.expires_at)}</small>
                </div>
              ) : (
                <EmptyPanel
                  title="还没有配对内容"
                  description="点击上面的二维码配对或生成配对码，这里会实时显示下一步操作。"
                />
              )}
            </div>
          ) : (
            <EmptyPanel title="还没有选中账号" description="先创建一个账号卡片，右侧会显示状态和配对信息。" />
          )}
        </article>
      </section>

      <section className="panel account-list-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">账号列表</p>
            <h3>当前可管理账号</h3>
          </div>
          <span className="subtle-text">{loading ? '正在读取...' : `共 ${accounts.length} 个账号`}</span>
        </div>

        {accounts.length > 0 ? (
          <div className="account-list-scroll">
            <div className="account-card-grid">
              {accounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  className={`account-card${selectedAccount?.id === account.id ? ' selected' : ''}`}
                  onClick={() => setSelectedAccountId(account.id)}
                >
                  <div className="account-card-header">
                    <strong>{account.display_name}</strong>
                    <StatusBadge status={account.session?.status ?? account.status} />
                  </div>
                  <p>{account.platform_label ?? '未填写内部标签'}</p>
                  <span>{account.phone_number ?? '未填写手机号'}</span>
                  <small>{formatDateTime(account.session?.updated_at ?? account.updated_at)}</small>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <EmptyPanel title="还没有账号" description="先在上面的表单里创建账号卡片。" />
        )}
      </section>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
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
