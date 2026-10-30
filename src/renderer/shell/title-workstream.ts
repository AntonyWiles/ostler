import { useEffect, useSyncExternalStore } from 'react'

/**
 * The workstream the open project view is scoped to, by name, for the title
 * bar: "Project › Workstream › View". The project workspace already has its
 * workstreams loaded, so it reports the name here rather than the shell
 * loading them a second time. Null while no workstream is open.
 */
let current: string | null = null
const listeners = new Set<() => void>()

function publish(next: string | null) {
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

/** The project workspace reports its open workstream while it is shown. */
export function useReportTitleWorkstream(name: string | null) {
  useEffect(() => {
    publish(name)
  }, [name])
  useEffect(() => () => publish(null), [])
}

/** The open workstream's name, or null. */
export function useTitleWorkstream(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current
  )
}
