import type { PlanningWorkItem } from '@shared/ostler-api'
import { formatIsoDate } from '@shared/dates'
import type { CriticalPath } from '@shared/planning/critical-path'
import { dependencyLinksOf } from '@shared/planning/dependency-links'
import { dependencyLinkWords } from '../dependency-link-words'
import { t } from '@shared/i18n'

function shortDate(date: string): string {
  return formatIsoDate(date, { day: 'numeric', month: 'short', year: 'numeric' })
}

function spanText(start: string, end: string): string {
  return start === end
    ? shortDate(end)
    : t('views:timelineView.to', { longDate: shortDate(start), longDate2: shortDate(end) })
}

/**
 * Show critical path's side panel (N7.3): the end it measures against, each
 * chain of critical tasks in order with their dates and the link between
 * each pair in words, its type and lag (N7.2b), and the open tasks
 * without dates, apart. Every task opens from here.
 */
export function CriticalPathPanel({
  result,
  milestoneName,
  byId,
  onOpen
}: {
  result: CriticalPath
  milestoneName: string | null
  byId: ReadonlyMap<string, PlanningWorkItem>
  onOpen: (item: PlanningWorkItem) => void
}) {
  const spans = new Map(result.tasks.map((entry) => [entry.taskId, entry]))
  const end = result.end
  const endWords =
    end === null
      ? t('views:timelineView.noCriticalEnd')
      : milestoneName === null
        ? t('views:timelineView.criticalEnd', { longDate: shortDate(end) })
        : result.endFrom === 'milestone'
          ? t('views:timelineView.criticalMilestoneEnd', {
              longDate: shortDate(end),
              milestone: milestoneName
            })
          : t('views:timelineView.criticalLatestTask', {
              longDate: shortDate(end),
              milestone: milestoneName
            })
  const undated = result.undatedTaskIds.flatMap((id) => byId.get(id) ?? [])

  const taskButton = (item: PlanningWorkItem, dates: string | null) => (
    <button type="button" className="critical-path__task" onClick={() => onOpen(item)}>
      <span className="critical-path__title">{item.title}</span>
      {dates && <span className="critical-path__dates">{dates}</span>}
    </button>
  )

  return (
    <aside className="critical-path" aria-labelledby="critical-path-heading">
      <h2 id="critical-path-heading" className="critical-path__heading">
        {t('views:timelineView.criticalPath')}
      </h2>
      <p className="critical-path__end">{endWords}</p>
      {end !== null && result.chains.length === 0 && (
        <p className="critical-path__note">{t('views:timelineView.nothingCritical')}</p>
      )}
      {result.chains.map((chain, index) => (
        <section key={chain.join(' ')} className="critical-path__chain">
          {result.chains.length > 1 && (
            <h3 className="critical-path__subheading">
              {t('views:timelineView.chain', { number: index + 1 })}
            </h3>
          )}
          <ol className="critical-path__list">
            {chain.map((id, at) => {
              const item = byId.get(id)
              const entry = spans.get(id)
              if (!item || !entry) return null
              const previous = at > 0 ? byId.get(chain[at - 1]) : undefined
              const link =
                previous &&
                dependencyLinksOf(item).find((candidate) => candidate.id === previous.id)
              return (
                <li key={id}>
                  {previous && link && (
                    <span className="critical-path__link">
                      {dependencyLinkWords(link, previous.title)}
                    </span>
                  )}
                  {taskButton(item, spanText(entry.start, entry.end))}
                </li>
              )
            })}
          </ol>
        </section>
      ))}
      {result.moreChains && (
        <p className="critical-path__note">
          {t('views:timelineView.moreChains', { count: result.chains.length })}
        </p>
      )}
      {undated.length > 0 && (
        <section className="critical-path__chain">
          <h3 className="critical-path__subheading">
            {t('views:timelineView.undatedNotCounted', { count: undated.length })}
          </h3>
          <ul className="critical-path__list">
            {undated.map((item) => (
              <li key={item.id}>{taskButton(item, null)}</li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
