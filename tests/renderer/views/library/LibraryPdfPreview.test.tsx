// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LibraryItem } from '@shared/ostler-api'
import { LibraryPdfPreview } from '@renderer/views/project-detail/library/LibraryPdfPreview'

const PDF: LibraryItem = {
  id: 'd1',
  projectId: 'p1',
  kind: 'document',
  title: 'Quote',
  summary: '',
  body: '',
  url: null,
  file: {
    fileName: 'quote.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    sha256: 'x',
    pageCount: 3
  } as LibraryItem['file'],
  aiAccess: 'human-only',
  isPrimaryBrief: false,
  tags: [],
  revision: 2,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  archivedAt: null
}

describe('LibraryPdfPreview', () => {
  it('shows one page at a time, with Previous and Next', () => {
    render(<LibraryPdfPreview item={PDF} fallback={<p>The text</p>} />)
    expect(screen.getByRole('img').getAttribute('src')).toBe('ostler-library://p1/d1/page-1?r=2')
    expect(screen.getByText('Page 1 of 3')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByRole('img', { name: 'Quote, Page 2 of 3' }).getAttribute('src')).toBe(
      'ostler-library://p1/d1/page-2?r=2'
    )
  })

  it('falls back to the text when a page cannot be drawn', () => {
    render(<LibraryPdfPreview item={PDF} fallback={<p>The text</p>} />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('The text')).toBeTruthy()
  })
})
