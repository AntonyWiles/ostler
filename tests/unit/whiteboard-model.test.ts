import { describe, expect, it } from 'vitest'
import { BRAND } from '../../src/shared/brand'
import { LEGACY_NAMES } from '../../src/shared/legacy-names'
import {
  WHITEBOARD_LIMITS,
  cleanWhiteboardLink,
  cleanWhiteboardObject,
  cleanWhiteboardSave,
  defaultObject,
  isWebLink,
  objectLinkTarget,
  objectsById,
  sameWhiteboardObject,
  type WhiteboardObject
} from '../../src/shared/whiteboard/model'

/** The whiteboard object model (docs/plans/whiteboards/, D8): kinds, defaults, limits and the validator. */

const PROJECT = '11111111-2222-4333-8444-555555555555'
const TASK = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const TASK_LINK = `${BRAND.urlScheme}://task/${PROJECT}/${TASK}`

const box = { x: 10, y: 20, width: 100, height: 50, z: 1 }

function base(id: string, kind: string, extra: Record<string, unknown> = {}) {
  return { id, kind, ...box, ...extra }
}

describe('cleanWhiteboardObject: each kind with defaults', () => {
  const common = { x: 10, y: 20, width: 100, height: 50, z: 1, text: '', link: null, groupId: null }

  it('note', () => {
    expect(cleanWhiteboardObject(base('n1', 'note'))).toEqual({
      id: 'n1',
      kind: 'note',
      ...common,
      colour: 'yellow',
      data: { textSize: 'medium' }
    })
  })

  it('text', () => {
    expect(cleanWhiteboardObject(base('t1', 'text'))).toEqual({
      id: 't1',
      kind: 'text',
      ...common,
      colour: 'black',
      data: { textSize: 'medium', align: 'start' }
    })
  })

  it('shape', () => {
    expect(cleanWhiteboardObject(base('s1', 'shape'))).toEqual({
      id: 's1',
      kind: 'shape',
      ...common,
      colour: 'black',
      data: { shape: 'rectangle', fill: 'light', stroke: 'medium', textSize: 'medium' }
    })
  })

  it('connector', () => {
    const object = cleanWhiteboardObject(
      base('c1', 'connector', {
        data: { from: { objectId: 'n1', x: 0, y: 0 }, to: { objectId: null, x: 50, y: 60 } }
      })
    )
    expect(object).toEqual({
      id: 'c1',
      kind: 'connector',
      ...common,
      colour: 'black',
      data: {
        from: { objectId: 'n1', x: 0, y: 0 },
        to: { objectId: null, x: 50, y: 60 },
        startHead: 'none',
        endHead: 'arrow',
        route: 'straight',
        stroke: 'medium',
        dashed: false
      }
    })
  })

  it('connector without ends throws', () => {
    expect(() => cleanWhiteboardObject(base('c1', 'connector'))).toThrow(/data\.from/)
  })

  it('pen', () => {
    expect(cleanWhiteboardObject(base('p1', 'pen', { data: { points: [0, 0, 5, 5] } }))).toEqual({
      id: 'p1',
      kind: 'pen',
      ...common,
      colour: 'black',
      data: { points: [0, 0, 5, 5], stroke: 'medium', marker: false }
    })
  })

  it('image', () => {
    expect(cleanWhiteboardObject(base('i1', 'image'))).toEqual({
      id: 'i1',
      kind: 'image',
      ...common,
      colour: 'black',
      data: { imageItemId: null }
    })
    const withItem = cleanWhiteboardObject(base('i2', 'image', { data: { imageItemId: TASK } }))
    expect(withItem.data).toEqual({ imageItemId: TASK })
  })

  it('card', () => {
    const object = cleanWhiteboardObject(base('k1', 'card', { link: TASK_LINK }))
    expect(object).toEqual({
      id: 'k1',
      kind: 'card',
      ...common,
      link: TASK_LINK,
      colour: 'black',
      data: {}
    })
    expect(objectLinkTarget(object)).toEqual({ kind: 'task', projectId: PROJECT, id: TASK })
  })

  it('frame', () => {
    expect(cleanWhiteboardObject(base('f1', 'frame', { text: 'Ideas' }))).toEqual({
      id: 'f1',
      kind: 'frame',
      ...common,
      text: 'Ideas',
      colour: 'grey',
      data: {}
    })
  })

  it('mindmap', () => {
    expect(cleanWhiteboardObject(base('m1', 'mindmap'))).toEqual({
      id: 'm1',
      kind: 'mindmap',
      ...common,
      colour: 'blue',
      data: { parentId: null, order: 0, textSize: 'medium' }
    })
  })

  it('normalises line endings in text', () => {
    expect(cleanWhiteboardObject(base('n1', 'note', { text: 'a\r\nb\rc' })).text).toBe('a\nb\nc')
  })
})

describe('cleanWhiteboardObject: unknown fields', () => {
  it('drops unknown top-level and data fields', () => {
    const object = cleanWhiteboardObject(
      base('n1', 'note', { extra: 1, createdAt: 'x', data: { textSize: 'large', fontFamily: 'x' } })
    )
    expect(object).not.toHaveProperty('extra')
    expect(object).not.toHaveProperty('createdAt')
    expect(object.data).toEqual({ textSize: 'large' })
  })
})

describe('cleanWhiteboardObject: refusals', () => {
  const cases: [string, unknown][] = [
    ['a bad id', base('bad id!', 'note')],
    ['an id too long', base('a'.repeat(65), 'note')],
    ['an unknown kind', base('n1', 'sticker')],
    ['NaN x', base('n1', 'note', { x: Number.NaN })],
    ['x out of range', base('n1', 'note', { x: WHITEBOARD_LIMITS.coordinate + 1 })],
    ['y out of range', base('n1', 'note', { y: -WHITEBOARD_LIMITS.coordinate - 1 })],
    ['a negative width', base('n1', 'note', { width: -1 })],
    ['an unknown colour', base('n1', 'note', { colour: 'magenta' })],
    [
      'text one over the limit',
      base('n1', 'note', { text: 'a'.repeat(WHITEBOARD_LIMITS.textChars + 1) })
    ],
    ['an odd number of pen points', base('p1', 'pen', { data: { points: [0, 0, 1, 1, 2] } })],
    ['a pen with one point', base('p1', 'pen', { data: { points: [0, 0] } })],
    [
      'a pen with 2,001 points',
      base('p1', 'pen', {
        data: { points: new Array(2 * (WHITEBOARD_LIMITS.penPoints + 1)).fill(1) }
      })
    ],
    ['a mind-map node that is its own parent', base('m1', 'mindmap', { data: { parentId: 'm1' } })],
    ['a card with a web link', base('k1', 'card', { link: 'https://example.com/a' })],
    ['a card with no link', base('k1', 'card')],
    ['a javascript: link', base('n1', 'note', { link: 'javascript:alert(1)' })],
    ['an unknown enum value in data', base('s1', 'shape', { data: { shape: 'star' } })],
    ['a negative mind-map order', base('m1', 'mindmap', { data: { order: -1 } })],
    ['not an object', 'note']
  ]

  for (const [name, value] of cases) {
    it(`throws for ${name}`, () => {
      expect(() => cleanWhiteboardObject(value)).toThrow(Error)
    })
  }

  it('names the object and field', () => {
    expect(() => cleanWhiteboardObject(base('abc', 'note', { width: 'wide' }))).toThrow(
      'Whiteboard object abc: width must be a number'
    )
  })

  it('accepts a pen with exactly the limit of points and zero size', () => {
    const points = new Array(2 * WHITEBOARD_LIMITS.penPoints).fill(1)
    const object = cleanWhiteboardObject(
      base('p1', 'pen', { width: 0, height: 0, data: { points } })
    )
    expect(object.width).toBe(0)
  })
})

describe('cleanWhiteboardLink', () => {
  it('keeps an item link', () => {
    expect(cleanWhiteboardLink(TASK_LINK)).toBe(TASK_LINK)
  })

  it('rewrites a legacy-scheme link with the current scheme', () => {
    const legacy = `${LEGACY_NAMES.urlScheme}://task/${PROJECT}/${TASK}`
    expect(cleanWhiteboardLink(`  ${legacy} `)).toBe(TASK_LINK)
  })

  it('keeps a web link', () => {
    expect(cleanWhiteboardLink(' https://example.com/a ')).toBe('https://example.com/a')
    expect(isWebLink('https://example.com/a')).toBe(true)
    expect(isWebLink(TASK_LINK)).toBe(false)
    expect(isWebLink(null)).toBe(false)
  })

  it('refuses other schemes and over-long links', () => {
    expect(() => cleanWhiteboardLink('ftp://x')).toThrow()
    expect(() => cleanWhiteboardLink('javascript:alert(1)')).toThrow()
    expect(() =>
      cleanWhiteboardLink(`https://example.com/${'a'.repeat(WHITEBOARD_LIMITS.linkChars)}`)
    ).toThrow()
  })

  it('reads no item from a web link', () => {
    expect(objectLinkTarget({ link: 'https://example.com/a' })).toBeNull()
    expect(objectLinkTarget({ link: null })).toBeNull()
  })
})

describe('cleanWhiteboardSave', () => {
  const note = (id: string) => base(id, 'note')

  it('refuses more than the limit of upserts', () => {
    const upserts = Array.from({ length: WHITEBOARD_LIMITS.upserts + 1 }, (_, index) =>
      note(`n${index}`)
    )
    expect(() => cleanWhiteboardSave({ upserts })).toThrow()
  })

  it('refuses an id both upserted and deleted', () => {
    expect(() => cleanWhiteboardSave({ upserts: [note('n1')], deletes: ['n1'] })).toThrow()
  })

  it('refuses a duplicate upsert id', () => {
    expect(() => cleanWhiteboardSave({ upserts: [note('n1'), note('n1')] })).toThrow()
  })

  it('refuses a duplicate or bad delete id', () => {
    expect(() => cleanWhiteboardSave({ deletes: ['a', 'a'] })).toThrow()
    expect(() => cleanWhiteboardSave({ deletes: ['bad id'] })).toThrow()
  })

  it('treats missing arrays as empty', () => {
    expect(cleanWhiteboardSave({})).toEqual({ upserts: [], deletes: [] })
  })

  it('cleans each upsert', () => {
    const save = cleanWhiteboardSave({ upserts: [note('n1')], deletes: ['n2'] })
    expect(save.upserts[0].colour).toBe('yellow')
    expect(save.deletes).toEqual(['n2'])
  })
})

describe('sameWhiteboardObject', () => {
  const pen = cleanWhiteboardObject(base('p1', 'pen', { data: { points: [0, 0, 5, 5] } }))

  it('ignores createdAt and updatedAt', () => {
    const a = { ...pen, createdAt: '2026-01-01', updatedAt: '2026-01-02' } as WhiteboardObject
    const b = { ...pen, createdAt: '2026-02-01', updatedAt: '2026-02-02' } as WhiteboardObject
    expect(sameWhiteboardObject(a, b)).toBe(true)
  })

  it('sees a changed pen point', () => {
    const moved = cleanWhiteboardObject(base('p1', 'pen', { data: { points: [0, 0, 5, 6] } }))
    expect(sameWhiteboardObject(pen, moved)).toBe(false)
  })

  it('sees a changed common field', () => {
    expect(sameWhiteboardObject(pen, { ...pen, x: pen.x + 1 })).toBe(false)
  })
})

describe('defaultObject and objectsById', () => {
  it('makes a 200×200 yellow note', () => {
    const note = defaultObject('note', { id: 'n1', x: 0, y: 0, z: 1 })
    expect(note).toMatchObject({ kind: 'note', width: 200, height: 200, colour: 'yellow', z: 1 })
    expect(cleanWhiteboardObject(note)).toEqual(note)
  })

  it('makes a 640×400 grey frame', () => {
    const frame = defaultObject('frame', { id: 'f1', x: 0, y: 0, z: 0 })
    expect(frame).toMatchObject({ kind: 'frame', width: 640, height: 400, colour: 'grey' })
  })

  it('makes text and shapes that pass the validator', () => {
    for (const kind of ['text', 'shape'] as const) {
      const object = defaultObject(kind, { id: kind, x: 5, y: 5, z: 0 })
      expect(cleanWhiteboardObject(object)).toEqual(object)
    }
  })

  it('maps objects by id', () => {
    const a = defaultObject('note', { id: 'a', x: 0, y: 0, z: 0 })
    const b = defaultObject('frame', { id: 'b', x: 0, y: 0, z: 0 })
    const map = objectsById([a, b])
    expect(map.get('b')).toBe(b)
    expect(map.size).toBe(2)
  })
})

describe('pen points', () => {
  it('are rounded to integers', () => {
    const object = cleanWhiteboardObject(
      base('p1', 'pen', { data: { points: [0.4, 0.6, 2.5, -1.4] } })
    )
    expect(object.data).toMatchObject({ points: [0, 1, 3, -1] })
  })
})

describe('bend points and free ideas', () => {
  const line = (data: Record<string, unknown>) =>
    cleanWhiteboardObject({
      id: 'c',
      kind: 'connector',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      z: 1,
      data: { from: { objectId: null, x: 0, y: 0 }, to: { objectId: null, x: 10, y: 0 }, ...data }
    })
  const via = (data: Record<string, unknown>) => {
    const object = line(data)
    return object?.kind === 'connector' ? object.data.via : 'not a connector'
  }

  it("keeps a connector's bend points, and writes none when there are none", () => {
    const points = [
      { x: 1, y: 2 },
      { x: 4, y: 5 }
    ]
    expect(via({ via: points })).toEqual(points)
    expect('via' in (line({ via: [] })?.data ?? {})).toBe(false)
    expect('via' in (line({})?.data ?? {})).toBe(false)
  })

  it('refuses a bend point that is not a point, and more than 100 of them', () => {
    expect(() => line({ via: [{ x: 'no', y: 3 }] })).toThrow('data.via[0].x must be a number')
    const many = Array.from({ length: 101 }, (_, x) => ({ x, y: 0 }))
    expect(() => line({ via: many })).toThrow('at most 100 points')
    expect(via({ via: many.slice(0, 100) })).toHaveLength(100)
  })

  it('writes free only on an idea placed by hand', () => {
    const idea = (free: unknown) =>
      cleanWhiteboardObject({
        id: 'n',
        kind: 'mindmap',
        x: 0,
        y: 0,
        width: 160,
        height: 48,
        z: 1,
        data: { parentId: 'root', order: 0, free }
      })
    expect(idea(true)?.data).toMatchObject({ free: true })
    expect('free' in (idea(false)?.data ?? {})).toBe(false)
    expect('free' in (idea(undefined)?.data ?? {})).toBe(false)
  })
})
