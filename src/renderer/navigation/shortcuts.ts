import { useEffect, useRef } from 'react'
import { dialogOpen, isTypingTarget } from '../utils/dom'

import { t } from '@shared/i18n'
import {
  SHORTCUTS,
  shortcutGroupLabelKey,
  shortcutLabelKey,
  type ShortcutDefinition,
  type ShortcutId
} from '@shared/shortcuts'

/**
 * The shortcut table's behaviour: lookups and the one keyboard handler. The
 * data lives in `src/shared/shortcuts.ts`, which the main process's menu
 * reads too and the user guide's shortcuts page is generated from
 * (`npm run docs:shortcuts`).
 */
export {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  shortcutGroups,
  type ShortcutDefinition,
  type ShortcutGroupId,
  type ShortcutId
} from '@shared/shortcuts'

/** What a shortcut does, in the interface language. */
export function shortcutLabel(id: string): string {
  return t(shortcutLabelKey(id))
}

/** Where a group of shortcuts works, in the interface language. */
export function shortcutGroupLabel(id: string): string {
  return t(shortcutGroupLabelKey(id))
}

export function shortcut(id: ShortcutId): ShortcutDefinition {
  return SHORTCUTS.find((entry) => entry.id === id)!
}

/** The keys of the n-th project tab (0-based): Ctrl+1 … Ctrl+9, none after. */
export function projectViewKeys(index: number): string | undefined {
  return index >= 0 && index < 9 ? `Ctrl+${index + 1}` : undefined
}

/** A shortcut handler. `project-view` receives the tab index (0-based). */
export type ShortcutHandler = (index: number) => void
export type ShortcutHandlers = Partial<Record<ShortcutId, ShortcutHandler>>

/** How long the second key of a "G then H" sequence may take. */
export const SEQUENCE_TIMEOUT_MS = 1000

interface Chord {
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

/** Key names a shortcut writes as a symbol, as the event names them. */
const KEY_NAMES: Record<string, string> = {
  Esc: 'escape',
  '→': 'arrowright',
  '←': 'arrowleft'
}

function parseChord(keys: string): Chord {
  const parts = keys.split(/\+(?!$)/)
  const key = parts[parts.length - 1]
  return {
    ctrl: parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key: KEY_NAMES[key] ?? key.toLowerCase()
  }
}

function matchesChord(event: KeyboardEvent, chord: Chord): boolean {
  const ctrl = event.ctrlKey || event.metaKey
  if (ctrl !== chord.ctrl || event.altKey !== chord.alt) return false
  // Shift is part of how some keys are typed ("?"), so only a letter chord
  // insists on it either way, unless the chord names Shift itself (Alt+Shift+→).
  if ((chord.shift || /^[a-z]$/.test(chord.key)) && event.shiftKey !== chord.shift) return false
  return event.key.toLowerCase() === chord.key
}

/**
 * What a key press means: a shortcut and its argument, or a sequence started.
 * Pure apart from the `pending` first key it is given, so it is testable.
 */
export function resolveShortcut(
  event: KeyboardEvent,
  pending: string | null
): { id: ShortcutId; index: number } | { pending: string } | null {
  for (const entry of SHORTCUTS as readonly ShortcutDefinition[]) {
    if (entry.since) continue
    const sequence = /^(\S+) then (\S+)$/.exec(entry.keys)
    if (sequence) {
      if (event.ctrlKey || event.metaKey || event.altKey) continue
      const [first, second] = [sequence[1].toLowerCase(), sequence[2].toLowerCase()]
      if (pending === first && event.key.toLowerCase() === second)
        return { id: entry.id as ShortcutId, index: 0 }
      continue
    }
    const range = /^Ctrl\+1–9$/.exec(entry.keys)
    if (range) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) continue
      const digit = Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9)
        return { id: entry.id as ShortcutId, index: digit - 1 }
      continue
    }
    if (matchesChord(event, parseChord(entry.keys))) return { id: entry.id as ShortcutId, index: 0 }
  }
  // A bare letter that starts a sequence. Compared as text: the key is
  // whatever was typed, and "*" or "(" in a pattern would throw.
  if (!event.ctrlKey && !event.metaKey && !event.altKey) {
    const key = event.key.toLowerCase()
    if (!/^[a-z]$/.test(key)) return null
    const starts = (SHORTCUTS as readonly ShortcutDefinition[]).some(
      (entry) => !entry.since && entry.keys.toLowerCase().startsWith(`${key} then `)
    )
    if (starts) return { pending: key }
  }
  return null
}

/**
 * Where a set of handlers belongs. When the application menu runs a shortcut
 * (`runShortcut`), the most specific handler wins: a project's over the app's.
 */
export type ShortcutScope = 'app' | 'project'

interface Registration {
  rank: number
  handlers: { current: ShortcutHandlers }
}

const registrations: Registration[] = []

/**
 * Which registration runs a shortcut: the most specific one with a handler
 * for it (a project's over the app's; among equals, the latest). The one rule
 * for a key press and for the menu alike.
 */
function chooseRegistration(id: ShortcutId): Registration | null {
  let chosen: Registration | null = null
  for (const registration of registrations) {
    if (!registration.handlers.current[id]) continue
    if (!chosen || registration.rank >= chosen.rank) chosen = registration
  }
  return chosen
}

/**
 * Runs a shortcut's handler as if its key were pressed, for the application
 * menu and the title bar's menu (P8.2): the project's handler if a project
 * registered one, else the app's. A menu choice is deliberate, so it runs
 * even while focus is in a text field. Returns whether anything handled it.
 */
export function runShortcut(id: ShortcutId, index = 0): boolean {
  const handler = chooseRegistration(id)?.handlers.current[id]
  if (!handler) return false
  handler(index)
  return true
}

/**
 * The one keyboard handler for the shortcut table. Each caller passes the
 * handlers it owns (the shell: palette, settings, sidebar, Home; a project
 * workspace: new task and its views). Shortcuts are ignored while typing and
 * while a dialog is open, unless their entry allows it.
 */
export function useShortcuts(handlers: ShortcutHandlers, scope: ShortcutScope = 'app'): void {
  const latest = useRef(handlers)
  latest.current = handlers
  const own = useRef<Registration | null>(null)

  useEffect(() => {
    const registration: Registration = { rank: scope === 'project' ? 1 : 0, handlers: latest }
    registrations.push(registration)
    own.current = registration
    return () => {
      registrations.splice(registrations.indexOf(registration), 1)
      if (own.current === registration) own.current = null
    }
  }, [scope])

  useEffect(() => {
    let pending: { key: string; at: number } | null = null
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      const live = pending && Date.now() - pending.at <= SEQUENCE_TIMEOUT_MS ? pending.key : null
      const result = resolveShortcut(event, live)
      pending = null
      if (!result) return
      const typing = isTypingTarget(event.target)
      const inDialog = dialogOpen()
      if ('pending' in result) {
        if (!typing && !inDialog) pending = { key: result.pending, at: Date.now() }
        return
      }
      const handler = latest.current[result.id]
      if (!handler) return
      // Every caller's listener hears the key. Only the registration the menu
      // would choose runs it: Ctrl+N in a project is that project's quick add,
      // whichever listener happened to be added first.
      if (own.current && chooseRegistration(result.id) !== own.current) return
      const entry = shortcut(result.id)
      if (typing && !entry.allowInText) return
      if (inDialog && !entry.allowInDialog) return
      event.preventDefault()
      handler(result.index)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
