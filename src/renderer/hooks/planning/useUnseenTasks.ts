import { useCallback, useEffect, useState } from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'

export type UnseenKind = 'new' | 'changed'

const NONE: Readonly<Record<string, UnseenKind>> = Object.freeze({})

/**
 * New and changed marks (MOP-82): the project's tasks that someone or something else made or
 * changed since this device last opened them. Read again whenever the records reload (any
 * change reloads them); the task open in the drawer is marked seen, and stays so while open.
 */
export function useUnseenTasks(
  projectId: string,
  workItems: readonly PlanningWorkItem[],
  selectedWorkItemId: string | null
) {
  const [unseenTasks, setUnseenTasks] = useState<Readonly<Record<string, UnseenKind>>>(NONE)

  useEffect(() => {
    let current = true
    void window.ostlerAPI.getUnseenTasks(projectId).then((result) => {
      if (current && result.ok) setUnseenTasks(result.value)
    })
    return () => {
      current = false
    }
  }, [projectId, workItems])

  const openUnseen = selectedWorkItemId !== null && selectedWorkItemId in unseenTasks
  useEffect(() => {
    if (!openUnseen || selectedWorkItemId === null) return
    setUnseenTasks((now) => {
      const next = { ...now }
      delete next[selectedWorkItemId]
      return next
    })
    void window.ostlerAPI.markTasksSeen([selectedWorkItemId])
  }, [openUnseen, selectedWorkItemId])

  const markAllTasksSeen = useCallback(async () => {
    setUnseenTasks(NONE)
    await window.ostlerAPI.markProjectTasksSeen(projectId)
  }, [projectId])

  return { unseenTasks, markAllTasksSeen }
}
