import { describe, expect, it } from 'vitest'
import {
  WHITEBOARD_FILE_FORMAT,
  WHITEBOARD_FILE_MAX_BYTES,
  WHITEBOARD_FILE_VERSION,
  WHITEBOARD_TITLE_MAX,
  buildWhiteboardFile,
  parseWhiteboardFile,
  remapWhiteboardIds,
  serializeWhiteboardFile,
  type WhiteboardFilePicture
} from '../../src/shared/whiteboard/file-format'
import {
  cleanWhiteboardObject,
  type WhiteboardObjectInput
} from '../../src/shared/whiteboard/model'

/** The whiteboard file (docs/plans/whiteboards/, D15) and fresh ids for copied objects. */

const NOW = new Date('2026-10-26T12:00:00.000Z')
const box = { x: 0, y: 0, width: 100, height: 50, z: 1 }

function make(value: Record<string, unknown>): WhiteboardObjectInput {
  return cleanWhiteboardObject({ ...box, ...value })
}

const note = make({ id: 'n1', kind: 'note', text: 'Hello', groupId: 'g1' })
const shape = make({ id: 's1', kind: 'shape', groupId: 'g1', x: 200 })
const image = make({ id: 'i1', kind: 'image', data: { imageItemId: 'pic1' } })
const lostImage = make({ id: 'i2', kind: 'image', data: { imageItemId: 'gone' } })
const picture: WhiteboardFilePicture = {
  id: 'pic1',
  fileName: 'photo.png',
  mimeType: 'image/png',
  base64: 'iVBORw0KGgo='
}

function fileText(overrides: Record<string, unknown> = {}): string {
  const file = buildWhiteboardFile('Board', [note], [picture], NOW)
  return JSON.stringify({ ...file, ...overrides })
}

describe('build, serialize and parse', () => {
  it('round trips objects and pictures', () => {
    const file = buildWhiteboardFile('  My board  ', [note, shape, image], [picture], NOW)
    expect(file.format).toBe(WHITEBOARD_FILE_FORMAT)
    expect(file.version).toBe(WHITEBOARD_FILE_VERSION)
    expect(file.exportedAt).toBe('2026-10-26T12:00:00.000Z')
    const parsed = parseWhiteboardFile(serializeWhiteboardFile(file))
    expect(parsed).toEqual({
      ok: true,
      file: { ...file, title: 'My board' }
    })
  })

  it('serializes with two-space indentation', () => {
    const file = buildWhiteboardFile('B', [], [], NOW)
    expect(serializeWhiteboardFile(file)).toBe(JSON.stringify(file, null, 2))
  })

  it('gives an image without its picture imageItemId null', () => {
    const file = buildWhiteboardFile('B', [image, lostImage], [picture], NOW)
    expect(file.objects[0]).toMatchObject({ data: { imageItemId: 'pic1' } })
    expect(file.objects[1]).toMatchObject({ data: { imageItemId: null } })
    expect(lostImage).toMatchObject({ data: { imageItemId: 'gone' } })
  })

  it('copies objects rather than sharing them', () => {
    const file = buildWhiteboardFile('B', [note], [picture], NOW)
    expect(file.objects[0]).toEqual(note)
    expect(file.objects[0]).not.toBe(note)
    expect(file.objects[0].data).not.toBe(note.data)
    expect(file.pictures[0]).not.toBe(picture)
  })

  it('trims and cuts the title; a missing title is empty', () => {
    const long = parseWhiteboardFile(fileText({ title: 'x'.repeat(300) }))
    expect(long.ok && long.file.title.length).toBe(WHITEBOARD_TITLE_MAX)
    const missing = parseWhiteboardFile(fileText({ title: undefined }))
    expect(missing.ok && missing.file.title).toBe('')
  })

  it('returns the cleaned objects', () => {
    const parsed = parseWhiteboardFile(
      fileText({ objects: [{ id: 'n9', kind: 'note', ...box, extra: true }] })
    )
    expect(parsed.ok && parsed.file.objects[0]).toEqual(
      cleanWhiteboardObject({ id: 'n9', kind: 'note', ...box })
    )
  })
})

describe('parseWhiteboardFile problems', () => {
  const problem = (text: string) => {
    const parsed = parseWhiteboardFile(text)
    return parsed.ok ? 'ok' : parsed.problem
  }

  it('too-large', () => {
    expect(problem(' '.repeat(WHITEBOARD_FILE_MAX_BYTES + 1))).toBe('too-large')
  })

  it('not-json', () => {
    expect(problem('{ not json')).toBe('not-json')
  })

  it('not-whiteboard', () => {
    expect(problem('[]')).toBe('not-whiteboard')
    expect(problem('"text"')).toBe('not-whiteboard')
    expect(problem(fileText({ format: 'ostler-project-package' }))).toBe('not-whiteboard')
  })

  it('newer-version', () => {
    expect(problem(fileText({ version: 2 }))).toBe('newer-version')
  })

  it('invalid version', () => {
    expect(problem(fileText({ version: 0 }))).toBe('invalid')
    expect(problem(fileText({ version: 1.5 }))).toBe('invalid')
    expect(problem(fileText({ version: '1' }))).toBe('invalid')
  })

  it('invalid objects', () => {
    expect(problem(fileText({ objects: [{ id: 'bad', kind: 'blob', ...box }] }))).toBe('invalid')
    expect(problem(fileText({ objects: {} }))).toBe('invalid')
    expect(problem(fileText({ objects: [note, note] }))).toBe('invalid')
  })

  it('invalid pictures', () => {
    expect(problem(fileText({ pictures: [{ ...picture, mimeType: 'image/svg+xml' }] }))).toBe(
      'invalid'
    )
    expect(problem(fileText({ pictures: [{ ...picture, base64: 'not base64!' }] }))).toBe('invalid')
    expect(problem(fileText({ pictures: [{ ...picture, id: 'bad id' }] }))).toBe('invalid')
    expect(problem(fileText({ pictures: [{ ...picture, fileName: '' }] }))).toBe('invalid')
    expect(problem(fileText({ pictures: [{ ...picture, fileName: 'x'.repeat(256) }] }))).toBe(
      'invalid'
    )
    expect(problem(fileText({ pictures: null }))).toBe('invalid')
    expect(problem(fileText({ pictures: Array(201).fill(picture) }))).toBe('invalid')
  })
})

describe('remapWhiteboardIds', () => {
  function counter() {
    let next = 0
    return () => `new${++next}`
  }

  const connector = (id: string, from: string | null, to: string | null) =>
    make({
      id,
      kind: 'connector',
      data: { from: { objectId: from, x: 1, y: 2 }, to: { objectId: to, x: 3, y: 4 } }
    })
  const node = (id: string, parentId: string | null) =>
    make({ id, kind: 'mindmap', data: { parentId } })

  it('gives every object a new id', () => {
    const result = remapWhiteboardIds([note, shape, image], counter())
    const ids = result.map((object) => object.id)
    expect(new Set(ids).size).toBe(3)
    for (const id of ids) expect(['n1', 's1', 'i1']).not.toContain(id)
  })

  it('keeps a group together under one new id', () => {
    const [a, b, c] = remapWhiteboardIds([note, shape, image], counter())
    expect(a.groupId).not.toBeNull()
    expect(a.groupId).not.toBe('g1')
    expect(b.groupId).toBe(a.groupId)
    expect(c.groupId).toBeNull()
  })

  it('remaps a connector stuck inside the set and frees one stuck outside it', () => {
    const [newNote, line] = remapWhiteboardIds(
      [note, connector('c1', 'n1', 'elsewhere')],
      counter()
    )
    if (line.kind !== 'connector') throw new Error('expected a connector')
    expect(line.data.from).toEqual({ objectId: newNote.id, x: 1, y: 2 })
    expect(line.data.to).toEqual({ objectId: null, x: 3, y: 4 })
  })

  it('remaps a mind-map parent and makes an orphan a central idea', () => {
    const [root, child, orphan] = remapWhiteboardIds(
      [node('m1', null), node('m2', 'm1'), node('m3', 'missing')],
      counter()
    )
    if (child.kind !== 'mindmap' || orphan.kind !== 'mindmap' || root.kind !== 'mindmap') {
      throw new Error('expected mind-map nodes')
    }
    expect(root.data.parentId).toBeNull()
    expect(child.data.parentId).toBe(root.id)
    expect(orphan.data.parentId).toBeNull()
  })

  it('maps a picture id and nulls a missing one; keeps it without a map', () => {
    const mapped = remapWhiteboardIds([image, lostImage], counter(), new Map([['pic1', 'lib9']]))
    expect(mapped[0]).toMatchObject({ data: { imageItemId: 'lib9' } })
    expect(mapped[1]).toMatchObject({ data: { imageItemId: null } })
    const kept = remapWhiteboardIds([image], counter())
    expect(kept[0]).toMatchObject({ data: { imageItemId: 'pic1' } })
  })

  it('does not change the objects it was given', () => {
    const before = JSON.stringify(note)
    remapWhiteboardIds([note], counter())
    expect(JSON.stringify(note)).toBe(before)
  })
})
