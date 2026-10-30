import { useState } from 'react'

export type PlanningRun = <T>(
  fallback: string,
  action: () => Promise<T>,
  options?: { onFailure?: () => void; subject?: string }
) => Promise<T | undefined>

/**
 * The workspace's busy flag and error line, and the one shape every mutating
 * action shares. Depends on nothing; every other planning hook may use it.
 */
export function usePlanningRunner() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * Which record the running mutation is acting on, when it acts on one.
   * `busy` is workspace-wide, and the board and the goal list render the same
   * control once per record, so reading `busy` alone made every card say
   * "Starting..." because one of them was.
   */
  const [busySubject, setBusySubject] = useState<string | null>(null)

  /**
   * Raise a busy flag, clear the last error, run the call, and turn any
   * failure into text the board can show -- `fallback` when the failure
   * carries no message of its own. `onFailure` runs before that message is
   * shown, for the actions that update the board optimistically and have to
   * roll it back; `subject` names the record being acted on, for controls
   * rendered once per record.
   *
   * Returns the action's value, or undefined when it threw, so a caller that
   * reports success to its own caller can end with `?? false` / `?? null`.
   */
  const runWith =
    (setFlag: (value: boolean) => void, tracksSubject = false): PlanningRun =>
    async (fallback, action, options = {}) => {
      setFlag(true)
      if (tracksSubject) setBusySubject(options.subject ?? null)
      setError(null)
      try {
        return await action()
      } catch (actionError) {
        options.onFailure?.()
        setError(actionError instanceof Error ? actionError.message : fallback)
        return undefined
      } finally {
        setFlag(false)
        // Only the runner that owns `busy` owns the subject, so a long-running
        // improve call finishing cannot clear the label off a card that a
        // different action is still working on.
        if (tracksSubject) setBusySubject(null)
      }
    }
  const runBusy = runWith(setBusy, true)

  /**
   * True only for the record this mutation was started from. Controls rendered
   * once per card or per goal ask this instead of `busy`, so the one the user
   * actually clicked is the one that reports progress.
   */
  const isBusyOn = (id: string): boolean => busy && busySubject === id

  return {
    busy,
    error,
    setError,
    isBusyOn,
    internal: { setBusy, runWith, runBusy }
  }
}

export type PlanningRunner = ReturnType<typeof usePlanningRunner>
