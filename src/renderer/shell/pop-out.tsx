import { createContext, useCallback, useContext } from 'react'
import type { RendererProject } from '@shared/ostler-api'
import { parsePopOutRoute } from '@shared/pop-out'
import { useConfirm, useToast } from '../ui'
import { useOstler } from '../context/OstlerContext'
import { findProjectView } from '../navigation/registry'
import { t } from '@shared/i18n'

/**
 * Pop out a view (N5.8a): the route this window was popped out on, or null in
 * the main window. A view reads it to leave out what makes no sense in a
 * pop-out (its project's view tabs, Open in new window itself).
 */
const PopOutRouteContext = createContext<string | null>(null)

export const PopOutRouteProvider = PopOutRouteContext.Provider

export function usePopOutRoute(): string | null {
  return useContext(PopOutRouteContext)
}

/** What a pop-out shows, in words: "Home", or "Project - Board". */
export function describePopOutRoute(
  route: string,
  projects: readonly Pick<RendererProject, 'id' | 'name'>[]
): string {
  const target = parsePopOutRoute(route)
  if (!target || target.kind === 'home') return t('navigation:popOut.home')
  const projectName = projects.find((project) => project.id === target.projectId)?.name ?? ''
  const view = findProjectView(target.view)?.label ?? target.view
  return t('navigation:popOut.projectView', { projectName, view })
}

/**
 * Open in new window: asks main to pop `route` out. With eight open it asks
 * whether to close the oldest first; a failure shows in a toast.
 */
export function useOpenInNewWindow(): (route: string) => Promise<void> {
  const confirm = useConfirm()
  const { toast } = useToast()
  const { projects } = useOstler()
  return useCallback(
    async (route: string) => {
      let result = await window.ostlerAPI.openInNewWindow(route)
      if (result.ok && !result.value.opened) {
        const closeOldest = await confirm({
          title: t('navigation:popOut.fullTitle'),
          body: t('navigation:popOut.fullBody', {
            oldest: describePopOutRoute(result.value.oldest, projects)
          }),
          confirmLabel: t('navigation:popOut.closeOldest')
        })
        if (!closeOldest) return
        result = await window.ostlerAPI.openInNewWindow(route, true)
      }
      if (!result.ok)
        toast({ title: t('navigation:popOut.couldNotOpen'), body: result.error, tone: 'danger' })
    },
    [confirm, toast, projects]
  )
}
