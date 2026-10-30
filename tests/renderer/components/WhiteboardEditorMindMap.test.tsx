// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WHITEBOARD_SHORTCUTS } from '@shared/shortcuts'
import type { ObjectMap } from '@shared/whiteboard/history'
import { MIND_MAP_H_GAP, relayoutMindMaps } from '@shared/whiteboard/mind-map'
import {
  cleanWhiteboardObject,
  type MindmapObject,
  type WhiteboardObjectInput
} from '@shared/whiteboard/model'
import {
  WhiteboardEditor,
  type WhiteboardEditorProps
} from '@renderer/components/whiteboard/WhiteboardEditor'
import { AnnouncerProvider } from '@renderer/ui'
import { pickStyle, styleControl } from './whiteboard-style-helpers'

/**
 * Mind-map mode in the whiteboard editor (docs/plans/whiteboards, prompt 14,
 * D18, D27). The canvas measure is replaced with a fixed one: every character
 * is 10 units wide at any size. As in the other editor tests, jsdom has no
 * layout, so the view stays at 100% with the board's origin top-left.
 */

const tenPerChar = (text: string) => text.length * 10
vi.mock('@renderer/components/whiteboard/measure', () => ({
  canvasMeasure: () => tenPerChar
}))

function idea(
  id: string,
  parentId: string | null,
  order: number,
  text: string,
  z: number
): MindmapObject {
  return cleanWhiteboardObject({
    id,
    kind: 'mindmap',
    x: 0,
    y: 0,
    width: parentId === null ? 200 : 160,
    height: parentId === null ? 64 : 48,
    z,
    colour: 'blue',
    text,
    data: { parentId, order, textSize: parentId === null ? 'large' : 'medium' }
  }) as MindmapObject
}

/** Launch plan → Budget, Venue → Hall; laid out as the editor lays it out. */
function laidOutMap(): WhiteboardObjectInput[] {
  const nodes = [
    idea('root', null, 0, 'Launch plan', 1),
    idea('budget', 'root', 0, 'Budget', 2),
    idea('venue', 'root', 1, 'Venue', 3),
    idea('hall', 'venue', 0, 'Hall', 4)
  ]
  const laid = new Map(relayoutMindMaps(nodes, ['root'], tenPerChar).map((n) => [n.id, n]))
  return nodes.map((node) => laid.get(node.id) ?? node)
}

const MAP = laidOutMap()

let changes: ObjectMap[] = []
const onChange = vi.fn((present: ObjectMap) => changes.push(present))
const outerKeys = vi.fn()

function renderEditor(props: Partial<WhiteboardEditorProps> = {}) {
  render(
    <AnnouncerProvider>
      <div onKeyDown={outerKeys}>
        <WhiteboardEditor
          title="Launch"
          objects={MAP}
          version={1}
          onChange={onChange}
          imageUrl={() => null}
          {...props}
        />
      </div>
    </AnnouncerProvider>
  )
  return { board: screen.getByRole('group', { name: 'Whiteboard: Launch' }) }
}

function focus(element: HTMLElement | SVGElement) {
  act(() => element.focus())
}

const latest = () => changes[changes.length - 1]
const node = (id: string) => latest().get(id) as MindmapObject
const nodes = () => [...latest().values()].filter((o): o is MindmapObject => o.kind === 'mindmap')
const root$ = () => document.querySelector('.wb-editor')!
const announced = () => document.querySelector('[data-announcer]')?.textContent?.trim() ?? ''
const ideaBox = () => screen.getByRole('textbox', { name: 'Idea text' }) as HTMLTextAreaElement
const objectButton = (name: string) => screen.getByRole('button', { name })
const type = (text: string) => fireEvent.change(ideaBox(), { target: { value: text } })
const press = (init: KeyboardEventInit & { key: string }) =>
  fireEvent.keyDown(document.activeElement!, init)

/** A board with nothing on it, its view 1000 × 600: B and Enter place a central idea. */
function startMap() {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  const { board } = renderEditor({ objects: [] })
  focus(board)
  fireEvent.keyDown(board, { key: 'b' })
  fireEvent.keyDown(board, { key: 'Enter' })
  return nodes()[0]
}

beforeEach(() => {
  changes = []
  onChange.mockClear()
  outerKeys.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('mind-map mode', () => {
  it('lists the mind-map keys in the shortcut table', () => {
    const keys = Object.fromEntries(WHITEBOARD_SHORTCUTS.map((entry) => [entry.id, entry.keys]))
    expect(keys).toMatchObject({
      mindmap: 'B',
      'mind-map-child': 'Tab or Insert',
      'mind-map-sibling': 'Enter',
      'mind-map-new-line': 'Shift+Enter',
      'mind-map-navigate': 'Arrow keys',
      'mind-map-move': 'Shift+Arrow keys'
    })
  })

  it('places a central idea in the middle of the view with B and Enter, open for typing', () => {
    const root = startMap()
    // The middle of a 1000 × 600 view is 500, 300; a central idea is 200 × 64, snapped.
    expect(root).toMatchObject({ x: 400, y: 270, width: 200, height: 64, colour: 'blue' })
    expect(root.data).toMatchObject({ parentId: null, textSize: 'large' })
    expect(document.activeElement).toBe(ideaBox())
    expect(announced()).toBe('Mind map added')
    const tools = screen.getByRole('toolbar', { name: 'Tools' })
    expect(
      within(tools).getByRole('button', { name: 'Mind map' }).getAttribute('aria-pressed')
    ).toBe('false')
    expect(within(tools).getByRole('button', { name: 'Select' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('places a central idea where the board is clicked with the Mind map tool', () => {
    const { board } = renderEditor({ objects: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Mind map' }))
    fireEvent(
      board,
      new MouseEvent('pointerdown', { clientX: 103, clientY: 98, button: 0, bubbles: true })
    )
    expect(nodes()[0]).toMatchObject({ x: 100, y: 100, data: { parentId: null } })
    expect(document.activeElement).toBe(ideaBox())
  })

  it('adds a child with Tab and a sibling below it with Enter, laid out to the right', () => {
    const root = startMap()
    type('Launch')
    press({ key: 'Tab' })
    expect(announced()).toBe('Idea added')
    const [child] = nodes().filter((n) => n.id !== root.id)
    expect(child.data).toMatchObject({ parentId: root.id, order: 0, textSize: 'medium' })
    expect(child).toMatchObject({
      x: root.x + 200 + MIND_MAP_H_GAP,
      y: root.y + 32 - 24,
      width: 120,
      height: 48
    })
    expect(ideaBox().value).toBe('')
    expect(document.activeElement).toBe(ideaBox())

    type('Venue')
    press({ key: 'Enter' })
    const sibling = nodes().find((n) => n.id !== root.id && n.id !== child.id)!
    expect(sibling.data).toMatchObject({ parentId: root.id, order: 1 })
    // Two 48-unit children with a 16-unit gap, centred on the central idea.
    expect(node(child.id)).toMatchObject({ y: root.y + 32 - 56, text: 'Venue' })
    expect(sibling).toMatchObject({ x: child.x, y: root.y + 32 - 56 + 48 + 16 })
    // Neither key reached the app.
    expect(outerKeys).not.toHaveBeenCalled()
  })

  it('keeps Shift+Enter as a new line and makes each new idea and its words one undo step', () => {
    const root = startMap()
    type('Launch')
    press({ key: 'Tab' })
    type('Venue')
    press({ key: 'Enter' })
    expect(fireEvent.keyDown(ideaBox(), { key: 'Enter', shiftKey: true })).toBe(true)
    type('Budget\nand costs')
    press({ key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(nodes()).toHaveLength(3)
    // One Ctrl+Z takes back the last idea with its words; the map lays out as before.
    fireEvent.keyDown(root$(), { key: 'z', ctrlKey: true })
    expect(nodes()).toHaveLength(2)
    const [child] = nodes().filter((n) => n.id !== root.id)
    expect(child).toMatchObject({ text: 'Venue', y: root.y + 8 })
    fireEvent.keyDown(root$(), { key: 'z', ctrlKey: true })
    expect(nodes()).toHaveLength(1)
    expect(nodes()[0]).toMatchObject({ text: 'Launch' })
  })

  it('removes a new idea left empty when Escape ends its editing, with nothing to undo', () => {
    renderEditor()
    const venue = objectButton('Idea: Venue, level 1, 2 of 2, 1 branch')
    focus(venue)
    press({ key: 'Insert' })
    expect(nodes()).toHaveLength(5)
    press({ key: 'Escape' })
    expect(nodes()).toHaveLength(4)
    expect(announced()).toBe('Empty idea removed')
    // Focus goes back to the idea it grew from.
    expect(document.activeElement).toBe(objectButton('Idea: Venue, level 1, 2 of 2, 1 branch'))
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('adds a child of the selected idea with Insert, laid out after its siblings', () => {
    renderEditor()
    focus(objectButton('Idea: Venue, level 1, 2 of 2, 1 branch'))
    press({ key: 'Insert' })
    type('Garden')
    press({ key: 'Escape' })
    const garden = nodes().find((n) => n.text === 'Garden')!
    expect(garden.data).toMatchObject({ parentId: 'venue', order: 1, textSize: 'small' })
    expect(garden.x).toBe(node('hall').x)
    expect(garden.y).toBe(node('hall').y + 48 + 16)
    expect(objectButton('Idea: Garden, level 2, 2 of 2')).toBeTruthy()
  })

  it('moves along the tree with the arrow keys, saying each idea and each end', () => {
    renderEditor()
    focus(objectButton('Central idea: Launch plan, 2 branches'))
    const steps: [string, string][] = []
    const step = (key: string) => {
      press({ key })
      steps.push([document.activeElement!.getAttribute('aria-label')!, announced()])
    }
    step('ArrowRight')
    step('ArrowDown')
    step('ArrowDown')
    step('ArrowRight')
    step('ArrowRight')
    step('ArrowLeft')
    step('ArrowUp')
    step('ArrowUp')
    step('ArrowLeft')
    step('ArrowLeft')
    const budget = 'Idea: Budget, level 1, 1 of 2'
    const venue = 'Idea: Venue, level 1, 2 of 2, 1 branch'
    const hall = 'Idea: Hall, level 2, 1 of 1'
    const root = 'Central idea: Launch plan, 2 branches'
    expect(steps).toEqual([
      [budget, budget],
      [venue, venue],
      [venue, 'Last idea on this branch'],
      [hall, hall],
      [hall, 'No branches from this idea'],
      [venue, venue],
      [budget, budget],
      [budget, 'First idea on this branch'],
      [root, root],
      [root, 'This is the central idea']
    ])
    // Moving along the map changes nothing on the board.
    expect(onChange).not.toHaveBeenCalled()
    expect(outerKeys).not.toHaveBeenCalled()
  })

  it('deletes a branch with Delete and lays the map out again', () => {
    renderEditor()
    const budgetBefore = MAP.find((o) => o.id === 'budget')!
    focus(objectButton('Idea: Venue, level 1, 2 of 2, 1 branch'))
    press({ key: 'Delete' })
    expect(latest().has('venue')).toBe(false)
    expect(latest().has('hall')).toBe(false)
    expect(announced()).toBe('Deleted 2 objects')
    // Budget is alone now: centred on the central idea, in the same undo step.
    expect(node('budget').y).toBe(32 - 24)
    expect(node('budget').y).not.toBe(budgetBefore.y)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(objectButton('Central idea: Launch plan, 1 branch')).toBeTruthy()
  })

  it('moves the whole map 10 units with Shift+arrows on its central idea, and a branch on its idea', () => {
    renderEditor()
    focus(objectButton('Central idea: Launch plan, 2 branches'))
    press({ key: 'ArrowRight', shiftKey: true })
    expect(onChange).toHaveBeenCalledTimes(1)
    for (const before of MAP) {
      expect(latest().get(before.id)).toMatchObject({ x: before.x + 10, y: before.y })
    }
    expect(announced()).toBe('Moved')
    const venueBefore = latest().get('venue') as MindmapObject
    const hallBefore = latest().get('hall') as MindmapObject
    focus(objectButton('Idea: Venue, level 1, 2 of 2, 1 branch'))
    press({ key: 'ArrowDown', shiftKey: true })
    expect(onChange).toHaveBeenCalledTimes(2)
    // The idea leaves the map's layout and keeps its place; its branch comes with it.
    expect(node('venue')).toMatchObject({ x: venueBefore.x, y: venueBefore.y + 10 })
    expect(node('venue').data.free).toBe(true)
    expect(node('hall')).toMatchObject({ x: hallBefore.x, y: hallBefore.y + 10 })
    expect(announced()).toBe('Moved')
  })

  it('widens an idea to its words up to 320 units and lays the map out as you type', () => {
    renderEditor()
    focus(objectButton('Idea: Venue, level 1, 2 of 2, 1 branch'))
    press({ key: 'Enter' })
    type('Venue and catering')
    // 18 characters at 10 units, plus 12 units of padding each side.
    expect(node('venue').width).toBe(204)
    expect(node('hall').x).toBe(node('venue').x + 204 + MIND_MAP_H_GAP)
    type('Venue, catering, music and somewhere for everyone to park')
    expect(node('venue').width).toBe(320)
    expect(node('venue').height).toBeGreaterThan(48)
    expect(node('hall').x).toBe(node('venue').x + 320 + MIND_MAP_H_GAP)
    press({ key: 'Escape' })
    // The whole edit, layout included, is one undo step.
    fireEvent.keyDown(root$(), { key: 'z', ctrlKey: true })
    for (const before of MAP) expect(latest().get(before.id)).toEqual(before)
  })

  it('lays the map out again when the text size changes in the style bar', () => {
    renderEditor()
    focus(objectButton('Idea: Venue, level 1, 2 of 2, 1 branch'))
    pickStyle('Text size', 'Huge')
    expect(node('venue').data.textSize).toBe('huge')
    expect(node('venue').height).toBeGreaterThan(48)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("offers Apply to the whole map after a central idea's colour changes", () => {
    renderEditor()
    focus(objectButton('Central idea: Launch plan, 2 branches'))
    const apply = () => screen.queryByRole('button', { name: 'Apply to the whole map' })
    fireEvent.click(styleControl('Colour'))
    expect(apply()).toBeNull()
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Colour' })).getByRole('button', { name: 'Green' })
    )
    expect(node('root').colour).toBe('green')
    expect(node('venue').colour).toBe('blue')
    expect(apply()).not.toBeNull()
    fireEvent.click(apply()!)
    expect(nodes().every((n) => n.colour === 'green')).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(announced()).toBe('Colour applied to the whole map')
    // The map is one colour now: reopened, the panel offers nothing more.
    fireEvent.click(styleControl('Colour'))
    expect(apply()).toBeNull()
  })

  it('moves only by the tree and adds nothing when read-only', () => {
    renderEditor({ readOnly: true })
    focus(objectButton('Central idea: Launch plan, 2 branches'))
    press({ key: 'ArrowRight' })
    expect(document.activeElement!.getAttribute('aria-label')).toBe('Idea: Budget, level 1, 1 of 2')
    press({ key: 'Insert' })
    press({ key: 'ArrowLeft', shiftKey: true })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mind map' })).toBeNull()
  })
})
