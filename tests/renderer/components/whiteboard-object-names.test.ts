// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { BRAND } from '@shared/brand'
import { itemLinkUrl } from '@shared/item-links'
import type { ItemLinkInfo } from '@shared/ostler-api'
import {
  cleanWhiteboardObject,
  objectsById,
  type WhiteboardObjectInput
} from '@shared/whiteboard/model'
import { objectName } from '@renderer/components/whiteboard/object-names'

/** The spoken names of whiteboard objects (docs/plans/whiteboards, prompt 05, D14). */

const PROJECT = '11111111-1111-4111-8111-111111111111'
const TASK = '22222222-2222-4222-8222-222222222222'
const TASK_LINK = itemLinkUrl({ kind: 'task', projectId: PROJECT, id: TASK }, BRAND.urlScheme)

function object(fields: Record<string, unknown>): WhiteboardObjectInput {
  return cleanWhiteboardObject({ x: 0, y: 0, width: 100, height: 100, z: 1, ...fields })
}

function nameOf(
  target: WhiteboardObjectInput,
  others: WhiteboardObjectInput[] = [],
  links?: ReadonlyMap<string, ItemLinkInfo>
) {
  return objectName(target, objectsById([target, ...others]), links)
}

const start = object({ id: 'start', kind: 'shape', text: 'Start\nhere' })
const end = object({ id: 'end', kind: 'note', text: '' })

function connector(fields: Record<string, unknown>) {
  return object({
    id: 'line',
    kind: 'connector',
    ...fields,
    data: {
      from: { objectId: 'start', x: 0, y: 0 },
      to: { objectId: null, x: 50, y: 50 },
      startHead: 'none',
      endHead: 'none',
      ...(fields.data as object)
    }
  })
}

describe('objectName', () => {
  it('names notes, text and shapes by their words', () => {
    expect(nameOf(object({ id: 'n', kind: 'note', text: 'Buy milk' }))).toBe('Note: Buy milk')
    expect(nameOf(object({ id: 'n', kind: 'note' }))).toBe('Empty note')
    expect(nameOf(object({ id: 't', kind: 'text', text: 'Heading' }))).toBe('Text: Heading')
    expect(nameOf(object({ id: 't', kind: 'text' }))).toBe('Empty text')
    expect(nameOf(object({ id: 's', kind: 'shape', text: 'Go', data: { shape: 'diamond' } }))).toBe(
      'Diamond: Go'
    )
    expect(nameOf(object({ id: 's', kind: 'shape', data: { shape: 'rounded' } }))).toBe(
      'Rounded rectangle'
    )
  })

  it('names a connector by its ends, as a line or an arrow', () => {
    expect(nameOf(connector({}), [start, end])).toBe('Line from Start to a point')
    expect(nameOf(connector({ data: { endHead: 'arrow' } }), [start, end])).toBe(
      'Arrow from Start to a point'
    )
    // An end stuck to an object with no words is named by that object.
    expect(
      nameOf(connector({ data: { to: { objectId: 'end', x: 0, y: 0 }, startHead: 'arrow' } }), [
        start,
        end
      ])
    ).toBe('Arrow from Start to Empty note')
    // An end whose object has gone is a point.
    expect(nameOf(connector({ data: { from: { objectId: 'gone', x: 0, y: 0 } } }))).toBe(
      'Line from a point to a point'
    )
  })

  it('names drawings, pictures, frames and ideas', () => {
    const pen = (marker: boolean) =>
      object({ id: 'p', kind: 'pen', data: { points: [0, 0, 10, 10], marker } })
    expect(nameOf(pen(false))).toBe('Drawing')
    expect(nameOf(pen(true))).toBe('Marker drawing')
    expect(nameOf(object({ id: 'i', kind: 'image', data: { imageItemId: null } }))).toBe('Picture')
    expect(nameOf(object({ id: 'f', kind: 'frame', text: 'Ideas' }))).toBe('Frame: Ideas')
    expect(nameOf(object({ id: 'f', kind: 'frame' }))).toBe('Frame')
    expect(nameOf(object({ id: 'm', kind: 'mindmap', text: 'Budget' }))).toBe(
      'Central idea: Budget'
    )
    expect(nameOf(object({ id: 'm', kind: 'mindmap' }))).toBe('Empty central idea')
  })

  it('names a mind-map node with its level, its place among its siblings and its branches', () => {
    const idea = (id: string, parentId: string | null, order: number, text = '') =>
      object({ id, kind: 'mindmap', text, data: { parentId, order } })
    const map = [
      idea('root', null, 0, 'Launch plan'),
      idea('budget', 'root', 0, 'Budget'),
      idea('venue', 'root', 1, 'Venue'),
      idea('date', 'root', 2),
      idea('hall', 'venue', 0, 'Hall')
    ]
    const name = (id: string) =>
      objectName(
        map.find((o) => o.id === id)!,
        objectsById(map)
      )
    expect(name('root')).toBe('Central idea: Launch plan, 3 branches')
    expect(name('venue')).toBe('Idea: Venue, level 1, 2 of 3, 1 branch')
    expect(name('budget')).toBe('Idea: Budget, level 1, 1 of 3')
    expect(name('date')).toBe('Empty idea, level 1, 3 of 3')
    expect(name('hall')).toBe('Idea: Hall, level 2, 1 of 1')
    // A node whose parent is not on the board is a central idea.
    expect(nameOf(idea('lost', 'gone', 0, 'Lost'))).toBe('Central idea: Lost')
  })

  it("names a card by its item's title", () => {
    const card = object({ id: 'card', kind: 'card', link: TASK_LINK })
    const info: ItemLinkInfo = {
      kind: 'task',
      projectId: PROJECT,
      id: TASK,
      exists: true,
      title: 'Book the venue'
    }
    expect(nameOf(card, [], new Map([[TASK_LINK, info]]))).toBe('Card: Book the venue')
    expect(nameOf(card)).toMatch(/^Card: \S/)
  })

  it('numbers objects that would read alike, in reading order, and connector ends with them', () => {
    const first = object({ id: 'r1', kind: 'shape', x: 300, y: 0 })
    const second = object({ id: 'r2', kind: 'shape', x: 0, y: 300 })
    const third = object({ id: 'r3', kind: 'shape', x: 0, y: 0 })
    const frame = object({ id: 'f', kind: 'frame', x: 600, y: 600 })
    const arrow = object({
      id: 'a',
      kind: 'connector',
      data: {
        from: { objectId: 'r1', x: 0, y: 0 },
        to: { objectId: 'r2', x: 0, y: 0 },
        startHead: 'none',
        endHead: 'arrow'
      }
    })
    const board = objectsById([first, second, third, frame, arrow])
    // Top to bottom, then left to right.
    expect(objectName(third, board)).toBe('Rectangle 1')
    expect(objectName(first, board)).toBe('Rectangle 2')
    expect(objectName(second, board)).toBe('Rectangle 3')
    // A name only one object has stays as it is.
    expect(objectName(frame, board)).toBe('Frame')
    expect(objectName(arrow, board)).toBe('Arrow from Rectangle 2 to Rectangle 3')
    // Words tell objects apart, so only the same words are numbered.
    const named = objectsById([
      object({ id: 'n1', kind: 'note', text: 'Venue', y: 0 }),
      object({ id: 'n2', kind: 'note', text: 'Venue', y: 300 }),
      object({ id: 'n3', kind: 'note', text: 'Band', y: 600 })
    ])
    expect(objectName(named.get('n2')!, named)).toBe('Note: Venue 2')
    expect(objectName(named.get('n3')!, named)).toBe('Note: Band')
  })

  it('adds ", in a group" for a grouped object', () => {
    expect(nameOf(object({ id: 'n', kind: 'note', text: 'One', groupId: 'g' }))).toBe(
      'Note: One, in a group'
    )
  })

  it('cuts long text to its first 80 characters and reads it as one line', () => {
    const long = 'word '.repeat(40)
    const name = nameOf(object({ id: 'n', kind: 'note', text: long }))
    expect(name.startsWith('Note: word word')).toBe(true)
    expect(name.endsWith('…')).toBe(true)
    expect(name.length).toBeLessThanOrEqual('Note: '.length + 81)
    expect(nameOf(object({ id: 'n', kind: 'note', text: 'Two\nlines' }))).toBe('Note: Two lines')
  })
})
