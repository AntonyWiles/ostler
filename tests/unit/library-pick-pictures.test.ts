import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, type WatchedProject } from '@shared/ostler-api'

/**
 * `pickLibraryFiles(projectId, { only: 'image' })` (a whiteboard's Picture
 * tool): main's file picker offers pictures alone and says "Insert pictures".
 * Without the option the picker is the Library's own, unchanged.
 */

interface OpenOptions {
  title?: string
  properties?: string[]
  filters?: Array<{ name: string; extensions: string[] }>
}

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
const openDialogs: OpenOptions[] = []

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  },
  dialog: {
    showOpenDialog: async (_window: unknown, options: OpenOptions) => {
      openDialogs.push(options)
      return { canceled: false, filePaths: ['C:\\pictures\\site.png'] }
    }
  },
  shell: { openPath: async () => '' },
  clipboard: {},
  nativeImage: {},
  BrowserWindow: class {},
  webContents: { getAllWebContents: () => [] }
}))

const { registerLibraryHandlers } = await import('../../electron/ipc/library-handlers')

const PROJECT = 'project-one'
const importPaths = vi.fn((_projectId: string, paths: string[]) =>
  paths.map((path) => ({ item: { id: 'item-1', title: path } }))
)

beforeEach(() => {
  handlers.clear()
  openDialogs.length = 0
  importPaths.mockClear()
  registerLibraryHandlers({
    libraryService: { importPaths } as never,
    getMainWindow: () => ({}) as never,
    getProject: () => ({ id: PROJECT, name: 'Website' }) as WatchedProject,
    getTextProgress: () => null
  })
})

async function invoke(channel: string, ...args: unknown[]) {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return handler({ sender: undefined }, ...args)
}

describe('Picking files for the Library', () => {
  it('offers pictures alone, titled Insert pictures, with only: image', async () => {
    const result = await invoke(IPC_CHANNELS.LIBRARY_PICK_FILES, PROJECT, { only: 'image' })
    expect(result).toEqual({
      ok: true,
      value: [{ item: expect.objectContaining({ id: 'item-1' }) }]
    })
    expect(openDialogs).toHaveLength(1)
    expect(openDialogs[0].title).toBe('Insert pictures')
    expect(openDialogs[0].properties).toEqual(['openFile', 'multiSelections'])
    expect(openDialogs[0].filters).toEqual([
      { name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }
    ])
    expect(importPaths).toHaveBeenCalledWith(PROJECT, ['C:\\pictures\\site.png'])
  })

  it('keeps the Library’s own picker without the option', async () => {
    await invoke(IPC_CHANNELS.LIBRARY_PICK_FILES, PROJECT)
    expect(openDialogs).toHaveLength(1)
    expect(openDialogs[0].title).toBe('Import into library')
    expect(openDialogs[0].filters).toBeUndefined()
    expect(openDialogs[0]).toEqual({
      title: 'Import into library',
      properties: ['openFile', 'multiSelections']
    })
  })
})
