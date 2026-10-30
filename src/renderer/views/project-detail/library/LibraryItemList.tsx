import type React from 'react'
import type { LibraryItem } from '@shared/ostler-api'
import { Badge, Card, Checkbox, Chip } from '../../../ui'
import { Icon, Image } from '../../../ui/icons'
import type { LibrarySelection } from './useLibrarySelection'
import { ACCESS_BADGE, ACCESS_TONE, KIND_LABEL, libraryFileUrl, relativeTime } from './libraryUi'
import { useFeatures } from '../../../navigation/features'
import { t } from '@shared/i18n'

interface LibraryItemListProps {
  /** In display order: references first, then the rows. */
  references: LibraryItem[]
  rows: LibraryItem[]
  activeId: string | null
  focusedId: string | null
  selection: LibrarySelection
  onActivate(item: LibraryItem, event: React.MouseEvent): void
  onOpen(item: LibraryItem): void
}

/** Only when Ostler AI is set up: otherwise who may read an item means nothing here. */
function AccessBadge({ item }: { item: LibraryItem }) {
  return <Badge tone={ACCESS_TONE[item.aiAccess]}>{ACCESS_BADGE[item.aiAccess]}</Badge>
}

/**
 * A written item's first line of text, skipping headings (a new brief is all
 * headings) and list marks, so a row says what the item is about.
 */
function firstLine(body: string): string {
  for (const line of body.split('\n')) {
    if (/^\s*#/.test(line)) continue
    const text = line.replace(/^\s*([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/, '').trim()
    if (text) return text
  }
  return ''
}

export function Tick({ item, selection }: { item: LibraryItem; selection: LibrarySelection }) {
  return (
    // A picture of a checkbox that toggles on click. The item's
    // aria-selected says whether it is selected, and Space toggles it from
    // the keyboard; a real checkbox inside an option is a nested control
    // that assistive tech still reaches (P9.2), so this one is inert.
    <span
      className="ostler-library-tick"
      aria-hidden="true"
      onClick={(event) => {
        event.stopPropagation()
        selection.toggle(item.id)
      }}
    >
      <span className="ostler-library-tick__box" inert>
        <Checkbox label={null} checked={selection.has(item.id)} readOnly tabIndex={-1} />
      </span>
    </span>
  )
}

/** The DOM id of an item's option, for aria-activedescendant. */
export function libraryOptionId(itemId: string): string {
  return `library-item-${itemId}`
}

export function LibraryItemList({
  references,
  rows,
  activeId,
  focusedId,
  selection,
  onActivate,
  onOpen
}: LibraryItemListProps) {
  const ai = useFeatures().ai
  const classFor = (item: LibraryItem, base: string) =>
    [
      base,
      item.id === activeId ? 'active' : '',
      item.id === focusedId ? 'focused' : '',
      selection.has(item.id) ? 'selected' : '',
      item.archivedAt ? 'archived' : ''
    ]
      .filter(Boolean)
      .join(' ')

  // Each list takes focus itself and points at the focused item, so Tab
  // reaches it and a screen reader follows the arrow keys (P9.2).
  const listProps = (label: string, items: LibraryItem[]) => ({
    role: 'listbox',
    'aria-label': label,
    'aria-multiselectable': true,
    tabIndex: 0,
    'aria-activedescendant':
      focusedId && items.some((item) => item.id === focusedId)
        ? libraryOptionId(focusedId)
        : undefined
  })

  return (
    <>
      {references.length > 0 && (
        <div
          className="ostler-library-grid"
          {...listProps(t('library:libraryItemList.references'), references)}
        >
          {references.map((item) => (
            <Card
              key={item.id}
              id={libraryOptionId(item.id)}
              role="option"
              aria-selected={selection.has(item.id)}
              data-library-item={item.id}
              interactive
              selected={item.id === activeId}
              padding="none"
              tabIndex={-1}
              className={classFor(item, 'ostler-library-tile')}
              onClick={(event) => onActivate(item, event)}
              onDoubleClick={() => onOpen(item)}
            >
              <div className="ostler-library-tile-image">
                {item.file ? (
                  <img src={libraryFileUrl(item, 'thumb')} alt={item.title} loading="lazy" />
                ) : (
                  <span className="ostler-library-muted">
                    <Icon icon={Image} size="lg" />
                    {t('library:libraryItemList.noPreview')}
                  </span>
                )}
              </div>
              <div className="ostler-library-tile-meta">
                <Tick item={item} selection={selection} />
                <span className="ostler-library-tile-title" title={item.title}>
                  {item.title}
                </span>
                {ai && <AccessBadge item={item} />}
              </div>
            </Card>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div
          className="ostler-library-rows"
          {...listProps(t('library:libraryItemList.libraryItems'), rows)}
        >
          {rows.map((item) => (
            <div
              key={item.id}
              id={libraryOptionId(item.id)}
              role="option"
              aria-selected={selection.has(item.id)}
              data-library-item={item.id}
              className={classFor(item, 'ostler-library-row')}
              onClick={(event) => onActivate(item, event)}
              onDoubleClick={() => onOpen(item)}
            >
              <Tick item={item} selection={selection} />
              <span className="ostler-library-row-kind">{KIND_LABEL[item.kind]}</span>
              <span className="ostler-library-row-main">
                <span className="ostler-library-row-title">
                  {item.isPrimaryBrief && (
                    <Badge tone="success">{t('library:libraryItemList.primary')}</Badge>
                  )}
                  {item.title}
                </span>
                <span className="ostler-library-row-summary">
                  {item.summary || (item.kind === 'link' ? item.url : firstLine(item.body))}
                </span>
              </span>
              {ai && <AccessBadge item={item} />}
              <span className="ostler-library-row-tags">
                {item.tags.map((tag) => (
                  <Chip key={tag}>#{tag}</Chip>
                ))}
              </span>
              <span className="ostler-library-row-updated" title={item.updatedAt}>
                {relativeTime(item.updatedAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
