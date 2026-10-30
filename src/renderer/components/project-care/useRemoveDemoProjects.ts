import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useOstler } from '../../context/OstlerContext'
import { homePath, parseAppPath } from '../../navigation/paths'
import { useConfirm, useToast } from '../../ui'
import { t } from '@shared/i18n'

/**
 * Removes both demo projects at once, after one plain confirmation: no name
 * to type and no backup, since they come back from Ctrl+K. Main knows which
 * projects are demos (`demo`); the confirmation says if the person added
 * tasks or comments to them. One implementation for every place that offers
 * it: a demo's Remove tab, its menus, Home and the command palette.
 */
export function useRemoveDemoProjects(): () => Promise<boolean> {
  const navigate = useNavigate()
  const location = useLocation()
  const { refreshProjects } = useOstler()
  const confirm = useConfirm()
  const { toast } = useToast()

  const { pathname } = location
  return useCallback(async () => {
    const status = await window.ostlerAPI.getDemoProjects()
    if (!status.ok) {
      toast({ title: t('projects:demoRemoval.couldntRemove'), body: status.error, tone: 'danger' })
      return false
    }
    const { projects, addedTasks, addedComments, untouched } = status.value
    if (projects.length === 0) return false
    const yours = [
      addedTasks > 0 ? t('projects:demoRemoval.taskCount', { count: addedTasks }) : null,
      addedComments > 0 ? t('projects:demoRemoval.commentCount', { count: addedComments }) : null
    ].filter((part): part is string => part !== null)
    const added =
      yours.length > 0
        ? t('projects:demoRemoval.added', { what: yours.join(t('projects:demoRemoval.and')) })
        : untouched
          ? null
          : t('projects:demoRemoval.edited')
    const ok = await confirm({
      title: t('projects:demoRemoval.title', { count: projects.length }),
      body: [
        t('projects:demoRemoval.body', {
          count: projects.length,
          names: projects.map((project) => project.name).join(t('projects:demoRemoval.and'))
        }),
        added
      ]
        .filter(Boolean)
        .join(' '),
      confirmLabel: t('projects:demoRemoval.confirm', { count: projects.length }),
      tone: 'danger'
    })
    if (!ok) return false

    const result = await window.ostlerAPI.removeDemoProjects()
    if (!result.ok) {
      toast({ title: t('projects:demoRemoval.couldntRemove'), body: result.error, tone: 'danger' })
      return false
    }
    const here = parseAppPath(pathname)
    if (here && 'projectId' in here && projects.some((project) => project.id === here.projectId))
      navigate(homePath())
    await refreshProjects()
    toast({
      title: t('projects:demoRemoval.removed', { count: result.value }),
      body: t('projects:demoRemoval.bringBack'),
      tone: 'success'
    })
    return true
  }, [confirm, navigate, pathname, refreshProjects, toast])
}
