// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanningMilestone } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import type { ObjectMap } from '@shared/whiteboard/history'
import { cleanWhiteboardObject, type WhiteboardObjectInput } from '@shared/whiteboard/model'
import type { MakeWhiteboardTasksInput } from '@shared/whiteboard/tasks'
import {
  WhiteboardEditor,
  type WhiteboardEditorProps
} from '@renderer/components/whiteboard/WhiteboardEditor'
import { AnnouncerProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { installOstlerApi } from '../fixtures/ostler-api'

/**
 * Make tasks from whiteboard objects (docs/plans/whiteboards, prompt 13, D17, D27): `K` and
 * the style bar's button open the dialog; Make saves first, then each object links to its
 * task as one undo step; the toast's undo goes to main.
 */

const S = BRAND.urlScheme
const PROJECT = '11111111-2222-4333-8444-555555555555'
const BOARD_ID = '99999999-2222-4333-8444-555555555555'
const T1 = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001'
const T2 = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000002'
const OLD = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000009'
const taskUrl = (id: string) => `${S}://task/${PROJECT}/${id}`

function object(fields: Record<string, unknown>): WhiteboardObjectInput {
  return cleanWhiteboardObject({ x: 0, y: 0, width: 200, height: 200, z: 1, ...fields })
}

const noteA = object({ id: 'a', kind: 'note', text: 'Call the venue !high', z: 1 })
const noteB = object({ id: 'b', kind: 'note', text: 'Order the cake\nchocolate', x: 300, z: 2 })
const linked = object({ id: 'c', kind: 'note', text: 'Old', x: 600, z: 3, link: taskUrl(OLD) })
const BOARD = [noteA, noteB, linked]

function milestone(id: string, name: string, status: PlanningMilestone['status']) {
  return { id, projectId: PROJECT, name, status } as PlanningMilestone
}
const MILESTONES = [
  milestone('m1', 'The party', 'active'),
  milestone('m2', 'Last year', 'complete'),
  milestone('m3', 'Next', 'planned')
]

let changes: ObjectMap[] = []
const latest = () => changes[changes.length - 1]
const order: string[] = []

afterEach(() => {
  __resetDismissableStackForTests()
  vi.clearAllMocks()
  changes = []
  order.length = 0
})

function install() {
  const makeWhiteboardTasks = vi.fn(async (_projectId: string, input: MakeWhiteboardTasksInput) => {
    order.push('make')
    return {
      ok: true as const,
      value: {
        made: input.tasks.map((task, index) => ({
          objectId: task.objectId,
          taskId: [T1, T2][index]
        }))
      }
    }
  })
  const undoWhiteboardTasks = vi.fn(async () => ({ ok: true as const, value: undefined }))
  installOstlerApi({
    makeWhiteboardTasks,
    undoWhiteboardTasks,
    getPlanningLabels: async () => ({ ok: true, value: [] })
  })
  return { makeWhiteboardTasks, undoWhiteboardTasks }
}

const flush = vi.fn(async () => {
  order.push('flush')
})

function renderEditor(props: Partial<WhiteboardEditorProps> = {}) {
  render(
    <AnnouncerProvider>
      <ToastProvider>
        <WhiteboardEditor
          title="Party"
          objects={BOARD}
          version={1}
          onChange={(present) => changes.push(present)}
          imageUrl={() => null}
          projectId={PROJECT}
          whiteboardId={BOARD_ID}
          milestones={MILESTONES}
          flush={flush}
          {...props}
        />
      </ToastProvider>
    </AnnouncerProvider>
  )
}

function focus(element: Element) {
  act(() => (element as HTMLElement).focus())
}

function key(init: KeyboardEventInit) {
  fireEvent.keyDown(document.activeElement ?? document.body, init)
}

/** Every object selected, focus on the board. */
function selectAll() {
  focus(screen.getByRole('button', { name: /Call the venue/ }))
  key({ key: 'a', ctrlKey: true })
}

describe('Make tasks on a whiteboard', () => {
  it('K opens the dialog with two tasks and one object left out', async () => {
    install()
    renderEditor()
    selectAll()
    key({ key: 'k' })

    const dialog = await screen.findByRole('dialog', { name: 'Make tasks' })
    const list = within(dialog).getByRole('list', { name: 'Tasks to make' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText('Call the venue')).toBeTruthy()
    expect(within(list).getByText('High')).toBeTruthy()
    expect(within(list).getByText('Order the cake')).toBeTruthy()
    expect(within(list).getByText('1 line of description')).toBeTruthy()
    expect(within(dialog).getByText('1 object left out: already linked.')).toBeTruthy()
    // Planned and active milestones only.
    const select = within(dialog).getByRole('combobox', { name: 'Milestone' })
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['No milestone', 'The party', 'Next'])
    expect(within(dialog).getByRole('button', { name: 'Make 2 tasks' })).toBeTruthy()
  })

  it('Make saves first, then the notes link to their tasks in one undo step', async () => {
    const { makeWhiteboardTasks, undoWhiteboardTasks } = install()
    renderEditor()
    selectAll()
    key({ key: 'k' })
    const dialog = await screen.findByRole('dialog', { name: 'Make tasks' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Milestone' }), {
      target: { value: 'm1' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make 2 tasks' }))

    await waitFor(() => expect(makeWhiteboardTasks).toHaveBeenCalledTimes(1))
    expect(order.slice(0, 2)).toEqual(['flush', 'make'])
    expect(makeWhiteboardTasks.mock.calls[0][0]).toBe(PROJECT)
    expect(makeWhiteboardTasks.mock.calls[0][1]).toMatchObject({
      whiteboardId: BOARD_ID,
      milestoneId: 'm1',
      tasks: [
        { objectId: 'a', title: 'Call the venue', priority: 'high' },
        { objectId: 'b', title: 'Order the cake', description: 'chocolate' }
      ]
    })

    await waitFor(() => expect(latest()?.get('a')?.link).toBe(taskUrl(T1)))
    expect(changes).toHaveLength(1)
    expect(latest().get('b')?.link).toBe(taskUrl(T2))
    expect(latest().get('c')?.link).toBe(taskUrl(OLD))
    // Saved again once linked.
    await waitFor(() => expect(order).toEqual(['flush', 'make', 'flush']))

    // The toast's undo goes to main, which deletes the tasks and clears the links.
    expect(await screen.findByText('Made 2 tasks')).toBeTruthy()
    const toastUndo = screen
      .getAllByRole('button', { name: 'Undo' })
      .find((button) => !button.closest('.wb-editor'))
    fireEvent.click(toastUndo as HTMLElement)
    await waitFor(() => expect(undoWhiteboardTasks).toHaveBeenCalledTimes(1))
    expect(undoWhiteboardTasks).toHaveBeenCalledWith(PROJECT, {
      whiteboardId: BOARD_ID,
      taskIds: [T1, T2]
    })

    // One undo step in the editor takes both links back.
    focus(screen.getByRole('button', { name: /Call the venue/ }))
    key({ key: 'z', ctrlKey: true })
    expect(latest().get('a')?.link).toBeNull()
    expect(latest().get('b')?.link).toBeNull()
    expect(latest().get('c')?.link).toBe(taskUrl(OLD))
  })

  it('gives focus back to the object that opened it, after Make and after Cancel', async () => {
    install()
    renderEditor()
    selectAll()
    const venue = screen.getByRole('button', { name: /Call the venue/ })
    expect(document.activeElement).toBe(venue)
    key({ key: 'k' })
    let dialog = await screen.findByRole('dialog', { name: 'Make tasks' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(venue)

    key({ key: 'k' })
    dialog = await screen.findByRole('dialog', { name: 'Make tasks' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make 2 tasks' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /Call the venue/ }))
    )
  })

  it('from the style bar: back to its button on Cancel, to the object once the button cannot be used', async () => {
    install()
    renderEditor()
    selectAll()
    const button = screen.getByRole('button', { name: 'Make tasks' })
    focus(button)
    fireEvent.click(button)
    let dialog = await screen.findByRole('dialog', { name: 'Make tasks' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(button)

    fireEvent.click(button)
    dialog = await screen.findByRole('dialog', { name: 'Make tasks' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make 2 tasks' }))
    // Everything selected is linked now, so the style bar's Make tasks says why it cannot run.
    const makeTasks = () => screen.getByRole('button', { name: 'Make tasks' })
    await waitFor(() => expect(makeTasks().getAttribute('aria-disabled')).toBe('true'))
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /Call the venue/ }))
    )
  })

  it('the style bar offers Make tasks only while something selected can make one', async () => {
    install()
    renderEditor()
    focus(screen.getByRole('button', { name: /Old/ }))
    const makeTasks = () => screen.getByRole('button', { name: 'Make tasks' })
    expect(makeTasks().getAttribute('aria-disabled')).toBe('true')
    // Clicked anyway, it opens nothing.
    fireEvent.click(makeTasks())
    expect(screen.queryByRole('dialog')).toBeNull()
    focus(screen.getByRole('button', { name: /Order the cake/ }))
    expect(makeTasks().getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(makeTasks())
    const dialog = await screen.findByRole('dialog', { name: 'Make tasks' })
    expect(within(dialog).getByRole('button', { name: 'Make 1 task' })).toBeTruthy()
  })

  it('K with nothing that can make a task says why and opens nothing', () => {
    install()
    renderEditor()
    focus(screen.getByRole('button', { name: /Old/ }))
    key({ key: 'k' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('[data-announcer]')?.textContent).toContain(
      'Only notes, shapes and mind-map nodes with words and no link make tasks.'
    )
  })

  it.each([
    ['read-only', { readOnly: true }],
    ['without a host that saves', { flush: undefined }]
  ])('is not offered %s', (_name, props: Partial<WhiteboardEditorProps>) => {
    install()
    renderEditor(props)
    focus(screen.getByRole('button', { name: /Call the venue/ }))
    key({ key: 'k' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Make tasks' })).toBeNull()
  })
})
