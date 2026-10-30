// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoalCheckIn, GoalMeasure, PlanningGoal } from '@shared/ostler-api'
import { GoalMeasureSection } from '@renderer/views/planning/goal-measure/GoalMeasureSection'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

const TODAY = '2026-01-16'

const MEASURE: GoalMeasure = {
  unit: 'members',
  startValue: 0,
  targetValue: 200,
  startDate: '2026-01-01',
  targetDate: '2026-01-21',
  direction: 'up'
}

const goal = (measure: GoalMeasure | null): PlanningGoal => ({
  id: 'g1',
  projectId: 'p1',
  title: 'Sign up members',
  outcome: '',
  status: 'active',
  measure,
  createdAt: 1,
  updatedAt: 1
})

const checkIn = (date: string, value: number, note = ''): GoalCheckIn => ({
  goalId: 'g1',
  projectId: 'p1',
  date,
  value,
  note,
  recordedAt: 5
})

function wrap(element: ReactElement) {
  return render(
    <ToastProvider>
      <ConfirmProvider>{element}</ConfirmProvider>
    </ToastProvider>
  )
}

describe('a goal measure in the panel (N5.6a)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('adds a measure through the small form', async () => {
    const updatePlanningGoal = vi.fn(async () => ({ ok: true as const, value: goal(MEASURE) }))
    installOstlerApi({ updatePlanningGoal })
    const onGoalChanged = vi.fn()
    wrap(
      <GoalMeasureSection
        goal={goal(null)}
        checkIns={[]}
        today={TODAY}
        onChanged={() => {}}
        onGoalChanged={onGoalChanged}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add a measure' }))
    const dialog = screen.getByRole('dialog', { name: 'Measure for Sign up members' })
    fireEvent.change(within(dialog).getByLabelText(/^Unit/), { target: { value: 'members' } })
    fireEvent.change(within(dialog).getByLabelText(/^Target$/), { target: { value: '1,200.5' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save measure' }))
    await waitFor(() => expect(updatePlanningGoal).toHaveBeenCalled())
    expect(updatePlanningGoal).toHaveBeenCalledWith('g1', {
      measure: expect.objectContaining({
        unit: 'members',
        startValue: 0,
        targetValue: 1200.5,
        startDate: TODAY,
        direction: 'up'
      })
    })
    await waitFor(() => expect(onGoalChanged).toHaveBeenCalled())
  })

  it('refuses a target on the wrong side of the start, in words', async () => {
    const updatePlanningGoal = vi.fn()
    installOstlerApi({ updatePlanningGoal })
    wrap(
      <GoalMeasureSection
        goal={goal(null)}
        checkIns={[]}
        today={TODAY}
        onChanged={() => {}}
        onGoalChanged={() => {}}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add a measure' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/^Start$/), { target: { value: '120' } })
    fireEvent.change(within(dialog).getByLabelText(/^Target$/), { target: { value: '20' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save measure' }))
    expect(
      await within(dialog).findByText('With higher is better, the target must be above the start')
    ).toBeTruthy()
    expect(updatePlanningGoal).not.toHaveBeenCalled()
  })

  it('shows the latest value, the pace and the chart summary', () => {
    installOstlerApi()
    wrap(
      <GoalMeasureSection
        goal={goal(MEASURE)}
        checkIns={[checkIn('2026-01-05', 40), checkIn('2026-01-16', 120)]}
        today={TODAY}
        onChanged={() => {}}
        onGoalChanged={() => {}}
      />
    )
    expect(screen.getByText('120 of 200 members')).toBeTruthy()
    expect(screen.getByText('30 behind the line')).toBeTruthy()
    const chart = screen.getByRole('img', { name: '120 of 200 members, 30 behind the line' })
    expect(chart.querySelectorAll('circle')).toHaveLength(2)
    expect(chart.querySelector('[data-series="line"]')?.getAttribute('stroke-dasharray')).toBe(
      '6 4'
    )
  })

  it('says the target is reached without closing the goal', () => {
    installOstlerApi()
    wrap(
      <GoalMeasureSection
        goal={goal(MEASURE)}
        checkIns={[checkIn('2026-01-16', 205)]}
        today={TODAY}
        onChanged={() => {}}
        onGoalChanged={() => {}}
      />
    )
    expect(screen.getByText('Target reached')).toBeTruthy()
    expect(screen.getByText('Mark the goal achieved when you are ready.')).toBeTruthy()
  })

  it('checks in by keyboard, today by default, and offers Undo', async () => {
    const recordGoalCheckIn = vi.fn(async (_goalId: string, input: { value: number }) => ({
      ok: true as const,
      value: { checkIn: checkIn(TODAY, input.value), replaced: null }
    }))
    const deleteGoalCheckIn = vi.fn(async () => ({
      ok: true as const,
      value: checkIn(TODAY, 142)
    }))
    installOstlerApi({ recordGoalCheckIn, deleteGoalCheckIn })
    const onChanged = vi.fn()
    wrap(
      <GoalMeasureSection
        goal={goal(MEASURE)}
        checkIns={[]}
        today={TODAY}
        onChanged={onChanged}
        onGoalChanged={() => {}}
      />
    )
    expect(screen.getByText(/No check-ins yet/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check in' }))
    const dialog = screen.getByRole('dialog', { name: 'Check in on Sign up members' })
    const value = within(dialog).getByLabelText('Value (members)')
    expect(document.activeElement).toBe(value)
    fireEvent.change(value, { target: { value: '142' } })
    fireEvent.submit(value.closest('form')!)
    await waitFor(() =>
      expect(recordGoalCheckIn).toHaveBeenCalledWith('g1', { date: TODAY, value: 142, note: '' })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(deleteGoalCheckIn).toHaveBeenCalledWith('g1', TODAY))
  })

  it('edits a check-in, and Undo puts the earlier reading back', async () => {
    const earlier = checkIn('2026-01-05', 40, 'First week')
    const recordGoalCheckIn = vi.fn(async () => ({
      ok: true as const,
      value: { checkIn: checkIn('2026-01-05', 45), replaced: earlier }
    }))
    const restoreGoalCheckIn = vi.fn(async () => ({ ok: true as const, value: earlier }))
    installOstlerApi({ recordGoalCheckIn, restoreGoalCheckIn })
    wrap(
      <GoalMeasureSection
        goal={goal(MEASURE)}
        checkIns={[earlier]}
        today={TODAY}
        onChanged={() => {}}
        onGoalChanged={() => {}}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^Edit the check-in for/ }))
    const dialog = screen.getByRole('dialog')
    const value = within(dialog).getByLabelText('Value (members)') as HTMLInputElement
    expect(value.value).toBe('40')
    fireEvent.change(value, { target: { value: '45' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save check-in' }))
    await waitFor(() =>
      expect(recordGoalCheckIn).toHaveBeenCalledWith('g1', {
        date: '2026-01-05',
        value: 45,
        note: 'First week'
      })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(restoreGoalCheckIn).toHaveBeenCalledWith('g1', earlier))
  })

  it('removes a check-in at once, with Undo', async () => {
    const entry = checkIn('2026-01-05', 40)
    const deleteGoalCheckIn = vi.fn(async () => ({ ok: true as const, value: entry }))
    const restoreGoalCheckIn = vi.fn(async () => ({ ok: true as const, value: entry }))
    installOstlerApi({ deleteGoalCheckIn, restoreGoalCheckIn })
    const onChanged = vi.fn()
    wrap(
      <GoalMeasureSection
        goal={goal(MEASURE)}
        checkIns={[entry]}
        today={TODAY}
        onChanged={onChanged}
        onGoalChanged={() => {}}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^Remove the check-in for/ }))
    await waitFor(() => expect(deleteGoalCheckIn).toHaveBeenCalledWith('g1', '2026-01-05'))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(restoreGoalCheckIn).toHaveBeenCalledWith('g1', entry))
    expect(onChanged).toHaveBeenCalledTimes(2)
  })
})
