import { app, dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {
  ExportWhiteboardFileResult,
  SaveWhiteboardImageInput,
  WatchedProject,
  WhiteboardPrintRequest
} from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { whiteboardHashPath } from '@shared/print-route'
import { Refusal } from '@shared/refusal'
import {
  WHITEBOARD_FILE_EXTENSION,
  WHITEBOARD_FILE_MAX_BYTES
} from '@shared/whiteboard/file-format'
import type { LibraryService } from '../services/library-service'
import { importWhiteboardText, whiteboardFileText } from '../services/whiteboard-file'
import { safeFileName } from '../app/file-names'
import { pdfOf, printContents, renderPrintWindow } from '../app/print-window'
import { projectIpcHandlers, handleApi } from './handle-ipc'

/** The most a PNG or SVG of a board may be. */
export const WHITEBOARD_IMAGE_MAX_BYTES = 200 * 1024 * 1024

export interface WhiteboardFileHandlerDependencies {
  libraryService: LibraryService
  getProject(projectId: string): WatchedProject
  getMainWindow(): BrowserWindow | null
  notifyLibraryChanged(project: WatchedProject): void
}

const IMAGE_KINDS = {
  png: { extension: 'png', filter: () => t('errors:whiteboard.file.pngFilter') },
  svg: { extension: 'svg', filter: () => t('errors:whiteboard.file.svgFilter') }
} as const

/**
 * Export and import of whiteboards (plan `docs/plans/whiteboards/`, prompt 16,
 * D15). Main shows every dialog and reads and writes every file; the renderer
 * sends only ids and the bytes of a picture it drew. Nothing crosses as a path.
 */
export function registerWhiteboardFileHandlers({
  libraryService,
  getProject,
  getMainWindow,
  notifyLibraryChanged
}: WhiteboardFileHandlerDependencies): void {
  const { projectApi, mutatingApi } = projectIpcHandlers(getProject, notifyLibraryChanged)

  const window = () => {
    const main = getMainWindow()
    if (!main) throw new Error('Main window is not available')
    return main
  }

  /** The save dialog every whiteboard export uses, as `saveTo` in import-handlers. */
  const saveTo = async (defaultName: string, filter: Electron.FileFilter) => {
    const choice = await dialog.showSaveDialog(window(), {
      title: t('errors:whiteboard.file.exportTitle'),
      buttonLabel: t('errors:whiteboard.file.exportButton'),
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [filter],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (choice.canceled || !choice.filePath) return null
    const ending = `.${filter.extensions[0]}`
    return choice.filePath.toLowerCase().endsWith(ending.toLowerCase())
      ? choice.filePath
      : `${choice.filePath}${ending}`
  }

  /** The board, checked to be one in this project. */
  const board = (projectId: string, whiteboardId: unknown) => {
    if (typeof whiteboardId !== 'string') throw new Error('A whiteboard id is needed')
    return libraryService.whiteboards.get(projectId, whiteboardId).item
  }

  projectApi(
    'saveWhiteboardImage',
    async (project, input: SaveWhiteboardImageInput): Promise<string | null> => {
      const kind = input?.kind
      if (kind !== 'png' && kind !== 'svg') throw new Error('A whiteboard picture is a PNG or SVG')
      const bytes = input.bytes
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
        throw new Error('A whiteboard picture needs its bytes')
      }
      if (bytes.byteLength > WHITEBOARD_IMAGE_MAX_BYTES) {
        throw new Refusal(t('errors:whiteboard.file.imageTooLarge'))
      }
      const item = board(project.id, input.whiteboardId)
      const { extension, filter } = IMAGE_KINDS[kind]
      const chosen = await saveTo(`${safeFileName(item.title, 'Whiteboard')}.${extension}`, {
        name: filter(),
        extensions: [extension]
      })
      if (!chosen) return null
      fs.writeFileSync(chosen, bytes)
      return chosen
    }
  )

  projectApi(
    'exportWhiteboardFile',
    async (project, whiteboardId: string): Promise<ExportWhiteboardFileResult> => {
      board(project.id, whiteboardId)
      const { title, text, missingPictures } = whiteboardFileText(
        libraryService,
        project.id,
        whiteboardId
      )
      const chosen = await saveTo(
        `${safeFileName(title, 'Whiteboard')}.${WHITEBOARD_FILE_EXTENSION}`,
        { name: t('errors:whiteboard.file.fileFilter'), extensions: [WHITEBOARD_FILE_EXTENSION] }
      )
      if (!chosen) return { path: null, missingPictures }
      fs.writeFileSync(chosen, text, 'utf8')
      return { path: chosen, missingPictures }
    }
  )

  /**
   * Print… and Save as PDF… (prompt 17, D15), as Compare rounds does them: the board is drawn on
   * its print route in main's print window. A PDF goes where the person chooses; its path, or null
   * when printed or cancelled.
   */
  handleApi('printWhiteboard', async (_event, request: WhiteboardPrintRequest) => {
    if (!request || (request.output !== 'pdf' && request.output !== 'printer'))
      throw new Error('Choose a printer or a PDF')
    const project = getProject(request.projectId)
    const item = board(project.id, request.whiteboardId)
    const hash = whiteboardHashPath({ projectId: project.id, whiteboardId: item.id })
    if (request.output === 'printer') {
      await renderPrintWindow(hash, printContents)
      return null
    }
    const choice = await dialog.showSaveDialog(window(), {
      title: t('errors:importHandlers.savePdf'),
      buttonLabel: t('errors:importHandlers.saveButton'),
      defaultPath: path.join(
        app.getPath('documents'),
        `${safeFileName(item.title, 'Whiteboard')}.pdf`
      ),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (choice.canceled || !choice.filePath) return null
    const pdf = await renderPrintWindow(hash, (contents) => pdfOf(contents, app.getLocale()))
    fs.writeFileSync(choice.filePath, pdf)
    return choice.filePath
  })

  mutatingApi('importWhiteboardFile', async (project) => {
    const choice = await dialog.showOpenDialog(window(), {
      title: t('errors:whiteboard.file.importTitle'),
      buttonLabel: t('errors:whiteboard.file.importButton'),
      properties: ['openFile'],
      filters: [{ name: t('errors:whiteboard.file.fileFilter'), extensions: ['json'] }]
    })
    const chosen = choice.filePaths[0]
    if (choice.canceled || !chosen) return null
    const stat = fs.statSync(chosen)
    if (!stat.isFile()) throw new Refusal(t('errors:whiteboard.file.not-whiteboard'))
    if (stat.size > WHITEBOARD_FILE_MAX_BYTES) {
      throw new Refusal(t('errors:whiteboard.file.too-large'))
    }
    const text = fs.readFileSync(chosen, 'utf8')
    return importWhiteboardText(libraryService, project.id, text, path.basename(chosen))
  })
}
