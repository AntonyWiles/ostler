import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportRendererError } from '../lib/report-renderer-errors'
import { CopyDiagnosticsButton } from './CopyDiagnosticsButton'
import { Button } from '../ui'
import './ErrorBoundary.css'
import { t } from '@shared/i18n'

interface ErrorBoundaryProps {
  children: ReactNode
  /**
   * `view` wraps the routed content: the sidebar keeps working while one view
   * shows the fallback. `app` is the last line of defence around everything.
   */
  scope: 'view' | 'app'
}

interface ErrorBoundaryState {
  error: Error | null
  /** Bumped by Reload view, so the view mounts afresh rather than reusing broken state. */
  attempt: number
}

/** Catches a render crash, logs it to main.log, and offers a way back. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, attempt: 0 }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportRendererError({
      kind: 'boundary',
      message:
        this.props.scope === 'view'
          ? t('common:errorBoundary.viewCrashed', { message: error.message })
          : t('common:errorBoundary.appCrashed', { message: error.message }),
      stack: `${error.stack ?? ''}${info.componentStack ? `\nComponent stack:${info.componentStack}` : ''}`
    })
  }

  private reload = () => {
    if (this.props.scope === 'app') {
      window.location.reload()
      return
    }
    this.setState((state) => ({ error: null, attempt: state.attempt + 1 }))
  }

  render() {
    const { error, attempt } = this.state
    if (!error)
      return (
        <div key={attempt} className="ostler-error-boundary-content">
          {this.props.children}
        </div>
      )
    return (
      <section
        className="ostler-error-boundary"
        role="alert"
        aria-labelledby="ostler-error-boundary-title"
      >
        <h2 id="ostler-error-boundary-title">
          {this.props.scope === 'view'
            ? t('common:errorBoundary.somethingWentWrongView')
            : t('common:errorBoundary.somethingWentWrong')}
        </h2>
        <p className="ostler-error-boundary-message">{error.message}</p>
        <p className="ostler-error-boundary-note">
          {t('common:errorBoundary.detailsLogCopyDiagnostics')}
        </p>
        <div className="ostler-error-boundary-actions">
          <Button variant="primary" onClick={this.reload}>
            {this.props.scope === 'view'
              ? t('common:errorBoundary.reloadView')
              : t('common:errorBoundary.reload')}
          </Button>
          <CopyDiagnosticsButton />
        </div>
      </section>
    )
  }
}
