import { dialog, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { openExternalUrl } from '../app/security'
import { readClipboard } from '../app/clipboard'
import { importFromClipboard, type ClipboardImportOptions } from '../services/library-clipboard'
import { projectIpcHandlers, handleApi } from './handle-ipc'
import { broadcastToWindows } from '../services/send-to-window'
import { IPC_CHANNELS } from '@shared/ostler-api'
import type {
  CreateLibraryItemInput,
  ImportLibraryFileInput,
  LibraryAttachedBy,
  LibraryQuery,
  LibraryTextProgress,
  UpdateLibraryItemInput,
  WatchedProject
} from '@shared/ostler-api'
import { cleanUrl, type LibraryService } from '../services/library-service'
import { t } from '@shared/i18n'

/** The picture files `pickLibraryFiles` offers with `only: 'image'` (a whiteboard's Picture tool). */
const PICTURE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp']

export interface LibraryHandlerDependencies {
  libraryService: LibraryService
  getMainWindow(): BrowserWindow | null
  getProject(projectId: string): WatchedProject
  /** The background pass reading files for search (N4.5). */
  getTextProgress(): LibraryTextProgress | null
}

/**
 * Project Library IPC. Every channel resolves the project first (the access
 * check), and every mutation pushes `ON_PROJECT_STATE_CHANGE` with field
 * 'library'. No library content reaches the harness from here.
 */
export function registerLibraryHandlers({
  libraryService,
  getMainWindow,
  getProject,
  getTextProgress
}: LibraryHandlerDependencies): void {
  const notifyLibrary = (project: WatchedProject): void => {
    broadcastToWindows(IPC_CHANNELS.ON_PROJECT_STATE_CHANGE, {
      projectId: project.id,
      field: 'library',
      data: null
    })
  }
  const { projectApi, mutatingApi } = projectIpcHandlers(getProject, notifyLibrary)

  handleApi('getLibraryTextProgress', () => getTextProgress())
  projectApi('listLibraryItems', (project, query?: LibraryQuery) =>
    libraryService.listItems(project.id, query ?? {})
  )
  projectApi('getLibraryItem', (project, itemId: string) =>
    libraryService.getItem(project.id, itemId)
  )
  projectApi('getLibraryItemText', (project, itemId: string) =>
    libraryService.getItemText(project.id, itemId)
  )
  mutatingApi('createLibraryItem', (project, input: CreateLibraryItemInput) =>
    libraryService.createItem(project.id, input)
  )
  mutatingApi('updateLibraryItem', (project, itemId: string, updates: UpdateLibraryItemInput) =>
    libraryService.updateItem(project.id, itemId, updates ?? {})
  )
  mutatingApi('setPrimaryBrief', (project, itemId: string | null) =>
    libraryService.setPrimaryBrief(project.id, itemId)
  )
  mutatingApi('archiveLibraryItem', (project, itemId: string) =>
    libraryService.archiveItem(project.id, itemId)
  )
  mutatingApi('unarchiveLibraryItem', (project, itemId: string) =>
    libraryService.unarchiveItem(project.id, itemId)
  )
  mutatingApi('deleteLibraryItem', (project, itemId: string) => {
    libraryService.deleteItem(project.id, itemId)
    return undefined
  })
  projectApi('listLibraryRevisions', (project, itemId: string) =>
    libraryService.listRevisions(project.id, itemId)
  )
  mutatingApi('restoreLibraryRevision', (project, itemId: string, revision: number) =>
    libraryService.restoreRevision(project.id, itemId, revision)
  )
  mutatingApi('importLibraryFiles', (project, files: ImportLibraryFileInput[]) =>
    libraryService.importFiles(project.id, files)
  )
  mutatingApi('pickLibraryFiles', async (project, pick?: { only?: 'image' }) => {
    // The picker runs here so no path ever crosses IPC.
    const window = getMainWindow()
    const pictures = pick?.only === 'image'
    const options: OpenDialogOptions = {
      title: pictures
        ? t('errors:libraryHandlers.insertPictures')
        : t('errors:libraryHandlers.importIntoLibrary'),
      properties: ['openFile', 'multiSelections'],
      ...(pictures
        ? {
            filters: [
              { name: t('errors:libraryHandlers.pictureFiles'), extensions: PICTURE_EXTENSIONS }
            ]
          }
        : {})
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return []
    return libraryService.importPaths(project.id, result.filePaths)
  })
  // The clipboard is read here, when the person asks, and never sent whole to the page.
  mutatingApi('importLibraryFromClipboard', (project, options?: ClipboardImportOptions) =>
    importFromClipboard(libraryService, project.id, readClipboard(), {
      only: options?.only === 'image' ? 'image' : undefined
    })
  )
  projectApi('openLibraryItemExternally', async (project, itemId: string) => {
    const item = libraryService.getItem(project.id, itemId)
    if (item.kind === 'link') {
      // cleanUrl re-checks the stored value: http and https only.
      await openExternalUrl(cleanUrl(item.url))
      return undefined
    }
    if (!item.file) throw new Error(t('errors:libraryHandlers.libraryItemHasNothing'))
    const error = await shell.openPath(libraryService.originalFilePath(project.id, itemId))
    if (error) throw new Error(error)
    return undefined
  })

  const storedFilePath = (projectId: string, itemId: string): string => {
    const item = libraryService.getItem(projectId, itemId)
    if (!item.file) throw new Error(t('errors:libraryHandlers.libraryItemHasNothing'))
    return libraryService.originalFilePath(projectId, itemId)
  }
  projectApi('showLibraryItemInFolder', (project, itemId: string) => {
    shell.showItemInFolder(storedFilePath(project.id, itemId))
    return undefined
  })
  projectApi('getLibraryItemFilePath', (project, itemId: string) =>
    storedFilePath(project.id, itemId)
  )

  mutatingApi('addWorkItemSource', (project, workItemId: string, itemId: string) =>
    libraryService.addWorkItemSource(project.id, workItemId, itemId)
  )
  mutatingApi('removeWorkItemSource', (project, workItemId: string, itemId: string) =>
    libraryService.removeWorkItemSource(project.id, workItemId, itemId)
  )
  projectApi('listWorkItemSources', (project, workItemId: string) =>
    libraryService.listWorkItemSources(project.id, workItemId)
  )
  projectApi('listWorkItemsWithChangedSources', (project) =>
    libraryService.listWorkItemsWithChangedSources(project.id)
  )
  projectApi('countWorkItemAttachments', (project) =>
    libraryService.countWorkItemAttachments(project.id)
  )
  projectApi('listItemWorkItems', (project, itemId: string) =>
    libraryService.listItemWorkItems(project.id, itemId)
  )
  mutatingApi(
    'attachToWorkItem',
    (project, workItemId: string, itemId: string, attachedBy: LibraryAttachedBy) =>
      libraryService.attachToWorkItem(project.id, workItemId, itemId, attachedBy)
  )
  mutatingApi('detachFromWorkItem', (project, workItemId: string, itemId: string) =>
    libraryService.detachFromWorkItem(project.id, workItemId, itemId)
  )
  projectApi('listWorkItemAttachments', (project, workItemId: string) =>
    libraryService.listWorkItemAttachments(project.id, workItemId)
  )
  projectApi('listItemAttachments', (project, itemId: string) =>
    libraryService.listItemAttachments(project.id, itemId)
  )
  // Mark up a copy (N4.2b): the editor opens the stored bytes and saves a new item.
  projectApi('getLibraryImage', (project, itemId: string) =>
    libraryService.readImage(project.id, itemId)
  )
  mutatingApi('saveMarkedUpCopy', (project, itemId: string, workItemId: unknown, png: unknown) => {
    if (workItemId !== null && typeof workItemId !== 'string') throw new Error('Name the task')
    if (!(png instanceof Uint8Array)) throw new Error('Invalid file data')
    return libraryService.saveMarkedUpCopy(project.id, itemId, workItemId, png)
  })
  projectApi('getLibraryAiContextSummary', (project, selectedItemIds?: string[], use?: unknown) =>
    libraryService.buildLibraryAiContextSummary(
      project.id,
      selectedItemIds ?? [],
      use === 'planning' ? 'planning' : 'chat'
    )
  )
}
