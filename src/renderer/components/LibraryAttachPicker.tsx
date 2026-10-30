import { useEffect, useMemo, useRef, useState } from 'react'
import type { LibraryItem } from '@shared/ostler-api'
import { KIND_LABEL } from '../views/project-detail/library/libraryUi'
import { Badge, Button } from '../ui'
import './LibraryAttachPicker.css'
import { t } from '@shared/i18n'
import { useFeatures } from '../navigation/features'

interface LibraryAttachPickerProps {
  /** Every library item of the project; the picker offers only the AI-visible ones. */
  items: LibraryItem[]
  selectedIds: string[]
  onToggle: (item: LibraryItem) => void
  onClose: () => void
  /** Human-only items are offered too, marked when Ostler AI is set up, rather than hidden. */
  includeHumanOnly?: boolean
  label?: string
}

/**
 * Searchable picker for "Attach from Library". It only narrows what is
 * offered; the main process re-checks every id through `aiVisibleItem`.
 */
export function LibraryAttachPicker({
  items,
  selectedIds,
  onToggle,
  onClose,
  includeHumanOnly = false,
  label = t('library:libraryAttachPicker.attachLibrary')
}: LibraryAttachPickerProps) {
  const ai = useFeatures().ai
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const offered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items
      .filter((item) => !item.archivedAt && (includeHumanOnly || item.aiAccess !== 'human-only'))
      .filter(
        (item) =>
          !needle ||
          item.title.toLowerCase().includes(needle) ||
          item.summary.toLowerCase().includes(needle) ||
          item.tags.some((tag) => tag.toLowerCase().includes(needle))
      )
  }, [items, query, includeHumanOnly])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [onClose])

  return (
    <div
      ref={rootRef}
      className="ostler-library-attach-picker"
      role="dialog"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        // The picker can sit inside a form (the work item drawer); Enter must not submit it.
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault()
        }}
        placeholder={t('library:libraryAttachPicker.searchLibrary')}
        aria-label={t('library:libraryAttachPicker.searchLibrary2')}
      />
      <ul>
        {offered.length === 0 && (
          <li className="ostler-library-attach-empty">
            {items.length === 0
              ? t('library:libraryAttachPicker.libraryEmpty')
              : includeHumanOnly
                ? t('library:libraryAttachPicker.noLibraryItemsMatch')
                : t('library:libraryAttachPicker.noItemsOstlerAi')}
          </li>
        )}
        {offered.map((item) => {
          const checked = selectedIds.includes(item.id)
          return (
            <li key={item.id}>
              <label>
                <input type="checkbox" checked={checked} onChange={() => onToggle(item)} />
                <span className="ostler-library-attach-kind">{KIND_LABEL[item.kind]}</span>
                <span className="ostler-library-attach-title">{item.title}</span>
                {ai && item.aiAccess === 'human-only' && (
                  <Badge tone="warning">{t('library:libraryAttachPicker.notReadAi')}</Badge>
                )}
                {item.summary && (
                  <span className="ostler-library-attach-summary">{item.summary}</span>
                )}
              </label>
            </li>
          )
        })}
      </ul>
      <div className="ostler-library-attach-footer">
        <Button size="sm" onClick={onClose}>
          {t('library:libraryAttachPicker.done')}
        </Button>
      </div>
    </div>
  )
}
