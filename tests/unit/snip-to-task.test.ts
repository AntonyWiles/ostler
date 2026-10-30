import fs from 'node:fs'
import path from 'node:path'
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
 * Snip to task (N4.2a): Add stores one PNG in the project's Library, When
 * selected, attached to the new task as `human` through the ordinary gate;
 * Cancel stores nothing; the overlays always close and the full captures are
 * let go.
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

/** A fake capture that records how it was cropped. */
function fakeImage(width: number, height: number, crops: unknown[]): SnipImage {
  return {
    getSize: () => ({ width, height }),
    crop: (rect) => {
      crops.push(rect)
      return fakeImage(rect.width, rect.height, crops)
    },
    resize: (options) => fakeImage(options.width ?? width, options.height ?? height, crops),
    toPNG: () => PNG,
    toDataURL: () => `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`,
    toJPEG: () => PNG
  }
}

const tempDir = useTempDir('ostler-snip-')
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

function setUp() {
  const crops: unknown[] = []
  const delivered: SnipPreview[] = []
  const events: string[] = []
  const controller = new SnipController({
    capture: async () => [
      {
        display: { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
        image: fakeImage(1920, 1080, crops)
      },
      {
        display: { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.5 },
        image: fakeImage(3840, 2160, crops)
      }
    ],
    openOverlays: (displays) => {
      events.push(`overlays ${displays.map((display) => display.id).join(',')}`)
      return { close: () => events.push('overlays closed') }
    },
    hideMainWindow: async () => {
      events.push('hidden')
      return true
    },
    restoreMainWindow: () => events.push('restored'),
    cursorPoint: () => ({ x: 2000, y: 100 }),
    deliver: (preview) => delivered.push(preview),
    save: (projectId, workItemId, fileName, png) =>
      library.saveSnip(projectId, workItemId, fileName, png).then((saved) => saved.item),
    imageFromPng: () => null,
    now: () => new Date(2026, 2, 14, 9, 41),
    warn: () => {}
  })
  return { controller, crops, delivered, events }
}

function storedFiles(): string[] {
  const root = path.join(tempDir(), 'library')
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { recursive: true }).map(String)
}

describe('Snip to task', () => {
  it('hides the window first, then shows an overlay over every display', async () => {
    const { controller, events } = setUp()
    await controller.start()
    expect(events).toEqual(['hidden', 'overlays 1,2'])
    expect(controller.active).toBe(true)
    expect(controller.overlayPicture(2)).toMatchObject({ width: 3840, height: 2160 })
  })

  it('Add stores one PNG, When selected, attached to the task by a person', async () => {
    const { controller, crops, delivered, events } = setUp()
    const task = planning.createWorkItem(PROJECT, { title: 'Fix the chart' }, human)
    await controller.start()
    expect(
      controller.select({ displayId: 2, rect: { x: 10, y: 20, width: 100, height: 50 } })
    ).toBe(true)
    expect(crops).toEqual([{ x: 15, y: 30, width: 150, height: 75 }])
    expect(events.at(-1)).toBe('overlays closed')
    expect(controller.active).toBe(false)
    // Nothing is written before Add.
    expect(storedFiles()).toEqual([])
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({ width: 150, height: 75 })

    await controller.save(PROJECT, task.id, delivered[0].snipId)
    const items = library.listItems(PROJECT)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'image', aiAccess: 'when-selected' })
    expect(items[0].file?.fileName).toMatch(/^Screenshot .*2026 09\.41\.png$/)
    expect(items[0].file?.mimeType).toBe('image/png')
    const attachments = library.listWorkItemAttachments(PROJECT, task.id)
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({ attachedBy: 'human' })
    expect(attachments[0].item.id).toBe(items[0].id)
    // When selected and attached: given to the task's agent as any attachment.
    expect(library.agentAttachments(PROJECT, task.id).given.map((a) => a.item.id)).toEqual([
      items[0].id
    ])
    expect(library.aiVisibleItem(PROJECT, items[0].id)?.id).toBe(items[0].id)
    // The snip is used up.
    await expect(controller.save(PROJECT, task.id, delivered[0].snipId)).rejects.toThrow()
    expect(library.listItems(PROJECT)).toHaveLength(1)
  })

  it('keeps the access the person gave the same picture, and never gives a Human only one to an agent', async () => {
    const { controller, delivered } = setUp()
    const task = planning.createWorkItem(PROJECT, { title: 'Same picture' }, human)
    const [{ item: picture }] = await library.importFiles(PROJECT, [
      { fileName: 'known.png', mimeType: 'image/png', bytes: PNG }
    ])
    const known = library.updateItem(PROJECT, picture.id, { aiAccess: 'human-only' })
    await controller.start()
    controller.select({ displayId: 1, rect: { x: 0, y: 0, width: 40, height: 40 } })
    await controller.save(PROJECT, task.id, delivered[0].snipId)
    expect(library.listItems(PROJECT).map((item) => item.id)).toEqual([known.id])
    expect(library.getItem(PROJECT, known.id).aiAccess).toBe('human-only')
    expect(library.listWorkItemAttachments(PROJECT, task.id).map((e) => e.item.id)).toEqual([
      known.id
    ])
    expect(library.agentAttachments(PROJECT, task.id).given).toEqual([])
  })

  it('Cancel in quick add stores nothing', async () => {
    const { controller, delivered } = setUp()
    const task = planning.createWorkItem(PROJECT, { title: 'Never mind' }, human)
    await controller.start()
    controller.select({ displayId: 1, rect: { x: 0, y: 0, width: 40, height: 40 } })
    controller.discard(delivered[0].snipId)
    await expect(controller.save(PROJECT, task.id, delivered[0].snipId)).rejects.toThrow()
    expect(library.listItems(PROJECT)).toEqual([])
    expect(storedFiles()).toEqual([])
  })

  it('Esc closes every overlay, brings the window back and keeps nothing', async () => {
    const { controller, delivered, events } = setUp()
    await controller.start()
    controller.cancel()
    expect(events).toEqual(['hidden', 'overlays 1,2', 'overlays closed', 'restored'])
    expect(controller.active).toBe(false)
    expect(delivered).toEqual([])
    expect(() => controller.overlayPicture(1)).toThrow()
  })

  it('Enter takes the whole display under the pointer', async () => {
    const { controller, crops } = setUp()
    await controller.start()
    expect(controller.select({ whole: true })).toBe(true)
    expect(crops).toEqual([{ x: 0, y: 0, width: 3840, height: 2160 }])
  })

  it('ignores a drag too small to be a snip, and keeps the overlays up', async () => {
    const { controller, delivered } = setUp()
    await controller.start()
    expect(controller.select({ displayId: 1, rect: { x: 5, y: 5, width: 1, height: 1 } })).toBe(
      false
    )
    expect(controller.active).toBe(true)
    expect(delivered).toEqual([])
  })

  it('closes the overlays and brings the window back when the capture fails', async () => {
    const events: string[] = []
    const controller = new SnipController({
      capture: async () => {
        throw new Error('no screen')
      },
      openOverlays: () => ({ close: () => events.push('overlays closed') }),
      hideMainWindow: async () => true,
      restoreMainWindow: () => events.push('restored'),
      cursorPoint: () => ({ x: 0, y: 0 }),
      deliver: () => {},
      save: async () => null as never,
      imageFromPng: () => null,
      now: () => new Date(),
      warn: () => {}
    })
    await expect(controller.start()).rejects.toThrow('no screen')
    expect(events).toEqual(['restored'])
    expect(controller.active).toBe(false)
  })

  it('closes the overlays on quit, and a second press while snipping does nothing', async () => {
    const { controller, events } = setUp()
    await controller.start()
    await controller.start()
    expect(events.filter((entry) => entry.startsWith('overlays 1'))).toHaveLength(1)
    controller.dispose()
    expect(events.at(-1)).toBe('overlays closed')
    expect(controller.active).toBe(false)
  })
})
