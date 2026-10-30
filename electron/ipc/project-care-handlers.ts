import { app, dialog, shell, type BrowserWindow } from 'electron'
import type { WatchedProject } from '@shared/ostler-api'
import type { ImportService } from '../services/import-service'
import type { ProjectCareService } from '../services/project-care-service'
import type { ProjectRuntimeController } from '../services/project-runtime-controller'
import { CHECKSUM_EXTENSION, verifyChecksumFile, writeChecksumFile } from '../services/checksum'
import { handleApi } from './handle-ipc'
import { t } from '@shared/i18n'

export interface ProjectCareHandlerDependencies {
  projectCareService: ProjectCareService
  importService: ImportService
  runtimeController: ProjectRuntimeController
  getMainWindow(): BrowserWindow | null
  getProject(projectId: string): WatchedProject
  /** Records changed: Board, Home and the Inbox read again. */
  notifyPlanningChanged(projectId: string): void
}

/**
 * Project settings › Backup (looking after one project's data): its own
 * backups, checksum files and the records check. Every project id is checked
 * against the registered projects, and backups are named by file name only.
 */
export function registerProjectCareHandlers(deps: ProjectCareHandlerDependencies): void {
  const { projectCareService: care, getProject } = deps

  const window = () => {
    const main = deps.getMainWindow()
    if (!main) throw new Error('Main window is not available')
    return main
  }

  handleApi('listProjectBackups', (_event, projectId: string) =>
    care.listBackups(getProject(projectId).id)
  )
  handleApi('createProjectBackup', (_event, projectId: string) =>
    care.createBackup(getProject(projectId))
  )
  handleApi('deleteProjectBackup', (_event, projectId: string, backupId: string) =>
    care.deleteBackup(getProject(projectId).id, backupId)
  )
  handleApi('verifyProjectBackup', (_event, projectId: string, backupId: string) =>
    care.verifyBackup(getProject(projectId).id, backupId)
  )
  handleApi('writeProjectBackupChecksum', (_event, projectId: string, backupId: string) =>
    care.writeBackupChecksum(getProject(projectId).id, backupId)
  )
  // Also for a project just removed: its backups stay, under the data folder.
  handleApi('showProjectBackup', (_event, projectId: string, backupId: string) => {
    shell.showItemInFolder(care.backupPath(projectId, backupId))
  })
  // Opened as a new project, as Import does: the project it came from is untouched.
  handleApi('openProjectBackup', async (_event, projectId: string, backupId: string) => {
    const project = getProject(projectId)
    const file = deps.importService.readFile(care.backupPath(project.id, backupId))
    const result = await deps.importService.runImport(
      file.fileId,
      { kind: 'package' },
      { kind: 'new', name: t('errors:projectCare.backupCopyName', { projectName: project.name }) }
    )
    deps.runtimeController.start(getProject(result.projectId))
    deps.notifyPlanningChanged(result.projectId)
    return result
  })

  handleApi('writeChecksumFile', async () => {
    const choice = await dialog.showOpenDialog(window(), {
      title: t('errors:projectCare.chooseFileForChecksum'),
      buttonLabel: t('errors:projectCare.writeChecksumButton'),
      defaultPath: app.getPath('documents'),
      properties: ['openFile']
    })
    const filePath = choice.filePaths[0]
    if (choice.canceled || !filePath) return null
    return { filePath, ...(await writeChecksumFile(filePath)) }
  })
  handleApi('verifyChecksumFile', async () => {
    const choice = await dialog.showOpenDialog(window(), {
      title: t('errors:projectCare.chooseFileToCheck'),
      buttonLabel: t('errors:projectCare.checkButton'),
      defaultPath: app.getPath('documents'),
      properties: ['openFile']
    })
    const chosen = choice.filePaths[0]
    if (choice.canceled || !chosen) return null
    // Picking the checksum file itself checks the file it describes.
    const filePath = chosen.toLowerCase().endsWith(CHECKSUM_EXTENSION)
      ? chosen.slice(0, -CHECKSUM_EXTENSION.length)
      : chosen
    return { filePath, verdict: await verifyChecksumFile(filePath) }
  })

  handleApi('checkProjectRecords', (_event, projectId: string) =>
    care.checkRecords(getProject(projectId).id)
  )
  handleApi('repairProjectRecords', async (_event, projectId: string) => {
    const project = getProject(projectId)
    const result = await care.repairRecords(project.id)
    deps.notifyPlanningChanged(project.id)
    return result
  })
}
