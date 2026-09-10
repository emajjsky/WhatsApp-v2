import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error?: Error }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {}

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('页面渲染失败', error, info.componentStack)
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <main className="app-error-page">
        <section className="app-error-panel">
          <span className="eyebrow">页面暂时无法显示</span>
          <h1>页面加载出了问题</h1>
          <p>当前页面没有被破坏，返回后可以继续使用其它功能。</p>
          <div className="button-row">
            <button className="primary-button" type="button" onClick={() => window.location.reload()}>重新加载</button>
            <a className="secondary-button" href="/accounts">返回首页</a>
          </div>
        </section>
      </main>
    )
  }
}
