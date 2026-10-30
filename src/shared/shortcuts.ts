/**
 * The shortcut table as
 * plain data, with no imports, so `scripts/generate-shortcuts-doc.cjs` can
 * read it to write the user guide's shortcuts page. The renderer's handlers,
 * the `?` overlay and tooltips read it through
 * `src/renderer/navigation/shortcuts.ts`; the main process's application menu
 * (`electron/app/desktop/app-menu.ts`) and the title bar's menu button read it
 * directly (P8.2). One table, so a key shown in a menu is the key that works.
 *
 * Who handles a key: the renderer's one keyboard handler (`useShortcuts`)
 * handles every entry here. The menu only shows these keys beside its items
 * and does not register them, so a key never fires twice. The exceptions are
 * the keys only the menu implements: zoom, full screen and, in development,
 * reload and DevTools.
 *
 * The words are not here: each entry's label is the key
 * `navigation:shortcuts.<id>`, and each group's `navigation:shortcutGroups.<id>`,
 * in src/shared/locales (P11.1). The keys are written in English ("Ctrl+K",
 * "G then H"); the renderer translates key names and joining words as it
 * shows them.
 *
 * Ctrl+Z: in a text field, the browser's own undo undoes typing. Everywhere
 * else it is the app's undo: the `undo` entry below undoes the last action
 * while its toast is shown, or a task drawer's last saved change while the
 * drawer is open, and otherwise the newest step of the undo history
 * (`ChangeHistoryProvider`, which handles Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z
 * itself, after the toast and the drawer). `undo` and `redo` are not allowed
 * in text fields for that reason, so the two never compete.
 */

/** Where a shortcut works, in the order the overlay and the user guide list them. */
export const SHORTCUT_GROUPS = [
  { id: 'anywhere' },
  { id: 'project' },
  { id: 'tasks' },
  { id: 'dates' },
  { id: 'library' }
] as const

export type ShortcutGroupId = (typeof SHORTCUT_GROUPS)[number]['id']

export interface ShortcutDefinition {
  id: string
  /** As `Kbd` shows it: "Ctrl+K", "G then H". */
  keys: string
  /** Where it works. */
  group: ShortcutGroupId
  /** The package that builds it, for entries not handled yet. Hidden from the overlay and the guide. */
  since?: string
  /** Also fires while focus is in a text field. */
  allowInText?: boolean
  /** Also fires while a dialog is open. */
  allowInDialog?: boolean
}

export const SHORTCUTS = [
  {
    id: 'palette',
    keys: 'Ctrl+K',
    group: 'anywhere',
    allowInText: true,
    allowInDialog: true
  },
  {
    id: 'new-task',
    keys: 'Ctrl+N',
    group: 'anywhere',
    allowInText: true
  },
  {
    id: 'quick-add',
    keys: 'Ctrl+Shift+N',
    group: 'anywhere',
    allowInText: true
  },
  { id: 'settings', keys: 'Ctrl+,', group: 'anywhere', allowInText: true },
  { id: 'sidebar', keys: 'Ctrl+B', group: 'anywhere' },
  { id: 'go-home', keys: 'G then H', group: 'anywhere' },
  { id: 'go-inbox', keys: 'G then I', group: 'anywhere' },
  { id: 'go-my-work', keys: 'G then M', group: 'anywhere' },
  {
    id: 'focus-search',
    keys: '/',
    group: 'anywhere'
  },
  { id: 'shortcut-help', keys: '?', group: 'anywhere' },
  {
    id: 'undo',
    keys: 'Ctrl+Z',
    group: 'anywhere'
  },
  { id: 'redo', keys: 'Ctrl+Y', group: 'anywhere' },
  { id: 'undo-history', keys: 'G then U', group: 'anywhere' },
  {
    id: 'escape',
    keys: 'Esc',
    group: 'anywhere'
  },
  { id: 'project-view', keys: 'Ctrl+1–9', group: 'project' },
  { id: 'find-replace', keys: 'Ctrl+H', group: 'project', allowInText: true },
  { id: 'next-task', keys: 'J', group: 'tasks' },
  { id: 'open-task', keys: 'Enter', group: 'tasks' },
  {
    id: 'plan-indent',
    keys: 'Alt+Shift+→',
    group: 'tasks',
    allowInText: true,
    allowInDialog: true
  },
  {
    id: 'plan-outdent',
    keys: 'Alt+Shift+←',
    group: 'tasks',
    allowInText: true,
    allowInDialog: true
  },
  { id: 'move-task-order', keys: 'Alt+Up or Down', group: 'tasks' },
  { id: 'move-task-column', keys: 'Alt+Left or Right', group: 'tasks' },
  { id: 'move-task-matrix', keys: 'Shift+Up or Down', group: 'tasks' },
  { id: 'select-task', keys: 'X', group: 'tasks' },
  { id: 'edit-title', keys: 'E', group: 'tasks' },
  { id: 'delete-task', keys: 'Delete', group: 'tasks' },
  { id: 'calendar-today', keys: 'T', group: 'dates' },
  {
    id: 'move-task-date',
    keys: 'Alt+Arrow keys',
    group: 'dates'
  },
  {
    id: 'move-task-due',
    keys: 'Alt+Shift+Left or Right',
    group: 'dates'
  },
  {
    id: 'move-task-start',
    keys: 'Alt+Ctrl+Left or Right',
    group: 'dates'
  },
  { id: 'library-search', keys: 'Ctrl+F', group: 'library' },
  {
    id: 'library-make-task',
    keys: 'Ctrl+Shift+K',
    group: 'library',
    allowInText: true,
    allowInDialog: true
  },
  { id: 'zoom-in', keys: 'Ctrl+=', group: 'anywhere' },
  { id: 'zoom-out', keys: 'Ctrl+-', group: 'anywhere' },
  { id: 'zoom-reset', keys: 'Ctrl+0', group: 'anywhere' }
] as const satisfies readonly ShortcutDefinition[]

export type ShortcutId = (typeof SHORTCUTS)[number]['id']

/** The shortcuts that work today, grouped by where, in table order. */
export function shortcutGroups(): {
  id: ShortcutGroupId
  shortcuts: ShortcutDefinition[]
}[] {
  const live = (SHORTCUTS as readonly ShortcutDefinition[]).filter((entry) => !entry.since)
  return SHORTCUT_GROUPS.map((group) => ({
    ...group,
    shortcuts: live.filter((entry) => entry.group === group.id)
  })).filter((group) => group.shortcuts.length > 0)
}

/**
 * Mark up a picture (N4.2b): the editor's own keys. They work only while the
 * editor is open and focus is not in one of its fields, so the app-wide
 * handler above never sees them. Kept here so the editor's buttons, their
 * tooltips and the user guide read one list. Each label is the key
 * `navigation:markupShortcuts.<id>`; the tools' ids are the editor's tools.
 */
export const MARKUP_SHORTCUTS = [
  { id: 'select', keys: 'V' },
  { id: 'arrow', keys: 'A' },
  { id: 'box', keys: 'R' },
  { id: 'highlight', keys: 'H' },
  { id: 'text', keys: 'T' },
  { id: 'blur', keys: 'B' },
  { id: 'undo', keys: 'Ctrl+Z' },
  { id: 'redo', keys: 'Ctrl+Y' },
  { id: 'next-mark', keys: 'Tab' },
  { id: 'move', keys: 'Arrow keys' },
  { id: 'move-far', keys: 'Shift+Arrow keys' },
  { id: 'resize', keys: 'Alt+Arrow keys' },
  { id: 'delete', keys: 'Delete' }
] as const

export type MarkupShortcutId = (typeof MARKUP_SHORTCUTS)[number]['id']

/** The translation key of a mark-up key's label. */
export function markupShortcutLabelKey(id: string): string {
  return `navigation:markupShortcuts.${id}`
}

/**
 * Whiteboards (plan `docs/plans/whiteboards/`, D14, D26, D27): the editor's own
 * keys. Like the mark-up keys, they work only while focus is inside the
 * whiteboard editor and not in one of its fields, and the editor stops them
 * from reaching the app-wide handler. Each label is the key
 * `navigation:whiteboardShortcuts.<id>`; a tool's id is the editor's tool id.
 * Later prompts append rows; keep this order.
 */
export const WHITEBOARD_SHORTCUTS = [
  { id: 'select', keys: 'V' },
  { id: 'hand', keys: 'H' },
  { id: 'pan', keys: 'Space+drag' },
  { id: 'next-object', keys: 'Tab' },
  { id: 'previous-object', keys: 'Shift+Tab' },
  { id: 'move', keys: 'Arrow keys' },
  { id: 'move-far', keys: 'Shift+Arrow keys' },
  { id: 'resize', keys: 'Alt+Arrow keys' },
  { id: 'resize-far', keys: 'Shift+Alt+Arrow keys' },
  { id: 'free-move', keys: 'Alt+drag' },
  { id: 'keep-ratio', keys: 'Shift+drag' },
  { id: 'select-all', keys: 'Ctrl+A' },
  { id: 'deselect', keys: 'Escape' },
  { id: 'context-menu', keys: 'Shift+F10' },
  { id: 'delete', keys: 'Delete' },
  { id: 'undo', keys: 'Ctrl+Z' },
  { id: 'redo', keys: 'Ctrl+Y' },
  { id: 'zoom-in', keys: '+' },
  { id: 'zoom-out', keys: '-' },
  { id: 'zoom-fit', keys: 'Shift+1' },
  { id: 'zoom-reset', keys: 'Shift+0' },
  { id: 'note', keys: 'N' },
  { id: 'text', keys: 'T' },
  { id: 'place', keys: 'Enter' },
  { id: 'edit-text', keys: 'Enter' },
  { id: 'finish-text', keys: 'Ctrl+Enter' },
  { id: 'duplicate', keys: 'Ctrl+D' },
  { id: 'copy', keys: 'Ctrl+C' },
  { id: 'cut', keys: 'Ctrl+X' },
  { id: 'paste', keys: 'Ctrl+V' },
  { id: 'group', keys: 'Ctrl+G' },
  { id: 'ungroup', keys: 'Ctrl+Shift+G' },
  { id: 'pick-in-group', keys: 'Ctrl+click' },
  { id: 'bring-forward', keys: 'Ctrl+]' },
  { id: 'send-backward', keys: 'Ctrl+[' },
  { id: 'bring-to-front', keys: 'Ctrl+Shift+]' },
  { id: 'send-to-back', keys: 'Ctrl+Shift+[' },
  { id: 'pen', keys: 'P' },
  { id: 'marker', keys: 'M' },
  { id: 'eraser', keys: 'E' },
  { id: 'shape', keys: 'S' },
  { id: 'frame', keys: 'F' },
  { id: 'draw-square', keys: 'Shift+drag' },
  { id: 'connector', keys: 'A' },
  { id: 'node', keys: 'J' },
  { id: 'connect-to', keys: 'C' },
  { id: 'picture', keys: 'I' },
  { id: 'paste-lines', keys: 'Ctrl+Shift+V' },
  { id: 'link', keys: 'L' },
  { id: 'open-link', keys: 'O' },
  { id: 'make-tasks', keys: 'K' },
  { id: 'mindmap', keys: 'B' },
  { id: 'mind-map-child', keys: 'Tab or Insert' },
  { id: 'mind-map-sibling', keys: 'Enter' },
  { id: 'mind-map-new-line', keys: 'Shift+Enter' },
  { id: 'mind-map-navigate', keys: 'Arrow keys' },
  { id: 'mind-map-move', keys: 'Shift+Arrow keys' }
] as const

export type WhiteboardShortcutId = (typeof WHITEBOARD_SHORTCUTS)[number]['id']

/** The translation key of a whiteboard key's label. */
export function whiteboardShortcutLabelKey(id: string): string {
  return `navigation:whiteboardShortcuts.${id}`
}

/**
 * An entry's keys as an Electron accelerator ("Ctrl+K" → "CmdOrCtrl+K"), or
 * null for keys a menu does not show: sequences ("G then H"), ranges
 * ("Ctrl+1–9"), alternatives, and single keys ("?", "J"), which work only
 * outside text fields.
 */
export function menuAccelerator(keys: string): string | null {
  if (/ (then|or) |–/.test(keys) || !/^(Ctrl|Alt)\+./.test(keys)) return null
  const parts = keys.split(/\+(?!$)/)
  const names: Record<string, string> = { Ctrl: 'CmdOrCtrl', Esc: 'Escape' }
  return parts.map((part) => names[part] ?? part).join('+')
}

/** The translation key of a shortcut's label. */
export function shortcutLabelKey(id: string): string {
  return `navigation:shortcuts.${id}`
}

/** The translation key of a shortcut group's heading. */
export function shortcutGroupLabelKey(id: string): string {
  return `navigation:shortcutGroups.${id}`
}
