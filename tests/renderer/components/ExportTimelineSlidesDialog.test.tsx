// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RendererProject } from '@shared/ostler-api'
import { ExportTimelineSlidesDialog } from '@renderer/components/share/ExportTimelineSlidesDialog'
import { ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { installOstlerApi } from '../fixtures/ostler-api'

afterEach(() => __resetDismissableStackForTests())

const project = { id: 'p1', name: 'Launch' } as RendererProject
const view = {
  from: '2026-11-01',
  to: '2026-12-31',
  taskIds: ['a', 'b'],
  zoom: 'week' as const,
  groupBy: 'assignee' as const,
  collapsed: ['assignee:none']
}

function open(onClose = vi.fn()) {
  render(
    <ToastProvider>
      <ExportTimelineSlidesDialog project={project} view={view} onClose={onClose} />
    </ToastProvider>
  )
  return onClose
}

describe('Export to PowerPoint slide (N7.6)', () => {
  it('sends the Timeline’s tasks, grouping and the range picked, then closes', async () => {
    const exportTimelineSlides = vi.fn(async () => ({
      ok: true as const,
      value: 'C:\\out\\Launch timeline.pptx'
    }))
    installOstlerApi({ exportTimelineSlides })
    const onClose = open()
    expect(screen.getByLabelText('From')).toHaveProperty('value', '2026-11-01')
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose where…' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(exportTimelineSlides).toHaveBeenCalledWith('p1', { ...view, to: '2026-11-30' })
  })

  it('refuses a From date after the To date without calling main', async () => {
    const exportTimelineSlides = vi.fn()
    installOstlerApi({ exportTimelineSlides })
    const onClose = open()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2027-01-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose where…' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Choose a From date on or before the To date.'
    )
    expect(exportTimelineSlides).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
