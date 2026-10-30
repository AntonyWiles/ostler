import type { StatusUpdate, StatusUpdateHealth } from '@shared/ostler-api'
import { statusUpdateHealthLabel, updateFreshness } from '@shared/status-updates'
import { t } from '@shared/i18n'
import { Badge, VisuallyHidden, type BadgeTone } from '../../ui'
import { CircleCheck, OctagonX, TriangleAlert, type LucideIcon } from '../../ui/icons'
import './StatusUpdates.css'

/** Each health's icon and tone: words and an icon always, never colour alone. */
export const HEALTH_ICON: Record<StatusUpdateHealth, LucideIcon> = {
  'on-track': CircleCheck,
  'at-risk': TriangleAlert,
  'off-track': OctagonX
}

export const HEALTH_TONE: Record<StatusUpdateHealth, BadgeTone> = {
  'on-track': 'success',
  'at-risk': 'warning',
  'off-track': 'danger'
}

/** The person's health word as a badge: icon and words. */
export function StatusHealthBadge({ health }: { health: StatusUpdateHealth }) {
  return (
    <Badge tone={HEALTH_TONE[health]} icon={HEALTH_ICON[health]} data-status-health={health}>
      {statusUpdateHealthLabel(health)}
    </Badge>
  )
}

/**
 * Home's chip (N5.5): the latest update's health with its words, "No update
 * yet", or with it "Last update 5 weeks ago" when it is old.
 */
export function StatusUpdateChip({
  latest,
  reminder,
  now = Date.now()
}: {
  latest: StatusUpdate | null
  reminder: unknown
  now?: number
}) {
  const freshness = updateFreshness(latest, reminder, now)
  return (
    <span className="status-update-chip">
      {latest && <VisuallyHidden>{t('projects:statusUpdates.chipPrefix')}</VisuallyHidden>}
      {latest ? (
        <StatusHealthBadge health={latest.health} />
      ) : (
        <span className="status-update-chip__none">{t('projects:statusUpdates.noUpdateYet')}</span>
      )}
      {freshness.kind === 'old' && (
        <span className="status-update-chip__age">
          {t('projects:statusUpdates.lastUpdateWeeksAgo', { count: freshness.weeks })}
        </span>
      )}
    </span>
  )
}
