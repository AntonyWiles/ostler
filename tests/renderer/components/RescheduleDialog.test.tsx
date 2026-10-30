// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RescheduleQuery } from '@shared/ostler-api'
import type {
  RescheduleChange,
  ReschedulePlan,
  RescheduleResult
} from '@shared/planning/reschedule'
import { RescheduleDialog } from '@renderer/components/reschedule/RescheduleDialog'
import { ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { installOstlerApi } from '../fixtures/ostler-api'

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({
    projects: [{ id: 'p1', name: 'Website', color: '#3b82f6', enabled: true }],
    loading: false
  })
}))

const PLAN: ReschedulePlan = {
  mode: 'tomorrow',
  days: [],
  entries: [
    {
      id: 'a',
      projectId: 'p1',
      title: 'Write the brief',
      fromDue: '2026-10-01',
      toDue: '2026-10-16',
      fromStart: null,
      toStart: null,
      recurring: true,
      warnings: []
    },
    {
      id: 'b',
      projectId: 'p1',
      title: 'Build the page',
      fromDue: '2026-10-05',
      toDue: '2026-10-16',
      fromStart: null,
      toStart: null,
      recurring: false,
      warnings: [
        {
          taskId: 'b',
          taskTitle: 'Build the page',
          dependencyId: 'd',
          dependencyTitle: 'Design',
          start: '2026-10-16',
          dependencyDue: '2026-10-20'
        }
      ]
    }
  ]
}

function setup() {
  const previewReschedule = vi.fn(async (_query: RescheduleQuery) => ({
    ok: true as const,
    value: PLAN
  }))
  const applyReschedule = vi.fn(async (changes: RescheduleChange[]) => ({
    ok: true as const,
    value: { changed: changes, skipped: [] } satisfies RescheduleResult
  }))
  installOstlerApi({ previewReschedule, applyReschedule })
  const onClose = vi.fn()
  const onChanged = vi.fn()
  render(
    <ToastProvider>
      <RescheduleDialog open onClose={onClose} onChanged={onChanged} />
    </ToastProvider>
  )
  return { previewReschedule, applyReschedule, onClose, onChanged }
}

describe('RescheduleDialog (N1.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 15, 9))
  })
  afterEach(() => {
    __resetDismissableStackForTests()
    vi.useRealTimers()
  })

  it('previews every new date, the repeat note and the dependency warning', async () => {
    const { previewReschedule } = setup()
    await screen.findByText('Write the brief')
    expect(previewReschedule).toHaveBeenCalledWith({ today: '2026-10-15', mode: 'tomorrow' })
    expect(screen.getByText(/this occurrence moves, the repeat rule stays/)).toBeTruthy()
    expect(screen.getByText(/Starts before "Design" is due/)).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: 'Spread over the next working days' }))
    await waitFor(() =>
      expect(previewReschedule).toHaveBeenLastCalledWith({
        today: '2026-10-15',
        mode: 'spread',
        days: 5
      })
    )
  })

  it('leaves an unticked task out, and the toast undoes the rest', async () => {
    const { applyReschedule, onClose, onChanged } = setup()
    await screen.findByText('Write the brief')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Build the page' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reschedule 1 task' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(applyReschedule).toHaveBeenCalledWith([
      { id: 'a', fromDue: '2026-10-01', toDue: '2026-10-16', fromStart: null, toStart: null }
    ])
    expect(onChanged).toHaveBeenCalledTimes(1)

    await screen.findByText('Rescheduled 1 task')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(applyReschedule).toHaveBeenLastCalledWith([
        { id: 'a', fromDue: '2026-10-16', toDue: '2026-10-01', fromStart: null, toStart: null }
      ])
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
  })
})
