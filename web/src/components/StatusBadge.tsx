import type { AccountStatus } from '../api/client'

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const accountToneMap: Record<AccountStatus, BadgeTone> = {
  pending: 'neutral',
  pairing: 'warning',
  connected: 'success',
  reconnecting: 'info',
  disconnected: 'danger',
  logged_out: 'neutral',
  failed: 'danger',
}

function getTone(status: string): BadgeTone {
  switch (status) {
    case 'enabled':
      return 'success'
    case 'disabled':
      return 'neutral'
    case 'suggest':
      return 'info'
    case 'auto_send':
      return 'warning'
    case 'queued':
      return 'neutral'
    case 'generating':
      return 'info'
    case 'blocked':
      return 'danger'
    case 'ready_for_review':
      return 'warning'
    case 'sent':
      return 'success'
    default:
      return accountToneMap[status as AccountStatus] ?? 'neutral'
  }
}

function getLabel(status: string) {
  switch (status) {
    case 'pending':
      return '待接入'
    case 'pairing':
      return '配对中'
    case 'connected':
      return '已连接'
    case 'reconnecting':
      return '重连中'
    case 'disconnected':
      return '已断开'
    case 'logged_out':
      return '已退出'
    case 'failed':
      return '异常'
    case 'direct':
      return '单聊'
    case 'group':
      return '群聊'
    case 'broadcast':
      return '广播'
    case 'status':
      return '状态'
    case 'enabled':
      return '已启用'
    case 'disabled':
      return '未启用'
    case 'suggest':
      return '建议草稿'
    case 'auto_send':
      return '自动发送'
    case 'queued':
      return '排队中'
    case 'generating':
      return '生成中'
    case 'blocked':
      return '已拦截'
    case 'ready_for_review':
      return '待复核'
    case 'sent':
      return '已发出'
    default:
      return status
  }
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge tone-${getTone(status)}`}>{getLabel(status)}</span>
}
