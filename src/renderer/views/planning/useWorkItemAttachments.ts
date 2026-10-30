import { useCallback, useEffect, useState } from 'react'
import type { LibraryAttachedBy, Result, WorkItemAttachment } from '@shared/ostler-api'
import { t } from '@shared/i18n'

export const ATTACHED_BY_LABEL: Record<LibraryAttachedBy, string> = {
  human: 'you',
  get 'ostler-ai'() {
    return t('tasks:useWorkItemAttachments.ostlerAi')
  },
  automation: 'automation'
}

/**
 * A work item's agent attachments, kept fresh by the 'library' state change
 * every attach and detach pushes. The main process is the gate: attaching a
 * human-only or archived item, or past the cap, comes back as `error`.
 */
export function useWorkItemAttachments(projectId: string, workItemId: string) {
  const [attachments, setAttachments] = useState<WorkItemAttachment[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.listWorkItemAttachments(projectId, workItemId)
    if (result.ok) setAttachments(result.value)
  }, [projectId, workItemId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(
    () =>
      window.ostlerAPI.onProjectStateChange((update) => {
        if (update.projectId === projectId && update.field === 'library') void load()
      }),
    [projectId, load]
  )

  const apply = async (call: Promise<Result<WorkItemAttachment[]>>) => {
    setError(null)
    const result = await call
    if (result.ok) setAttachments(result.value)
    else setError(result.error)
  }

  const attach = (itemId: string, attachedBy: LibraryAttachedBy = 'human') =>
    apply(window.ostlerAPI.attachToWorkItem(projectId, workItemId, itemId, attachedBy))
  const detach = (itemId: string) =>
    apply(window.ostlerAPI.detachFromWorkItem(projectId, workItemId, itemId))
  const isAttached = (itemId: string) =>
    attachments.some((attachment) => attachment.item.id === itemId)

  return { attachments, error, attach, detach, isAttached }
}
