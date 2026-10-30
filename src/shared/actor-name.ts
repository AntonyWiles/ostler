import { BRAND } from './brand'
import { t } from './i18n/index'
import type { ActorKind } from './ostler-api/activity-types'

/**
 * Who did something, named for display: the person, "An agent", Ostler AI,
 * "Automation API", Ostler, or "Rule: <name>" for a change a rule made. One
 * rule for the desktop's history and the phone's comments.
 */
export function actorDisplayName(
  kind: ActorKind | 'unknown',
  personName: string | null | undefined,
  ruleName?: string | null,
  agentName?: string
): string {
  if (ruleName) return t('errors:planningActivity.rule', { name: ruleName })
  switch (kind) {
    case 'human':
      return personName || 'Someone'
    case 'agent':
      return agentName ?? t('errors:planningActivity.agent')
    case 'ostler-ai':
      return BRAND.aiName
    case 'automation':
      return t('errors:planningActivity.automationApi')
    case 'system':
    case 'rule':
      return BRAND.name
    default:
      return 'Someone'
  }
}
