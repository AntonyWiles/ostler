import { shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { IPC_CHANNELS } from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'
import { cleanProjectPath, isOpenableFile, isWindowsPath } from '@shared/file-links'
import type { ConfigStore } from '../config-store'
import { isWatchedProject } from '../paths'
import type { EventDatabase } from '../services/event-database'
import { handleIpc, handleApi } from './handle-ipc'
import { openExternalUrl } from '../app/security'
import { currentLocale } from '../app/locale'
import { appLog } from '../app/logging'
import { offScreen } from '../app/off-screen'
import { copyText, offScreenCopiedText } from '../app/clipboard'
import { t } from '@shared/i18n'

export interface SystemHandlerDependencies {
  configStore: ConfigStore
  database: EventDatabase
}

/** Registers the small, service-independent operating-system IPC surface. */
export function registerSystemHandlers({ configStore, database }: SystemHandlerDependencies): void {
  const requireWatchedProject = (path: string): void => {
    const projectPaths = configStore
      .getProjects()
      .map(projectFolder)
      .filter((folder): folder is string => folder !== null)
    if (!isWatchedProject(path, projectPaths)) {
      throw new Error(t('errors:systemHandlers.pathNotInsideOne'))
    }
  }

  // A window opens in the language it was created with; after a reload it
  // checks the current one here (P11.1).
  handleApi('getLocale', () => currentLocale())

  handleApi('openExternalLink', async (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('Send a link to open')
    await openExternalUrl(url)
  })

  // A file link in a text (`ostler://file/<projectId>/<path>`): only ever
  // something inside the project's own folder, after links and shortcuts are
  // followed. Documents and pictures open in their program; folders open in
  // Explorer; any other file is shown in Explorer, never run.
  handleApi('openProjectFile', async (_event, projectId: unknown, path: unknown) => {
    if (typeof projectId !== 'string' || typeof path !== 'string')
      throw new Error('Send a project and a path')
    const project = configStore.getProjects().find((entry) => entry.id === projectId)
    const folder = project ? projectFolder(project) : null
    if (!folder) throw new Error('This project has no linked folder, so its file links cannot open')
    // A full path written in a text counts only inside the project's folder.
    let wanted = path
    if (isWindowsPath(path)) {
      const within = relative(resolve(folder), resolve(path))
      if (!within || within.startsWith('..') || isAbsolute(within))
        throw new Error(`${path} is outside the project folder (${folder}), so it cannot open`)
      wanted = within.split(sep).join('/')
    }
    const clean = cleanProjectPath(wanted)
    if (!clean) throw new Error('That link does not name a file in the project folder')
    const target = resolve(folder, ...clean.split('/'))
    if (!existsSync(target)) throw new Error(`There is no ${clean} in the project folder`)
    const realFolder = realpathSync(folder)
    const realTarget = realpathSync(target)
    const inside = relative(realFolder, realTarget)
    if (inside.startsWith('..') || isAbsolute(inside))
      throw new Error('That link leads outside the project folder')
    if (offScreen) {
      appLog.info(`Off screen: held back opening ${realTarget}`)
      return { opened: 'held' as const }
    }
    if (statSync(realTarget).isDirectory() || isOpenableFile(clean)) {
      const failure = await shell.openPath(realTarget)
      if (failure) throw new Error(failure)
      return { opened: 'opened' as const }
    }
    shell.showItemInFolder(realTarget)
    return { opened: 'shown' as const }
  })

  handleApi('openInExplorer', (_event, path: string) => {
    requireWatchedProject(path)
    shell.showItemInFolder(path)
  })

  handleApi('openCheckout', async (_event, path: string, mode: string) => {
    requireWatchedProject(path)
    if (mode !== 'vscode' && mode !== 'other') throw new Error('Invalid checkout open mode')
    // Off screen no other app opens (`offScreen`): VS Code and the Open with picker are windows.
    if (offScreen) {
      appLog.info(`Off screen: held back opening ${path} (${mode})`)
      return
    }
    if (mode === 'vscode') {
      const vscodeExecutable = [
        process.env.LOCALAPPDATA &&
          join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
        process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
        process.env['ProgramFiles(x86)'] &&
          join(process.env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe')
      ].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))
      if (!vscodeExecutable) throw new Error(t('errors:systemHandlers.visualStudioCodeNot'))

      await new Promise<void>((resolve, reject) => {
        const vscode = spawn(vscodeExecutable, ['--new-window', path], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        })
        vscode.once('error', reject)
        vscode.once('spawn', () => {
          vscode.unref()
          resolve()
        })
      })
      return
    }
    if (process.platform !== 'win32')
      throw new Error(t('errors:systemHandlers.appPickerOnlyAvailable'))

    await new Promise<void>((resolve, reject) => {
      const picker = spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', path], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      picker.once('error', reject)
      picker.once('spawn', () => {
        picker.unref()
        resolve()
      })
    })
  })

  handleApi('copyText', (_event, text: string) => {
    if (typeof text !== 'string' || text.length > 250_000) {
      throw new Error('Clipboard text is invalid or too large')
    }
    copyText(text)
  })

  // Off screen the paste key pastes from Ostler's own clipboard; on screen
  // Chromium pastes from the Windows one, and this answers nothing.
  handleIpc(IPC_CHANNELS.READ_OFF_SCREEN_CLIPBOARD, () => {
    if (!offScreen) throw new Error('Only off screen')
    return offScreenCopiedText()
  })

  handleApi('getDatabaseStats', () => database.getStats())

  handleApi('pruneDatabase', (_event, olderThanDays: number) => database.prune(olderThanDays))
}
