import { agentRunStateLabel, type AgentRunState } from '@shared/agent-run-state'
import { Badge, STATUS_ICONS, type BadgeTone } from '../../ui'
import type { LucideIcon } from '../../ui/icons'

/**
 * An agent run's state, drawn like a task's StatusBadge (the same icons and
 * tones for the same meaning) with the shared run words
 * (`@shared/agent-run-state`): "Next to start" and "Queued #3" say more than
 * the task status "Ready" would.
 */
export const RUN_STATE_LOOK: Record<AgentRunState, { icon: LucideIcon; tone: BadgeTone }> = {
  queued: { icon: STATUS_ICONS.ready, tone: 'info' },
  onHold: { icon: STATUS_ICONS.blocked, tone: 'warning' },
  starting: { icon: STATUS_ICONS.active, tone: 'accent' },
  running: { icon: STATUS_ICONS.active, tone: 'accent' },
  waitingForYou: { icon: STATUS_ICONS.blocked, tone: 'warning' },
  inReview: { icon: STATUS_ICONS.review, tone: 'warning' },
  accepted: { icon: STATUS_ICONS.done, tone: 'success' },
  cancelled: { icon: STATUS_ICONS.backlog, tone: 'neutral' }
}

export function AgentRunBadge({
  state,
  queuePosition,
  detail
}: {
  state: AgentRunState
  queuePosition?: number
  /** A word on the state, such as what review still needs. */
  detail?: string
}) {
  const look = RUN_STATE_LOOK[state]
  const label = agentRunStateLabel(state, queuePosition)
  return (
    <Badge tone={look.tone} icon={look.icon} className="agents-run-state">
      {detail ? `${label} · ${detail}` : label}
    </Badge>
  )
}
