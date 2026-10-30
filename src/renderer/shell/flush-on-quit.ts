import { useEffect, useRef } from 'react'

/**
 * Saving on quit (R1.5, D30). Text saves after a short pause, so an edit typed
 * in the last second has not been sent when Ostler quits. Main asks the window
 * to save before its services stop; every component with edits waiting for
 * their pause registers here while it is mounted, and the shell answers main
 * once they are all saved (or failed: a failure is not waited on twice).
 */
type Flush = () => Promise<void>

const flushes = new Set<{ current: Flush }>()

/** Saves every pending edit now, and resolves once each is saved or has failed. */
export async function flushPendingEdits(): Promise<void> {
  await Promise.all([...flushes].map((flush) => flush.current().catch(() => {})))
}

/** Registers how this component saves its pending edits, while it is mounted. */
export function useFlushOnQuit(flush: Flush): void {
  const latest = useRef(flush)
  latest.current = flush
  useEffect(() => {
    const registration = latest
    flushes.add(registration)
    return () => {
      flushes.delete(registration)
    }
  }, [])
}

/** Answers main's request to save before quitting, for the life of the shell. */
export function useFlushOnQuitChannel(): void {
  useEffect(
    () =>
      window.ostlerAPI.onFlushEdits?.((requestId) => {
        void flushPendingEdits().then(() => window.ostlerAPI.editsFlushed(requestId))
      }),
    []
  )
}
