import type { ShortcutId } from '../shortcuts'
import type { ThemeSetting } from './appearance-types'
import { t } from '../i18n'

/**
 * Windows integration (P8.2): the application menu's commands, what the
 * renderer tells main about where the person is, the title bar's colours, the
 * taskbar badge and the desktop settings.
 */

/**
 * A command from the application menu, the title bar's menu button or the
 * tray, sent to the renderer on one channel (`ON_APP_COMMAND`). `shortcut`
 * commands run the same handler their key does (`useShortcuts`); the rest
 * are menu-only actions.
 */
export type AppCommand =
  | { kind: 'shortcut'; id: ShortcutId }
  | { kind: 'open-view'; view: string }
  | { kind: 'theme'; theme: ThemeSetting }
  | {
      kind:
        | 'new-project'
        | 'import'
        | 'export'
        | 'print'
        | 'user-guide'
        | 'whats-new'
        | 'report-problem'
        | 'copy-diagnostics'
        | 'about'
        // The undo history: in a text field, Undo and Redo undo its typing instead.
        | 'undo'
        | 'redo'
        | 'undo-history'
    }

/** A project view as the menu's Go list shows it. */
export interface MenuView {
  id: string
  label: string
  /** Its key, "Ctrl+1" to "Ctrl+9" for the first nine tabs. */
  keys?: string
}

/**
 * Where the person is, sent by the renderer whenever it changes
 * (`setMenuContext`): the menu's Go list and enabled items follow it, and
 * deep links check views against `viewIds`, the registry's whole list.
 */
export interface MenuContext {
  /** The open project, or null outside one. */
  project: { id: string; name: string } | null
  /** The open project's views, tabs first, in order. Empty outside a project. */
  views: MenuView[]
  /** Every project view id the registry knows. */
  viewIds: string[]
  /** The current view can be printed (List, Overview, Timeline). */
  printable: boolean
  /** The projects opened most recently, most recent first: the jump list's Recent projects. */
  recentProjectIds: string[]
}

export const EMPTY_MENU_CONTEXT: MenuContext = {
  project: null,
  views: [],
  viewIds: [],
  printable: false,
  recentProjectIds: []
}

/** The custom title bar's height: its own window buttons fill it. */
export const TITLE_BAR_HEIGHT = 36

/** The custom title bar's window buttons: Minimise, Maximise or Restore, and Close. */
export type WindowControl = 'minimize' | 'toggle-maximize' | 'close'

export const WINDOW_CONTROLS: readonly WindowControl[] = ['minimize', 'toggle-maximize', 'close']

/** What the Maximise button shows: Restore while the window fills the screen. */
export interface WindowState {
  maximized: boolean
  fullScreen: boolean
}

/** The taskbar badge's label for an unread count: none at zero, then 1 to 9, then "9+". */
export function badgeText(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null
  return count > 9 ? '9+' : String(Math.floor(count))
}

/** Settings › General › Windows (P8.2). */
export interface DesktopSettings {
  /** Use Windows' own title bar and menu bar instead of Ostler's. Applies at the next start. */
  nativeTitleBar: boolean
  /** Closing the window hides it to the notification area; reminders and agents keep running. */
  backgroundMode: boolean
  /** Start when the person signs in to Windows (hidden, when background mode is on). */
  startAtLogin: boolean
  /** A system-wide key for Quick add, registered only while this is on. */
  quickAddHotkeyEnabled: boolean
  /** That key, as an accelerator ("Ctrl+Alt+N"). */
  quickAddHotkey: string
  /** A system-wide key for Snip to task (N4.2a), registered only while this is on. */
  snipHotkeyEnabled: boolean
  /** That key, as an accelerator ("Ctrl+Alt+S"); never the Quick add key. */
  snipHotkey: string
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  nativeTitleBar: false,
  backgroundMode: false,
  startAtLogin: false,
  quickAddHotkeyEnabled: false,
  quickAddHotkey: 'Ctrl+Alt+N',
  snipHotkeyEnabled: false,
  snipHotkey: 'Ctrl+Alt+S'
}

/**
 * Whether a system-wide hotkey is one Ostler accepts: Ctrl and/or Alt (with
 * Shift if wanted) plus a letter, digit or F-key. A bare key or Shift alone
 * would take a key away from every other app.
 */
export function isValidHotkey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 32) return false
  const parts = value.split('+')
  const key = parts.pop() ?? ''
  if (!/^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4]))$/.test(key)) return false
  const allowed = ['Ctrl', 'Alt', 'Shift']
  if (parts.some((part) => !allowed.includes(part))) return false
  if (new Set(parts).size !== parts.length) return false
  return parts.includes('Ctrl') || parts.includes('Alt')
}

/** The desktop settings with every field present and valid; anything else falls back to the default. */
export function normalizeDesktopSettings(value: unknown): DesktopSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const flag = (key: keyof DesktopSettings): boolean =>
    typeof raw[key] === 'boolean'
      ? (raw[key] as boolean)
      : (DEFAULT_DESKTOP_SETTINGS[key] as boolean)
  return {
    nativeTitleBar: flag('nativeTitleBar'),
    backgroundMode: flag('backgroundMode'),
    startAtLogin: flag('startAtLogin'),
    quickAddHotkeyEnabled: flag('quickAddHotkeyEnabled'),
    quickAddHotkey: isValidHotkey(raw.quickAddHotkey)
      ? raw.quickAddHotkey
      : DEFAULT_DESKTOP_SETTINGS.quickAddHotkey,
    snipHotkeyEnabled: flag('snipHotkeyEnabled'),
    snipHotkey: isValidHotkey(raw.snipHotkey) ? raw.snipHotkey : DEFAULT_DESKTOP_SETTINGS.snipHotkey
  }
}

/**
 * Rejects a desktop settings change the person must hear about before it is
 * stored. With `current`, also refuses a change that would give Snip to task
 * (N4.2a) the Quick add key, or the other way round.
 */
export function assertValidDesktopUpdate(
  update: Partial<DesktopSettings> | undefined,
  current?: DesktopSettings
): void {
  if (!update) return
  for (const key of [
    'nativeTitleBar',
    'backgroundMode',
    'startAtLogin',
    'quickAddHotkeyEnabled',
    'snipHotkeyEnabled'
  ] as const) {
    if (update[key] !== undefined && typeof update[key] !== 'boolean') {
      throw new Error(t('errors:desktopTypes.eitherOff', { key }))
    }
  }
  if (update.quickAddHotkey !== undefined && !isValidHotkey(update.quickAddHotkey)) {
    throw new Error(t('errors:desktopTypes.useCtrlAltShift'))
  }
  if (update.snipHotkey !== undefined && !isValidHotkey(update.snipHotkey)) {
    throw new Error(t('errors:desktopTypes.useCtrlAltShift'))
  }
  const quickAdd = update.quickAddHotkey ?? current?.quickAddHotkey
  const snip = update.snipHotkey ?? current?.snipHotkey
  if (
    (update.quickAddHotkey !== undefined || update.snipHotkey !== undefined) &&
    quickAdd !== undefined &&
    snip !== undefined &&
    sameHotkey(quickAdd, snip)
  ) {
    throw new Error(t('errors:desktopTypes.snipSameAsQuickAdd'))
  }
}

/** Two accelerators name the same keys, whatever order the modifiers are written in. */
export function sameHotkey(a: string, b: string): boolean {
  const keys = (value: string) => value.split('+').sort().join('+')
  return keys(a) === keys(b)
}

const VIEW_ID = /^[a-z][a-z-]{0,31}$/

function shortText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}

/**
 * A menu context from the renderer, checked before main uses it: anything
 * malformed is dropped, so the menu and deep links only ever see plain ids
 * and short labels.
 */
export function normalizeMenuContext(value: unknown): MenuContext {
  if (typeof value !== 'object' || value === null) return EMPTY_MENU_CONTEXT
  const raw = value as Record<string, unknown>
  const project = raw.project as Record<string, unknown> | null | undefined
  const projectId = project ? shortText(project.id, 64) : null
  const projectName = project ? shortText(project.name, 200) : null
  const list = (items: unknown, max: number): unknown[] =>
    Array.isArray(items) ? items.slice(0, max) : []
  const views: MenuView[] = []
  for (const item of list(raw.views, 40)) {
    const entry = (item ?? {}) as Record<string, unknown>
    const id = shortText(entry.id, 32)
    const label = shortText(entry.label, 60)
    if (!id || !VIEW_ID.test(id) || !label) continue
    const keys = shortText(entry.keys, 16)
    views.push(keys && /^Ctrl\+[1-9]$/.test(keys) ? { id, label, keys } : { id, label })
  }
  return {
    project: projectId && projectName ? { id: projectId, name: projectName } : null,
    views,
    viewIds: list(raw.viewIds, 40).filter(
      (id): id is string => typeof id === 'string' && VIEW_ID.test(id)
    ),
    printable: raw.printable === true,
    recentProjectIds: list(raw.recentProjectIds, 10).filter(
      (id): id is string => typeof id === 'string' && id.length <= 64
    )
  }
}
