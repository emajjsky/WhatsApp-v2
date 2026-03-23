import type { ReactNode } from 'react'

interface EmptyPanelProps {
  title: string
  description: string
  action?: ReactNode
}

export function EmptyPanel({ title, description, action }: EmptyPanelProps) {
  return (
    <section className="empty-panel">
      <p className="eyebrow">当前为空</p>
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div className="empty-panel-action">{action}</div> : null}
    </section>
  )
}
