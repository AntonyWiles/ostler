import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { Button } from '../../ui'
import { Bell, BellOff } from '../../ui/icons'

/**
 * Follow / Following (prompt 15): whether Me hears when someone else changes this task. A
 * toggle; the choice is personal and kept in the main process.
 */
export function FollowButton({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [following, setFollowing] = useState(false)
  const [busy, setBusy] = useState(false)

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

  const toggle = async () => {
    setBusy(true)
    const result = await window.ostlerAPI.setTaskFollow(projectId, taskId, !following)
    setBusy(false)
    if (result.ok) setFollowing(result.value)
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      icon={following ? Bell : BellOff}
      aria-pressed={following}
      disabled={busy}
      onClick={() => void toggle()}
    >
      {following ? t('tasks:workItemDrawer.following') : t('tasks:workItemDrawer.follow')}
    </Button>
  )
}
