import { HEALTH_LABEL, HEALTH_TONE, type HealthVerdict } from '@shared/planning/health'
import { Badge } from '../../ui'
import {
  Ban,
  CircleCheck,
  CircleDashed,
  Flag,
  TriangleAlert,
  type LucideIcon
} from '../../ui/icons'
import type { Health } from '@shared/planning/health'

const HEALTH_ICON: Record<Health, LucideIcon> = {
  'on-track': CircleCheck,
  'at-risk': TriangleAlert,
  blocked: Ban,
  'no-work': CircleDashed,
  'ready-to-close': Flag
}

/** A milestone's or project's health: icon, word and tone from one rule (health.ts). */
export function HealthBadge({ verdict }: { verdict: HealthVerdict }) {
  return (
    <Badge
      tone={HEALTH_TONE[verdict.health]}
      icon={HEALTH_ICON[verdict.health]}
      title={verdict.reason}
      data-health={verdict.health}
    >
      {HEALTH_LABEL[verdict.health]}
    </Badge>
  )
}
