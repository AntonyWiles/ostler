import { Suspense, useEffect, useState } from 'react'
import { matchPath, useInRouterContext, useLocation } from 'react-router-dom'
import type { ShareState } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Icon, RefreshCw, TriangleAlert, Users } from '../ui/icons'
import { useProjectList } from '../context/OstlerContext'
import { lazyNamed } from '../lib/lazy-named'
import { useCalmStatus } from '../shell/save-status'

const ProjectSettingsDialog = lazyNamed(
  () => import('./ProjectSettingsDialog'),
  'ProjectSettingsDialog'
)

const STATUS_ICON = {
  'up-to-date': Users,
  'catching-up': RefreshCw,
  'cannot-reach-folder': TriangleAlert,
  problems: TriangleAlert
} as const

/**
 * The status bar's word on the open project's sharing (S9d): nothing for a
 * project that isn't shared; otherwise who it is shared with and whether it is
 * up to date. A click opens Project settings › Sharing, where the people are
 * and where you leave it.
 */
export function StatusBarSharing() {
  return useInRouterContext() ? <OpenProjectSharing /> : null
}

/** Who the project is shared with, as the status bar says it: a name, a count, or only your own PCs. */
export function sharedWith(state: ShareState): string {
  const others = state.members.filter((member) => !member.isMe && member.leftAt === undefined)
  if (others.length === 0) return t('navigation:statusBar.sharedOnYourPcs')
  if (others.length === 1) return t('navigation:statusBar.sharedWithName', { name: others[0].name })
  return t('navigation:statusBar.sharedWithCount', { count: others.length })
}

function OpenProjectSharing() {
  const location = useLocation()
  const projectId = matchPath('/projects/:projectId/*', location.pathname)?.params.projectId ?? null
  const project = useProjectList().find((candidate) => candidate.id === projectId)
  const [loaded, setState] = useState<ShareState | null>(null)
  const [open, setOpen] = useState(false)
  // Catching up after every change is not news: it shows only when it lasts (MOP-29).
  const state = useCalmStatus(loaded, (value) => value?.status === 'catching-up', 3000)

  useEffect(() => {
    setState(null)
    if (!projectId) return
    let cancelled = false
    const load = async () => {
      const result = await window.ostlerAPI.getShareState(projectId)
      if (!cancelled) setState(result.ok ? result.value : null)
    }
    void load()
    const unsubscribe = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'sharing' && update.projectId === projectId) void load()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [projectId])

  if (!state) return null
  return (
    <>
      <button
        type="button"
        className="statusbar-stop"
        title={t('navigation:statusBar.sharingDetail')}
        onClick={() => setOpen(true)}
      >
        <Icon icon={STATUS_ICON[state.status]} />
        {t('navigation:statusBar.sharingSummary', {
          who: sharedWith(state),
          status: t(`navigation:statusBar.sharingStatus.${state.status}`)
        })}
      </button>
      {open && project && (
        <Suspense fallback={null}>
          <ProjectSettingsDialog
            project={project}
            section="sharing"
            onClose={() => setOpen(false)}
            onChanged={() => undefined}
          />
        </Suspense>
      )}
    </>
  )
}
