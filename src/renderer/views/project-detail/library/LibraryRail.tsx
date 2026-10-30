import type { LibraryAiAccess, LibraryAiContextSummary, LibraryItem } from '@shared/ostler-api'
import {
  LIBRARY_MAX_ALWAYS_IMAGES,
  LIBRARY_PLANNING_CONTEXT_BUDGET_CHARS
} from '@shared/ostler-api'
import { ProgressBar } from '../../../ui'
import { ACCESS_OPTIONS } from './libraryUi'
import { t } from '@shared/i18n'
import { formatNumber } from '@shared/format'

interface LibraryRailProps {
  /** Every item, archived included: the rail counts from these. */
  items: LibraryItem[]
  access: LibraryAiAccess | null
  onAccess(access: LibraryAiAccess | null): void
  tag: string | null
  onTag(tag: string | null): void
  context: LibraryAiContextSummary | null
}

export function LibraryRail({ items, access, onAccess, tag, onTag, context }: LibraryRailProps) {
  const live = items.filter((item) => !item.archivedAt)
  const accessCount = (id: LibraryAiAccess) => live.filter((item) => item.aiAccess === id).length
  const tags = [...new Set(live.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b))

  return (
    <aside className="ostler-library-rail" aria-label={t('library:libraryRail.libraryFilters')}>
      <section className="ostler-library-rail-group ostler-library-context">
        <div className="ostler-library-kicker">{t('library:libraryRail.context')}</div>
        {context ? (
          <>
            <div
              title={t('library:libraryRail.textAlwaysItemsSent', {
                planningBudget: formatNumber(LIBRARY_PLANNING_CONTEXT_BUDGET_CHARS)
              })}
            >
              <ProgressBar
                label={t('library:libraryRail.text')}
                showLabel
                value={Math.min(context.totalChars, context.budgetChars)}
                max={Math.max(1, context.budgetChars)}
                valueText={`${formatNumber(context.totalChars)} / ${formatNumber(context.budgetChars)}`}
                tone={context.overBudget ? 'danger' : 'accent'}
              />
              {context.overBudget && (
                <div className="ostler-library-meter-note">
                  {t('library:libraryRail.overBudgetSomeText')}
                </div>
              )}
            </div>
            <div
              className={`ostler-library-meter-label${context.imagesDropped > 0 ? ' over' : ''}`}
              title={
                context.imagesDropped > 0
                  ? t('library:libraryRail.alwaysImagesOverLimit', { count: context.imagesDropped })
                  : t('library:libraryRail.imagesAlwaysItemsSent')
              }
            >
              <span>{t('library:libraryRail.images')}</span>
              <span>
                {t('library:libraryRail.of', {
                  imageCount: context.imageCount,
                  LIBRARY_MAX_ALWAYS_IMAGES
                })}
              </span>
            </div>
          </>
        ) : (
          <div className="ostler-library-muted">{t('library:libraryRail.loading')}</div>
        )}
        {ACCESS_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`ostler-library-rail-item${access === option.id ? ' active' : ''}`}
            aria-pressed={access === option.id}
            onClick={() => onAccess(access === option.id ? null : option.id)}
          >
            <span>{option.label}</span>
            <span className="ostler-library-rail-count">{accessCount(option.id)}</span>
          </button>
        ))}
      </section>

      {tags.length > 0 && (
        <section className="ostler-library-rail-group">
          <div className="ostler-library-kicker">{t('library:libraryRail.tags')}</div>
          {tags.map((name) => (
            <button
              key={name}
              type="button"
              className={`ostler-library-rail-item${tag === name ? ' active' : ''}`}
              aria-pressed={tag === name}
              onClick={() => onTag(tag === name ? null : name)}
            >
              <span>#{name}</span>
            </button>
          ))}
        </section>
      )}
    </aside>
  )
}
