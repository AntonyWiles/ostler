import { formatIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import {
  baselineShift,
  type BaselineComparison,
  type BaselineItemChange
} from '@shared/planning/baselines'

/**
 * What a baseline (N7.4) says in words: the name Save a baseline suggests,
 * how far a task or milestone has moved against one, and the Timeline's
 * summary line. Colour is never the only sign.
 */

/** "Plan agreed 3 October", from today. */
export function suggestedBaselineName(today: string): string {
  return t('views:baselines.suggestedName', {
    date: formatIsoDate(today, { day: 'numeric', month: 'long' })
  })
}

/** A task against a baseline: "3 days later than 'Plan agreed 3 October'", or on its dates. */
export function taskBaselineWords(change: BaselineItemChange | undefined, name: string): string {
  if (!change) return t('views:baselines.newSince', { name })
  if (!change.baseline.start && !change.baseline.due)
    return t('views:baselines.undatedThen', { name })
  const days = baselineShift(change)
  if (days === null || days === 0) return t('views:baselines.same', { name })
  return days > 0
    ? t('views:baselines.later', { count: days, name })
    : t('views:baselines.earlier', { count: -days, name })
}

/** A milestone against a baseline: "4 days late against 'Plan agreed 3 October'", or on its date. */
export function milestoneBaselineWords(
  change: BaselineItemChange | undefined,
  name: string
): string | null {
  if (!change) return t('views:baselines.milestoneNew', { name })
  const days = change.dueDays
  if (days === null) return null
  if (days === 0) return t('views:baselines.milestoneOnDate', { name })
  return days > 0
    ? t('views:baselines.milestoneLate', { count: days, name })
    : t('views:baselines.milestoneEarly', { count: -days, name })
}

/** "Against 'Plan agreed 3 October': 3 tasks later, 1 earlier, 2 new". */
export function baselineSummaryWords(comparison: BaselineComparison): string {
  const { later, earlier, added } = comparison.summary
  return t('views:baselines.summary', {
    name: comparison.name,
    later: t('views:baselines.summaryLater', { count: later }),
    earlier: t('views:baselines.summaryEarlier', { count: earlier }),
    added: t('views:baselines.summaryNew', { count: added })
  })
}
