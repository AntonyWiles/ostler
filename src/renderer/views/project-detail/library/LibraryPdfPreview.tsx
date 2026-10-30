import { useState, type ReactNode } from 'react'
import type { LibraryItem } from '@shared/ostler-api'
import { IconButton } from '../../../ui/IconButton'
import { ChevronLeft, ChevronRight } from '../../../ui/icons'
import { libraryFileUrl } from './libraryUi'
import { t } from '@shared/i18n'
import { formatNumber } from '@shared/format'

interface LibraryPdfPreviewProps {
  item: LibraryItem
  /** Shown instead when a page cannot be drawn: the PDF's text. */
  fallback: ReactNode
}

/** A PDF's pages as pictures, one at a time, drawn by main on first ask. */
export function LibraryPdfPreview({ item, fallback }: LibraryPdfPreviewProps) {
  const pageCount = Math.max(1, item.file?.pageCount ?? 1)
  const [page, setPage] = useState(1)
  const [failed, setFailed] = useState(false)
  if (failed) return <>{fallback}</>

  const label = t('library:libraryDetail.pageOf', {
    page: formatNumber(page),
    pageCount: formatNumber(pageCount)
  })
  return (
    <figure className="ostler-library-page">
      <img
        key={page}
        className="ostler-library-page-image"
        src={libraryFileUrl(item, `page-${page}`)}
        alt={t('library:libraryDetail.pageImage', { title: item.title, page: label })}
        onError={() => setFailed(true)}
      />
      {pageCount > 1 && (
        <figcaption className="ostler-library-page-nav">
          <IconButton
            size="sm"
            icon={ChevronLeft}
            label={t('library:libraryDetail.previousPage')}
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          />
          <span aria-live="polite">{label}</span>
          <IconButton
            size="sm"
            icon={ChevronRight}
            label={t('library:libraryDetail.nextPage')}
            disabled={page >= pageCount}
            onClick={() => setPage(page + 1)}
          />
        </figcaption>
      )}
    </figure>
  )
}
