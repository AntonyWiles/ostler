// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { installOstlerApi } from '../fixtures/ostler-api'

let shouldThrow = true

function FragileView() {
  if (shouldThrow) throw new Error('view exploded')
  return <p>View content</p>
}

describe('ErrorBoundary', () => {
  let logRendererError: ReturnType<typeof vi.fn>
  let copyDiagnostics: ReturnType<typeof vi.fn>

  beforeEach(() => {
    shouldThrow = true
    logRendererError = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    copyDiagnostics = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    installOstlerApi({ logRendererError, copyDiagnostics })
    // React reports the caught error to the console; that noise is expected here.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows the fallback, logs the crash, and keeps its siblings working', () => {
    render(
      <>
        <nav>Sidebar</nav>
        <ErrorBoundary scope="view">
          <FragileView />
        </ErrorBoundary>
      </>
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong in this view')
    expect(screen.getByText('view exploded')).toBeInTheDocument()
    expect(screen.getByText('Sidebar')).toBeInTheDocument()
    expect(logRendererError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'boundary', message: 'View crashed: view exploded' })
    )
  })

  it('recovers on Reload view once the view can render again', () => {
    render(
      <ErrorBoundary scope="view">
        <FragileView />
      </ErrorBoundary>
    )
    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: 'Reload view' }))

    expect(screen.getByText('View content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('copies diagnostics from the fallback', async () => {
    render(
      <ErrorBoundary scope="view">
        <FragileView />
      </ErrorBoundary>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }))
    await waitFor(() => expect(copyDiagnostics).toHaveBeenCalled())
    expect(await screen.findByText('Diagnostics copied')).toBeInTheDocument()
  })
})
