import type { EstimateUnit } from '../ostler-api'
import { formatHours } from './duration'
import { t } from '../i18n'

/**
 * Time logged against the estimate (R2.3, D33), one rule for the drawer and
 * cards: in a project that estimates in hours, "3.5 h of 5 h", over when the
 * time logged passes the estimate; in a points project, or without an
 * estimate, the time logged alone. Null when nothing is logged.
 */
export function timeAgainstEstimate(
  seconds: number,
  estimate: number | null,
  unit: EstimateUnit
): { text: string; over: boolean } | null {
  if (seconds <= 0) return null
  const logged = formatHours(seconds)
  if (unit !== 'hours' || estimate === null || estimate <= 0)
    return { text: t('tasks:time.logged', { time: logged }), over: false }
  return {
    text: t('tasks:time.loggedOfEstimate', {
      time: logged,
      estimate: formatHours(estimate * 3600)
    }),
    over: seconds > estimate * 3600
  }
}
