import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { SignOff, SignOffItem } from '@shared/ostler-api'

/** Every sign-off of one item, newest first; reloaded when the project changes (prompt 17). */
export function useItemSignOffs(item: SignOffItem): {
  signOffs: SignOff[]
  reload: () => Promise<void>
} {
  const [signOffs, setSignOffs] = useState<SignOff[]>([])
  const { kind, id } = item
  const reload = useCallback(async () => {
    const api = window.ostlerAPI
    if (typeof api?.listSignOffsForItem !== 'function') return
    const result = await api.listSignOffsForItem({ kind, id })
    if (result?.ok) setSignOffs(result.value)
  }, [kind, id])
  useEffect(() => {
    setSignOffs([])
    void reload()
    const api = window.ostlerAPI
    if (typeof api?.onProjectStateChange !== 'function') return
    return api.onProjectStateChange((update) => {
      if (update.field === 'planning') void reload()
    })
  }, [reload])
  return { signOffs, reload }
}

const EMPTY: SignOff[] = []
const cache = new Map<string, SignOff[]>()
const listeners = new Map<string, Set<() => void>>()

function loadProject(projectId: string): void {
  const api = window.ostlerAPI
  if (typeof api?.listSignOffsForProject !== 'function') return
  void api.listSignOffsForProject(projectId).then((result) => {
    if (!result?.ok) return
    cache.set(projectId, result.value)
    for (const listener of listeners.get(projectId) ?? []) listener()
  })
}

function subscribeProject(projectId: string, listener: () => void): () => void {
  let set = listeners.get(projectId)
  if (!set) listeners.set(projectId, (set = new Set()))
  set.add(listener)
  if (set.size === 1) loadProject(projectId)
  const api = window.ostlerAPI
  const stop =
    typeof api?.onProjectStateChange === 'function'
      ? api.onProjectStateChange((update) => {
          if (update.field === 'planning' && update.projectId === projectId) loadProject(projectId)
        })
      : () => {}
  return () => {
    stop()
    set.delete(listener)
    if (set.size === 0) {
      listeners.delete(projectId)
      cache.delete(projectId)
    }
  }
}

/** All sign-offs of a project, shared by every card on the Board so it asks once. */
export function useProjectSignOffs(projectId: string): SignOff[] {
  // A stable subscribe: a new function each render made React unsubscribe (which empties the
  // cache) and subscribe again (which reloads) on every render, so the badges never settled.
  const subscribe = useCallback(
    (listener: () => void) => subscribeProject(projectId, listener),
    [projectId]
  )
  return useSyncExternalStore(subscribe, () => cache.get(projectId) ?? EMPTY)
}

/** What a card or milestone shows: waiting (with the approver) or signed off; null when neither. */
export type SignOffBadgeState =
  { kind: 'waiting'; approverPersonId: string } | { kind: 'approved'; approverPersonId: string }

/** The badge for one item from a list of sign-offs (newest first). */
export function signOffBadgeOf(
  signOffs: readonly SignOff[],
  itemId: string
): SignOffBadgeState | null {
  const mine = signOffs.filter((signOff) => signOff.itemId === itemId)
  const waiting = mine.find((signOff) => signOff.state === 'waiting')
  if (waiting) return { kind: 'waiting', approverPersonId: waiting.approverPersonId }
  const latest = mine[0]
  return latest?.state === 'approved'
    ? { kind: 'approved', approverPersonId: latest.approverPersonId }
    : null
}
