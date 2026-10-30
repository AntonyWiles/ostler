import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

// Library images get their thumbnails from Electron; under Vitest it cannot decode.
vi.mock('electron', () => ({ nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) } }))

const { LibraryService } = await import('../../electron/services/library-service')
const { PlanningService } = await import('../../electron/services/planning-service')
const { SnipController } = await import('../../electron/app/desktop/snip')
type SnipImage = import('../../electron/app/desktop/snip').SnipImage
type SnipPreview = import('../../src/shared/snip').SnipPreview

/**
 * Mark up (N4.2b): a marked-up snip replaces the waiting one before Add; a
 * marked-up copy of a Library picture is a new item with the original's AI
 * access, attached to the task it was made from (unattached from the
 * Library), and the original never changes.
 */

const PROJECT = 'project-one'
const human = { kind: 'human' as const }

// A real 1x1 PNG, so the Library classifies it as an image.
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
)
/** The same picture with one more byte: another file, as a marked-up copy would be. */
const MARKED = Uint8Array.from([...PNG, 0])

const tempDir = useTempDir('ostler-markup-')
let library: InstanceType<typeof LibraryService>
let planning: InstanceType<typeof PlanningService>

beforeEach(async () => {
  const dbPath = await createMigratedDatabase(tempDir())
  library = new LibraryService(dbPath, tempDir())
  planning = new PlanningService(dbPath, () => [PROJECT])
})

afterEach(() => {
  library.close()
  planning.close()
})

async function importPicture(name = 'Login page.png') {
  const [result] = await library.importFiles(PROJECT, [
    { fileName: name, mimeType: 'image/png', bytes: PNG }
  ])
  return result.item
}

describe('Mark up a copy', () => {
  it('opens the stored bytes of a picture', async () => {
    const original = await importPicture()
    const picture = library.readImage(PROJECT, original.id)
    expect(picture.mimeType).toBe('image/png')
    expect(Buffer.from(picture.bytes).equals(Buffer.from(PNG))).toBe(true)
  })

  it('refuses anything that is not a picture', async () => {
    const note = library.createItem(PROJECT, { kind: 'note', title: 'Notes', body: 'Hello' })
    expect(() => library.readImage(PROJECT, note.id)).toThrow()
    await expect(library.saveMarkedUpCopy(PROJECT, note.id, null, MARKED)).rejects.toThrow()
  })

  it('saves a new item with the original’s AI access, attached to the task', async () => {
    const task = planning.createWorkItem(PROJECT, { title: 'Fix the login page' }, human)
    const original = await importPicture()
    library.updateItem(PROJECT, original.id, { aiAccess: 'when-selected' })
    library.attachToWorkItem(PROJECT, task.id, original.id, 'human')
    const before = library.getItem(PROJECT, original.id)
    const storedBefore = fs.readFileSync(library.originalFilePath(PROJECT, original.id))

    const copy = await library.saveMarkedUpCopy(PROJECT, original.id, task.id, MARKED)

    expect(copy.id).not.toBe(original.id)
    expect(copy.file?.fileName).toBe('Login page (marked up).png')
    expect(copy.aiAccess).toBe('when-selected')
    const attached = library.listWorkItemAttachments(PROJECT, task.id).map((entry) => entry.item.id)
    expect(attached.sort()).toEqual([original.id, copy.id].sort())
    // The original is never changed: its record and its file are as they were.
    expect(library.getItem(PROJECT, original.id)).toEqual(before)
    expect(
      fs.readFileSync(library.originalFilePath(PROJECT, original.id)).equals(storedBefore)
    ).toBe(true)
    expect(Buffer.from(library.readImage(PROJECT, copy.id).bytes).equals(Buffer.from(MARKED))).toBe(
      true
    )
  })

  it('keeps a human-only picture human only, attached but never given to an agent', async () => {
    const task = planning.createWorkItem(PROJECT, { title: 'Private' }, human)
    const original = await importPicture('Account.png')
    library.updateItem(PROJECT, original.id, { aiAccess: 'human-only' })
    const copy = await library.saveMarkedUpCopy(PROJECT, original.id, task.id, MARKED)
    expect(copy.aiAccess).toBe('human-only')
    expect(library.listWorkItemAttachments(PROJECT, task.id).map((e) => e.item.id)).toEqual([
      copy.id
    ])
    expect(library.agentAttachments(PROJECT, task.id).given).toEqual([])
  })

  it('from the Library, starts the copy unattached, even when the original is on tasks', async () => {
    const one = planning.createWorkItem(PROJECT, { title: 'One' }, human)
    const two = planning.createWorkItem(PROJECT, { title: 'Two' }, human)
    const original = await importPicture()
    library.attachToWorkItem(PROJECT, one.id, original.id, 'human')
    library.attachToWorkItem(PROJECT, two.id, original.id, 'human')
    const copy = await library.saveMarkedUpCopy(PROJECT, original.id, null, MARKED)
    expect(library.listItemAttachments(PROJECT, copy.id)).toEqual([])
    for (const task of [one, two]) {
      expect(library.listWorkItemAttachments(PROJECT, task.id).map((e) => e.item.id)).toEqual([
        original.id
      ])
    }
  })

  it('refuses bytes that are not a PNG', async () => {
    const original = await importPicture()
    await expect(
      library.saveMarkedUpCopy(PROJECT, original.id, null, Uint8Array.from([1, 2, 3]))
    ).rejects.toThrow()
    expect(library.listItems(PROJECT)).toHaveLength(1)
  })
})

describe('Mark up a snip', () => {
  function fakeImage(width: number, height: number, png: Uint8Array): SnipImage {
    return {
      getSize: () => ({ width, height }),
      crop: (rect) => fakeImage(rect.width, rect.height, png),
      resize: (options) => fakeImage(options.width ?? width, options.height ?? height, png),
      toPNG: () => png,
      toDataURL: () => `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
      toJPEG: () => png
    }
  }

  function setUp() {
    const delivered: SnipPreview[] = []
    const saved: Uint8Array[] = []
    const controller = new SnipController({
      capture: async () => [
        {
          display: { id: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.5 },
          image: fakeImage(3840, 2160, PNG)
        }
      ],
      openOverlays: () => ({ close: () => {} }),
      hideMainWindow: async () => true,
      restoreMainWindow: () => {},
      cursorPoint: () => ({ x: 0, y: 0 }),
      deliver: (preview) => delivered.push(preview),
      save: async (_projectId, _workItemId, _fileName, png) => {
        saved.push(png)
        return null as never
      },
      imageFromPng: (png) => fakeImage(3840, 2160, png),
      now: () => new Date(2026, 2, 14, 9, 41),
      warn: () => {}
    })
    return { controller, delivered, saved }
  }

  it('gives the editor the snip at its full resolution, and Add saves the marked-up one', async () => {
    const { controller, delivered, saved } = setUp()
    await controller.start()
    controller.select({ whole: true })
    const { snipId } = delivered[0]
    expect(Buffer.from(controller.picture(snipId)).equals(Buffer.from(PNG))).toBe(true)

    const preview = controller.replace(snipId, MARKED)
    expect(preview).toMatchObject({ snipId, width: 3840, height: 2160 })
    expect(Buffer.from(controller.picture(snipId)).equals(Buffer.from(MARKED))).toBe(true)

    await controller.save(PROJECT, 'task', snipId)
    expect(saved).toHaveLength(1)
    expect(Buffer.from(saved[0]).equals(Buffer.from(MARKED))).toBe(true)
  })

  it('refuses what is not a PNG and keeps the snip as it was', async () => {
    const { controller, delivered } = setUp()
    await controller.start()
    controller.select({ whole: true })
    const { snipId } = delivered[0]
    expect(() => controller.replace(snipId, Uint8Array.from([1, 2, 3]))).toThrow()
    expect(Buffer.from(controller.picture(snipId)).equals(Buffer.from(PNG))).toBe(true)
    expect(() => controller.replace('another', MARKED)).toThrow()
  })
})
