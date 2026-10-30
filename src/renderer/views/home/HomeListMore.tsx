import { Button } from '../../ui'
import { t } from '@shared/i18n'

/**
 * How many rows each of Home's lists (Today, Upcoming, Needs you) shows before
 * "Show N more". With many projects these lists ran to thousands of rows,
 * which Home drew, and took down again, on every visit.
 */
export const HOME_LIST_LIMIT = 20

/**
 * How many rows of each part of one Home list to show, in order: the first
 * part fills first, the next gets what is left of `limit`. Every row with `all`.
 */
export function shareLimit(lengths: readonly number[], limit: number, all: boolean): number[] {
  let left = all ? Number.POSITIVE_INFINITY : limit
  return lengths.map((length) => {
    const shown = Math.min(length, left)
    left -= shown
    return shown
  })
}

/** "Show 12 more" under a Home list that has more than it shows, then "Show fewer". */
export function HomeListMore({
  total,
  expanded,
  onToggle
}: {
  total: number
  expanded: boolean
  onToggle: () => void
}) {
  if (total <= HOME_LIST_LIMIT) return null
  return (
    <Button size="sm" variant="ghost" className="ostler-home-more" onClick={onToggle}>
      {expanded
        ? t('views:homeView.showFewer')
        : t('views:homeView.showMore', { count: total - HOME_LIST_LIMIT })}
    </Button>
  )
}
