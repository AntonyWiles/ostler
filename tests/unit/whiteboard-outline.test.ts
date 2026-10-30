import { describe, expect, it } from 'vitest'
import { BRAND } from '../../src/shared/brand'
import { extractItemLinks } from '../../src/shared/item-links'
import {
  cleanWhiteboardObject,
  type WhiteboardObjectInput
} from '../../src/shared/whiteboard/model'
import {
  OUTLINE_CUT_LINE,
  OUTLINE_EMPTY,
  WHITEBOARD_OUTLINE_MAX,
  readingOrder,
  whiteboardItemLinks,
  whiteboardOutline
} from '../../src/shared/whiteboard/outline'

/** A whiteboard's outline for search and AI (docs/plans/whiteboards/, D6). */

const PROJECT = '11111111-2222-4333-8444-555555555555'
const TASK = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const DOC = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
const TASK_LINK = `${BRAND.urlScheme}://task/${PROJECT}/${TASK}`
const DOC_LINK = `${BRAND.urlScheme}://library/${PROJECT}/${DOC}`
const WEB_LINK = 'https://example.com/page'

function make(
  id: string,
  kind: string,
  x: number,
  y: number,
  extra: Record<string, unknown> = {}
): WhiteboardObjectInput {
  return cleanWhiteboardObject({ id, kind, x, y, width: 100, height: 100, z: 0, ...extra })
}

const note = (id: string, x: number, y: number, text: string, extra = {}) =>
  make(id, 'note', x, y, { text, ...extra })
const frame = (id: string, x: number, y: number, width: number, height: number, text = '') =>
  make(id, 'frame', x, y, { width, height, text })
const shape = (id: string, x: number, y: number, text: string, kind = 'rectangle') =>
  make(id, 'shape', x, y, { text, data: { shape: kind } })
const idea = (id: string, parentId: string | null, order: number, text: string, x = 0, y = 0) =>
  make(id, 'mindmap', x, y, { text, data: { parentId, order } })
const end = (objectId: string | null) => ({ objectId, x: 0, y: 0 })
const connector = (
  id: string,
  from: string | null,
  to: string | null,
  heads: { startHead?: string; endHead?: string } = {},
  text = ''
) =>
  make(id, 'connector', 0, 1000, {
    text,
    data: { from: end(from), to: end(to), startHead: 'none', endHead: 'none', ...heads }
  })
const pen = (id: string) => make(id, 'pen', 0, 0, { data: { points: [0, 0, 10, 10] } })

describe('readingOrder', () => {
  it('reads rows top to bottom, then left to right, ties by id', () => {
    const objects = [
      note('c', 0, 300, ''),
      note('b', 200, 10, ''),
      note('a', 0, 0, ''),
      note('d', 200, 300, ''),
      note('e', 200, 300, '')
    ]
    expect(readingOrder(objects).map((object) => object.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('starts a new row when the overlap is half the shorter height or less', () => {
    const objects = [note('low', 0, 50, ''), note('high', 200, 0, '')]
    expect(readingOrder(objects).map((object) => object.id)).toEqual(['high', 'low'])
    const nudged = [note('low', 0, 49, ''), note('high', 200, 0, '')]
    expect(readingOrder(nudged).map((object) => object.id)).toEqual(['low', 'high'])
  })

  it('returns a copy', () => {
    const objects = [note('b', 100, 0, ''), note('a', 0, 0, '')]
    const ordered = readingOrder(objects)
    expect(ordered).not.toBe(objects)
    expect(objects.map((object) => object.id)).toEqual(['b', 'a'])
  })
})

describe('whiteboardOutline', () => {
  it('says an empty board is empty', () => {
    expect(whiteboardOutline([])).toBe(OUTLINE_EMPTY)
  })

  it('lists loose notes in reading order with no heading', () => {
    const objects = [
      note('n3', 0, 300, 'Third'),
      note('n2', 200, 0, 'Second'),
      note('n1', 0, 0, 'First')
    ]
    expect(whiteboardOutline(objects)).toBe('- Note: First\n- Note: Second\n- Note: Third')
  })

  it('puts a note in the smaller of two nested frames', () => {
    const objects = [
      frame('outer', 0, 0, 1000, 1000, 'Outer'),
      frame('inner', 100, 100, 300, 300, 'Inner'),
      note('n1', 150, 150, 'Inside')
    ]
    expect(whiteboardOutline(objects)).toBe('## Outer\n\n## Inner\n- Note: Inside')
  })

  it('names a frame with no title "Frame"', () => {
    const objects = [frame('f', 0, 0, 500, 500), note('n', 10, 10, '')]
    expect(whiteboardOutline(objects)).toBe('## Frame\n- Note (empty)')
  })

  it('writes a mind map nested, children in order', () => {
    const objects = [
      idea('root', null, 0, 'Launch'),
      idea('b', 'root', 1, 'Marketing', 0, -500),
      idea('a', 'root', 0, 'Build', 0, 500),
      idea('a1', 'a', 0, 'Tests')
    ]
    expect(whiteboardOutline(objects)).toBe('## Mind map: Launch\n- Build\n  - Tests\n- Marketing')
  })

  it('heads loose objects "Elsewhere on the board" only when there is a frame or map', () => {
    const loose = note('n', 2000, 2000, 'Loose')
    expect(whiteboardOutline([loose])).toBe('- Note: Loose')
    expect(whiteboardOutline([frame('f', 0, 0, 100, 100, 'Plan'), loose])).toBe(
      '## Plan\n\n## Elsewhere on the board\n- Note: Loose'
    )
    expect(whiteboardOutline([idea('m', null, 0, 'Idea', 0, 0), loose])).toBe(
      '## Mind map: Idea\n\n## Elsewhere on the board\n- Note: Loose'
    )
  })

  it('writes a connection between two shapes with its label and each arrow', () => {
    const shapes = [shape('s1', 0, 0, 'Plan'), shape('s2', 300, 0, '', 'ellipse')]
    const line = (heads: { startHead?: string; endHead?: string }) =>
      whiteboardOutline([...shapes, connector('c', 's1', 's2', heads, 'then')])
        .split('\n')
        .pop()
    expect(line({ endHead: 'arrow' })).toBe('- Plan → Ellipse: then')
    expect(line({ startHead: 'arrow' })).toBe('- Plan ← Ellipse: then')
    expect(line({ startHead: 'arrow', endHead: 'arrow' })).toBe('- Plan ↔ Ellipse: then')
    expect(line({})).toBe('- Plan — Ellipse: then')
    expect(whiteboardOutline([...shapes, connector('c', 's1', 's2', { endHead: 'arrow' })])).toBe(
      '- Rectangle: Plan\n- Ellipse\n\n## Connections\n- Plan → Ellipse'
    )
  })

  it('names a free end "(open end)" and leaves out a free unlabelled connector', () => {
    const objects = [
      note('n', 0, 0, 'Start here\nsecond line'),
      connector('c1', 'n', null, { endHead: 'arrow' }),
      connector('c2', null, null)
    ]
    expect(whiteboardOutline(objects)).toBe(
      '- Note: Start here / second line\n\n## Connections\n- Start here → (open end)'
    )
  })

  it('counts pen strokes, singular and plural', () => {
    expect(whiteboardOutline([pen('p1')])).toBe('Drawings: 1 freehand stroke.')
    expect(whiteboardOutline([note('n', 0, 0, 'Hi'), pen('p1'), pen('p2')])).toBe(
      '- Note: Hi\n\nDrawings: 2 freehand strokes.'
    )
  })

  it('writes an item link and a web link on notes', () => {
    const objects = [
      note('n1', 0, 0, 'Spec', { link: TASK_LINK }),
      note('n2', 200, 0, 'Site', { link: WEB_LINK })
    ]
    expect(whiteboardOutline(objects)).toBe(
      `- Note: Spec ([linked item](${TASK_LINK}))\n- Note: Site ([web link](${WEB_LINK}))`
    )
  })

  it('writes a card as its linked item', () => {
    const card = make('k', 'card', 0, 0, { link: DOC_LINK })
    expect(whiteboardOutline([card])).toBe(`- Card: [linked item](${DOC_LINK})`)
  })

  it('names a picture by its title when it is known', () => {
    const picture = make('i', 'image', 0, 0, { data: { imageItemId: DOC } })
    expect(whiteboardOutline([picture], { imageTitles: new Map([[DOC, 'Site map']]) })).toBe(
      '- Picture: Site map'
    )
    expect(whiteboardOutline([picture])).toBe('- Picture')
  })

  it('writes a newline in a note as a slash and collapses spaces', () => {
    expect(whiteboardOutline([note('n', 0, 0, 'One   line\n\nTwo')])).toBe('- Note: One line / Two')
  })

  it('leaves out an empty text object', () => {
    const empty = make('t', 'text', 0, 0)
    expect(whiteboardOutline([empty, note('n', 200, 0, 'Hi')])).toBe('- Note: Hi')
  })

  it('cuts a long outline at a line break and stays under the cap', () => {
    const objects = Array.from({ length: 2000 }, (_, index) =>
      note(`n${index}`, (index % 10) * 200, Math.floor(index / 10) * 200, 'x'.repeat(200))
    )
    const outline = whiteboardOutline(objects)
    expect(outline.length).toBeLessThanOrEqual(WHITEBOARD_OUTLINE_MAX)
    expect(outline.endsWith(`\n\n${OUTLINE_CUT_LINE}`)).toBe(true)
    const lines = outline.split('\n')
    expect(lines.slice(0, -2).every((line) => line === `- Note: ${'x'.repeat(200)}`)).toBe(true)
  })

  it('carries every item link where extractItemLinks finds it', () => {
    const objects = [
      frame('f', 0, 0, 500, 500, 'Frame'),
      note('n1', 10, 10, 'Spec', { link: TASK_LINK }),
      make('k', 'card', 1000, 0, { link: DOC_LINK }),
      note('n2', 2000, 0, 'Site', { link: WEB_LINK })
    ]
    const found = extractItemLinks(whiteboardOutline(objects), BRAND.urlScheme)
    expect(found).toEqual([
      { kind: 'task', projectId: PROJECT, id: TASK },
      { kind: 'library', projectId: PROJECT, id: DOC }
    ])
  })
})

describe('whiteboardItemLinks', () => {
  it('lists each linked item once, in reading order', () => {
    const objects = [
      note('n2', 0, 300, 'Again', { link: TASK_LINK }),
      make('k', 'card', 200, 0, { link: DOC_LINK }),
      note('n1', 0, 0, 'Spec', { link: TASK_LINK }),
      note('n3', 0, 600, 'Site', { link: WEB_LINK })
    ]
    expect(whiteboardItemLinks(objects)).toEqual([
      { kind: 'task', projectId: PROJECT, id: TASK },
      { kind: 'library', projectId: PROJECT, id: DOC }
    ])
  })
})
