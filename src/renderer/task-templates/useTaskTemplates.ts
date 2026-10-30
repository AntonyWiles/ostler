import { useCallback, useEffect, useState } from 'react'
import type { TaskTemplate, TaskTemplateDropped } from '@shared/ostler-api'
import { t } from '@shared/i18n'

/**
 * The task templates (N2.1) a project can use: its own and every project's,
 * by name. Loaded in one call when the project changes; `reload` after a save.
 */
export function useTaskTemplates(projectId: string | null | undefined) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!projectId) {
      setTemplates([])
      return
    }
    const result = await window.ostlerAPI.getTaskTemplates(projectId)
    setTemplates(result.ok ? result.value : [])
    setLoadedFor(projectId)
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    if (!projectId) {
      setTemplates([])
      return
    }
    void window.ostlerAPI.getTaskTemplates(projectId).then((result) => {
      if (cancelled) return
      setTemplates(result.ok ? result.value : [])
      setLoadedFor(projectId)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  return { templates: loadedFor === projectId ? templates : [], reload }
}

/** What a template held that the project could not take, in words; null when nothing. */
export function droppedText(dropped: TaskTemplateDropped): string | null {
  const parts: string[] = []
  if (dropped.assignee) parts.push(t('tasks:taskTemplates.droppedAssignee'))
  if (dropped.fieldCount > 0)
    parts.push(t('tasks:taskTemplates.droppedFields', { count: dropped.fieldCount }))
  return parts.length > 0 ? parts.join(' ') : null
}
