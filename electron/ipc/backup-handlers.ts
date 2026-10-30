import { dialog, shell, type BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { ConfigStore } from '../config-store'
import type { BackupService } from '../services/backup-service'
import { secondPlaceProblem } from '../services/backup-second-place'
import { handleApi } from './handle-ipc'
import { t } from '@shared/i18n'

export interface BackupHandlerDependencies {
  backupService: BackupService
  configStore: ConfigStore
  dataDir: string
  getMainWindow(): BrowserWindow | null
  /** The Inbox changed (a copy failure cleared when copying stops). */
  notifyHomeChanged(): void
}

/**
 * Backups of the data folder. Ids arrive from the renderer and are checked by
 * BackupService (a plain folder name directly under `backups/`), so no path
 * from the renderer ever reaches the filesystem. The second place (N6.1) is
 * chosen in main's own folder picker, never sent by the renderer.
 */
export function registerBackupHandlers({
  backupService,
  configStore,
  dataDir,
  getMainWindow,
  notifyHomeChanged
}: BackupHandlerDependencies): void {
  handleApi('listBackups', () => backupService.list())

  handleApi('createBackup', () => backupService.createBackup('manual'))

  handleApi('restoreBackup', (_event, backupId: string) => {
    backupService.scheduleRestore(backupId)
  })

  handleApi('deleteBackup', (_event, backupId: string) => {
    backupService.deleteBackup(backupId)
  })

  handleApi('openBackupsFolder', async () => {
    fs.mkdirSync(backupService.directory, { recursive: true })
    const error = await shell.openPath(backupService.directory)
    if (error) throw new Error(error)
  })

  handleApi('getBackupCopyStatus', () => backupService.copyStatus())

  handleApi('chooseBackupCopyFolder', async () => {
    const options: Electron.OpenDialogOptions = {
      title: t('errors:backupSecondPlace.chooseFolder'),
      properties: ['openDirectory', 'createDirectory']
    }
    const window = getMainWindow()
    const choice = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const chosen = choice.filePaths[0]
    if (choice.canceled || !chosen) return null
    const folder = path.resolve(chosen)
    const problem = secondPlaceProblem(folder, dataDir)
    if (problem) throw new Error(problem)
    configStore.update({ backups: { copyTo: folder, lastCopiedAt: null, copyFailedAt: null } })
    notifyHomeChanged()
    return backupService.copyStatus()
  })

  handleApi('stopBackupCopy', () => {
    configStore.update({ backups: { copyTo: null, lastCopiedAt: null, copyFailedAt: null } })
    notifyHomeChanged()
    return backupService.copyStatus()
  })

  handleApi('listSecondPlaceBackups', () => backupService.listSecondPlace())

  handleApi('restoreFromSecondPlace', (_event, backupId: string) =>
    backupService.restoreFromSecondPlace(backupId)
  )
}
