import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

/** Where an open document's changes are: the status bar says it (MOP-29). */
export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'failed'

const reports = new Map<symbol, SaveStatus>()
const listeners = new Set<() => void>()
let combined: SaveStatus | null = null

/** One word for every open document: the worst of them wins. */
function combine(): SaveStatus | null {
  if (reports.size === 0) return null
  const all = new Set(reports.values())
  for (const status of ['failed', 'saving', 'unsaved'] as const) if (all.has(status)) return status
  return 'saved'
}

function publish() {
  const next = combine()
  if (next === combined) return
  combined = next
  for (const listener of listeners) listener()
}

/** An open document reports its save status while it is shown; null reports nothing. */
export function useReportSaveStatus(status: SaveStatus | null) {
  const key = useRef(Symbol('document'))
  useEffect(() => {
    const id = key.current
    if (status === null) reports.delete(id)
    else reports.set(id, status)
    publish()
  }, [status])
  useEffect(() => {
    const id = key.current
    return () => {
      reports.delete(id)
      publish()
    }
  }, [])
}

/** The open documents' save status, or null when none is open. */
export function useSaveStatus(): SaveStatus | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => combined
  )
}

/**
 * A status as a quiet place shows it: a passing busy state (saving, catching
 * up) shows only once it has lasted `delayMs`, so quick ones never flicker.
 * Any other state shows at once.
 */
export function useCalmStatus<T>(value: T, busy: (value: T) => boolean, delayMs = 1000): T {
  const [shown, setShown] = useState(value)
  const isBusy = busy(value)
  useEffect(() => {
    if (!isBusy) {
      setShown(value)
      return
    }
    const timer = setTimeout(() => setShown(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, isBusy, delayMs])
  return shown
}
