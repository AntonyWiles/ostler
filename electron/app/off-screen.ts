import {
  dialog,
  Notification,
  shell,
  type BrowserWindow,
  type MessageBoxOptions,
  type NotificationConstructorOptions
} from 'electron'
import { OFF_SCREEN_ARGUMENT } from '@shared/off-screen-clipboard'
import { appLog } from './logging'

/**
 * An Ostler started by Playwright or another driver (it passes a remote-debugging
 * port, or OSTLER_OFF_SCREEN=1) keeps its windows left of every display and never
 * takes the focus, so tests and agents never get in the person's way.
 * OSTLER_ON_SCREEN=1 shows them anyway.
 *
 * This is the one switch: every way Ostler could otherwise put something in
 * front of the person (a window, a desktop notification, the taskbar, the
 * tray, a system dialog, another app) asks it. `window.ts` re-exports it.
 */
export const offScreen =
  process.env['OSTLER_ON_SCREEN'] !== '1' &&
  (process.env['OSTLER_OFF_SCREEN'] === '1' ||
    process.argv.some((arg) => arg.startsWith('--remote-debugging-port')))

/**
 * What every page Ostler opens is told about the switch (its
 * additionalArguments): off screen, its preload keeps the copy, cut and paste
 * keys to Ostler's own clipboard (`preload-clipboard.ts`).
 */
export function offScreenArguments(): string[] {
  return offScreen ? [OFF_SCREEN_ARGUMENT] : []
}

/**
 * Moves `win` left of all displays and shows it without focus or a taskbar
 * button (Windows gives a window its button when it is shown, so it is taken
 * away after), so no badge, progress or flash of it shows either.
 */
export function showOffScreen(win: BrowserWindow): void {
  // Required lazily: `screen` is only usable once the app is ready.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { screen } = require('electron') as typeof import('electron')
  const left = Math.min(...screen.getAllDisplays().map((display) => display.bounds.x))
  win.setPosition(left - win.getBounds().width - 200, 0)
  win.showInactive()
  win.setSkipTaskbar(true)
}

/**
 * The one way Ostler shows a Windows notification. Off screen none is shown
 * (it is logged instead) and this returns null; on screen it returns the
 * notification it showed, after `prepare` has wired its events. Only the
 * toast is skipped: callers still record Inbox items, rate limits and the
 * in-app notification, so that behaviour stays testable off screen.
 */
export function showDesktopNotification(
  options: NotificationConstructorOptions,
  prepare?: (notification: Notification) => void
): Notification | null {
  if (offScreen) {
    appLog.info(`Off screen: held back a desktop notification: ${options.title ?? ''}`)
    return null
  }
  if (!Notification.isSupported()) return null
  const notification = new Notification(options)
  prepare?.(notification)
  notification.show()
  return notification
}

/** Replaces `name` on `target`, writable and configurable, so a test can still stub it. */
function replace(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, configurable: true, writable: true })
}

/** `showMessageBox`'s options: the window argument is optional and comes first. */
function messageBoxOptions(args: unknown[]): MessageBoxOptions {
  const options = args.find(
    (arg) => arg !== null && typeof arg === 'object' && !('webContents' in arg)
  )
  return (options ?? { message: '' }) as MessageBoxOptions
}

/**
 * Off screen, Electron's system dialogs and the shell calls that open another
 * app answer as if the person cancelled or it opened, without showing
 * anything: an open or save dialog is cancelled, a message box gets its
 * cancel button, an error box and every link, file or folder Ostler would
 * open are logged. Installed once, first thing in main, so every caller (and
 * any added later) is covered. A test can still replace any of them with its
 * own answer, as the e2e suite and the monkey do. Nothing changes on screen.
 */
export function holdBackSystemUiOffScreen(): void {
  if (!offScreen) return
  const held = (what: string) => appLog.info(`Off screen: held back ${what}`)
  replace(dialog, 'showOpenDialog', async () => {
    held('an open dialog')
    return { canceled: true, filePaths: [] }
  })
  replace(dialog, 'showOpenDialogSync', () => {
    held('an open dialog')
    return undefined
  })
  replace(dialog, 'showSaveDialog', async () => {
    held('a save dialog')
    return { canceled: true, filePath: '' }
  })
  replace(dialog, 'showSaveDialogSync', () => {
    held('a save dialog')
    return undefined
  })
  replace(dialog, 'showMessageBox', async (...args: unknown[]) => {
    const options = messageBoxOptions(args)
    held(`a message box: ${options.message}`)
    return { response: options.cancelId ?? 0, checkboxChecked: options.checkboxChecked ?? false }
  })
  replace(dialog, 'showMessageBoxSync', (...args: unknown[]) => {
    const options = messageBoxOptions(args)
    held(`a message box: ${options.message}`)
    return options.cancelId ?? 0
  })
  replace(dialog, 'showErrorBox', (title: string, content: string) => {
    appLog.error(`Off screen: held back an error box: ${title}: ${content}`)
  })
  replace(dialog, 'showCertificateTrustDialog', async () => held('a certificate dialog'))
  replace(shell, 'openExternal', async (url: string) => held(`opening ${url}`))
  replace(shell, 'openPath', async (path: string) => {
    held(`opening ${path}`)
    return ''
  })
  replace(shell, 'showItemInFolder', (path: string) => held(`showing ${path} in its folder`))
  replace(shell, 'beep', () => held('a beep'))
}
