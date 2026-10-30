/** Settings › About › Updates (P10.1, roadmap D13). */
export interface UpdateSettings {
  /** Look for a new version at start-up. "Check now" works either way. */
  checkAutomatically: boolean
  /** Download a found update in the background; otherwise the person starts it. */
  downloadAutomatically: boolean
  /** Also offer pre-releases (`allowPrerelease`). */
  receiveBeta: boolean
}

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  checkAutomatically: true,
  downloadAutomatically: true,
  receiveBeta: false
}

/** The update settings with every field a boolean; anything else falls back to the default. */
export function normalizeUpdateSettings(value: unknown): UpdateSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const flag = (key: keyof UpdateSettings): boolean =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : DEFAULT_UPDATE_SETTINGS[key]
  return {
    checkAutomatically: flag('checkAutomatically'),
    downloadAutomatically: flag('downloadAutomatically'),
    receiveBeta: flag('receiveBeta')
  }
}

/** Why this copy of Ostler never looks for updates. */
export type UpdatesOffReason = 'development' | 'portable'

/**
 * Where updating stands (`UpdateService`). The renderer shows it in
 * Settings › About and turns `ready` into a toast; the Inbox has its own item.
 */
export type UpdateState =
  | { status: 'off'; reason: UpdatesOffReason }
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date'; checkedAt: number }
  | { status: 'available'; version: string; notes: string }
  | { status: 'downloading'; version: string; notes: string; percent: number }
  | {
      status: 'ready'
      version: string
      notes: string
      /** How many agents are working now: a restart would stop them. */
      agentsRunning: number
      /** The person chose "Restart when agents finish". */
      restartWhenAgentsFinish: boolean
    }
  | { status: 'error'; message: string }

/** `restartToUpdate`: now, or once no agent is working. */
export type RestartToUpdateMode = 'now' | 'when-agents-finish'
