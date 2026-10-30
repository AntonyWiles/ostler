import type { MenuItemConstructorOptions } from 'electron'
import { SHORTCUTS, menuAccelerator, type ShortcutId } from '@shared/shortcuts'
import type { AppCommand, MenuContext, ThemeSetting } from '@shared/ostler-api'
import type { ZoomStep } from '@shared/zoom'
import { t } from '@shared/i18n'

/**
 * The application menu (P8.2), built from the shared shortcut table so a key
 * shown beside an item is the key that works. `buildMenuTemplate` is pure:
 * items carry the `AppCommand` they send instead of a click handler, and
 * `toElectronTemplate` wires the clicks. The title bar's menu button pops up
 * this same menu.
 *
 * Keys from the shortcut table are shown, not registered: the renderer's one
 * keyboard handler handles them (see src/shared/shortcuts.ts). The roles
 * (Edit, full screen, and Reload and DevTools in development) keep their own
 * keys. Zoom is main's own (P9.2): its items register their keys and carry a
 * `zoom` step, which main applies and saves as `ui.zoom`.
 */

export type MenuTemplateItem = Omit<MenuItemConstructorOptions, 'click' | 'submenu'> & {
  command?: AppCommand
  /** A zoom item: main changes the page zoom itself. */
  zoom?: ZoomStep
  submenu?: MenuTemplateItem[]
}

export interface MenuTemplateOptions {
  context: MenuContext
  theme: ThemeSetting
  /** Reload and DevTools appear only in development. */
  isDev: boolean
}

function keysOf(id: ShortcutId): string {
  return SHORTCUTS.find((entry) => entry.id === id)?.keys ?? ''
}

/** A menu item that runs a shortcut's handler, showing its key without registering it. */
function shortcutItem(id: ShortcutId, label: string): MenuTemplateItem {
  const accelerator = menuAccelerator(keysOf(id))
  return {
    label,
    command: { kind: 'shortcut', id },
    ...(accelerator ? { accelerator, registerAccelerator: false } : {})
  }
}

/** A menu-only command shown with a shortcut's key, which the renderer handles itself. */
function commandItem(id: ShortcutId, command: AppCommand, label: string): MenuTemplateItem {
  const accelerator = menuAccelerator(keysOf(id))
  return { label, command, ...(accelerator ? { accelerator, registerAccelerator: false } : {}) }
}

/** A zoom item, with the table's key registered: nothing else handles zoom keys. */
function zoomItem(zoom: ZoomStep, label: string, id: ShortcutId): MenuTemplateItem {
  const accelerator = menuAccelerator(keysOf(id))
  return { label, zoom, ...(accelerator ? { accelerator } : {}) }
}

/**
 * The same steps on the other keys people press for them: Ctrl++ (Shift and
 * =) and the number pad. Hidden, so the menu shows one key per item.
 */
const ZOOM_ALTERNATIVES: MenuTemplateItem[] = [
  {
    get label() {
      return t('desktop:appMenu.zoomIn')
    },
    zoom: 'in',
    accelerator: 'CmdOrCtrl+Plus',
    visible: false
  },
  {
    get label() {
      return t('desktop:appMenu.zoomIn')
    },
    zoom: 'in',
    accelerator: 'CmdOrCtrl+numadd',
    visible: false
  },
  {
    get label() {
      return t('desktop:appMenu.zoomOut')
    },
    zoom: 'out',
    accelerator: 'CmdOrCtrl+numsub',
    visible: false
  },
  {
    get label() {
      return t('desktop:appMenu.resetZoom')
    },
    zoom: 'reset',
    accelerator: 'CmdOrCtrl+num0',
    visible: false
  }
]

const separator: MenuTemplateItem = { type: 'separator' }

const THEMES: { value: ThemeSetting; label: string }[] = [
  {
    value: 'system',
    get label() {
      return t('desktop:appMenu.system')
    }
  },
  {
    value: 'light',
    get label() {
      return t('desktop:appMenu.light')
    }
  },
  {
    value: 'dark',
    get label() {
      return t('desktop:appMenu.dark')
    }
  }
]

export function buildMenuTemplate({
  context,
  theme,
  isDev
}: MenuTemplateOptions): MenuTemplateItem[] {
  const inProject = context.project !== null
  const file: MenuTemplateItem = {
    label: t('desktop:appMenu.menu.file'),
    submenu: [
      shortcutItem('new-task', t('desktop:appMenu.newTask')),
      shortcutItem('quick-add', t('desktop:appMenu.quickAdd')),
      { label: t('desktop:appMenu.newProject'), command: { kind: 'new-project' } },
      separator,
      { label: t('desktop:appMenu.import'), command: { kind: 'import' } },
      { label: t('desktop:appMenu.export'), command: { kind: 'export' }, enabled: inProject },
      { label: t('desktop:appMenu.print'), command: { kind: 'print' }, enabled: context.printable },
      separator,
      shortcutItem('settings', t('desktop:appMenu.settings')),
      separator,
      { role: 'quit', label: t('desktop:appMenu.exit') }
    ]
  }
  const edit: MenuTemplateItem = {
    label: t('desktop:appMenu.menu.edit'),
    submenu: [
      // The app's undo history, or the text field's own undo while one has focus.
      commandItem('undo', { kind: 'undo' }, t('desktop:appMenu.edit.undo')),
      commandItem('redo', { kind: 'redo' }, t('desktop:appMenu.edit.redo')),
      commandItem('undo-history', { kind: 'undo-history' }, t('desktop:appMenu.edit.undoHistory')),
      separator,
      { role: 'cut', label: t('desktop:appMenu.edit.cut') },
      { role: 'copy', label: t('desktop:appMenu.edit.copy') },
      { role: 'paste', label: t('desktop:appMenu.edit.paste') },
      { role: 'delete', label: t('desktop:appMenu.edit.delete') },
      separator,
      { role: 'selectAll', label: t('desktop:appMenu.edit.selectAll') }
    ]
  }
  const view: MenuTemplateItem = {
    label: t('desktop:appMenu.menu.view'),
    submenu: [
      shortcutItem('go-home', t('desktop:appMenu.home')),
      shortcutItem('go-inbox', t('desktop:appMenu.inbox')),
      shortcutItem('go-my-work', t('desktop:appMenu.myWork')),
      shortcutItem('sidebar', t('desktop:appMenu.toggleSidebar')),
      separator,
      {
        label: t('desktop:appMenu.theme'),
        submenu: THEMES.map((choice) => ({
          label: choice.label,
          type: 'radio' as const,
          checked: theme === choice.value,
          command: { kind: 'theme' as const, theme: choice.value }
        }))
      },
      separator,
      zoomItem('in', t('desktop:appMenu.zoomIn'), 'zoom-in'),
      zoomItem('out', t('desktop:appMenu.zoomOut'), 'zoom-out'),
      zoomItem('reset', t('desktop:appMenu.resetZoom'), 'zoom-reset'),
      ...ZOOM_ALTERNATIVES,
      separator,
      { role: 'togglefullscreen', label: t('desktop:appMenu.fullScreen') },
      ...(isDev
        ? [
            separator,
            { role: 'reload' as const, label: t('desktop:appMenu.reload') },
            { role: 'toggleDevTools' as const, label: t('desktop:appMenu.developerTools') }
          ]
        : [])
    ]
  }
  const go: MenuTemplateItem = {
    label: t('desktop:appMenu.menu.go'),
    submenu: [
      shortcutItem('palette', t('desktop:appMenu.search')),
      separator,
      ...(inProject
        ? context.views.map((entry) => {
            const accelerator = entry.keys ? menuAccelerator(entry.keys) : null
            return {
              label: entry.label,
              command: { kind: 'open-view' as const, view: entry.id },
              ...(accelerator ? { accelerator, registerAccelerator: false } : {})
            }
          })
        : [{ label: t('desktop:appMenu.openProjectGoViews'), enabled: false }])
    ]
  }
  const help: MenuTemplateItem = {
    label: t('desktop:appMenu.menu.help'),
    submenu: [
      { label: t('desktop:appMenu.userGuide'), command: { kind: 'user-guide' } },
      shortcutItem('shortcut-help', t('desktop:appMenu.keyboardShortcuts')),
      { label: t('desktop:appMenu.whatsNew'), command: { kind: 'whats-new' } },
      separator,
      { label: t('desktop:appMenu.reportProblem'), command: { kind: 'report-problem' } },
      { label: t('desktop:appMenu.copyDiagnostics'), command: { kind: 'copy-diagnostics' } },
      separator,
      { label: t('desktop:appMenu.about'), command: { kind: 'about' } }
    ]
  }
  return [file, edit, view, go, help]
}

/** Wires each item's command to `send`, and each zoom item to `zoom`, for `Menu.buildFromTemplate`. */
export function toElectronTemplate(
  items: MenuTemplateItem[],
  send: (command: AppCommand) => void,
  zoom: (step: ZoomStep) => void = () => {}
): MenuItemConstructorOptions[] {
  return items.map(({ command, zoom: step, submenu, ...item }) => ({
    ...item,
    ...(command ? { click: () => send(command) } : {}),
    ...(step ? { click: () => zoom(step) } : {}),
    ...(submenu ? { submenu: toElectronTemplate(submenu, send, zoom) } : {})
  }))
}

/**
 * The menu without its enabled states, as JSON: two templates of the same
 * shape differ only in which items are enabled, which can be set on the
 * installed menu without installing a new one.
 */
export function menuShape(items: MenuTemplateItem[]): string {
  const strip = (list: MenuTemplateItem[]): unknown[] =>
    list.map(({ enabled: _enabled, submenu, ...item }) => ({
      ...item,
      ...(submenu ? { submenu: strip(submenu) } : {})
    }))
  return JSON.stringify(strip(items))
}

/** The part of an installed menu item `setMenuEnabled` touches. */
export interface EnablableMenuItem {
  enabled: boolean
  submenu?: { items: EnablableMenuItem[] } | null
}

/** Sets each installed item's enabled state from a template of the same shape. */
export function setMenuEnabled(items: EnablableMenuItem[], template: MenuTemplateItem[]): void {
  template.forEach((entry, index) => {
    const item = items[index]
    if (!item) return
    const enabled = entry.enabled ?? true
    if (item.enabled !== enabled) item.enabled = enabled
    if (entry.submenu && item.submenu) setMenuEnabled(item.submenu.items, entry.submenu)
  })
}
