import QRCode from 'qrcode'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import {
  createAccount,
  deleteAccount,
  listAccounts,
  logoutAccount,
  startPairing,
  subscribeLiveUpdates,
  type AccountView,
  type PairingMethod,
} from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { Icon } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'

declare global {
  interface Window {
    desktopRuntime?: {
      platform: string
      appVersion?: () => Promise<string>
      getConfig?: () => Promise<DesktopRuntimeConfig>
      saveConfig?: (config: Partial<DesktopRuntimeConfig>) => Promise<DesktopRuntimeConfig>
    }
  }
}

type DesktopProxyMode = 'auto' | 'direct' | 'manual'

interface DesktopRuntimeConfig {
  cloudAuthBaseUrl: string
  whatsAppProxyMode: DesktopProxyMode
  whatsAppProxyUrl: string
  resolvedWhatsAppProxyUrl: string
}

const initialForm = {
  displayName: '',
  phoneNumber: '',
  platformLabel: '',
}

const initialNetworkSettings = {
  mode: 'auto' as DesktopProxyMode,
  proxyUrl: '',
  resolvedProxyUrl: '',
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
  const [networkSettings, setNetworkSettings] = useState(initialNetworkSettings)
  const [loadingNetworkSettings, setLoadingNetworkSettings] = useState(Boolean(window.desktopRuntime?.getConfig))
  const [savingNetworkSettings, setSavingNetworkSettings] = useState(false)

  const selectedAccount = accounts.find((item) => item.id === selectedAccountId) ?? accounts[0]
  const selectedBusyAction = busyAction && busyAction.accountId === selectedAccount?.id ? busyAction.method : undefined
  const isSelectedAccountBusy = selectedBusyAction !== undefined
  const isDesktopRuntime = Boolean(window.desktopRuntime?.saveConfig)

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

    async function loadDesktopConfig() {
      if (!window.desktopRuntime?.getConfig) {
        setLoadingNetworkSettings(false)
        return
      }

      try {
        const config = await window.desktopRuntime.getConfig()
        if (!cancelled) {
          setNetworkSettings({
            mode: config.whatsAppProxyMode,
            proxyUrl: config.whatsAppProxyUrl.trim(),
            resolvedProxyUrl: config.resolvedWhatsAppProxyUrl.trim(),
          })
        }
      } catch (configError) {
        if (!cancelled) {
          setError(configError instanceof Error ? configError.message : '读取桌面网络配置失败')
        }
      } finally {
        if (!cancelled) {
          setLoadingNetworkSettings(false)
        }
      }
    }

    void loadDesktopConfig()

    return () => {
      cancelled = true
    }
  }, [])

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

  async function handleSaveNetworkSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!window.desktopRuntime?.saveConfig) {
      return
    }

    const proxyUrl = networkSettings.mode === 'manual' ? networkSettings.proxyUrl.trim() : ''
    if (networkSettings.mode === 'manual' && !isValidProxyURL(proxyUrl)) {
      setError('代理地址格式不正确，请填写 http://127.0.0.1:7890 或 socks5://127.0.0.1:7890')
      return
    }

    setSavingNetworkSettings(true)
    setError(undefined)
    setNotice(undefined)

    try {
      const config = await window.desktopRuntime.saveConfig({
        whatsAppProxyMode: networkSettings.mode,
        whatsAppProxyUrl: proxyUrl,
      })
      setNetworkSettings({
        mode: config.whatsAppProxyMode,
        proxyUrl: config.whatsAppProxyUrl.trim(),
        resolvedProxyUrl: config.resolvedWhatsAppProxyUrl.trim(),
      })
      setNotice('网络连接方式已保存，本地连接服务已重启')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存桌面网络配置失败')
    } finally {
      setSavingNetworkSettings(false)
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
            <form className="desktop-network-card" onSubmit={handleSaveNetworkSettings}>
              <div className="desktop-network-head">
                <div>
                  <strong>网络连接方式</strong>
                  <span>{getNetworkModeLabel(networkSettings.mode, networkSettings.resolvedProxyUrl)}</span>
                </div>
              </div>

              <div className="desktop-network-mode-row">
                {(['auto', 'direct', 'manual'] as DesktopProxyMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`desktop-network-mode${networkSettings.mode === mode ? ' active' : ''}`}
                    disabled={loadingNetworkSettings || savingNetworkSettings}
                    onClick={() =>
                      setNetworkSettings((current) => ({
                        ...current,
                        mode,
                      }))
                    }
                  >
                    {getProxyModeText(mode)}
                  </button>
                ))}
              </div>

              {networkSettings.mode === 'manual' ? (
                <label className="field compact-field">
                  <span>代理地址</span>
                  <input
                    value={networkSettings.proxyUrl}
                    disabled={loadingNetworkSettings || savingNetworkSettings}
                    onChange={(event) =>
                      setNetworkSettings((current) => ({
                        ...current,
                        proxyUrl: event.target.value,
                      }))
                    }
                    placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:7890"
                  />
                </label>
              ) : null}

              <div className="desktop-network-actions">
                <p className="field-hint">{getNetworkHint(networkSettings.mode, networkSettings.resolvedProxyUrl)}</p>
                <button className="secondary-button" type="submit" disabled={loadingNetworkSettings || savingNetworkSettings}>
                  <Icon name="save" />
                  {savingNetworkSettings ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
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

function isValidProxyURL(value: string) {
  try {
    const parsed = new URL(value)
    return ['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol) && parsed.hostname !== ''
  } catch {
    return false
  }
}

function getProxyModeText(mode: DesktopProxyMode) {
  switch (mode) {
    case 'direct':
      return '直连'
    case 'manual':
      return '手动代理'
    default:
      return '自动检测'
  }
}

function getNetworkModeLabel(mode: DesktopProxyMode, resolvedProxyUrl: string) {
  if (mode === 'direct') {
    return '不使用代理'
  }
  if (mode === 'manual') {
    return '使用手动代理'
  }
  return resolvedProxyUrl ? '已自动检测到系统代理' : '自动检测，未发现代理则直连'
}

function getNetworkHint(mode: DesktopProxyMode, resolvedProxyUrl: string) {
  if (mode === 'manual') {
    return '只有代理软件没有设置系统代理时，才需要手动填写。'
  }
  if (mode === 'direct') {
    return '国外用户或可直连 WhatsApp 的网络可使用直连。'
  }
  return resolvedProxyUrl ? `当前检测到：${resolvedProxyUrl}` : '推荐保持自动；系统没有代理时会自动直连。'
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
