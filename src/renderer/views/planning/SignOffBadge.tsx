import { t } from '@shared/i18n'
import { usePeople } from '../../context/PeopleContext'
import { signOffBadgeOf, useProjectSignOffs } from '../../hooks/useSignOffs'
import { Badge } from '../../ui'
import { CircleCheck, Hourglass } from '../../ui/icons'

/**
 * "Waiting for sign-off" (with the approver's initials) or "Signed off" on a Board card or a
 * milestone card (prompt 17). Nothing when the item has no waiting or approved sign-off.
 */
export function SignOffBadge({
  projectId,
  itemId,
  className
}: {
  projectId: string
  itemId: string
  className?: string
}) {
  const people = usePeople()
  const signOffs = useProjectSignOffs(projectId)
  const state = signOffBadgeOf(signOffs, itemId)
  if (!state) return null
  const approver = people.byId.get(state.approverPersonId)
  const initials = approver?.initials ?? ''
  if (state.kind === 'approved') {
    return (
      <Badge
        tone="success"
        icon={CircleCheck}
        className={className}
        title={approver ? t('tasks:signOff.signedOffByTitle', { name: approver.name }) : undefined}
      >
        {t('tasks:signOff.badgeSignedOff')}
      </Badge>
    )
  }
  return (
    <Badge
      tone="warning"
      icon={Hourglass}
      className={className}
      title={approver ? t('tasks:signOff.waitingForTitle', { name: approver.name }) : undefined}
    >
      {initials ? t('tasks:signOff.badgeWaitingBy', { initials }) : t('tasks:signOff.badgeWaiting')}
    </Badge>
  )
}
