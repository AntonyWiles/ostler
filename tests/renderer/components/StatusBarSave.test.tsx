// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StatusBarSave } from '@renderer/components/StatusBarSave'
import { useReportSaveStatus, type SaveStatus } from '@renderer/shell/save-status'

function Document({ status }: { status: SaveStatus | null }) {
  useReportSaveStatus(status)
  return null
}

describe('the status bar save item', () => {
  afterEach(() => vi.useRealTimers())

  it('says nothing with no document open', () => {
    const { container } = render(<StatusBarSave />)
    expect(container.textContent).toBe('')
  })

  it('shows Saved at once, and Saving only once a save has lasted a moment', () => {
    vi.useFakeTimers()
    const { rerender, unmount } = render(
      <>
        <Document status="saved" />
        <StatusBarSave />
      </>
    )
    expect(screen.getByText('Saved')).toBeInTheDocument()
    rerender(
      <>
        <Document status="saving" />
        <StatusBarSave />
      </>
    )
    expect(screen.getByText('Saved')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1100))
    expect(screen.getByText('Saving')).toBeInTheDocument()
    rerender(
      <>
        <Document status="failed" />
        <StatusBarSave />
      </>
    )
    expect(screen.getByText("Couldn't save: retrying")).toBeInTheDocument()
    unmount()
  })

  it('goes away when the document closes', () => {
    const { rerender } = render(
      <>
        <Document status="saved" />
        <StatusBarSave />
      </>
    )
    rerender(<StatusBarSave />)
    expect(screen.queryByText('Saved')).toBeNull()
  })
})
