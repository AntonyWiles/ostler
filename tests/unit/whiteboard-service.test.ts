import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryService } from '../../electron/services/library-service'
import { ItemLinkIndex } from '../../electron/services/item-link-index'
import { isRefusal } from '../../src/shared/refusal'
import { WHITEBOARD_LIMITS } from '../../src/shared/whiteboard/model'
import { OUTLINE_EMPTY, whiteboardOutline } from '../../src/shared/whiteboard/outline'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/**
 * Whiteboard storage (plan `docs/plans/whiteboards/`, prompt 03b): a whiteboard is a Library
 * item of kind `whiteboard` whose objects are rows of `whiteboard_objects`, and whose body is
 * rewritten as its outline on every save.
 */

const PROJECT = 'b2c09364-5133-4ddf-9131-2b30cd9fa0d9'
const OTHER = '7d1f6a2e-0c4b-4f1e-9a55-2f4f3b8f0a11'
const TASK = '5f0e4b7c-3c1d-4a8e-8f2b-9e6d1c0a7b42'

const tempDir = useTempDir('ostler-whiteboard-')
let dbPath: string
let library: LibraryService
/** A second connection for rows the Library does not write (tasks, shares). */
let raw: Database.Database

beforeEach(async () => {
  dbPath = await createMigratedDatabase(tempDir())
  raw = new Database(dbPath)
  library = new LibraryService(dbPath, tempDir())
})

afterEach(() => {
  library.close()
  raw.close()
})

const note = (id: string, text: string, x = 0, y = 0) => ({
  id,
  kind: 'note',
  x,
  y,
  width: 200,
  height: 200,
  z: 0,
  text
})

const picture = (id: string, imageItemId: string) => ({
  id,
  kind: 'image',
  x: 0,
  y: 400,
  width: 100,
  height: 100,
  z: 1,
  data: { imageItemId }
})

const insertTask = (id: string, projectId: string, title: string) =>
  raw
    .prepare(
      `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
       VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
    )
    .run(id, projectId, title)

const objectRows = (whiteboardId: string) =>
  raw
    .prepare('SELECT id, text, x FROM whiteboard_objects WHERE whiteboard_id = ? ORDER BY id')
    .all(whiteboardId) as { id: string; text: string; x: number }[]

/** Runs `action` and returns the refusal it raised; fails when it raised none or a plain Error. */
function refusalOf(action: () => unknown): string {
  try {
    action()
  } catch (error) {
    expect(isRefusal(error)).toBe(true)
    return (error as Error).message
  }
  throw new Error('Expected a refusal')
}

describe('creating a whiteboard', () => {
  it('makes an empty whiteboard item: kind, AI access, outline body, revision 1', () => {
    const { item, objects } = library.whiteboards.create(PROJECT, { title: '  Planning  ' })
    expect(item).toMatchObject({
      kind: 'whiteboard',
      title: 'Planning',
      summary: '',
      body: OUTLINE_EMPTY,
      url: null,
      file: null,
      aiAccess: 'when-selected',
      tags: [],
      revision: 1
    })
    expect(objects).toEqual([])
    expect(library.getItem(PROJECT, item.id)).toEqual(item)
    expect(library.listRevisions(PROJECT, item.id)).toHaveLength(1)
  })

  it('stores the objects it is given and writes their outline', () => {
    const { item, objects } = library.whiteboards.create(PROJECT, {
      title: 'Ideas',
      objects: [note('n1', 'Buy paint'), note('n2', 'Sand the door', 300)] as never
    })
    expect(objects.map((object) => object.id)).toEqual(['n1', 'n2'])
    expect(objects[0]).toMatchObject({ kind: 'note', text: 'Buy paint', colour: 'yellow' })
    expect(objects[0].createdAt).toBe(item.createdAt)
    expect(item.body).toBe(whiteboardOutline(objects))
    expect(item.body).toContain('Buy paint')
    expect(item.revision).toBe(1)
    expect(library.listItems(PROJECT, { search: 'paint' }).map((found) => found.id)).toEqual([
      item.id
    ])
  })

  it('refuses a title that is empty', () => {
    expect(() => library.whiteboards.create(PROJECT, { title: ' ' })).toThrow()
  })
})

describe('reading and saving a whiteboard', () => {
  it('returns the objects with get and listObjects', () => {
    const { item } = library.whiteboards.create(PROJECT, {
      title: 'Board',
      objects: [note('b', 'Second', 0, 0), { ...note('a', 'First'), z: 5 }] as never
    })
    const document = library.whiteboards.get(PROJECT, item.id)
    expect(document.item).toEqual(item)
    // Back to front: by z, then id.
    expect(document.objects.map((object) => object.id)).toEqual(['b', 'a'])
    expect(library.whiteboards.listObjects(PROJECT, item.id)).toEqual(document.objects)
    expect(library.whiteboards.outlineOf(PROJECT, item.id)).toBe(item.body)
  })

  it('adds, changes and deletes objects in one save, bumping the revision once', () => {
    const { item } = library.whiteboards.create(PROJECT, {
      title: 'Board',
      objects: [note('keep', 'Keep me'), note('gone', 'Remove me', 300)] as never
    })
    const result = library.whiteboards.save(PROJECT, item.id, {
      upserts: [note('keep', 'Kept and changed'), note('new', 'A new idea', 0, 300)],
      deletes: ['gone', 'never-existed']
    })
    expect(objectRows(item.id)).toEqual([
      { id: 'keep', text: 'Kept and changed', x: 0 },
      { id: 'new', text: 'A new idea', x: 0 }
    ])
    expect(result.item.revision).toBe(2)
    expect(result.item.updatedAt).toBe(result.savedAt)
    expect(result.item.body).toContain('Kept and changed')
    expect(result.item.body).not.toContain('Remove me')
    expect(library.getItem(PROJECT, item.id)).toEqual(result.item)
    expect(library.listRevisions(PROJECT, item.id).map((revision) => revision.revision)).toEqual([
      2, 1
    ])
    expect(library.listItems(PROJECT, { search: 'idea' }).map((found) => found.id)).toEqual([
      item.id
    ])
  })

  it('keeps the revision when a save only moves an object', () => {
    const { item } = library.whiteboards.create(PROJECT, {
      title: 'Board',
      objects: [note('n1', 'Alone')] as never
    })
    const result = library.whiteboards.save(PROJECT, item.id, {
      upserts: [note('n1', 'Alone', 40, 20)]
    })
    expect(objectRows(item.id)).toEqual([{ id: 'n1', text: 'Alone', x: 40 }])
    expect(result.item.revision).toBe(1)
    expect(result.item.body).toBe(item.body)
    expect(library.listRevisions(PROJECT, item.id)).toHaveLength(1)
  })

  it('makes a linked task\'s "Linked from" list the whiteboard', () => {
    insertTask(TASK, PROJECT, 'Paint the hall')
    const { item } = library.whiteboards.create(PROJECT, { title: 'Board' })
    library.whiteboards.save(PROJECT, item.id, {
      upserts: [{ ...note('n1', 'See the task'), link: `ostler://task/${PROJECT}/${TASK}` }]
    })
    // The link index, read on its own connection as the automation API's "linkedFrom" does.
    const linkedFrom = new ItemLinkIndex(raw).linkedFrom('task', TASK)
    expect(linkedFrom).toEqual([
      expect.objectContaining({ sourceKind: 'library', sourceId: item.id })
    ])
  })

  it('rewrites a stale body when the whiteboard is opened', () => {
    const { item } = library.whiteboards.create(PROJECT, {
      title: 'Board',
      objects: [note('n1', 'Old words')] as never
    })
    // As sync would: another PC's change arrives straight into the row.
    raw.prepare("UPDATE whiteboard_objects SET text = 'New words' WHERE id = 'n1'").run()
    const document = library.whiteboards.get(PROJECT, item.id)
    expect(document.item.body).toContain('New words')
    expect(document.item.revision).toBe(2)
    expect(library.getItem(PROJECT, item.id).body).toBe(document.item.body)
    expect(library.whiteboards.get(PROJECT, item.id).item.revision).toBe(2)
  })
})

describe('what a save refuses', () => {
  it('refuses an item that is not this project’s whiteboard', () => {
    const brief = library.createItem(PROJECT, { kind: 'note', title: 'Notes' })
    const expected = refusalOf(() => library.whiteboards.get(PROJECT, brief.id))
    expect(expected).toBeTruthy()
    const { item } = library.whiteboards.create(PROJECT, { title: 'Board' })
    expect(refusalOf(() => library.whiteboards.get(OTHER, item.id))).toBe(expected)
    expect(refusalOf(() => library.whiteboards.save(PROJECT, brief.id, {}))).toBe(expected)
    expect(refusalOf(() => library.whiteboards.listObjects(PROJECT, 'missing'))).toBe(expected)
  })

  it('refuses an archived whiteboard', () => {
    const { item } = library.whiteboards.create(PROJECT, { title: 'Board' })
    library.archiveItem(PROJECT, item.id)
    refusalOf(() => library.whiteboards.save(PROJECT, item.id, { upserts: [note('n1', 'x')] }))
    expect(objectRows(item.id)).toEqual([])
  })

  it('refuses a save that would hold more objects than the limit', () => {
    const { item } = library.whiteboards.create(PROJECT, { title: 'Board' })
    const batch = WHITEBOARD_LIMITS.upserts
    for (let start = 0; start < WHITEBOARD_LIMITS.objects; start += batch) {
      library.whiteboards.save(PROJECT, item.id, {
        upserts: Array.from({ length: batch }, (_, index) => note(`o${start + index}`, ''))
      })
    }
    expect(library.whiteboards.listObjects(PROJECT, item.id)).toHaveLength(
      WHITEBOARD_LIMITS.objects
    )
    const message = refusalOf(() =>
      library.whiteboards.save(PROJECT, item.id, { upserts: [note('one-more', '')] })
    )
    expect(message).toContain(String(WHITEBOARD_LIMITS.objects))
    // Replacing one is fine: the count stays at the limit.
    expect(() =>
      library.whiteboards.save(PROJECT, item.id, {
        upserts: [note('one-more', '')],
        deletes: ['o0']
      })
    ).not.toThrow()
  })

  it('refuses an object id that is on another whiteboard', () => {
    const first = library.whiteboards.create(PROJECT, {
      title: 'First',
      objects: [note('shared-id', 'Mine')] as never
    }).item
    const second = library.whiteboards.create(PROJECT, { title: 'Second' }).item
    refusalOf(() =>
      library.whiteboards.save(PROJECT, second.id, { upserts: [note('shared-id', 'Taken')] })
    )
    expect(objectRows(first.id)).toEqual([{ id: 'shared-id', text: 'Mine', x: 0 }])
    expect(objectRows(second.id)).toEqual([])
  })

  it("refuses a picture from another project's Library, and takes one from this project", () => {
    const { item } = library.whiteboards.create(PROJECT, { title: 'Board' })
    const insertImage = (id: string, projectId: string) =>
      raw
        .prepare(
          `INSERT INTO library_items (id, project_id, kind, title, ai_access, created_at, updated_at)
           VALUES (?, ?, 'image', 'Floor plan', 'when-selected', 't', 't')`
        )
        .run(id, projectId)
    const theirs = '0b7e1c2d-1111-4a2b-8c3d-4e5f6a7b8c9d'
    const ours = '0b7e1c2d-2222-4a2b-8c3d-4e5f6a7b8c9d'
    insertImage(theirs, OTHER)
    insertImage(ours, PROJECT)
    refusalOf(() =>
      library.whiteboards.save(PROJECT, item.id, { upserts: [picture('p1', theirs)] })
    )
    const result = library.whiteboards.save(PROJECT, item.id, {
      upserts: [picture('p1', ours)]
    })
    expect(result.item.body).toContain('Floor plan')
  })

  it('throws a plain Error for a malformed save', () => {
    const { item } = library.whiteboards.create(PROJECT, { title: 'Board' })
    for (const input of [null, { upserts: 'no' }, { upserts: [{ id: 'x', kind: 'nope' }] }]) {
      let caught: unknown
      try {
        library.whiteboards.save(PROJECT, item.id, input)
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(Error)
      expect(isRefusal(caught)).toBe(false)
    }
  })
})

describe('the rest of the Library and a whiteboard', () => {
  it('refuses a typed body and restoring a revision', () => {
    const { item } = library.whiteboards.create(PROJECT, { title: 'Board' })
    expect(() => library.updateItem(PROJECT, item.id, { body: 'Typed' })).toThrow(
      "A whiteboard's body is written from its objects"
    )
    expect(library.updateItem(PROJECT, item.id, { title: 'Renamed' }).title).toBe('Renamed')
    refusalOf(() => library.restoreRevision(PROJECT, item.id, 1))
  })

  it('leaves no objects behind when the whiteboard is deleted', () => {
    const { item } = library.whiteboards.create(PROJECT, {
      title: 'Board',
      objects: [note('n1', 'One'), note('n2', 'Two', 300)] as never
    })
    library.deleteItem(PROJECT, item.id)
    expect(raw.prepare('SELECT COUNT(*) AS n FROM whiteboard_objects').get()).toEqual({ n: 0 })
  })

  it('tells the attached task when the outline changes, and not when an object only moves', () => {
    insertTask(TASK, PROJECT, 'Paint the hall')
    const { item } = library.whiteboards.create(PROJECT, {
      title: 'Board',
      objects: [note('n1', 'First')] as never
    })
    library.attachToWorkItem(PROJECT, TASK, item.id, 'human')
    const listener = vi.fn()
    library.setAttachmentsChangedListener(listener)

    library.whiteboards.save(PROJECT, item.id, { upserts: [note('n1', 'First, changed')] })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(PROJECT, TASK)

    listener.mockClear()
    library.whiteboards.save(PROJECT, item.id, { upserts: [note('n1', 'First, changed', 50)] })
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('a whiteboard in a shared project', () => {
  beforeEach(() => {
    raw
      .prepare(
        `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at)
         VALUES (?, 'share-1', 'x', 'm1', 'dev-a', 1, 1)`
      )
      .run(PROJECT)
  })

  const outbox = (table: string) =>
    raw
      .prepare('SELECT row_key, op FROM sync_outbox WHERE table_name = ? ORDER BY id')
      .all(table) as { row_key: string; op: string }[]

  it('records saved objects for sync, and a delete for each when the whiteboard goes', () => {
    const { item } = library.whiteboards.create(PROJECT, { title: 'Board' })
    library.whiteboards.save(PROJECT, item.id, {
      upserts: [note('n1', 'One'), note('n2', 'Two', 300)]
    })
    expect(outbox('whiteboard_objects')).toEqual([
      { row_key: '["n1"]', op: 'upsert' },
      { row_key: '["n2"]', op: 'upsert' }
    ])
    library.deleteItem(PROJECT, item.id)
    const deletes = outbox('whiteboard_objects').filter((row) => row.op === 'delete')
    expect(deletes.map((row) => row.row_key).sort()).toEqual(['["n1"]', '["n2"]'])
    expect(outbox('library_items').at(-1)).toEqual({ row_key: `["${item.id}"]`, op: 'delete' })
  })

  it("returns a stale whiteboard as it is on a Viewer's PC", () => {
    const { item } = library.whiteboards.create(PROJECT, {
      title: 'Board',
      objects: [note('n1', 'Old words')] as never
    })
    raw.prepare("UPDATE whiteboard_objects SET text = 'New words' WHERE id = 'n1'").run()
    raw.prepare("UPDATE sync_shares SET my_role = 'viewer' WHERE project_id = ?").run(PROJECT)

    const document = library.whiteboards.get(PROJECT, item.id)
    expect(document.item).toEqual(item)
    expect(document.objects[0].text).toBe('New words')
    expect(library.getItem(PROJECT, item.id).body).toContain('Old words')
  })
})
