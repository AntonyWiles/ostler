import type { PlanningDependencyLink, PlanningDependencyType } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { isPlainDependencyLink } from '@shared/planning/dependency-links'
import { dependencyLinkWords } from '@shared/planning/dependency-link-words'

// The words live in shared, where the activity feed words a changed link too.
export { dependencyLinkWords }

/**
 * What a broken link says when it has a type or lag (N7.2a): "Too early:
 * Starts 2 days after Plastering starts". Null for finish to start with no
 * lag, which keeps the words it always had.
 */
export function dependencyConflictWords(
  title: string,
  link?: Partial<Pick<PlanningDependencyLink, 'type' | 'lagDays'>>
): string | null {
  const whole = { type: link?.type ?? 'finish-to-start', lagDays: link?.lagDays ?? 0 }
  if (isPlainDependencyLink(whole)) return null
  return t('tasks:taskDependencies.tooEarly', { link: dependencyLinkWords(whole, title) })
}

/** The type picker's choices, in the order the drawer lists them. */
export function dependencyTypeOptions(): Array<{ value: PlanningDependencyType; label: string }> {
  return [
    { value: 'finish-to-start', label: t('tasks:taskDependencies.typeFinishToStart') },
    { value: 'start-to-start', label: t('tasks:taskDependencies.typeStartToStart') },
    { value: 'finish-to-finish', label: t('tasks:taskDependencies.typeFinishToFinish') }
  ]
}

/**
 * A link as the Timeline's arrow says it (N7.2b), naming both tasks:
 * "Painting starts 2 days after Plastering starts". `itemTitle` is the task
 * that waits, `title` the one it waits on.
 */
export function timelineLinkWords(
  link: Pick<PlanningDependencyLink, 'type' | 'lagDays'>,
  itemTitle: string,
  title: string
): string {
  const words = { itemTitle, title, count: Math.abs(link.lagDays) }
  const after = link.lagDays > 0
  if (link.type === 'start-to-start') {
    if (link.lagDays === 0) return t('views:timelineView.linkStartToStart', words)
    return after
      ? t('views:timelineView.linkStartToStartAfter', words)
      : t('views:timelineView.linkStartToStartBefore', words)
  }
  if (link.type === 'finish-to-finish') {
    if (link.lagDays === 0) return t('views:timelineView.linkFinishToFinish', words)
    return after
      ? t('views:timelineView.linkFinishToFinishAfter', words)
      : t('views:timelineView.linkFinishToFinishBefore', words)
  }
  if (link.lagDays === 0) return t('views:timelineView.linkFinishToStart', words)
  return after
    ? t('views:timelineView.linkFinishToStartAfter', words)
    : t('views:timelineView.linkFinishToStartBefore', words)
}
