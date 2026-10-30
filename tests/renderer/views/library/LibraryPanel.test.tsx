// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { CreateLibraryItemInput, LibraryItem } from '@shared/ostler-api'
import { LibraryPanel } from '@renderer/views/project-detail/library/LibraryPanel'
import { installOstlerApi } from '../../fixtures/ostler-api'

function item(id: string, kind: LibraryItem['kind'], title: string): LibraryItem {
  return {
    id,
    projectId: 'p1',
    kind,
    title,
    summary: '',
    body: '',
    url: null,
    file: null,
    aiAccess: 'when-selected',
    isPrimaryBrief: false,
    tags: kind === 'note' ? ['beta'] : [],
    revision: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    archivedAt: null
  }
}

const ITEMS = [
  item('a', 'guide', 'Writing style guide'),
  item('b', 'note', 'Tester feedback'),
  { ...item('c', 'note', 'Old idea'), archivedAt: '2026-10-02T00:00:00.000Z' }
]

function renderLibrary() {
  const updateLibraryItem = vi.fn(async () => ({ ok: true as const, value: ITEMS[0] }))
  const createLibraryItem = vi.fn(async (_projectId: string, _input: CreateLibraryItemInput) => ({
    ok: true as const,
    value: ITEMS[1]
  }))
  installOstlerApi({
    listLibraryItems: async () => ({ ok: true, value: ITEMS }),
    getLibraryAiContextSummary: async () => ({
      ok: true,
      value: {
        included: [],
        listed: [],
        totalChars: 500,
        budgetChars: 2000,
        imageCount: 0,
        maxImages: 4,
        overBudget: false,
        imagesDropped: 0
      }
    }),
    listItemWorkItems: async () => ({ ok: true, value: [] }),
    listItemAttachments: async () => ({ ok: true, value: [] }),
    updateLibraryItem,
    createLibraryItem
  })
  render(
    <MemoryRouter>
      <LibraryPanel projectId="p1" initialItemId={null} />
    </MemoryRouter>
  )
  return { updateLibraryItem, createLibraryItem }
}

describe('LibraryPanel', () => {
  it('filters by section with tabs, Archived among them', async () => {
    renderLibrary()
    const sections = screen.getByRole('tablist', { name: 'Library sections' })
    await screen.findByText('Writing style guide')

    fireEvent.click(within(sections).getByRole('tab', { name: /Notes/ }))
    expect(screen.queryByText('Writing style guide')).toBeNull()
    expect(screen.getByText('Tester feedback')).toBeTruthy()

    fireEvent.click(within(sections).getByRole('tab', { name: /Archived/ }))
    expect(screen.getByText('Old idea')).toBeTruthy()
    expect(screen.queryByText('Tester feedback')).toBeNull()
  })

  it('shows the AI context as a progress bar and tags as chips', async () => {
    renderLibrary()
    expect(await screen.findByRole('progressbar', { name: 'Text' })).toHaveAttribute(
      'aria-valuetext',
      '500 / 2,000'
    )
    await screen.findByText('Tester feedback')
    expect(screen.getAllByText('#beta').length).toBeGreaterThan(0)
  })

  it('sets Ostler AI access with a segmented control', async () => {
    const { updateLibraryItem } = renderLibrary()
    fireEvent.click(await screen.findByText('Writing style guide'))
    const access = await screen.findByRole('radiogroup', { name: 'Ostler AI access' })
    fireEvent.click(within(access).getByRole('radio', { name: 'Always' }))
    await waitFor(() =>
      expect(updateLibraryItem).toHaveBeenCalledWith('p1', 'a', { aiAccess: 'always' })
    )
  })

  it('starts new meeting notes When selected, so Find actions works at once', async () => {
    const { createLibraryItem } = renderLibrary()
    await screen.findByText('Writing style guide')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New meeting notes' }))
    fireEvent.change(await screen.findByPlaceholderText('Title'), {
      target: { value: 'Site visit' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(createLibraryItem).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ kind: 'note', title: 'Site visit', aiAccess: 'when-selected' })
      )
    )
  })

  it('starts a plain new note with the kind’s own access, set by the Library', async () => {
    const { createLibraryItem } = renderLibrary()
    await screen.findByText('Writing style guide')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New note' }))
    fireEvent.change(await screen.findByPlaceholderText('Title'), {
      target: { value: 'Idea' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(createLibraryItem).toHaveBeenCalled())
    expect(createLibraryItem.mock.calls[0][1]).not.toHaveProperty('aiAccess')
  })

  it('imports what the clipboard holds from Add, and says when it holds nothing', async () => {
    renderLibrary()
    const importLibraryFromClipboard = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { item: ITEMS[1] } })
      .mockResolvedValueOnce({ ok: true, value: null })
    window.ostlerAPI.importLibraryFromClipboard = importLibraryFromClipboard
    await screen.findByText('Writing style guide')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Import from clipboard' }))
    await waitFor(() => expect(importLibraryFromClipboard).toHaveBeenCalledWith('p1'))

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Import from clipboard' }))
    expect(await screen.findByText(/The clipboard has nothing to keep/)).toBeTruthy()
  })

  it('shows a clear overlay while files are dragged over it', async () => {
    renderLibrary()
    await screen.findByText('Writing style guide')
    const library = document.querySelector('.ostler-library')!
    fireEvent.dragEnter(library, { dataTransfer: { types: ['Files'], files: [] } })
    expect(screen.getByText('Drop to add to the library')).toBeTruthy()
  })
})
