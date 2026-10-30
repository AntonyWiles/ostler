// @vitest-environment jsdom
import { render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { TITLE_BAR_HEIGHT, type RendererProject } from '@shared/ostler-api'
import { TitleBar } from '@renderer/shell/TitleBar'
import { useReportTitleWorkstream, useTitleWorkstream } from '@renderer/shell/title-workstream'
import { overlayViewport } from '@renderer/ui/overlay/layer'
import { installOstlerApi } from '../fixtures/ostler-api'

const NOWHERE = { project: null, label: null }

describe('TitleBar', () => {
  beforeEach(() => {
    installOstlerApi()
  })

  it('publishes its height so overlays start below the strip', () => {
    const { unmount } = render(<TitleBar where={NOWHERE} />)
    expect(document.documentElement.style.getPropertyValue('--title-bar-height')).toBe(
      `${TITLE_BAR_HEIGHT}px`
    )
    unmount()
    expect(document.documentElement.style.getPropertyValue('--title-bar-height')).toBe('')
  })

  it('keeps pop-ups (menus, tooltips, tips) below the strip too', () => {
    expect(overlayViewport().top).toBe(0)
    const { unmount } = render(<TitleBar where={NOWHERE} />)
    expect(overlayViewport().top).toBe(TITLE_BAR_HEIGHT)
    unmount()
    expect(overlayViewport().top).toBe(0)
  })

  it('names the open workstream between the project and the view', () => {
    const project = { id: 'p1', name: 'Café refit' } as RendererProject
    render(<TitleBar where={{ project, workstream: 'Kitchen', label: 'Board' }} />)
    expect(screen.getByText('Café refit › Kitchen › Board')).toBeInTheDocument()
  })

  it('hears the workstream the project workspace reports, until it closes', () => {
    const read = renderHook(() => useTitleWorkstream())
    const report = renderHook(({ name }) => useReportTitleWorkstream(name), {
      initialProps: { name: 'Kitchen' as string | null }
    })
    expect(read.result.current).toBe('Kitchen')
    report.rerender({ name: null })
    expect(read.result.current).toBeNull()
    report.rerender({ name: 'Dining room' })
    expect(read.result.current).toBe('Dining room')
    report.unmount()
    expect(read.result.current).toBeNull()
  })
})
