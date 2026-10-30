import {
  app,
  globalShortcut,
  Menu,
  screen,
  Tray,
  type BrowserWindow,
  type BrowserWindowConstructorOptions
} from 'electron'
import { BRAND } from '@shared/brand'
import { deepLinkFor, findDeepLinkArgument, parseDeepLink, parseJoinLink } from '@shared/deep-link'
import { rememberJoinInvite } from '../join-links'
import {
  badgeText,
  EMPTY_MENU_CONTEXT,
  IPC_CHANNELS,
  type AppCommand,
  type MenuContext,
  type NavigateRequest,
  type OstlerConfig,
  sameHotkey
} from '@shared/ostler-api'
import { isAiConfigured } from '@shared/ai-configured'
import { normalizeZoomLevel, stepZoomLevel, type ZoomStep } from '@shared/zoom'
import { appLog } from '../logging'
import { USER_DATA_ARGUMENT } from '../data-dir'
import { focusWindow } from '../window'
import { offScreen, showDesktopNotification } from '../off-screen'
import { openOstlerWindows } from '../../services/send-to-window'
import { SnipController } from './snip'
import { captureDisplays, hideForSnip, openSnipOverlays, snipImageFromPng } from './snip-electron'
import { buildMenuTemplate, menuShape, setMenuEnabled, toElectronTemplate } from './app-menu'
import { appIconPath, badgeImage } from './icons'
import { watchWindowState } from './window-controls'
import { buildJumpList, recentProjects, STOP_TIMER_ARGUMENT } from './jump-list'
import { buildTrayMenu, PAUSE_REMINDERS_MS, trayTooltip, type TrayAction } from './tray-menu'
import { CountdownWatch, type CountdownEntry } from './countdowns'
import type { FocusState, LibraryItem } from '@shared/ostler-api'
import { formatTime } from '@shared/format'
import { t } from '@shared/i18n'

/**
 * Windows integration (P8.2): the application menu, the custom title bar, deep
 * links, the jump list, the taskbar badge, flash and progress, and background
 * mode's tray, sign-in start and Quick add key. main.ts creates one and
 * services.ts tells it what changed (`DesktopHooks`).
 *
 * Shell registrations that outlive the process (the link scheme, the jump
 * list and the sign-in entry) are made only by a packaged build, or by a
 * development run that sets OSTLER_SHELL_INTEGRATION=1 to test them, so
 * development and scratch runs never take them over from an installed Ostler.
 */

export interface DesktopDependencies {
  getConfig(): OstlerConfig
  unreadInboxCount(): number
  stopAllAi(): Promise<unknown>
  pauseReminders(until: number | null): void
  remindersPausedUntil(): number | null
  /** The running timer's task title, or null (R2.3). */
  runningTimerTitle(): string | null
  stopTimer(): void
  /** The focus, or null (N3.5). */
  focus(): FocusState | null
  stopFocus(): void
  /** The countdowns for the tray and the jump list, worded for `today` (N5.2b). */
  countdowns?(today: string): CountdownEntry[]
  /** Saves the page zoom as `ui.zoom` (P9.2). */
  saveZoom(level: number): void
  /** Snip to task (N4.2a): stores a snip in the Library and attaches it to the task. */
  saveSnip(
    projectId: string,
    workItemId: string,
    fileName: string,
    png: Uint8Array
  ): Promise<LibraryItem>
  /** The data folder, for development runs that register the shell (`--ostler-user-data`). */
  dataDir: string
  isDev: boolean
}

export type ProgressSource = 'import' | 'task-split'

type HotkeyId = 'quickAdd' | 'snip'

/** The argument a start at sign-in carries: open hidden when background mode is on. */
export const HIDDEN_ARGUMENT = '--hidden'

export class DesktopIntegration {
  private window: BrowserWindow | null = null
  private context: MenuContext = EMPTY_MENU_CONTEXT
  /** The renderer has said where it is, so it is listening: links can be delivered. */
  private rendererReady = false
  private pendingLink: NavigateRequest | null = null
  private customTitleBar = false
  /** The installed menu's `menuShape`: a menu of the same shape is not installed again. */
  private installedMenu: string | null = null
  private tray: Tray | null = null
  /** The system-wide keys registered now: Quick add's and Snip to task's (N4.2a). */
  private registeredHotkeys: Record<HotkeyId, string | null> = { quickAdd: null, snip: null }
  private progress = new Map<ProgressSource, number | 'indeterminate'>()
  private lastConfigKey = ''

  /** Snip to task (N4.2a): the key, the tray and the command palette all start it here. */
  readonly snip: SnipController

  /** The tray's and the jump list's countdowns (N5.2b), kept current across a date change. */
  private readonly countdownWatch: CountdownWatch

  constructor(private readonly deps: DesktopDependencies) {
    this.countdownWatch = new CountdownWatch({
      now: () => new Date(),
      read: (today) => this.deps.countdowns?.(today) ?? [],
      apply: () => {
        this.refreshTray()
        this.refreshJumpList()
      }
    })
    this.snip = new SnipController({
      capture: captureDisplays,
      openOverlays: openSnipOverlays,
      hideMainWindow: () => hideForSnip(this.window),
      restoreMainWindow: () => this.showWindow(),
      cursorPoint: () => screen.getCursorScreenPoint(),
      deliver: (preview) => this.navigate({ kind: 'snip', snip: preview }),
      save: (projectId, workItemId, fileName, png) =>
        this.deps.saveSnip(projectId, workItemId, fileName, png),
      imageFromPng: snipImageFromPng,
      now: () => new Date(),
      warn: (message) => appLog.warn(message)
    })
  }

  /** Whether this process may make registrations that outlive it. */
  get shellIntegration(): boolean {
    return app.isPackaged || process.env['OSTLER_SHELL_INTEGRATION'] === '1'
  }

  /**
   * Arguments a shell entry starts Ostler with before its own: in development,
   * the app folder and this data folder, so a link never opens the default one.
   */
  private launchArgs(): string[] {
    return app.isPackaged ? [] : [app.getAppPath(), `${USER_DATA_ARGUMENT}${this.deps.dataDir}`]
  }

  // ─── Start-up ──────────────────────────────────────────────────────────────

  /** Before the window opens: the link scheme and the menu. */
  start(argv: readonly string[]): void {
    if (this.shellIntegration) {
      const ok = app.isPackaged
        ? app.setAsDefaultProtocolClient(BRAND.urlScheme)
        : app.setAsDefaultProtocolClient(BRAND.urlScheme, process.execPath, this.launchArgs())
      if (!ok) appLog.warn(`Could not register the ${BRAND.urlScheme}: link scheme`)
    }
    this.installMenu()
    this.applyConfig()
    // Countdowns (N5.2b): read once now, then whenever the local date changes.
    this.countdownWatch.refresh()
    this.countdownWatch.start()
    this.receiveArgv(argv)
  }

  /** The title bar options for a new main window, from the setting as it is now. */
  windowOptions(): Partial<BrowserWindowConstructorOptions> {
    this.customTitleBar = !this.deps.getConfig().desktop.nativeTitleBar
    const icon = appIconPath()
    if (!this.customTitleBar) return { icon, titleBarStyle: 'default' }
    // No overlay: the title bar draws its own Minimise, Maximise and Close
    // (`WindowControls`); the window keeps its resize edges and shadow.
    return { icon, titleBarStyle: 'hidden' }
  }

  get usesCustomTitleBar(): boolean {
    return this.customTitleBar
  }

  /** Whether a start at sign-in should stay hidden in the tray. */
  startsHidden(argv: readonly string[]): boolean {
    return argv.includes(HIDDEN_ARGUMENT) && this.deps.getConfig().desktop.backgroundMode
  }

  attachWindow(win: BrowserWindow): void {
    this.window = win
    this.rendererReady = false
    win.on('focus', () => win.flashFrame(false))
    win.webContents.on('did-start-loading', () => {
      this.rendererReady = false
    })
    // The saved zoom, on every load: Chromium does not keep it across restarts.
    win.webContents.on('did-finish-load', () => this.applyZoom())
    watchWindowState(win)
    this.refreshBadge()
    this.refreshProgress()
  }

  /**
   * A pop-out window (N5.8a): the saved zoom on every load, and its title
   * bar's Maximise button kept in step, as the main window's are. The taskbar
   * badge, progress and flash stay on the main window.
   */
  attachPopOut(win: BrowserWindow): void {
    win.webContents.on('did-finish-load', () => {
      if (win.isDestroyed()) return
      win.webContents.setZoomLevel(normalizeZoomLevel(this.deps.getConfig().ui.zoom))
    })
    watchWindowState(win)
  }

  // ─── Menu and renderer context ─────────────────────────────────────────────

  private installMenu(): void {
    const config = this.deps.getConfig()
    const template = buildMenuTemplate({
      context: this.context,
      theme: config.ui.theme,
      isDev: this.deps.isDev
    })
    // The renderer sends its context on every view change, and the config
    // changes on most saves. Installing a menu re-lays out every window on
    // Windows, which made the app flicker as the person clicked around, so a
    // menu of the same shape keeps its items and only has their enabled
    // state set; a new menu is installed only when its items differ.
    const shape = menuShape(template)
    const installed = Menu.getApplicationMenu()
    if (shape === this.installedMenu && installed) {
      setMenuEnabled(installed.items, template)
      return
    }
    this.installedMenu = shape
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        toElectronTemplate(
          template,
          (command) => this.send(command),
          (step) => this.zoom(step)
        )
      )
    )
  }

  // ─── Zoom ──────────────────────────────────────────────────────────────────

  /** Ctrl+=, Ctrl+- and Ctrl+0, from the View menu (P9.2): applies the step and saves it. */
  zoom(step: ZoomStep): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    const level = stepZoomLevel(this.deps.getConfig().ui.zoom, step)
    win.webContents.setZoomLevel(level)
    this.deps.saveZoom(level)
  }

  private applyZoom(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    win.webContents.setZoomLevel(normalizeZoomLevel(this.deps.getConfig().ui.zoom))
  }

  /** Sends a menu, tray or key command to the renderer, showing the window first. */
  send(command: AppCommand): void {
    // A key pressed in a pop-out acts there (N5.8a); the tray's commands go to the main window.
    const focused = openOstlerWindows().find((candidate) => candidate.isFocused())
    const win = focused ?? this.window
    if (!win || win.isDestroyed()) return
    if (!win.isVisible() || win.isMinimized()) focusWindow(win)
    win.webContents.send(IPC_CHANNELS.ON_APP_COMMAND, command)
  }

  setMenuContext(context: MenuContext): void {
    this.context = context
    this.installMenu()
    this.refreshJumpList()
    if (!this.rendererReady) {
      this.rendererReady = true
      const pending = this.pendingLink
      this.pendingLink = null
      if (pending) this.navigate(pending)
    }
  }

  /** The title bar's menu button: the same application menu, below the button. */
  popupMenu(x: number, y: number): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    // Windows keeps a menu on a display, so one from an off-screen window would show.
    if (offScreen) return
    Menu.getApplicationMenu()?.popup({ window: win, x: Math.round(x), y: Math.round(y) })
  }

  // ─── Deep links ────────────────────────────────────────────────────────────

  /** A second launch's arguments, or this launch's: the link among them, if any. */
  receiveArgv(argv: readonly string[]): void {
    // The jump list's Stop timer (R2.3): an ordinary write, nothing else happens.
    if (argv.includes(STOP_TIMER_ARGUMENT)) {
      this.deps.stopTimer()
      return
    }
    const link = findDeepLinkArgument(argv, BRAND.urlScheme)
    if (link) this.openLink(link)
  }

  /** Opens a deep link, if it is one Ostler accepts; anything else is logged and ignored. */
  openLink(raw: string): void {
    // A join link opens the Join step filled in; it never joins by itself (prompt 07).
    // Its text is not logged: it carries the invite.
    const join = parseJoinLink(raw, BRAND.urlScheme)
    if (join.ok) {
      this.navigate({ kind: 'join-share', inviteId: rememberJoinInvite(join.invite) })
      return
    }
    if (join.reason !== 'another scheme' && join.reason !== 'not a join link') {
      appLog.warn(`Ignored a join link (${join.reason})`)
      return
    }
    const viewIds = this.context.viewIds
    const parsed = parseDeepLink(raw, BRAND.urlScheme, (view) =>
      // Before the renderer has said which views exist, a view link waits to be checked there.
      viewIds.length === 0 ? /^[a-z]{1,20}$/.test(view) : viewIds.includes(view)
    )
    if (!parsed.ok) {
      appLog.warn(`Ignored a link (${parsed.reason}): ${JSON.stringify(raw.slice(0, 120))}`)
      return
    }
    const request = parsed.request
    if (
      'projectId' in request &&
      !this.deps.getConfig().projects.some((project) => project.id === request.projectId)
    ) {
      appLog.warn(`Ignored a link to a project that does not exist: ${request.projectId}`)
      this.showWindow()
      return
    }
    this.navigate(request)
  }

  /** Shows the window and sends the renderer where to go, once it is listening. */
  navigate(request: NavigateRequest | null): void {
    this.showWindow()
    if (!request) return
    if (!this.rendererReady) {
      this.pendingLink = request
      return
    }
    this.window?.webContents.send(IPC_CHANNELS.ON_NAVIGATE, request)
  }

  showWindow(): void {
    if (this.window && !this.window.isDestroyed()) focusWindow(this.window)
  }

  // ─── Taskbar ───────────────────────────────────────────────────────────────

  /** The Inbox changed: the badge and the tray's count. */
  inboxChanged(): void {
    this.refreshBadge()
    this.refreshTray()
  }

  private refreshBadge(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    const count = this.deps.unreadInboxCount()
    const label = badgeText(count)
    if (label) win.setOverlayIcon(badgeImage(label), t('desktop:desktop.unreadInbox', { count }))
    else win.setOverlayIcon(null, '')
  }

  /** An agent asked a question: the taskbar button flashes until the window is focused. */
  agentQuestionArrived(): void {
    const win = this.window
    // An off-screen window is never focused: it would flash for every question.
    if (offScreen) return
    if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true)
  }

  setProgress(source: ProgressSource, value: number | 'indeterminate' | null): void {
    if (value === null) this.progress.delete(source)
    else this.progress.set(source, value)
    this.refreshProgress()
  }

  private refreshProgress(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    const values = [...this.progress.values()]
    const fractions = values.filter((value): value is number => typeof value === 'number')
    if (values.length === 0) win.setProgressBar(-1)
    else if (fractions.length === 0) win.setProgressBar(1, { mode: 'indeterminate' })
    else win.setProgressBar(Math.min(...fractions), { mode: 'normal' })
  }

  /** The timer started or stopped: the tray's and the jump list's Stop timer (R2.3). */
  timerChanged(): void {
    const running = this.deps.runningTimerTitle() !== null
    this.refreshTray()
    if (running !== this.jumpListTimer) this.refreshJumpList()
  }

  private jumpListTimer = false

  /** Refreshes the tray's tooltip each minute while a focus or its break counts down. */
  private focusTick: ReturnType<typeof setInterval> | null = null

  /** A focus started, ended or moved on (N3.5): the tray's tooltip and Stop focus. */
  focusChanged(): void {
    const focus = this.deps.focus()
    const counting = focus !== null && focus.phase !== 'ended'
    if (counting && !this.focusTick) {
      this.focusTick = setInterval(() => this.refreshTray(), 15_000)
      this.focusTick.unref?.()
    } else if (!counting && this.focusTick) {
      clearInterval(this.focusTick)
      this.focusTick = null
    }
    this.refreshTray()
  }

  /** Pins or their items may have changed: the countdowns are read again (N5.2b). */
  countdownsChanged(): void {
    this.countdownWatch.refresh()
  }

  /** Back from sleep, or the clock moved: the countdowns, if the date has changed. */
  dateMayHaveChanged(): void {
    this.countdownWatch.tick()
  }

  /** Projects changed: the jump list's recent projects. */
  projectsChanged(): void {
    this.refreshJumpList()
  }

  private refreshJumpList(): void {
    if (!this.shellIntegration || process.platform !== 'win32') return
    this.jumpListTimer = this.deps.runningTimerTitle() !== null
    try {
      app.setJumpList(
        buildJumpList({
          program: process.execPath,
          baseArgs: this.launchArgs(),
          scheme: BRAND.urlScheme,
          iconPath: appIconPath(),
          recentProjects: recentProjects(
            this.deps.getConfig().projects,
            this.context.recentProjectIds
          ),
          timerRunning: this.jumpListTimer,
          countdowns: this.countdownWatch.entries
        })
      )
    } catch (error) {
      appLog.warn(`Could not update the jump list: ${String(error)}`)
    }
  }

  // ─── Settings: background mode, sign-in, the Quick add key ─────────────────

  /** The config changed: apply what it says about the desktop and the theme. */
  configChanged(): void {
    this.installMenu()
    // The language may have changed: the jump list's words too (P11.1).
    this.refreshJumpList()
    this.applyConfig()
  }

  private applyConfig(): void {
    const { desktop } = this.deps.getConfig()
    const key = JSON.stringify(desktop)
    if (key === this.lastConfigKey) {
      this.refreshTray()
      return
    }
    this.lastConfigKey = key
    if (desktop.backgroundMode) this.createTray()
    else this.destroyTray()
    this.applyLoginItem(desktop.startAtLogin, desktop.backgroundMode)
    // Snip to task's key first lets go, so the two can swap keys in one change.
    this.applyHotkey('snip', null)
    this.applyHotkey('quickAdd', desktop.quickAddHotkeyEnabled ? desktop.quickAddHotkey : null)
    this.applyHotkey(
      'snip',
      desktop.snipHotkeyEnabled && !sameHotkey(desktop.snipHotkey, desktop.quickAddHotkey)
        ? desktop.snipHotkey
        : null
    )
  }

  private applyLoginItem(openAtLogin: boolean, hidden: boolean): void {
    if (!this.shellIntegration) return
    const args = [...this.launchArgs(), ...(hidden ? [HIDDEN_ARGUMENT] : [])]
    const current = app.getLoginItemSettings({ path: process.execPath, args })
    if (current.openAtLogin === openAtLogin && !openAtLogin) return
    app.setLoginItemSettings({ openAtLogin, path: process.execPath, args })
  }

  private applyHotkey(id: HotkeyId, accelerator: string | null): void {
    const registered = this.registeredHotkeys[id]
    if (registered === accelerator) return
    if (registered) globalShortcut.unregister(registered)
    this.registeredHotkeys[id] = null
    if (!accelerator) return
    // A system-wide key is the person's: off screen it stays with their own Ostler.
    if (offScreen) {
      appLog.info(
        `Off screen: did not register the ${id === 'quickAdd' ? 'Quick add' : 'Snip to task'} key ${accelerator}`
      )
      return
    }
    const ok = globalShortcut.register(accelerator, () =>
      id === 'quickAdd' ? this.openQuickAdd() : this.startSnip()
    )
    if (ok) {
      this.registeredHotkeys[id] = accelerator
      return
    }
    appLog.warn(
      `Could not register the ${id === 'quickAdd' ? 'Quick add' : 'Snip to task'} key ${accelerator}`
    )
    showDesktopNotification({
      title: t('desktop:desktop.keyInUse', { accelerator }),
      body: t(
        id === 'quickAdd'
          ? 'desktop:desktop.anotherAppAlreadyUses'
          : 'desktop:desktop.anotherAppAlreadyUsesSnip',
        { accelerator }
      ),
      icon: appIconPath()
    })
  }

  private openQuickAdd(): void {
    // Quick add's key always wins: a snip being taken is dropped.
    this.snip.cancel()
    this.navigate({ kind: 'quick-add' })
  }

  /** The Snip to task key or the tray: a failure is logged and Ostler's window comes back. */
  startSnip(): void {
    this.snip.start().catch((error: unknown) => {
      appLog.warn(`Could not start a snip: ${String(error)}`)
    })
  }

  // ─── Tray ──────────────────────────────────────────────────────────────────

  private createTray(): void {
    if (this.tray) return
    // Off screen there is no tray icon, so no tooltip or menu of it shows either.
    if (offScreen) return
    this.tray = new Tray(appIconPath())
    this.tray.setToolTip(BRAND.fullName)
    this.tray.on('click', () => this.showWindow())
    this.refreshTray()
  }

  private destroyTray(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private refreshTray(): void {
    if (!this.tray) return
    const config = this.deps.getConfig()
    const ai = config.ai
    const current = this.deps.focus()
    const focus = current && current.phase !== 'ended' ? current : null
    const items = buildTrayMenu({
      focus,
      unread: this.deps.unreadInboxCount(),
      aiOn: config.harness.enabled || isAiConfigured({ ...ai, hasApiKey: ai.apiKey !== '' }),
      remindersPausedUntil: this.deps.remindersPausedUntil(),
      timerTask: this.deps.runningTimerTitle(),
      countdowns: this.countdownWatch.entries,
      time: (at) => formatTime(new Date(at), { hour: '2-digit', minute: '2-digit' })
    })
    this.tray.setContextMenu(
      Menu.buildFromTemplate(
        items.map((item) =>
          'type' in item
            ? { type: 'separator' as const }
            : { label: item.label, click: () => this.trayAction(item.action, item.request) }
        )
      )
    )
    this.tray.setToolTip(
      trayTooltip({
        focus,
        unread: this.deps.unreadInboxCount(),
        now: Date.now(),
        name: BRAND.fullName
      })
    )
  }

  private trayAction(action: TrayAction, request?: NavigateRequest): void {
    switch (action) {
      case 'open':
        this.showWindow()
        return
      case 'quick-add':
        this.openQuickAdd()
        return
      case 'snip':
        this.startSnip()
        return
      case 'inbox':
        this.navigate({ kind: 'inbox' })
        return
      // A countdown opens its item through its link's route: checked, then navigated.
      case 'open-countdown':
        if (request) this.openLink(deepLinkFor(request, BRAND.urlScheme))
        return
      case 'stop-timer':
        this.deps.stopTimer()
        return
      case 'stop-focus':
        this.deps.stopFocus()
        return
      case 'pause-reminders':
        this.deps.pauseReminders(Date.now() + PAUSE_REMINDERS_MS)
        this.refreshTray()
        return
      case 'resume-reminders':
        this.deps.pauseReminders(null)
        this.refreshTray()
        return
      case 'stop-ai':
        void this.deps.stopAllAi()
        return
      case 'quit':
        app.quit()
        return
    }
  }

  /** On quit: let go of the key and the tray. */
  dispose(): void {
    if (this.focusTick) clearInterval(this.focusTick)
    this.focusTick = null
    this.countdownWatch.stop()
    this.snip.dispose()
    for (const id of ['quickAdd', 'snip'] as const) {
      const registered = this.registeredHotkeys[id]
      if (registered) globalShortcut.unregister(registered)
      this.registeredHotkeys[id] = null
    }
    this.destroyTray()
  }
}
