// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TaskSubtasksSection } from '@renderer/views/planning/TaskSubtasksSection'
import { AnnouncerProvider } from '@renderer/ui'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'
import { makeWorkItem } from '../../fixtures/planning-records'

/** A task's subtasks keep a stored order, set by dragging or Alt and an arrow (D31). */

const PARENT = makeWorkItem('parent', { title: 'Party', orderKey: 'a' })
const child = (id: string, title: string, orderKey: string) =>
  makeWorkItem(id, {
    title,
    orderKey,
    parentWorkItemId: 'parent',
    subtaskPhaseNumber: 1
  })
const ITEMS = [
  PARENT,
  child('drinks', 'Buy drinks', 'c'),
  child('snacks', 'Buy snacks', 'b'),
  child('music', 'Pick music', 'd')
]

async function renderSubtasks() {
  const base = await renderPlanningWorkspace({
    api: { getPlanningWorkItems: async () => ({ ok: true, value: ITEMS }) }
  })
  const placeWorkItem = vi.fn(async () => {})
  const ws = withWorkspace(base, { placeWorkItem })
  render(
    <AnnouncerProvider>
      <TaskSubtasksSection ws={ws} item={PARENT} openTask={() => {}} />
    </AnnouncerProvider>
  )
  return placeWorkItem
}

const titles = () =>
  [...document.querySelectorAll('.task-subtasks__open')].map((button) => button.textContent)

describe('TaskSubtasksSection order (D31)', () => {
  it('lists subtasks in their stored order', async () => {
    await renderSubtasks()
    expect(titles()).toEqual(['Buy snacks', 'Buy drinks', 'Pick music'])
  })

  it('moves a subtask with Alt and Up or Down, and says where it went', async () => {
    const place = await renderSubtasks()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Buy drinks' }), {
      key: 'ArrowDown',
      altKey: true
    })
    expect(place).toHaveBeenCalledWith(expect.objectContaining({ id: 'drinks' }), {
      afterId: 'music'
    })
    expect(document.querySelector('[data-announcer]')).toHaveTextContent(
      'Moved below Pick music, 3 of 3'
    )
  })

  it('takes a subtask dropped above another', async () => {
    const place = await renderSubtasks()
    const row = (title: string) => screen.getByRole('button', { name: title }).closest('li')!
    const dataTransfer = { getData: () => 'music', setData: vi.fn(), dropEffect: '' }
    fireEvent.dragStart(row('Pick music'), { dataTransfer })
    fireEvent.dragOver(row('Buy snacks'), { dataTransfer })
    fireEvent.drop(row('Buy snacks'), { dataTransfer })
    // jsdom has no layout, so the pointer counts as being in the lower half.
    expect(place).toHaveBeenCalledWith(expect.objectContaining({ id: 'music' }), {
      afterId: 'snacks'
    })
  })
})
