import type { PlanningDependencyLink } from '../ostler-api'
import { t } from '../i18n'

/**
 * A waits-on link in words (N7.2a): "Starts 2 days after Plastering
 * starts", "Due when Data is due". `title` is the task waited on.
 */
export function dependencyLinkWords(
  link: Pick<PlanningDependencyLink, 'type' | 'lagDays'>,
  title: string
): string {
  const count = Math.abs(link.lagDays)
  const after = link.lagDays > 0
  if (link.type === 'start-to-start') {
    if (link.lagDays === 0) return t('tasks:taskDependencies.linkStartToStart', { title })
    return after
      ? t('tasks:taskDependencies.linkStartToStartAfter', { title, count })
      : t('tasks:taskDependencies.linkStartToStartBefore', { title, count })
  }
  if (link.type === 'finish-to-finish') {
    if (link.lagDays === 0) return t('tasks:taskDependencies.linkFinishToFinish', { title })
    return after
      ? t('tasks:taskDependencies.linkFinishToFinishAfter', { title, count })
      : t('tasks:taskDependencies.linkFinishToFinishBefore', { title, count })
  }
  if (link.lagDays === 0) return t('tasks:taskDependencies.linkFinishToStart', { title })
  return after
    ? t('tasks:taskDependencies.linkFinishToStartAfter', { title, count })
    : t('tasks:taskDependencies.linkFinishToStartBefore', { title, count })
}
