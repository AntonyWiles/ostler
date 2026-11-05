import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { Button, Tooltip, useToast } from '../../ui'
import { Bell, BellOff } from '../../ui/icons'

/**
 * Follow / Following (prompt 15): whether Me hears when someone else changes this task. A
 * toggle; the choice is personal and kept in the main process. While following, pointing at
 * the button reads "Unfollow" and its tooltip says a click stops it. Each change says what it
 * did in a toast with Undo, and a failed change says so.
 */
export function FollowButton({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [following, setFollowing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hovered, setHovered] = useState(false)
  const { toast, toastUndo } = useToast()

  useEffect(() => {
    let current = true
    setFollowing(false)
    void window.ostlerAPI.getTaskFollow(taskId).then((result) => {
      if (current && result.ok) setFollowing(result.value)
    })
    return () => {
      current = false
    }
  }, [taskId])

  const change = async (next: boolean, offerUndo: boolean) => {
    setBusy(true)
    const result = await window.ostlerAPI.setTaskFollow(projectId, taskId, next)
    setBusy(false)
    if (!result.ok) {
      toast({
        tone: 'danger',
        title: next
          ? t('tasks:workItemDrawer.followFailed')
          : t('tasks:workItemDrawer.unfollowFailed'),
        body: result.error
      })
      return
    }
    setFollowing(result.value)
    const title = result.value
      ? t('tasks:workItemDrawer.followedToast')
      : t('tasks:workItemDrawer.unfollowedToast')
    const body = result.value
      ? t('tasks:workItemDrawer.followedToastBody')
      : t('tasks:workItemDrawer.unfollowedToastBody')
    if (offerUndo) toastUndo(title, () => change(!result.value, false), body)
    else toast({ title, body })
  }

  const label = following
    ? hovered && !busy
      ? t('tasks:workItemDrawer.unfollow')
      : t('tasks:workItemDrawer.following')
    : t('tasks:workItemDrawer.follow')

  return (
    <Tooltip
      content={
        following
          ? t('tasks:workItemDrawer.followingTooltip')
          : t('tasks:workItemDrawer.followTooltip')
      }
    >
      <Button
        size="sm"
        variant="ghost"
        icon={following && !hovered ? Bell : BellOff}
        aria-pressed={following}
        aria-label={
          following ? t('tasks:workItemDrawer.following') : t('tasks:workItemDrawer.follow')
        }
        disabled={busy}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => void change(!following, true)}
      >
        {label}
      </Button>
    </Tooltip>
  )
}
