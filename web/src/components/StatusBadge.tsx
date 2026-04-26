import type { AccountStatus, ExportStatus } from '../api/client'

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

const exportToneMap: Record<ExportStatus, BadgeTone> = {
  queued: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'danger',
}

function getTone(status: string): BadgeTone {
  switch (status) {
    case 'direct':
      return 'info'
    case 'group':
      return 'warning'
    case 'broadcast':
      return 'neutral'
    case 'status':
      return 'neutral'
    case 'ok':
    case 'enabled':
    case 'suggest':
    case 'sent':
      return 'success'
    case 'warn':
    case 'pairing_code':
    case 'auto_send':
    case 'ready_for_review':
      return 'warning'
    case 'manual':
    case 'disabled':
    case 'logged_out':
      return 'neutral'
    case 'down':
    case 'blocked':
      return 'danger'
    case 'generating':
      return 'info'
    default:
      return (
        accountToneMap[status as AccountStatus] ??
        exportToneMap[status as ExportStatus] ??
        'neutral'
      )
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
    case 'queued':
      return '排队中'
    case 'running':
      return '导出中'
    case 'completed':
      return '已完成'
    case 'enabled':
      return '已启用'
    case 'disabled':
      return '未启用'
    case 'manual':
      return '手动回复'
    case 'suggest':
      return '建议草稿'
    case 'auto_send':
      return '自动发送'
    case 'generating':
      return '生成中'
    case 'blocked':
      return '已拦截'
    case 'ready_for_review':
      return '待复核'
    case 'sent':
      return '已发送'
    case 'ok':
      return '正常'
    case 'warn':
      return '需关注'
    case 'down':
      return '不可用'
    default:
      return status
  }
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge tone-${getTone(status)}`}>{getLabel(status)}</span>
}
