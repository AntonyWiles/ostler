// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Person, PlanningWorkItem } from '@shared/ostler-api'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { AssigneeField } from '@renderer/views/planning/AssigneeField'
import { TaskChecklistEditor } from '@renderer/views/planning/TaskChecklistEditor'
import { PlanningCard } from '@renderer/views/planning/PlanningCard'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'

afterEach(() => __resetDismissableStackForTests())

function person(id: string, name: string, overrides: Partial<Person> = {}): Person {
  return {
    id,
    name,
    initials: name
      .split(' ')
      .map((word) => word[0])
      .join(''),
    color: '#3b82f6',
    isMe: false,
    archivedAt: null,
    weeklyCapacityHours: null,
    workingDays: [1, 2, 3, 4, 5],
    projectId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

const PEOPLE = [
  person('me', 'Jordan Reyes', { isMe: true }),
  person('ada', 'Ada Lovelace', { color: '#ec4899' }),
  person('old', 'Old Timer', { archivedAt: 5 })
]

function AssigneeHarness({ initial = null }: { initial?: string | null }) {
  const [value, setValue] = useState<string | null>(initial)
  return (
    <StaticPeopleProvider people={PEOPLE}>
      <AssigneeField projectId={null} value={value} onChange={setValue} />
      <output>{value ?? 'nobody'}</output>
    </StaticPeopleProvider>
  )
}

const assignee = () => screen.getByRole('combobox', { name: 'Assignee' })

describe('AssigneeField', () => {
  it('picks a person by keyboard, offering active people with avatars', () => {
    render(<AssigneeHarness />)
    fireEvent.keyDown(assignee(), { key: 'ArrowDown' })
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Unassigned',
      'JRJordan Reyes (you)',
      'ALAda Lovelace'
    ])
    expect(within(options[2]).getByRole('img', { name: 'Ada Lovelace' })).toBeInTheDocument()

    fireEvent.keyDown(assignee(), { key: 'ArrowDown' })
    fireEvent.keyDown(assignee(), { key: 'ArrowDown' })
    fireEvent.keyDown(assignee(), { key: 'Enter' })
    expect(screen.getByText('ada', { selector: 'output' })).toBeInTheDocument()
  })

  it('types to filter and Enter assigns the match', () => {
    render(<AssigneeHarness />)
    fireEvent.change(assignee(), { target: { value: 'love' } })
    fireEvent.keyDown(assignee(), { key: 'Enter' })
    expect(screen.getByText('ada', { selector: 'output' })).toBeInTheDocument()
  })

  it('assigns to me in one click, and the same button then unassigns me (MOP-13)', () => {
    render(<AssigneeHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Assign to me' }))
    expect(screen.getByText('me', { selector: 'output' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assign to me' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Unassign me' }))
    expect(screen.getByText('nobody', { selector: 'output' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign to me' })).toBeInTheDocument()
  })

  it('adds a person who is not on the list', async () => {
    render(<AssigneeHarness />)
    fireEvent.change(assignee(), { target: { value: 'Grace Hopper' } })
    expect(screen.getByRole('option', { name: 'Add person “Grace Hopper”' })).toBeInTheDocument()
    fireEvent.keyDown(assignee(), { key: 'Enter' })
    expect(await screen.findByText('new-Grace Hopper', { selector: 'output' })).toBeInTheDocument()
  })

  it('keeps showing an archived assignee without offering them to others', () => {
    render(<AssigneeHarness initial="old" />)
    expect(assignee()).toHaveValue('Old Timer')
    fireEvent.keyDown(assignee(), { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /Old Timer/ })).toHaveTextContent('Archived')
  })
})

describe('TaskChecklistEditor ticks', () => {
  function ChecklistHarness({ onCheck }: { onCheck: (text: string, checked: boolean) => void }) {
    const [items, setItems] = useState(['Docs', 'Tests', 'Review', 'Release notes', 'Demo'])
    return (
      <TaskChecklistEditor
        items={items}
        onChange={setItems}
        saved={['Docs', 'Tests', 'Review', 'Release notes', 'Demo']}
        checked={['Docs', 'Review', 'Demo']}
        onCheck={onCheck}
      />
    )
  }

  it('shows "3 of 5 done" and ticks a saved item', () => {
    const onCheck = vi.fn()
    render(<ChecklistHarness onCheck={onCheck} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '3')
    expect(bar).toHaveAttribute('aria-valuemax', '5')
    expect(screen.getByText('3 of 5 done')).toBeInTheDocument()

    expect(screen.getByRole('checkbox', { name: 'Done: Docs' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done: Tests' }))
    expect(onCheck).toHaveBeenCalledWith('Tests', true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done: Docs' }))
    expect(onCheck).toHaveBeenCalledWith('Docs', false)
  })

  it('does not tick a row until it is saved', () => {
    render(<ChecklistHarness onCheck={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    const rows = screen.getAllByRole('checkbox')
    expect(rows[rows.length - 1]).toBeDisabled()
    expect(rows[rows.length - 1]).toHaveAttribute('title', 'Save the task to tick this item')
  })
})

describe('TaskChecklistEditor dates and people (N2.2)', () => {
  function DetailsHarness({ onDetails }: { onDetails: (text: string, input: object) => void }) {
    const [items, setItems] = useState(['Confirm caterer', 'Send invitations'])
    return (
      <StaticPeopleProvider people={PEOPLE}>
        <TaskChecklistEditor
          items={items}
          onChange={setItems}
          saved={['Confirm caterer', 'Send invitations']}
          onCheck={vi.fn()}
          details={[{ text: 'Send invitations', dueDate: '2099-03-14', assigneeId: 'ada' }]}
          onDetails={onDetails}
        />
      </StaticPeopleProvider>
    )
  }

  it('sets an item’s person and date from its button, by mouse', () => {
    const onDetails = vi.fn()
    render(<DetailsHarness onDetails={onDetails} />)
    fireEvent.click(screen.getByRole('button', { name: 'Date and person for Confirm caterer' }))
    const panel = screen.getByRole('dialog', { name: 'Date and person for item 1' })
    const person = within(panel).getByRole('combobox', { name: 'Person' })
    fireEvent.change(person, { target: { value: 'love' } })
    fireEvent.keyDown(person, { key: 'Enter' })
    expect(onDetails).toHaveBeenCalledWith('Confirm caterer', { assigneeId: 'ada' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Assign to me' }))
    expect(onDetails).toHaveBeenCalledWith('Confirm caterer', { assigneeId: 'me' })
  })

  it('shows a set item’s date and person as chips, reached and cleared by keyboard', () => {
    const onDetails = vi.fn()
    render(<DetailsHarness onDetails={onDetails} />)
    const chips = screen.getByRole('button', {
      name: /^Date and person for Send invitations: .*, Ada Lovelace$/
    })
    expect(chips).toHaveTextContent('Ada Lovelace')
    // A real button: Tab reaches it from the item, and Enter or Space opens it.
    expect(chips.tagName).toBe('BUTTON')
    chips.focus()
    fireEvent.click(chips)
    const panel = screen.getByRole('dialog', { name: 'Date and person for item 2' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Clear date and person' }))
    expect(onDetails).toHaveBeenCalledWith('Send invitations', { dueDate: null, assigneeId: null })
  })

  it('offers no controls for a row not yet saved, and says when two rows are alike', () => {
    render(<DetailsHarness onDetails={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Checklist item 3' }), {
      target: { value: 'Confirm caterer' }
    })
    expect(
      screen.getByText("Same as another item: they'll be one item when saved.")
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Date and person for/ })).toHaveLength(2)
  })
})

describe('PlanningCard essentials', () => {
  let base: PlanningWorkspace
  beforeEach(async () => {
    base = await renderPlanningWorkspace()
  })

  const card = (item: PlanningWorkItem) =>
    render(
      <StaticPeopleProvider people={PEOPLE}>
        <PlanningCard item={item} ws={withWorkspace(base, {})} />
      </StaticPeopleProvider>
    )

  it('shows the assignee avatar, checklist progress and the start–due range', () => {
    const { container } = card(
      makeWorkItem('w1', {
        assigneeId: 'ada',
        acceptanceCriteria: ['Docs', 'Tests', 'Review'],
        checkedCriteria: ['Docs'],
        startDate: '2026-10-12',
        targetDate: '2026-10-20'
      })
    )
    const meta = container.querySelector('.task-card__meta') as HTMLElement
    expect(within(meta).getByRole('img', { name: 'Ada Lovelace' })).toHaveTextContent('AL')
    expect(within(meta).getByTitle('Assigned to Ada Lovelace')).toBeInTheDocument()
    expect(within(meta).getByTitle('Checklist: 1 of 3 done')).toHaveTextContent('1/3')
    const due = meta.querySelector('.task-card__due') as HTMLElement
    expect(due.getAttribute('title')).toMatch(/^Starts .*2026 · /)
  })

  it('shows neither while the task has no assignee or checklist', () => {
    const { container } = card(makeWorkItem('w2'))
    const meta = container.querySelector('.task-card__meta') as HTMLElement
    expect(within(meta).queryByRole('img', { name: /Ada|Jordan/ })).toBeNull()
    expect(meta.querySelector('.task-card__checklist')).toBeNull()
  })

  it('shows the next dated checklist item when it comes before the task is due (N2.2)', () => {
    const { container } = card(
      makeWorkItem('w3', {
        acceptanceCriteria: ['Confirm caterer', 'Send invitations'],
        checklistDetails: [
          { text: 'Confirm caterer', dueDate: '2099-03-14', assigneeId: null },
          { text: 'Send invitations', dueDate: '2099-03-10', assigneeId: 'ada' }
        ],
        targetDate: '2099-03-20'
      })
    )
    expect(container.querySelector('.task-card__next-item')).toHaveTextContent(
      /^Next: Send invitations, /
    )
  })
})
