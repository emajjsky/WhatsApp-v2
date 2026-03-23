import { type FormEvent, useCallback, useEffect, useState } from 'react'
import {
  createAccount,
  listAccounts,
  logoutAccount,
  startPairing,
  type AccountView,
  type PairingMethod,
} from '../api/client'
import { EmptyPanel } from '../components/EmptyPanel'
import { PageHeader } from '../components/PageHeader'
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
  const [busyAccountId, setBusyAccountId] = useState<string>()
  const [error, setError] = useState<string>()
  const [form, setForm] = useState(initialForm)

  const selectedAccount = accounts.find((item) => item.id === selectedAccountId) ?? accounts[0]

  const loadAccounts = useCallback(async (preferredAccountId?: string) => {
    setLoading(true)
    setError(undefined)

    try {
      const response = await listAccounts()
      setAccounts(response.accounts)

      setSelectedAccountId((current) => {
        if (preferredAccountId) {
          return preferredAccountId
        }

        return response.accounts.some((item) => item.id === current) ? current : response.accounts[0]?.id
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载账号失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

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

  async function runAccountAction(accountId: string, method: PairingMethod | 'logout') {
    setBusyAccountId(accountId)
    setError(undefined)

    try {
      if (method === 'logout') {
        await logoutAccount(accountId)
      } else {
        await startPairing(accountId, method)
      }

      await loadAccounts(accountId)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '执行账号动作失败')
    } finally {
      setBusyAccountId(undefined)
    }
  }

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="账号接入"
        title="先把账号卡片建好，再做后面的事"
        description="新员工只需要理解一个动作链路：创建账号、点击配对、看状态是否变成已连接。看不懂协议名词也不影响使用。"
      />

      <section className="two-column-grid account-layout">
        <article className="panel">
          <p className="eyebrow">第一步</p>
          <h3>创建账号卡片</h3>
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
                placeholder="可选，便于后续识别"
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
              {submitting ? '正在创建...' : '创建账号'}
            </button>
          </form>

          <div className="helper-card">
            <strong>新手说明</strong>
            <p>这里不会直接连手机。这里只是先生成一个账号卡片，方便后续做扫码配对。</p>
          </div>
        </article>

        <article className="panel">
          <p className="eyebrow">第二步</p>
          <h3>账号状态与配对信息</h3>
          {selectedAccount ? (
            <div className="detail-stack">
              <div className="detail-card">
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
                </dl>
                <div className="button-row">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={busyAccountId === selectedAccount.id}
                    onClick={() => void runAccountAction(selectedAccount.id, 'qr')}
                  >
                    {busyAccountId === selectedAccount.id ? '处理中...' : '开始二维码配对'}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busyAccountId === selectedAccount.id}
                    onClick={() => void runAccountAction(selectedAccount.id, 'pairing_code')}
                  >
                    生成配对码
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={busyAccountId === selectedAccount.id}
                    onClick={() => void runAccountAction(selectedAccount.id, 'logout')}
                  >
                    退出登录
                  </button>
                </div>
              </div>

              {selectedAccount.session?.pairing ? (
                <div className="pairing-card">
                  <p className="eyebrow">当前配对内容</p>
                  <h4>{selectedAccount.session.pairing.method === 'qr' ? '二维码内容' : '配对码'}</h4>
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
                  description="选择左边账号后，点击“开始二维码配对”或“生成配对码”，这里就会出现下一步提示。"
                />
              )}
            </div>
          ) : (
            <EmptyPanel title="还没有选中账号" description="先创建一个账号卡片，右侧才会出现配对说明。" />
          )}
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">账号列表</p>
            <h3>当前可管理的账号</h3>
          </div>
          <span className="subtle-text">{loading ? '正在读取...' : `共 ${accounts.length} 个账号`}</span>
        </div>

        {accounts.length > 0 ? (
          <div className="card-grid">
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
              </button>
            ))}
          </div>
        ) : (
          <EmptyPanel
            title="还没有账号"
            description="先在上面的表单里创建一个账号卡片，再开始配对。这个页面不需要先懂 WhatsApp 协议。"
          />
        )}
      </section>

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
