import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, type WatchedProject } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { WHITEBOARD_FILE_MAX_BYTES } from '@shared/whiteboard/file-format'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/**
 * Whiteboard export and import IPC (plan `docs/plans/whiteboards/`, prompt 16): main shows the
 * dialogs and checks what the renderer sends. A cancelled save writes nothing; a picture of the
 * wrong kind or too many bytes is refused; a file too large is refused before it is read.
 */

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
const showSaveDialog = vi.fn()
const showOpenDialog = vi.fn()
const renderPrintWindow = vi.fn()
const printContents = vi.fn(async () => false)
const pdfOf = vi.fn(async () => Buffer.from('%PDF-1.7'))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  },
  app: { getPath: () => os.tmpdir(), getLocale: () => 'en-GB' },
  dialog: {
    showSaveDialog: (...args: unknown[]) => showSaveDialog(...args),
    showOpenDialog: (...args: unknown[]) => showOpenDialog(...args)
  },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
  BrowserWindow: class {}
}))

vi.mock('../../electron/app/print-window', () => ({
  renderPrintWindow: (...args: unknown[]) => renderPrintWindow(...args),
  printContents: (...args: unknown[]) => printContents(...(args as [])),
  pdfOf: (...args: unknown[]) => pdfOf(...(args as []))
}))

const { LibraryService } = await import('../../electron/services/library-service')
const { registerWhiteboardFileHandlers, WHITEBOARD_IMAGE_MAX_BYTES } =
  await import('../../electron/ipc/whiteboard-file-handlers')

const PROJECT = 'b2c09364-5133-4ddf-9131-2b30cd9fa0d9'

const tempDir = useTempDir('ostler-whiteboard-file-ipc-')
let library: InstanceType<typeof LibraryService>
const notifyLibraryChanged = vi.fn()

beforeEach(async () => {
  handlers.clear()
  showSaveDialog.mockReset()
  showOpenDialog.mockReset()
  renderPrintWindow.mockReset()
  renderPrintWindow.mockImplementation(
    async (_hash: string, use: (contents: unknown) => Promise<unknown>) => use({})
  )
  printContents.mockClear()
  pdfOf.mockClear()
  notifyLibraryChanged.mockClear()
  // Refusals are logged; keep the run's output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  library = new LibraryService(await createMigratedDatabase(tempDir()), tempDir())
  registerWhiteboardFileHandlers({
    libraryService: library,
    getProject: (projectId) => {
      if (projectId !== PROJECT) throw new Error('Project not found')
      return { id: PROJECT, name: 'Website' } as WatchedProject
    },
    getMainWindow: () => ({}) as never,
    notifyLibraryChanged
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  library.close()
})

async function invoke(channel: string, ...args: unknown[]) {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return (await handler({ sender: undefined }, ...args)) as
    { ok: true; value: unknown } | { ok: false; error: string }
}

const board = () =>
  library.whiteboards.create(PROJECT, {
    title: 'Launch: plan',
    objects: [
      { id: 'n1', kind: 'note', x: 0, y: 0, width: 200, height: 200, z: 0, text: 'Hi' }
    ] as never
  }).item

const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')

describe('SAVE_WHITEBOARD_IMAGE', () => {
  it('writes the bytes where the person chose, named after the board', async () => {
    const item = board()
    const target = path.join(tempDir(), 'out')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
    const result = await invoke(IPC_CHANNELS.SAVE_WHITEBOARD_IMAGE, PROJECT, {
      whiteboardId: item.id,
      kind: 'svg',
      bytes: SVG
    })
    expect(result).toEqual({ ok: true, value: `${target}.svg` })
    expect(fs.readFileSync(`${target}.svg`, 'utf8')).toContain('<svg')
    const options = showSaveDialog.mock.calls[0][1]
    expect(path.basename(options.defaultPath)).toBe('Launch  plan.svg')
    expect(options.filters).toEqual([
      { name: t('errors:whiteboard.file.svgFilter'), extensions: ['svg'] }
    ])
  })

  it('writes nothing when the save is cancelled', async () => {
    const item = board()
    const write = vi.spyOn(fs, 'writeFileSync')
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    const result = await invoke(IPC_CHANNELS.SAVE_WHITEBOARD_IMAGE, PROJECT, {
      whiteboardId: item.id,
      kind: 'png',
      bytes: SVG
    })
    expect(result).toEqual({ ok: true, value: null })
    expect(write).not.toHaveBeenCalled()
  })

  it('refuses a kind that is not png or svg', async () => {
    const item = board()
    const result = await invoke(IPC_CHANNELS.SAVE_WHITEBOARD_IMAGE, PROJECT, {
      whiteboardId: item.id,
      kind: 'exe',
      bytes: SVG
    })
    expect(result.ok).toBe(false)
    expect(showSaveDialog).not.toHaveBeenCalled()
  })

  it('refuses bytes over 200 MB', async () => {
    const item = board()
    const bytes = new Uint8Array(1)
    Object.defineProperty(bytes, 'byteLength', { value: WHITEBOARD_IMAGE_MAX_BYTES + 1 })
    const result = await invoke(IPC_CHANNELS.SAVE_WHITEBOARD_IMAGE, PROJECT, {
      whiteboardId: item.id,
      kind: 'png',
      bytes
    })
    expect(result).toEqual({ ok: false, error: t('errors:whiteboard.file.imageTooLarge') })
    expect(showSaveDialog).not.toHaveBeenCalled()
  })

  it('refuses a board that is not in the project', async () => {
    const result = await invoke(IPC_CHANNELS.SAVE_WHITEBOARD_IMAGE, PROJECT, {
      whiteboardId: 'not-a-board',
      kind: 'png',
      bytes: SVG
    })
    expect(result.ok).toBe(false)
    expect(showSaveDialog).not.toHaveBeenCalled()
  })
})

describe('EXPORT_WHITEBOARD_FILE and IMPORT_WHITEBOARD_FILE', () => {
  it('exports a whiteboard file and imports it as a new board', async () => {
    const item = board()
    const target = path.join(tempDir(), 'Launch plan.whiteboard.json')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
    const exported = await invoke(IPC_CHANNELS.EXPORT_WHITEBOARD_FILE, PROJECT, item.id)
    expect(exported).toEqual({ ok: true, value: { path: target, missingPictures: 0 } })

    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [target] })
    const imported = await invoke(IPC_CHANNELS.IMPORT_WHITEBOARD_FILE, PROJECT)
    if (!imported.ok) throw new Error(imported.error)
    const made = imported.value as { id: string; title: string }
    expect(made.id).not.toBe(item.id)
    expect(made.title).toBe('Launch: plan')
    expect(library.whiteboards.get(PROJECT, made.id).objects).toHaveLength(1)
    expect(notifyLibraryChanged).toHaveBeenCalled()
  })

  it('answers null when the open dialog is cancelled', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await invoke(IPC_CHANNELS.IMPORT_WHITEBOARD_FILE, PROJECT)).toEqual({
      ok: true,
      value: null
    })
  })

  it('refuses a file over the size limit before reading it', async () => {
    const target = path.join(tempDir(), 'Huge.whiteboard.json')
    fs.writeFileSync(target, '{}')
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [target] })
    const realStat = fs.statSync
    vi.spyOn(fs, 'statSync').mockImplementation(((file: fs.PathLike) => {
      const stat = realStat(file)
      return file === target ? Object.assign(stat, { size: WHITEBOARD_FILE_MAX_BYTES + 1 }) : stat
    }) as typeof fs.statSync)
    const read = vi.spyOn(fs, 'readFileSync')
    const result = await invoke(IPC_CHANNELS.IMPORT_WHITEBOARD_FILE, PROJECT)
    expect(result).toEqual({ ok: false, error: t('errors:whiteboard.file.too-large') })
    expect(read).not.toHaveBeenCalledWith(target, expect.anything())
  })
})

describe('PRINT_WHITEBOARD', () => {
  it('saves a PDF of the board where the person chose, named after the board', async () => {
    const item = board()
    const target = path.join(tempDir(), 'board.pdf')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
    const result = await invoke(IPC_CHANNELS.PRINT_WHITEBOARD, {
      projectId: PROJECT,
      whiteboardId: item.id,
      output: 'pdf'
    })
    expect(result).toEqual({ ok: true, value: target })
    expect(fs.readFileSync(target, 'utf8')).toBe('%PDF-1.7')
    expect(renderPrintWindow.mock.calls[0][0]).toBe(`/print/whiteboard/${PROJECT}/${item.id}`)
    const options = showSaveDialog.mock.calls[0][1]
    expect(path.basename(options.defaultPath)).toBe('Launch  plan.pdf')
    expect(options.title).toBe(t('errors:importHandlers.savePdf'))
  })

  it('prints without a save dialog', async () => {
    const item = board()
    const result = await invoke(IPC_CHANNELS.PRINT_WHITEBOARD, {
      projectId: PROJECT,
      whiteboardId: item.id,
      output: 'printer'
    })
    expect(result).toEqual({ ok: true, value: null })
    expect(printContents).toHaveBeenCalled()
    expect(showSaveDialog).not.toHaveBeenCalled()
  })

  it('draws nothing when the save is cancelled', async () => {
    const item = board()
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    const result = await invoke(IPC_CHANNELS.PRINT_WHITEBOARD, {
      projectId: PROJECT,
      whiteboardId: item.id,
      output: 'pdf'
    })
    expect(result).toEqual({ ok: true, value: null })
    expect(renderPrintWindow).not.toHaveBeenCalled()
  })

  it('refuses another output, another project and an item that is not a whiteboard', async () => {
    const item = board()
    const bad = await invoke(IPC_CHANNELS.PRINT_WHITEBOARD, {
      projectId: PROJECT,
      whiteboardId: item.id,
      output: 'fax'
    })
    expect(bad.ok).toBe(false)
    const elsewhere = await invoke(IPC_CHANNELS.PRINT_WHITEBOARD, {
      projectId: 'another',
      whiteboardId: item.id,
      output: 'pdf'
    })
    expect(elsewhere.ok).toBe(false)
    const missing = await invoke(IPC_CHANNELS.PRINT_WHITEBOARD, {
      projectId: PROJECT,
      whiteboardId: '99999999-9999-4999-8999-999999999999',
      output: 'pdf'
    })
    expect(missing).toEqual({ ok: false, error: t('errors:whiteboard.notAWhiteboard') })
    expect(renderPrintWindow).not.toHaveBeenCalled()
  })
})
