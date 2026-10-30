// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Person, PlanningRecurrence } from '@shared/ostler-api'
import { TaskRepeatSection } from '@renderer/views/planning/TaskRepeatSection'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { makeWorkItem } from '../../fixtures/planning-records'
import { installOstlerApi } from '../../fixtures/ostler-api'

/** Opens Repeat… for a task with this recurrence, and returns the Repeats picker. */
async function openRepeat(recurrence: PlanningRecurrence | null) {
  const setPlanningRecurrence = vi.fn()
  installOstlerApi({
    getPlanningRecurrence: async () => ({ ok: true, value: recurrence }),
    getPlanningReminders: async () => ({ ok: true, value: [] }),
    setPlanningRecurrence
  })
  render(<TaskRepeatSection item={makeWorkItem('a', { title: 'Water the plants' })} />)
  fireEvent.click(await screen.findByRole('button', { name: recurrence ? 'Change…' : 'Repeat…' }))
  return {
    repeats: (await screen.findByLabelText('Repeats')) as HTMLSelectElement,
    setPlanningRecurrence
  }
}

describe('Repeat dialog', () => {
  it('opens on "Does not repeat" for a task that does not repeat, and saves nothing', async () => {
    const { repeats, setPlanningRecurrence } = await openRepeat(null)
    expect(repeats.value).toBe('none')
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(setPlanningRecurrence).not.toHaveBeenCalled()
  })

  it('opens on its own rule for a task that repeats', async () => {
    const { repeats } = await openRepeat({
      workItemId: 'a',
      projectId: 'p1',
      rule: { every: 'month', interval: 1, monthDay: 12 },
      endsOn: null,
      remaining: null,
      rotation: null,
      nextIndex: 0,
      goToAgents: false
    })
    expect(repeats.value).toBe('monthly')
  })
})

function person(id: string, name: string, archived = false): Person {
  return {
    id,
    name,
    initials: name.slice(0, 1),
    color: '#3b82f6',
    isMe: false,
    archivedAt: archived ? 1 : null,
    weeklyCapacityHours: null,
    workingDays: [1, 2, 3, 4, 5],
    projectId: null,
    createdAt: 0,
    updatedAt: 0
  }
}

const turns = (rotation: string[] | null, nextIndex = 0): PlanningRecurrence => ({
  workItemId: 'a',
  projectId: 'p1',
  rule: { every: 'week', interval: 1, weekdays: [2] },
  endsOn: null,
  remaining: null,
  rotation,
  nextIndex,
  goToAgents: false
})

/** The Repeat section with these people, and the recurrence the drawer loads. */
async function renderTurns(recurrence: PlanningRecurrence, people: Person[]) {
  const setPlanningRecurrence = vi.fn(async (_id: string, input: unknown) => ({
    ok: true as const,
    value: input === null ? null : { ...recurrence, ...(input as object) }
  }))
  installOstlerApi({
    getPlanningRecurrence: async () => ({ ok: true, value: recurrence }),
    getPlanningReminders: async () => ({ ok: true, value: [] }),
    setPlanningRecurrence
  })
  render(
    <StaticPeopleProvider people={people}>
      <TaskRepeatSection item={makeWorkItem('a', { title: 'Bins out' })} />
    </StaticPeopleProvider>
  )
  return { setPlanningRecurrence }
}

describe('Go to agents when it comes round (N9.7)', () => {
  const weekly = turns(null)

  it('is hidden without agents or a linked folder, and never sent', async () => {
    const { setPlanningRecurrence } = await renderTurns({ ...weekly, goToAgents: true }, [])
    expect(screen.queryByTestId('goes-to-agents-summary')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Change…' }))
    await screen.findByLabelText('Repeats')
    expect(screen.queryByRole('switch', { name: /Go to agents/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'daily' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(setPlanningRecurrence).toHaveBeenCalled())
    expect(setPlanningRecurrence.mock.calls.at(-1)![1]).not.toHaveProperty('goToAgents')
  })

  it('turns on with agents and a folder, says what it does, and saves', async () => {
    const setPlanningRecurrence = vi.fn(async (_id: string, input: unknown) => ({
      ok: true as const,
      value: { ...weekly, ...(input as object) }
    }))
    installOstlerApi({
      getPlanningRecurrence: async () => ({ ok: true, value: weekly }),
      getPlanningReminders: async () => ({ ok: true, value: [] }),
      setPlanningRecurrence
    })
    render(
      <TaskRepeatSection
        item={makeWorkItem('a', { title: 'Update the dependencies' })}
        canGoToAgents
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Change…' }))
    const toggle = await screen.findByRole('switch', { name: /Go to agents when it comes round/ })
    expect(screen.getByText(/queued for agents on its start date/)).toBeTruthy()
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(setPlanningRecurrence).toHaveBeenCalled())
    expect(setPlanningRecurrence.mock.calls.at(-1)![1]).toMatchObject({ goToAgents: true })
    expect(await screen.findByTestId('goes-to-agents-summary')).toBeTruthy()
  })
})

const SAM = person('sam', 'Sam')
const ALEX = person('alex', 'Alex')
const JO = person('jo', 'Jo')

describe('Take turns', () => {
  it('says whose turn is next', async () => {
    await renderTurns(turns(['sam', 'alex', 'jo'], 1), [SAM, ALEX, JO])
    expect((await screen.findByTestId('take-turns-summary')).textContent).toBe(
      'Take turns: Sam, Alex and Jo. Next: Alex'
    )
  })

  it('passes over an archived person and says so', async () => {
    await renderTurns(turns(['sam', 'alex', 'jo'], 1), [SAM, person('alex', 'Alex', true), JO])
    expect((await screen.findByTestId('take-turns-summary')).textContent).toBe(
      'Take turns: Sam, Alex and Jo. Next: Jo (Alex is archived, so passed over)'
    )
  })

  it('says the next occurrence keeps its assignee when everyone is archived', async () => {
    await renderTurns(turns(['sam'], 0), [person('sam', 'Sam', true)])
    expect((await screen.findByTestId('take-turns-summary')).textContent).toContain(
      'Everyone is archived'
    )
  })

  async function openDialog() {
    fireEvent.click(await screen.findByRole('button', { name: 'Change…' }))
    return screen.findByRole('switch', { name: /Take turns/ })
  }

  it('reorders with the buttons and the keyboard, removes, and saves the order', async () => {
    const { setPlanningRecurrence } = await renderTurns(turns(['sam', 'alex', 'jo']), [
      SAM,
      ALEX,
      JO
    ])
    await openDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Move Jo up' }))
    // Sam, Jo, Alex; then Alt+Down on Sam's row: Jo, Sam, Alex.
    const samRow = screen.getByText('Sam').closest('li')!
    fireEvent.keyDown(samRow, { key: 'ArrowDown', altKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alex' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(setPlanningRecurrence).toHaveBeenCalled())
    const input = setPlanningRecurrence.mock.calls.at(-1)![1] as Record<string, unknown>
    expect(input.rotation).toEqual(['jo', 'sam'])
    // The service keeps whoever was next; the drawer never sends an index.
    expect(input).not.toHaveProperty('nextIndex')
  })

  it('reorders by dragging a row onto another', async () => {
    const { setPlanningRecurrence } = await renderTurns(turns(['sam', 'alex']), [SAM, ALEX])
    await openDialog()
    const rows = screen.getAllByRole('listitem')
    const dataTransfer = { effectAllowed: '', setData: () => undefined }
    fireEvent.dragStart(rows[1], { dataTransfer })
    fireEvent.dragOver(rows[0], { dataTransfer })
    fireEvent.drop(rows[0], { dataTransfer })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(setPlanningRecurrence).toHaveBeenCalled())
    const input = setPlanningRecurrence.mock.calls.at(-1)![1] as Record<string, unknown>
    expect(input.rotation).toEqual(['alex', 'sam'])
  })

  it('adds people by the picker, never offering an archived one', async () => {
    const { setPlanningRecurrence } = await renderTurns(turns(null), [
      SAM,
      person('alex', 'Alex', true)
    ])
    const toggle = await openDialog()
    fireEvent.click(toggle)
    const picker = screen.getByRole('combobox', { name: 'Add a person' })
    fireEvent.focus(picker)
    fireEvent.change(picker, { target: { value: '' } })
    fireEvent.keyDown(picker, { key: 'ArrowDown' })
    expect(screen.queryByRole('option', { name: /Alex/ })).toBeNull()
    fireEvent.click(await screen.findByRole('option', { name: /Sam/ }))
    expect(screen.getByRole('button', { name: 'Remove Sam' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(setPlanningRecurrence).toHaveBeenCalled())
    expect(
      (setPlanningRecurrence.mock.calls.at(-1)![1] as Record<string, unknown>).rotation
    ).toEqual(['sam'])
  })

  it('turning it off saves no rotation', async () => {
    const { setPlanningRecurrence } = await renderTurns(turns(['sam']), [SAM])
    const toggle = await openDialog()
    fireEvent.click(toggle)
    expect(screen.queryByRole('button', { name: 'Remove Sam' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(setPlanningRecurrence).toHaveBeenCalled())
    expect(
      (setPlanningRecurrence.mock.calls.at(-1)![1] as Record<string, unknown>).rotation
    ).toBeNull()
  })
})
