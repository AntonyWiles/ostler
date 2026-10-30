// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ItemLinkInfo, SearchResult } from '@shared/ostler-api'
import { WHITEBOARD_SHORTCUTS } from '@shared/shortcuts'
import { taskStatusLabel } from '@shared/task-labels'
import type { ObjectMap } from '@shared/whiteboard/history'
import { cleanWhiteboardObject, type WhiteboardObjectInput } from '@shared/whiteboard/model'
import {
  WhiteboardEditor,
  type WhiteboardEditorProps
} from '@renderer/components/whiteboard/WhiteboardEditor'
import { AnnouncerProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

/**
 * Links on whiteboard objects, item cards and opening links (docs/plans/whiteboards,
 * prompt 12, D10, D27). As in the other editor tests, jsdom has no layout: the view
 * stays at 100% and a client point is a board point.
 */

function object(fields: Record<string, unknown>): WhiteboardObjectInput {
  return cleanWhiteboardObject({ x: 0, y: 0, width: 200, height: 200, z: 1, ...fields })
}

const PROJECT = '11111111-2222-4333-8444-555555555555'
const TASK = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const TASK_LINK = `ostler://task/${PROJECT}/${TASK}`
const WEB = 'https://example.com/plans'

const noteA = object({ id: 'a', kind: 'note', text: 'Buy milk', z: 1 })
const noteB = object({ id: 'b', kind: 'note', text: 'Call Sam', x: 300, z: 2 })
const BOARD = [noteA, noteB]

const HIT = {
  type: 'task',
  id: TASK,
  projectId: PROJECT,
  title: 'Book the venue'
} as unknown as SearchResult
const GOAL = {
  type: 'goal',
  id: 'g1',
  projectId: PROJECT,
  title: 'A goal'
} as unknown as SearchResult

let changes: ObjectMap[] = []
const onChange = vi.fn((present: ObjectMap) => changes.push(present))
const onOpenLink = vi.fn()
let search: ReturnType<typeof vi.fn>

function renderEditor(props: Partial<WhiteboardEditorProps> = {}) {
  render(
    <AnnouncerProvider>
      <WhiteboardEditor
        title="Launch"
        objects={BOARD}
        version={1}
        onChange={onChange}
        imageUrl={() => null}
        projectId={PROJECT}
        onOpenLink={onOpenLink}
        {...props}
      />
    </AnnouncerProvider>
  )
  return screen.getByRole('group', { name: 'Whiteboard: Launch' })
}

function pointer(type: string, target: Element, [x, y]: [number, number]) {
  fireEvent(
    target,
    new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true })
  )
}

function focus(element: Element) {
  act(() => (element as HTMLElement).focus())
}

/** A key pressed where focus is. */
function key(init: KeyboardEventInit) {
  fireEvent.keyDown(document.activeElement ?? document.body, init)
}

const objectButton = (name: string | RegExp) => screen.getByRole('button', { name })
const pressed = (name: string | RegExp) =>
  objectButton(name).getAttribute('aria-pressed') === 'true'
const latest = () => changes[changes.length - 1]
const announced = () => document.querySelector('[data-announcer]')?.textContent?.trim() ?? ''
const linkButton = () =>
  within(screen.getByRole('toolbar', { name: 'Tools' })).getByRole('button', {
    name: /^Link to an item or web page/
  }) as HTMLButtonElement

/** Types `words` into the Link dialog's search and waits for its first result. */
async function searchFor(words: string, title = 'Book the venue') {
  const field = screen.getByRole('combobox', { name: 'Find an item' })
  fireEvent.change(field, { target: { value: words } })
  await screen.findByRole('option', { name: new RegExp(title) })
  return field
}

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  changes = []
  onChange.mockClear()
  onOpenLink.mockClear()
  search = vi.fn(async () => ({ ok: true, value: [HIT, GOAL] }))
  installOstlerApi({ search: search as never })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the Link tool (prompt 12)', () => {
  it('has L and O in the shortcut table', () => {
    const keys = Object.fromEntries(WHITEBOARD_SHORTCUTS.map((entry) => [entry.id, entry.keys]))
    expect(keys).toMatchObject({ link: 'L', 'open-link': 'O' })
  })

  it('links a selected note to a found item with L, search and Enter, in one undo step', async () => {
    renderEditor()
    focus(objectButton('Note: Buy milk'))
    key({ key: 'l' })
    const dialog = screen.getByRole('dialog', { name: 'Link to an item or web page' })
    expect(within(dialog).getByRole('textbox', { name: /Web address/ })).toBeTruthy()

    const field = await searchFor('venue')
    expect(search).toHaveBeenCalledWith('venue', {
      projectId: PROJECT,
      types: ['task', 'milestone', 'decision', 'library'],
      limit: 8
    })
    // Only the kinds a link takes are offered.
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(field, { key: 'Enter' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(latest().get('a')?.link).toBe(TASK_LINK)
    expect(announced()).toBe('Link added')
    expect(document.querySelector('[data-object-id="a"] [data-link-badge]')).not.toBeNull()

    key({ key: 'z', ctrlKey: true })
    expect(latest().get('a')?.link).toBeNull()
  })

  it('lists what can be linked as soon as it opens, newest first, and filters it by kind', async () => {
    const at = (day: number) => `2026-10-${day}T10:00:00.000Z`
    installOstlerApi({
      search: search as never,
      getPlanningWorkItems: (async () => ({
        ok: true,
        value: [{ id: TASK, title: 'Book the venue', updatedAt: Date.parse(at(20)) }]
      })) as never,
      getPlanningMilestones: (async () => ({
        ok: true,
        value: [{ id: 'm1', name: 'Launch day', updatedAt: Date.parse(at(22)) }]
      })) as never,
      getPlanningDecisions: (async () => ({ ok: true, value: [] })) as never,
      listLibraryItems: (async () => ({
        ok: true,
        value: [
          {
            id: 'lib1',
            title: 'Budget sheet',
            url: 'https://1drv.ms/x/s!budget',
            updatedAt: at(24),
            archivedAt: null
          },
          { id: 'lib2', title: 'Old notes', url: null, updatedAt: at(25), archivedAt: at(26) }
        ]
      })) as never
    })
    renderEditor()
    focus(objectButton('Note: Buy milk'))
    key({ key: 'l' })
    const dialog = screen.getByRole('dialog', { name: 'Link to an item or web page' })
    await within(dialog).findByRole('option', { name: /Budget sheet/ })
    const titles = () =>
      within(dialog)
        .getAllByRole('option')
        .map((option) => option.textContent)
    // Nothing typed: everything, newest first, the archived item left out; a cloud file says where it is.
    expect(titles()).toEqual(['Budget sheetOneDrive', 'Launch dayMilestone', 'Book the venueTask'])
    expect(search).not.toHaveBeenCalled()

    const filter = (name: string) =>
      within(within(dialog).getByRole('group', { name: 'Show' })).getByRole('button', { name })
    fireEvent.click(filter('Tasks'))
    expect(filter('Tasks').getAttribute('aria-pressed')).toBe('true')
    expect(titles()).toEqual(['Book the venueTask'])
    fireEvent.click(filter('Cloud files'))
    expect(titles()).toEqual(['Budget sheetOneDrive'])
    expect(within(dialog).getByText(/Cloud files are Library links/)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('option', { name: /Budget sheet/ }))
    expect(latest().get('a')?.link).toBe(`ostler://library/${PROJECT}/lib1`)
  })

  it('says there is nothing to link to in an empty project', async () => {
    installOstlerApi({
      search: search as never,
      getPlanningWorkItems: (async () => ({ ok: true, value: [] })) as never,
      getPlanningMilestones: (async () => ({ ok: true, value: [] })) as never,
      getPlanningDecisions: (async () => ({ ok: true, value: [] })) as never,
      listLibraryItems: (async () => ({ ok: true, value: [] })) as never
    })
    renderEditor()
    focus(objectButton('Note: Buy milk'))
    key({ key: 'l' })
    expect(await screen.findByText('Nothing to link to in this project yet.')).toBeTruthy()
  })

  it('links a note to a web address, and refuses one that is not', () => {
    renderEditor()
    focus(objectButton('Note: Buy milk'))
    key({ key: 'l' })
    const web = screen.getByRole('textbox', { name: /Web address/ })

    fireEvent.change(web, { target: { value: 'example dot com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    expect(
      screen.getByText('Enter a web address that starts with http:// or https://.')
    ).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.change(web, { target: { value: WEB } })
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    expect(latest().get('a')?.link).toBe(WEB)
    expect(objectButton('Note: Buy milk, linked to example.com')).toBeTruthy()
  })

  it('removes a link with Remove link', () => {
    renderEditor({ objects: [{ ...noteA, link: WEB }, noteB] })
    focus(objectButton('Note: Buy milk, linked to example.com'))
    key({ key: 'l' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }))

    expect(latest().get('a')?.link).toBeNull()
    expect(announced()).toBe('Link removed')
    expect(document.querySelector('[data-link-badge]')).toBeNull()
  })

  it('offers no Remove link on an unlinked object', () => {
    renderEditor()
    focus(objectButton('Note: Buy milk'))
    key({ key: 'l' })
    expect(screen.queryByRole('button', { name: 'Remove link' })).toBeNull()
  })

  it('adds a card in the middle of the view with L when nothing is selected', async () => {
    const board = renderEditor()
    focus(board)
    key({ key: 'l' })
    const dialog = screen.getByRole('dialog', { name: 'Add a card' })
    expect(within(dialog).queryByRole('textbox', { name: /Web address/ })).toBeNull()

    const field = await searchFor('venue')
    fireEvent.keyDown(field, { key: 'Enter' })

    const card = [...latest().values()].find((entry) => entry.kind === 'card')
    expect(card).toMatchObject({ kind: 'card', width: 280, height: 72, link: TASK_LINK })
    expect(pressed(/^Card:/)).toBe(true)
    expect(announced()).toBe('Card added')
  })

  it('offers only items when linking a card', () => {
    const card = object({ id: 'k', kind: 'card', link: TASK_LINK, width: 280, height: 72 })
    renderEditor({ objects: [card] })
    focus(objectButton(/^Card:/))
    key({ key: 'l' })
    expect(screen.queryByRole('textbox', { name: /Web address/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove link' })).toBeNull()
  })

  it('is disabled for several objects, and L says why', () => {
    renderEditor()
    focus(objectButton('Note: Buy milk'))
    key({ key: 'a', ctrlKey: true })
    expect(linkButton().disabled).toBe(true)
    key({ key: 'l' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(announced()).toBe('Select one object to link it.')
  })

  it('is disabled for a line, and L says why', () => {
    const line = object({
      id: 'c',
      kind: 'connector',
      x: 200,
      y: 100,
      width: 100,
      height: 0,
      data: {
        from: { objectId: 'a', x: 200, y: 100 },
        to: { objectId: 'b', x: 300, y: 100 }
      }
    })
    renderEditor({ objects: [...BOARD, line] })
    focus(objectButton(/^Arrow from/))
    expect(linkButton().disabled).toBe(true)
    key({ key: 'l' })
    expect(announced()).toBe('Lines and drawings can’t have a link.')
  })
})

describe('opening links (prompt 12)', () => {
  it('opens the selected object’s link with O', () => {
    renderEditor({ objects: [{ ...noteA, link: WEB }, noteB] })
    focus(objectButton(/^Note: Buy milk/))
    key({ key: 'o' })
    expect(onOpenLink).toHaveBeenCalledWith(WEB)
  })

  it('says so when O finds no link', () => {
    renderEditor()
    focus(objectButton('Note: Buy milk'))
    key({ key: 'o' })
    expect(onOpenLink).not.toHaveBeenCalled()
    expect(announced()).toBe('Select one object with a link to open it.')
  })

  it('opens the link of a clicked badge without changing the selection', () => {
    const board = renderEditor({ objects: [{ ...noteA, link: TASK_LINK }, noteB] })
    focus(objectButton('Note: Call Sam'))
    // Note a is 200 across at 0, 0: its badge is 176–196 across and 4–24 down.
    pointer('pointerdown', board, [186, 14])
    pointer('pointerup', board, [186, 14])

    expect(onOpenLink).toHaveBeenCalledWith(TASK_LINK)
    expect(pressed('Note: Call Sam')).toBe(true)
    expect(pressed(/^Note: Buy milk/)).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('selects, rather than opens, on a click elsewhere on a linked object', () => {
    const board = renderEditor({ objects: [{ ...noteA, link: TASK_LINK }, noteB] })
    pointer('pointerdown', board, [50, 50])
    pointer('pointerup', board, [50, 50])
    expect(onOpenLink).not.toHaveBeenCalled()
    expect(pressed(/^Note: Buy milk/)).toBe(true)
  })

  it('opens a card with Enter and with a double-click', () => {
    const card = object({ id: 'k', kind: 'card', link: TASK_LINK, width: 280, height: 72 })
    const board = renderEditor({ objects: [card] })
    focus(objectButton(/^Card:/))
    key({ key: 'Enter' })
    expect(onOpenLink).toHaveBeenCalledWith(TASK_LINK)
    expect(document.querySelector('textarea')).toBeNull()

    onOpenLink.mockClear()
    fireEvent.doubleClick(board, { clientX: 100, clientY: 30 })
    expect(onOpenLink).toHaveBeenCalledWith(TASK_LINK)
  })

  it('opens links on a read-only board too', () => {
    renderEditor({ objects: [{ ...noteA, link: WEB }], readOnly: true })
    expect(screen.queryByRole('button', { name: /^Link to an item or web page/ })).toBeNull()
    focus(objectButton(/^Note: Buy milk/))
    key({ key: 'o' })
    expect(onOpenLink).toHaveBeenCalledWith(WEB)
  })
})

describe('linked objects on the board (prompt 12)', () => {
  const info = (fields: Partial<ItemLinkInfo>): ReadonlyMap<string, ItemLinkInfo> =>
    new Map([
      [
        TASK_LINK,
        {
          kind: 'task',
          projectId: PROJECT,
          id: TASK,
          exists: true,
          title: 'Fix the header',
          status: 'active',
          ...fields
        } as ItemLinkInfo
      ]
    ])

  it('names a note with its linked task, title and status, and draws its status dot', () => {
    renderEditor({ objects: [{ ...noteA, link: TASK_LINK }], links: info({}) })
    expect(
      objectButton(`Note: Buy milk, linked to task Fix the header, ${taskStatusLabel('active')}`)
    ).toBeTruthy()
    expect(document.querySelector('[data-link-badge] .wb-status-active')).not.toBeNull()
  })

  it('names a link to a deleted item, and draws its badge grey', () => {
    renderEditor({
      objects: [{ ...noteA, link: TASK_LINK }],
      links: info({ exists: false, title: '', status: undefined })
    })
    expect(objectButton('Note: Buy milk, linked to a deleted item')).toBeTruthy()
    expect(document.querySelector('[data-link-badge].is-deleted .wb-icon-grey')).not.toBeNull()
  })

  it('keeps a card’s own name', () => {
    const card = object({ id: 'k', kind: 'card', link: TASK_LINK, width: 280, height: 72 })
    renderEditor({ objects: [card], links: info({}) })
    expect(objectButton('Card: Fix the header')).toBeTruthy()
    expect(document.querySelector('[data-link-badge]')).toBeNull()
  })
})
