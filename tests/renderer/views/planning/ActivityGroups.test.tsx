// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ActivityEntry } from '@shared/ostler-api'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ActivityList } from '@renderer/views/planning/ActivityList'

/** Twelve "created" rows from one template, as a new project's feed has them. */
const templateRows: ActivityEntry[] = Array.from({ length: 12 }, (_, index) => ({
  id: `f${index}`,
  kind: 'change',
  field: 'created',
  projectId: 'p1',
  workItemId: `w${index}`,
  workItemTitle: `Task ${index + 1}`,
  at: Date.now() - 60_000,
  actor: { kind: 'human', personId: null, name: 'Alex' },
  summary: 'Alex created the task from template “Software project”',
  source: { kind: 'template', name: 'Software project' }
}))

function renderList(grouped: boolean, onOpenTask = vi.fn()) {
  render(
    <StaticPeopleProvider people={[]}>
      <ActivityList
        entries={templateRows}
        grouped={grouped}
        onChanged={vi.fn()}
        onError={vi.fn()}
        onOpenTask={onOpenTask}
      />
    </StaticPeopleProvider>
  )
  return onOpenTask
}

describe('grouped activity', () => {
  it('shows a template’s twelve rows as one row that expands to the tasks', () => {
    const onOpenTask = renderList(true)
    const list = screen.getAllByRole('list')[0]
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(
      screen.getByText('Alex added 12 tasks from the “Software project” template')
    ).toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: 'Show the 12 tasks' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide the tasks' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    fireEvent.click(screen.getByRole('button', { name: /Task 3$/ }))
    expect(onOpenTask).toHaveBeenCalledWith('w2')
    expect(screen.getAllByRole('button', { name: /^Open Task|Task \d+$/ })).toHaveLength(12)
  })

  it('leaves the rows as they are where grouping is off (a task’s own history)', () => {
    renderList(false)
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(12)
  })
})
