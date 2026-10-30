// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyDayTask, TimeBlock, TimeBlocksQuery } from '@shared/ostler-api'
import { MyDaySection } from '@renderer/views/home/MyDaySection'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const TODAY = '2026-10-16'

const task = (id: string, title: string): MyDayTask => ({
  id,
  projectId: 'web',
  projectName: 'Website',
  projectColor: '#3b82f6',
  title,
  status: 'ready',
  priority: 'medium',
  targetDate: null,
  assigneeId: null,
  linked: false,
  estimate: null,
  estimateUnit: 'hours'
})

const block = (id: string, workItemId: string, title: string, start: number, length: number) =>
  ({
    id,
    projectId: 'web',
    workItemId,
    date: TODAY,
    startMinute: start,
    lengthMinutes: length,
    createdAt: 1,
    title,
    status: 'ready'
  }) satisfies TimeBlock

describe("My day's time blocks (N3.4a)", () => {
  // Before the first block starts, so none has passed (N3.4b).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 16, 8) })
  })
  afterEach(() => vi.useRealTimers())

  it("shows today's blocks in time order above the list, each opening its task, and each task's times", async () => {
    const getTimeBlocks = vi.fn(async (query: TimeBlocksQuery) => ({
      ok: true as const,
      value:
        query.from === TODAY && query.to === TODAY
          ? [
              block('b2', 'a', 'Write the proposal', 540, 90),
              block('b1', 'c', 'Call the printer', 840, 30),
              block('b3', 'a', 'Write the proposal', 960, 60)
            ]
          : []
    }))
    installOstlerApi({ getTimeBlocks })
    render(
      <ToastProvider>
        <MemoryRouter>
          <MyDaySection
            tasks={[task('a', 'Write the proposal'), task('b', 'Water the plants')]}
            today={TODAY}
            onChanged={() => {}}
          />
        </MemoryRouter>
      </ToastProvider>
    )
    const list = await screen.findByRole('list', { name: 'Time blocks today' })
    const links = within(list).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Write the proposal, 09:00 to 10:30, 1 h 30 min',
      'Call the printer, 14:00 to 14:30, 30 min',
      'Write the proposal, 16:00 to 17:00, 1 h'
    ])
    expect(links[1]).toHaveAttribute('href', '/projects/web/tasks/c')
    // A task's block times beside it; blocking time added no task to the list.
    expect(screen.getByText('Time blocked: 09:00 to 10:30, 16:00 to 17:00')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Call the printer' })).not.toBeInTheDocument()
  })
})
