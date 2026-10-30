import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOstler } from '../context/OstlerContext'
import { projectPath } from '../navigation/paths'
import { useToast } from '../ui'
import { t } from '@shared/i18n'
import { addDemoProjects, type DemoKind } from './sample-project'

/**
 * "Open the demo project" (P5.8): adds whichever demo projects are missing
 * (they come together), then opens the one asked for, the simple one when
 * left out. Both go together too, from `useRemoveDemoProjects`.
 */
export function useOpenDemoProject(): (kind?: DemoKind) => Promise<void> {
  const { projects, refreshProjects } = useOstler()
  const navigate = useNavigate()
  const { toast } = useToast()
  return useCallback(
    async (kind: DemoKind = 'simple') => {
      const result = await addDemoProjects(projects)
      await refreshProjects()
      if (!result.ok) {
        toast({
          title: t('views:useOpenSampleProject.couldntOpenSampleProject'),
          body: result.error,
          tone: 'danger'
        })
        return
      }
      navigate(projectPath(result.value[kind].id))
    },
    [projects, refreshProjects, navigate, toast]
  )
}
