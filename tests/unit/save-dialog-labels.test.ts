import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, type WatchedProject } from '@shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/**
 * The save dialog's button says what the action is called: Edit in Excel and
 * Save as PDF save a file, so their button says Save; an export says Export.
 */

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
const saveDialogs: Array<{ title?: string; buttonLabel?: string }> = []

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  },
  dialog: {
    showSaveDialog: async (_window: unknown, options: { title?: string; buttonLabel?: string }) => {
      saveDialogs.push(options)
      return { canceled: true, filePath: '' }
    }
  },
  app: { getPath: () => os.tmpdir() },
  shell: { openPath: async () => '' },
  BrowserWindow: class {},
  Notification: class {}
}))
vi.mock('../../electron/app/print-window', () => ({
  pdfOf: vi.fn(),
  printContents: vi.fn(),
  renderPrintWindow: vi.fn()
}))

const { PlanningService } = await import('../../electron/services/planning-service')
const { registerImportHandlers } = await import('../../electron/ipc/import-handlers')

const PROJECT = 'project-one'
const tempDir = useTempDir('ostler-save-dialog-')
let planning: InstanceType<typeof PlanningService>

beforeEach(async () => {
  handlers.clear()
  saveDialogs.length = 0
  planning = new PlanningService(await createMigratedDatabase(tempDir()), () => [PROJECT])
  registerImportHandlers({
    importService: {} as never,
    projectPackageService: {} as never,
    planningService: planning,
    getReportService: () => ({}) as never,
    runtimeController: {} as never,
    getMainWindow: () => ({}) as never,
    getProject: () => ({ id: PROJECT, name: 'Website' }) as WatchedProject,
    notifyPlanningChanged: () => {}
  })
})

afterEach(() => {
  planning.close()
})

async function invoke(channel: string, ...args: unknown[]) {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return handler({ sender: undefined }, ...args)
}

describe('The save dialog’s button', () => {
  it('says Save for Edit in Excel', async () => {
    expect(await invoke(IPC_CHANNELS.EDIT_IN_EXCEL, PROJECT, {})).toEqual({ ok: true, value: null })
    expect(saveDialogs).toEqual([
      expect.objectContaining({ title: 'Edit in Excel', buttonLabel: 'Save' })
    ])
  })

  it('says Export for an export', async () => {
    expect(await invoke(IPC_CHANNELS.EXPORT_TASKS_CSV, PROJECT, {})).toEqual({
      ok: true,
      value: null
    })
    expect(saveDialogs).toEqual([
      expect.objectContaining({ title: 'Export tasks to CSV', buttonLabel: 'Export' })
    ])
  })
})
