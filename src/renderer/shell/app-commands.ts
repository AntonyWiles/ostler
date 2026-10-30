import { useEffect, useRef } from 'react'
import type { AppCommand } from '@shared/ostler-api'
import { runShortcut, type ShortcutScope } from '../navigation/shortcuts'

/**
 * Commands from the application menu, the title bar's menu button and the
 * tray (P8.2), all arriving on one channel (`onAppCommand`). A shortcut
 * command runs the same handler as its key (`runShortcut`); the menu-only
 * ones go to whoever registered for them here, a project's handlers before
 * the app's, as with shortcuts.
 */

type MenuCommand = Exclude<AppCommand, { kind: 'shortcut' }>

export type AppCommandHandlers = {
  [Kind in MenuCommand['kind']]?: (command: Extract<MenuCommand, { kind: Kind }>) => void
}

interface Registration {
  rank: number
  handlers: { current: AppCommandHandlers }
}

const registrations: Registration[] = []

/** Runs a command. Returns whether anything handled it. */
export function runAppCommand(command: AppCommand): boolean {
  if (command.kind === 'shortcut') return runShortcut(command.id)
  let chosen: Registration | null = null
  for (const registration of registrations) {
    if (!registration.handlers.current[command.kind]) continue
    if (!chosen || registration.rank >= chosen.rank) chosen = registration
  }
  const handler = chosen?.handlers.current[command.kind] as
    ((command: MenuCommand) => void) | undefined
  if (!handler) return false
  handler(command)
  return true
}

/** Registers the menu commands this component handles while it is mounted. */
export function useAppCommands(handlers: AppCommandHandlers, scope: ShortcutScope = 'app'): void {
  const latest = useRef(handlers)
  latest.current = handlers
  useEffect(() => {
    const registration: Registration = { rank: scope === 'project' ? 1 : 0, handlers: latest }
    registrations.push(registration)
    return () => {
      registrations.splice(registrations.indexOf(registration), 1)
    }
  }, [scope])
}

/** Listens for commands from main for the life of the shell. */
export function useAppCommandChannel(): void {
  useEffect(() => window.ostlerAPI.onAppCommand?.((command) => void runAppCommand(command)), [])
}
