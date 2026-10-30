import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, type WatchedProject } from '@shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/**
 * Whiteboard IPC (plan `docs/plans/whiteboards/`, prompt 04b): create, open and save go through
 * the typed contract, resolve the project first, and only create tells the windows the Library
 * changed. Save does not, so the editor does not reload itself after its own saves.
 */

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  },
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: class {}
}))

const broadcastToWindows = vi.fn()
vi.mock('../../electron/services/send-to-window', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../electron/services/send-to-window')>()),
  broadcastToWindows: (...args: unknown[]) => broadcastToWindows(...args)
}))

const { LibraryService } = await import('../../electron/services/library-service')
const { registerWhiteboardHandlers } = await import('../../electron/ipc/whiteboard-handlers')

const PROJECT = 'b2c09364-5133-4ddf-9131-2b30cd9fa0d9'
const UNKNOWN = '7d1f6a2e-0c4b-4f1e-9a55-2f4f3b8f0a11'

const tempDir = useTempDir('ostler-whiteboard-ipc-')
let library: InstanceType<typeof LibraryService>

beforeEach(async () => {
  handlers.clear()
  broadcastToWindows.mockClear()
  // An unknown project is logged as an IPC failure; keep the run's output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  library = new LibraryService(await createMigratedDatabase(tempDir()), tempDir())
  registerWhiteboardHandlers({
    libraryService: library,
    getProject: (projectId) => {
      if (projectId !== PROJECT) throw new Error('Project not found')
      return { id: PROJECT, name: 'Website' } as WatchedProject
    }
  })
})

afterEach(() => {
  library.close()
})

async function invoke(channel: string, ...args: unknown[]) {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return handler({ sender: undefined }, ...args)
}

const note = (id: string, text: string) => ({
  id,
  kind: 'note',
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  z: 0,
  text
})

/** A whiteboard made through the create channel, with one note. */
async function createBoard() {
  const result = (await invoke(IPC_CHANNELS.WHITEBOARD_CREATE, PROJECT, {
    title: 'Plan',
    objects: [note('n1', 'First idea')]
  })) as { ok: true; value: { item: { id: string; kind: string } } }
  expect(result.ok).toBe(true)
  return result.value.item
}

describe('whiteboard IPC', () => {
  it('creates a whiteboard and tells the windows once that the Library changed', async () => {
    const item = await createBoard()
    expect(item.kind).toBe('whiteboard')
    expect(library.getItem(PROJECT, item.id).title).toBe('Plan')
    expect(broadcastToWindows).toHaveBeenCalledTimes(1)
    expect(broadcastToWindows).toHaveBeenCalledWith(IPC_CHANNELS.ON_PROJECT_STATE_CHANGE, {
      projectId: PROJECT,
      field: 'library',
      data: null
    })
  })

  it('opens a whiteboard with its objects', async () => {
    const item = await createBoard()
    const result = await invoke(IPC_CHANNELS.WHITEBOARD_GET, PROJECT, item.id)
    expect(result).toEqual({
      ok: true,
      value: {
        item: expect.objectContaining({ id: item.id, kind: 'whiteboard' }),
        objects: [expect.objectContaining({ id: 'n1', kind: 'note', text: 'First idea' })]
      }
    })
  })

  it('stores a save and does not broadcast', async () => {
    const item = await createBoard()
    broadcastToWindows.mockClear()
    const result = (await invoke(IPC_CHANNELS.WHITEBOARD_SAVE, PROJECT, item.id, {
      upserts: [note('n2', 'Second idea')],
      deletes: ['n1']
    })) as { ok: boolean; value: { item: { id: string }; savedAt: string } }
    expect(result.ok).toBe(true)
    expect(result.value.item.id).toBe(item.id)
    expect(typeof result.value.savedAt).toBe('string')
    expect(library.whiteboards.listObjects(PROJECT, item.id).map((object) => object.id)).toEqual([
      'n2'
    ])
    expect(broadcastToWindows).not.toHaveBeenCalled()
  })

  it('refuses a project it cannot resolve, on every channel', async () => {
    const item = await createBoard()
    broadcastToWindows.mockClear()
    const refused = { ok: false, error: 'Project not found' }
    expect(await invoke(IPC_CHANNELS.WHITEBOARD_CREATE, UNKNOWN, { title: 'Other' })).toEqual(
      refused
    )
    expect(await invoke(IPC_CHANNELS.WHITEBOARD_GET, UNKNOWN, item.id)).toEqual(refused)
    expect(
      await invoke(IPC_CHANNELS.WHITEBOARD_SAVE, UNKNOWN, item.id, { upserts: [], deletes: [] })
    ).toEqual(refused)
    expect(broadcastToWindows).not.toHaveBeenCalled()
  })

  it("passes on the service's translated refusal for an archived whiteboard", async () => {
    const item = await createBoard()
    library.archiveItem(PROJECT, item.id)
    const result = await invoke(IPC_CHANNELS.WHITEBOARD_SAVE, PROJECT, item.id, {
      upserts: [note('n3', 'Too late')],
      deletes: []
    })
    expect(result).toEqual({
      ok: false,
      error: 'This whiteboard is archived. Restore it to change it.'
    })
    expect(library.whiteboards.listObjects(PROJECT, item.id).map((object) => object.id)).toEqual([
      'n1'
    ])
  })
})
