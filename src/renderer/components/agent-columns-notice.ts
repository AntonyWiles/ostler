import { useCallback } from 'react'
import type { RendererProject } from '@shared/ostler-api'
import { AGENT_STATUSES, isStatusHidden } from '@shared/board-columns'
import { projectFolder } from '@shared/project-folder'
import { t } from '@shared/i18n'
import { useToast } from '../ui'

/**
 * Turning agents on shows Ready and In review again in every project with a
 * folder that hid them (main does it, D34). This says so: `hiding` before
 * the switch, `tellShown` after it, with the projects whose columns came back.
 */
export function useAgentColumnsNotice() {
  const { toast } = useToast()

  const hiding = useCallback(async (): Promise<RendererProject[]> => {
    const [projects, columns] = await Promise.all([
      window.ostlerAPI.getProjects(),
      window.ostlerAPI.getPlanningColumnSettings()
    ])
    if (!projects.ok || !columns.ok) return []
    return projects.value.filter(
      (project) =>
        projectFolder(project) !== null &&
        AGENT_STATUSES.some((status) => isStatusHidden(status, columns.value[project.id]))
    )
  }, [])

  const tellShown = useCallback(
    async (before: RendererProject[]) => {
      if (before.length === 0) return
      const after = await window.ostlerAPI.getPlanningColumnSettings()
      if (!after.ok) return
      const shown = before.filter(
        (project) =>
          !AGENT_STATUSES.some((status) => isStatusHidden(status, after.value[project.id]))
      )
      if (shown.length === 0) return
      toast({
        title: t('projects:boardColumns.agentColumnsShown', {
          count: shown.length,
          projects: shown.map((project) => project.name).join(', ')
        }),
        body: t('projects:boardColumns.agentColumnsWhy')
      })
    },
    [toast]
  )

  return { hiding, tellShown }
}
