import { app, BrowserWindow, dialog, screen } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { performance } from 'node:perf_hooks'
import { BRAND } from '@shared/brand'
import { PERF_MARKS } from '@shared/perf-marks'
import { deepLinkFor } from '@shared/deep-link'
import { resolveDataDir } from './app/data-dir'
import { moveLegacyDataFolder, renameLegacyFiles } from './app/rename-migration'
import {
  createPopOutWindow,
  createNewTaskWindow,
  createTaskWindow,
  createStickyTaskWindow,
  createWindow,
  focusWindow,
  recoverFromRendererCrash,
  revealStickyWindow
} from './app/window'
import { StickyTaskWindows } from './app/sticky-task-windows'
import { NewTaskWindows } from './app/new-task-windows'
import { TaskWindows } from './app/task-windows'
import {
  registerNewTaskWindowHandlers,
  registerTaskWindowHandlers
} from './ipc/new-task-window-handlers'
import { registerStickyTaskHandlers } from './ipc/sticky-task-handlers'
import { PopOutWindows } from './app/pop-out-windows'
import { registerPopOutHandlers } from './ipc/pop-out-handlers'
import {
  broadcastToWindows,
  openOstlerWindows,
  registerOstlerWindow,
  sendToWindow
} from './services/send-to-window'
import { holdBackSystemUiOffScreen } from './app/off-screen'
import { appLog, initLogging, recordProcessFailures } from './app/logging'
import { denyWebPermissions } from './app/security'
import { initialAppearance, watchSystemAppearance } from './app/appearance'
import { applyLanguageSetting, peekLanguageSetting } from './app/locale'
import {
  installLibraryProtocol,
  installReportPictureProtocol,
  registerLibraryScheme
} from './app/library-protocol'
import { createAppServices, type AppServices } from './app/services'
import { installSqlProfiler, writeSqlProfile } from './app/sql-profiler'
import { DesktopIntegration } from './app/desktop/desktop'
import { createQuitController } from './app/desktop/lifecycle'
import { appIconPath } from './app/desktop/icons'
import {
  registerDesktopHandlers,
  registerEditFlushHandler,
  registerSnipHandlers
} from './ipc/desktop-handlers'
import { IPC_CHANNELS } from '@shared/ostler-api'
import { createEditFlusher } from './app/desktop/edit-flush'
import {
  DatabaseTooNewError,
  MigrationBackupError,
  migrateOstlerDatabase
} from './services/database/migrations'
import { applyPendingRestore, backupsDirectory } from './services/backup-service'
import { t } from '@shared/i18n'
import { mcpStdioRequest } from './services/mcp/stdio-bridge'
import { runMcpStdioLauncher, shareSecureStorageKey } from './app/mcp-stdio'

performance.mark(PERF_MARKS.mainStart)
installSqlProfiler()
// Before anything can open a dialog or another app: off screen, none does.
holdBackSystemUiOffScreen()

// ─── Globals ────────────────────────────────────────────────────────────────

const isSmokeTest = process.env['OSTLER_SMOKE_TEST'] === '1'
const isDev = process.env.NODE_ENV === 'development' || !!process.env['ELECTRON_RENDERER_URL']

// `--mcp-stdio --project <id>` (D39): this process is only an MCP client's
// bridge to the running Ostler. It takes no lock, creates nothing, registers
// nothing and starts nothing below; it reads the data folder's config.json.
const mcpStdio = mcpStdioRequest(process.argv)

// Required for Windows to route Notification API toasts to this app instead of
// silently dropping them (unpackaged/dev builds have no shortcut-derived AUMID).
if (process.platform === 'win32') {
  app.setAppUserModelId(BRAND.appUserModelId)
}

// The data folder is resolved and pinned before anything else, because the
// single-instance lock below is keyed to it: a scratch instance with its own
// OSTLER_USER_DATA runs beside the everyday one, and a second launch against the same
// folder bounces off the first. Locking before setPath would key every
// instance to the default folder.
// Nexus Dashboard's data folder becomes Ostler's on the first start after the
// rename, before the folder is pinned or locked (rename-migration.ts).
if (!mcpStdio) {
  const move = moveLegacyDataFolder(process.env, app.getPath('appData'), BRAND.dataFolderName)
  if (move.kind === 'moved')
    console.log(`[rename] Moved the data folder from ${move.from} to ${move.to}`)
  if (move.kind === 'failed') {
    dialog.showErrorBox(
      t('desktop:main.couldNotMoveData'),
      t('desktop:main.closeOldAppFirst', { from: move.from, message: move.error })
    )
    // Right away: nothing below may create the new folder, or the next start
    // would find both and leave the data where it is.
    process.exit(1)
  }
}
const dataDir = resolveDataDir(process.env, app.getPath('appData'), process.argv, app.isPackaged)
if (!mcpStdio) fs.mkdirSync(dataDir, { recursive: true })
// Chromium writes its own state into userData, safeStorage's key among it:
// the launcher keeps that out of the data folder the running Ostler owns.
// It gets a copy of the data folder's key file, so it opens the encrypted token.
const launcherUserData = join(app.getPath('temp'), `${BRAND.dataFolderName}-mcp`)
if (mcpStdio) shareSecureStorageKey(dataDir, launcherUserData)
app.setPath('userData', mcpStdio ? launcherUserData : dataDir)
const isPrimaryInstance = mcpStdio === null && app.requestSingleInstanceLock()

let services: AppServices | null = null
let mainWindow: BrowserWindow | null = null
let desktop: DesktopIntegration | null = null
/** Pop-out windows (N5.8a): made once the services and desktop integration are. */
let popOuts: PopOutWindows<BrowserWindow> | null = null
/** Sticky tasks (N5.8b): made beside the pop-outs. */
let stickyTasks: StickyTaskWindows<BrowserWindow> | null = null

/**
 * Closing the window quits, or hides it to the tray with background mode on;
 * the services stop only on a real quit (P8.2).
 */
const editFlusher = createEditFlusher()
const quitController = createQuitController({
  backgroundMode: () => services?.configStore.get().desktop.backgroundMode ?? false,
  // Every window, pop-outs too (N5.8a), each within the same short wait.
  flushEdits: async () => {
    await Promise.all(openOstlerWindows().map((win) => editFlusher.flush(win)))
  },
  stopServices: async () => {
    desktop?.dispose()
    await (services?.stop() ?? Promise.resolve())
    writeSqlProfile(dataDir)
  },
  quit: () => app.quit()
})

/**
 * The argv of a second launch, after the first instance has focused itself:
 * a deep link or jump-list entry, if it carries one (P8.2).
 */
function onSecondInstance(argv: string[]): void {
  desktop?.receiveArgv(argv)
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────

if (!mcpStdio) registerLibraryScheme()

/**
 * Gets the data folder ready before anything opens it, in this order: apply a
 * restore the user scheduled (nothing may hold `ostler.db` open while it is
 * replaced), then migrate `ostler.db`. Returns false, after telling the user,
 * when Ostler must not start: the database is from a newer build, or it could
 * not be backed up or migrated. A failed restore has already been rolled back,
 * so it is reported and start-up continues.
 */
async function prepareDataFolder(databasePath: string): Promise<boolean> {
  try {
    await applyPendingRestore(dataDir, app.getVersion())
  } catch (error) {
    dialog.showErrorBox(
      t('desktop:main.restoreFailed'),
      error instanceof Error ? error.message : String(error)
    )
  }

  try {
    const result = await migrateOstlerDatabase(databasePath, {
      backupDir: backupsDirectory(dataDir),
      appVersion: app.getVersion()
    })
    if (result.from !== result.to) {
      appLog.info(
        `Database updated from version ${result.from} to ${result.to}` +
          (result.backupPath ? `; the previous copy is at ${result.backupPath}` : '')
      )
    }
    return true
  } catch (error) {
    if (error instanceof DatabaseTooNewError) {
      dialog.showErrorBox(t('desktop:main.cannotOpenData'), t('desktop:main.dataWasWrittenNewer'))
    } else if (error instanceof MigrationBackupError) {
      dialog.showErrorBox(
        t('desktop:main.couldNotBackUp'),
        t('desktop:main.dataNeedsUpdateBacks', { message: error.message })
      )
    } else {
      dialog.showErrorBox(
        t('desktop:main.couldNotUpdateData'),
        t('desktop:main.updateRolledBack', {
          message: error instanceof Error ? error.message : String(error)
        })
      )
    }
    return false
  }
}

function openMainWindow(hidden = false): void {
  if (!services || !desktop) return
  const win = createWindow(initialAppearance(services.configStore.get().ui), {
    chrome: desktop.windowOptions(),
    hidden
  })
  mainWindow = win
  performance.mark(PERF_MARKS.windowCreated)
  win.on('close', (event) => {
    quitController.onWindowClose(event, () => win.hide())
  })
  services.attachWindow(win)
  desktop.attachWindow(win)
}

if (mcpStdio) {
  runMcpStdioLauncher(mcpStdio, dataDir)
} else if (!isPrimaryInstance) {
  // Another instance owns this data folder; it focuses itself on 'second-instance'.
  app.quit()
} else {
  initLogging(dataDir)
  recordProcessFailures(app, recoverFromRendererCrash)
  app.on('second-instance', (_event, argv) => {
    if (mainWindow && !mainWindow.isDestroyed()) focusWindow(mainWindow)
    onSecondInstance(argv)
  })
  app.whenReady().then(startApp)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') quitController.onWindowAllClosed()
  })
  app.on('before-quit', (event) => {
    // Which pop-outs are open, before they close with the app (N5.8a).
    popOuts?.beforeQuit()
    // And where the sticky tasks are, so closing them unpins nothing (N5.8b).
    stickyTasks?.beforeQuit()
    quitController.onBeforeQuit(event)
  })
}

/**
 * `npm run seed:scale` (P9.1): with `OSTLER_SEED_SCALE` set to the folder the
 * scratch Git projects go in, Ostler writes the scale dataset into its data
 * folder and quits without opening a window. Development only: a packaged
 * build refuses the flag.
 */
const seedScaleParent = process.env['OSTLER_SEED_SCALE'] || null

async function runScaleSeed(started: AppServices, projectsParent: string): Promise<void> {
  let code = 0
  try {
    await started.seedScale(projectsParent)
  } catch (error) {
    console.error('seed:scale failed:', error)
    code = 1
  }
  await started.stop()
  app.exit(code)
}

async function startApp(): Promise<void> {
  if (seedScaleParent !== null && app.isPackaged) {
    console.error('OSTLER_SEED_SCALE is for development builds only.')
    app.exit(1)
    return
  }
  // The language first, so even start-up's dialogs are in it (P11.1).
  applyLanguageSetting(peekLanguageSetting(dataDir))
  const databasePath = join(dataDir, 'ostler.db')
  // Before the config or any service opens a file in the data folder.
  renameLegacyFiles(dataDir, 'ostler.db')
  if (!(await prepareDataFolder(databasePath))) {
    app.exit(1)
    return
  }

  denyWebPermissions()
  services = await createAppServices(dataDir)
  applyLanguageSetting(services.configStore.get().ui.language)
  performance.mark(PERF_MARKS.servicesCreated)
  if (seedScaleParent !== null) {
    await runScaleSeed(services, seedScaleParent)
    return
  }
  installLibraryProtocol(services.getProject, services.libraryService)
  installReportPictureProtocol(services.getProject, services.readReportPicture)
  services.registerHandlers()
  services.setBeforeUpdateInstall(() => quitController.beginQuit())
  watchSystemAppearance()
  const started = services
  desktop = new DesktopIntegration({
    getConfig: () => started.configStore.get(),
    unreadInboxCount: () => started.unreadInboxCount(),
    stopAllAi: () => started.stopAllAi(),
    pauseReminders: (until) => started.pauseReminders(until),
    remindersPausedUntil: () => started.remindersPausedUntil(),
    runningTimerTitle: () => started.runningTimerTitle(),
    stopTimer: () => started.stopTimer(),
    focus: () => started.focus(),
    stopFocus: () => started.stopFocus(),
    countdowns: (today) => started.countdowns(today),
    saveZoom: (level) => {
      const ui = started.configStore.get().ui
      started.configStore.update({ ui: { ...ui, zoom: level } })
    },
    saveSnip: async (projectId, workItemId, fileName, png) => {
      const saved = await started.libraryService.saveSnip(projectId, workItemId, fileName, png)
      broadcastToWindows(IPC_CHANNELS.ON_PROJECT_STATE_CHANGE, {
        projectId,
        field: 'library',
        data: null
      })
      return saved.item
    },
    dataDir,
    isDev
  })
  const integration = desktop
  registerDesktopHandlers(integration)
  registerSnipHandlers(integration.snip, started.getProject)
  registerEditFlushHandler(editFlusher)
  // Pop out a view (N5.8a): every pop-out is made like the main window
  // (`createOstlerWindow`), so off screen it stays off screen too.
  const popOutWindows = new PopOutWindows<BrowserWindow>({
    create: (route, place) => {
      const win = createPopOutWindow({
        appearance: initialAppearance(started.configStore.get().ui),
        chrome: integration.windowOptions(),
        route,
        place
      })
      registerOstlerWindow(win)
      integration.attachPopOut(win)
      return win
    },
    focus: focusWindow,
    read: () => started.configStore.get().popOuts.windows,
    write: (windows) => {
      started.configStore.update({ popOuts: { windows } })
    },
    workAreas: () => screen.getAllDisplays().map((display) => display.workArea),
    projectExists: (projectId) =>
      started.configStore.get().projects.some((project) => project.id === projectId)
  })
  popOuts = popOutWindows
  registerPopOutHandlers({
    open: (route, closeOldest) => popOutWindows.open(route, closeOldest),
    routeOf: (sender) => popOutWindows.routeOf(sender),
    reopenAtStart: (route) => popOutWindows.reopenAtStart(route),
    setReopenAtStart: (route, reopen) => popOutWindows.setReopenAtStart(route, reopen),
    openInMainWindow: (path) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      focusWindow(mainWindow)
      // '/' only brings it forward, on whatever it shows.
      if (path !== '/') sendToWindow(mainWindow, IPC_CHANNELS.ON_OPEN_IN_MAIN_WINDOW, path)
    }
  })
  // New task in a window of its own: made like every window, and handing its draft back to
  // the main window, which comes forward.
  const newTaskWindows = new NewTaskWindows<BrowserWindow>({
    create: (projectId) => {
      const win = createNewTaskWindow({
        appearance: initialAppearance(started.configStore.get().ui),
        chrome: integration.windowOptions(),
        projectId
      })
      registerOstlerWindow(win)
      integration.attachPopOut(win)
      return win
    },
    focus: focusWindow,
    projectExists: (projectId) =>
      started.configStore.get().projects.some((project) => project.id === projectId),
    returned: (projectId) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      focusWindow(mainWindow)
      sendToWindow(mainWindow, IPC_CHANNELS.ON_NEW_TASK_RETURNED, projectId)
    }
  })
  registerNewTaskWindowHandlers({
    open: (projectId, draft) => newTaskWindows.open(projectId, draft),
    takeOutgoing: (sender) => newTaskWindows.takeOutgoing(sender),
    giveBack: (sender, draft) => newTaskWindows.giveBack(sender, draft),
    takeReturned: (projectId) => newTaskWindows.takeReturned(projectId)
  })
  // A task in a window of its own (MOP-12): made like every window.
  const taskWindows = new TaskWindows<BrowserWindow>({
    create: (projectId, taskId) => {
      const win = createTaskWindow({
        appearance: initialAppearance(started.configStore.get().ui),
        chrome: integration.windowOptions(),
        projectId,
        taskId
      })
      registerOstlerWindow(win)
      integration.attachPopOut(win)
      return win
    },
    focus: focusWindow,
    projectExists: (projectId) =>
      started.configStore.get().projects.some((project) => project.id === projectId)
  })
  registerTaskWindowHandlers({ open: (projectId, taskId) => taskWindows.open(projectId, taskId) })
  // Sticky task on the desktop (N5.8b): made like every window
  // (`createOstlerWindow`), on top of others, never taking the focus.
  const stickyWindows = new StickyTaskWindows<BrowserWindow>({
    create: (ref, bounds) => {
      const win = createStickyTaskWindow({
        appearance: initialAppearance(started.configStore.get().ui),
        ref,
        bounds
      })
      registerOstlerWindow(win)
      return win
    },
    reveal: revealStickyWindow,
    read: () => started.configStore.get().stickyTasks.windows,
    write: (windows) => {
      started.configStore.update({ stickyTasks: { windows } })
    },
    workAreas: () => screen.getAllDisplays().map((display) => display.workArea),
    projectExists: (projectId) =>
      started.configStore.get().projects.some((project) => project.id === projectId)
  })
  stickyTasks = stickyWindows
  registerStickyTaskHandlers({
    pin: (ref, unpinOldest) => stickyWindows.pin(ref, unpinOldest),
    unpin: (ref) => stickyWindows.unpin(ref),
    taskOf: (sender) => stickyWindows.taskOf(sender),
    releaseFocus: (sender) => {
      const win = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.webContents === sender
      )
      if (win && !win.isDestroyed()) win.blur()
    }
  })
  services.setDesktopHooks({
    inboxChanged: () => integration.inboxChanged(),
    projectsChanged: () => {
      integration.projectsChanged()
      // A removed project's sticky tasks go with it.
      stickyWindows.unpinRemovedProjects()
    },
    configChanged: () => integration.configChanged(),
    agentQuestionArrived: () => integration.agentQuestionArrived(),
    progress: (source, value) => integration.setProgress(source, value),
    timerChanged: () => integration.timerChanged(),
    focusChanged: () => integration.focusChanged(),
    countdownsChanged: () => integration.countdownsChanged(),
    dateMayHaveChanged: () => integration.dateMayHaveChanged()
  })
  services.setNotificationShell({
    // A click takes the same route as a deep link: parsed, checked, then navigated.
    open: (target) =>
      target
        ? integration.openLink(deepLinkFor(target, BRAND.urlScheme))
        : integration.showWindow(),
    icon: appIconPath()
  })
  integration.start(process.argv)
  const startsHidden = integration.startsHidden(process.argv)
  openMainWindow(startsHidden)
  // Reopen at start (N5.8a), unless Ostler started hidden in the tray.
  if (!startsHidden) popOutWindows.restore()
  // Pinned tasks come back too, as sticky notes stay on a monitor (N5.8b).
  if (!startsHidden) stickyWindows.restore()
  services.start()

  if (isSmokeTest) {
    console.log('OSTLER_READY')
    setTimeout(() => app.quit(), 100)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow()
    }
  })
}
