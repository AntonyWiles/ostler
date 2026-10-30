// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PlanningReminder } from '@shared/ostler-api'
import { formatTime } from '@shared/format'
import { TaskRepeatSection } from '@renderer/views/planning/TaskRepeatSection'
import { ReminderNudgeBar } from '@renderer/views/planning/ReminderNudgeBar'
import { ToastProvider } from '@renderer/ui'
import { makeWorkItem } from '../../fixtures/planning-records'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'

const remindAt = new Date(2026, 9, 7, 10, 0).getTime()

function reminder(overrides: Partial<PlanningReminder> = {}): PlanningReminder {
  return {
    id: 'r1',
    projectId: 'p1',
    workItemId: 'a',
    remindAt,
    kind: 'custom',
    deliveredAt: remindAt,
    dismissedAt: null,
    keepReminding: true,
    intervalMinutes: 15,
    lastNudgedAt: remindAt,
    stoppedAt: null,
    ...overrides
  }
}

describe('Keep reminding me (N1.7)', () => {
  it('adds a reminder that keeps reminding at the default interval from Settings', async () => {
    const addPlanningReminder = vi.fn(async () => ({ ok: true as const, value: reminder() }))
    installOstlerApi({
      getPlanningRecurrence: async () => ({ ok: true, value: null }),
      getPlanningReminders: async () => ({ ok: true, value: [] }),
      getConfig: async () => ({
        ok: true,
        value: {
          ...RENDERER_DEFAULT_CONFIG,
          notifications: { ...RENDERER_DEFAULT_CONFIG.notifications, keepRemindingMinutes: 30 }
        }
      }),
      addPlanningReminder
    })
    render(
      <ToastProvider>
        <TaskRepeatSection item={makeWorkItem('a', { title: 'Call the council' })} />
      </ToastProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Remind me…' }))
    const keep = await screen.findByRole('switch', { name: /Keep reminding me/ })
    expect(screen.queryByLabelText('Every')).toBeNull()
    fireEvent.click(keep)
    const every = (await screen.findByLabelText('Every')) as HTMLSelectElement
    await waitFor(() => expect(every.value).toBe('30'))
    expect([...every.options].map((option) => option.value)).toEqual(['5', '15', '30', '60'])
    fireEvent.change(every, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }))
    await waitFor(() =>
      expect(addPlanningReminder).toHaveBeenCalledWith('a', expect.any(Number), {
        keepReminding: true,
        intervalMinutes: 5
      })
    )
  })

  it('adds a plain reminder when the switch is off', async () => {
    const addPlanningReminder = vi.fn(async () => ({ ok: true as const, value: reminder() }))
    installOstlerApi({
      getPlanningRecurrence: async () => ({ ok: true, value: null }),
      getPlanningReminders: async () => ({ ok: true, value: [] }),
      addPlanningReminder
    })
    render(
      <ToastProvider>
        <TaskRepeatSection item={makeWorkItem('a', { title: 'Call the council' })} />
      </ToastProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Remind me…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add reminder' }))
    await waitFor(() =>
      expect(addPlanningReminder).toHaveBeenCalledWith('a', expect.any(Number), undefined)
    )
  })

  it('shows on the reminder’s row that it keeps reminding', async () => {
    installOstlerApi({
      getPlanningRecurrence: async () => ({ ok: true, value: null }),
      getPlanningReminders: async () => ({
        ok: true,
        value: [reminder({ deliveredAt: null, lastNudgedAt: null, intervalMinutes: 30 })]
      })
    })
    render(
      <ToastProvider>
        <TaskRepeatSection item={makeWorkItem('a', { title: 'Call the council' })} />
      </ToastProvider>
    )
    expect(
      await screen.findByText('Your reminder, keeps reminding every 30 minutes')
    ).toBeInTheDocument()
  })
})

describe('The drawer’s keep-reminding bar (N1.7)', () => {
  const renderBar = (onDone = vi.fn()) => {
    render(
      <ToastProvider>
        <ReminderNudgeBar item={makeWorkItem('a', { title: 'Call the council' })} onDone={onDone} />
      </ToastProvider>
    )
    return onDone
  }

  it('shows nothing without a reminder that is still nudging', async () => {
    const getPlanningReminders = vi.fn(async () => ({
      ok: true as const,
      value: [reminder({ stoppedAt: remindAt + 1 }), reminder({ id: 'r2', keepReminding: false })]
    }))
    installOstlerApi({ getPlanningReminders })
    renderBar()
    await waitFor(() => expect(getPlanningReminders).toHaveBeenCalled())
    expect(screen.queryByText(/keeps reminding/)).toBeNull()
  })

  it('offers Snooze, Done and Stop reminding', async () => {
    const snoozeInboxReminder = vi.fn(async () => ({
      ok: true as const,
      value: { items: [], unreadCount: 0 }
    }))
    const stopPlanningReminder = vi.fn(async () => ({
      ok: true as const,
      value: reminder({ stoppedAt: Date.now() })
    }))
    installOstlerApi({
      getPlanningReminders: async () => ({ ok: true, value: [reminder()] }),
      snoozeInboxReminder,
      stopPlanningReminder
    })
    const onDone = renderBar()
    const time = formatTime(remindAt)
    expect(await screen.findByText(`Reminder: ${time}, keeps reminding`)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'For an hour' }))
    await waitFor(() => expect(snoozeInboxReminder).toHaveBeenCalledWith('reminder:r1', 'hour'))

    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: `Tomorrow at ${time}` }))
    await waitFor(() => expect(snoozeInboxReminder).toHaveBeenCalledWith('reminder:r1', 'tomorrow'))

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onDone).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Stop reminding' }))
    await waitFor(() => expect(stopPlanningReminder).toHaveBeenCalledWith('a', 'r1'))
  })
})
