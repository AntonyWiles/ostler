import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import type { UnseenKind } from '../../hooks/planning/useUnseenTasks'
import { IconButton } from '../../ui'
import { CheckCheck } from '../../ui/icons'
import { t } from '@shared/i18n'
import './UnseenMark.css'

/**
 * The dot on a task someone or something else made or changed since this device last opened it
 * (MOP-82). Filled for new, a ring for changed, so the two differ without colour alone.
 */
export function UnseenMark({ kind }: { kind: UnseenKind | undefined }) {
  if (!kind) return null
  const label = kind === 'new' ? t('tasks:unseen.new') : t('tasks:unseen.changed')
  return (
    <span
      className={`ostler-unseen-mark is-${kind}`}
      role="img"
      aria-label={label}
      title={kind === 'new' ? t('tasks:unseen.newTitle') : t('tasks:unseen.changedTitle')}
    />
  )
}

/** Clears every mark in the project; shown only while some task has one. */
export function MarkAllSeenButton({ ws }: { ws: PlanningWorkspace }) {
  const count = Object.keys(ws.unseenTasks).length
  if (count === 0) return null
  return (
    <IconButton
      size="sm"
      icon={CheckCheck}
      label={t('tasks:unseen.markAll')}
      onClick={() => void ws.markAllTasksSeen()}
    />
  )
}
