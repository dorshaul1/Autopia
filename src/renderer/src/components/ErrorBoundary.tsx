import { Component, type ReactNode } from 'react'
import { EmptyState } from './ui'

/** Keeps one failing view from blanking the whole window; shows the real error and a way back. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string; /** Going somewhere else clears the error, so one broken page can't take the others with it. */ resetKey?: string; /** A whole page: it covers the office instead of hiding behind it. */ page?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label}]`, error)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    const message = (
      <EmptyState
        tone="danger"
        icon="alert"
        title={`${this.props.label} could not be shown`}
        body={<code>{this.state.error.message}</code>}
        action={
          <button className="btn btn-sm" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        }
      />
    )
    return this.props.page ? <div className="boundary-page">{message}</div> : message
  }
}
