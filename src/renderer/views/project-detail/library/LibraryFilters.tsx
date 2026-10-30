import { useRef, useState } from 'react'
import type { LibraryAiAccess, LibraryAiContextSummary, LibraryItem } from '@shared/ostler-api'
import {
  LIBRARY_MAX_ALWAYS_IMAGES,
  LIBRARY_PLANNING_CONTEXT_BUDGET_CHARS
} from '@shared/ostler-api'
import { Button, Menu, Popover, ProgressBar } from '../../../ui'
import { ChevronDown, Sparkles, Tag, TriangleAlert } from '../../../ui/icons'
import { ACCESS_OPTIONS } from './libraryUi'
import { t } from '@shared/i18n'
import { formatNumber } from '@shared/format'

/** The items the filters count: archived ones are left out. */
function liveItems(items: LibraryItem[]): LibraryItem[] {
  return items.filter((item) => !item.archivedAt)
}

interface LibraryTagFilterProps {
  /** Every item, archived included. */
  items: LibraryItem[]
  tag: string | null
  onTag(tag: string | null): void
}

/** Tags, in the toolbar: show only the items with one tag. */
export function LibraryTagFilter({ items, tag, onTag }: LibraryTagFilterProps) {
  const tags = [...new Set(liveItems(items).flatMap((item) => item.tags))].sort((a, b) =>
    a.localeCompare(b)
  )
  return (
    <Menu
      label={t('library:libraryRail.tags')}
      placement="bottom-end"
      items={
        tags.length === 0
          ? [{ label: t('library:libraryRail.tagsHint'), disabled: true, onSelect: () => {} }]
          : [
              {
                label: t('library:libraryRail.allTags'),
                checked: tag === null,
                checkKind: 'radio',
                onSelect: () => onTag(null)
              },
              { type: 'separator' },
              ...tags.map((name) => ({
                label: `#${name}`,
                checked: tag === name,
                checkKind: 'radio' as const,
                onSelect: () => onTag(name)
              }))
            ]
      }
      renderTrigger={(trigger) => (
        <Button
          {...trigger}
          size="sm"
          variant={tag ? 'secondary' : 'ghost'}
          icon={Tag}
          iconEnd={ChevronDown}
          className="ostler-library-filter"
        >
          {tag ? `#${tag}` : t('library:libraryRail.tags')}
        </Button>
      )}
    />
  )
}

interface LibraryAiFilterProps {
  /** Every item, archived included. */
  items: LibraryItem[]
  access: LibraryAiAccess | null
  onAccess(access: LibraryAiAccess | null): void
  context: LibraryAiContextSummary | null
}

/**
 * Ostler AI, in the toolbar: how much Always material goes with each request,
 * and a filter by who reads an item. Shown only when Ostler AI is set up.
 */
export function LibraryAiFilter({ items, access, onAccess, context }: LibraryAiFilterProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const live = liveItems(items)
  const accessCount = (id: LibraryAiAccess) => live.filter((item) => item.aiAccess === id).length
  const over = Boolean(context && (context.overBudget || context.imagesDropped > 0))
  const chosen = ACCESS_OPTIONS.find((option) => option.id === access)

  return (
    <>
      <Button
        ref={anchor}
        size="sm"
        variant={access ? 'secondary' : 'ghost'}
        icon={over ? TriangleAlert : Sparkles}
        iconEnd={ChevronDown}
        className={`ostler-library-filter${over ? ' ostler-library-filter--over' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={over ? t('library:libraryRail.overBudgetSomeText') : undefined}
        onClick={() => setOpen(!open)}
      >
        {chosen
          ? t('library:libraryRail.aiFiltered', { access: chosen.label })
          : t('library:libraryRail.aiButton')}
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        label={t('library:libraryRail.context')}
        placement="bottom-end"
        className="ostler-library-ai-popover"
      >
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
                    ? t('library:libraryRail.alwaysImagesOverLimit', {
                        count: context.imagesDropped
                      })
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
        </section>
        <section
          className="ostler-library-rail-group"
          aria-label={t('library:libraryRail.showOnly')}
        >
          <div className="ostler-library-kicker">{t('library:libraryRail.showOnly')}</div>
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
      </Popover>
    </>
  )
}
