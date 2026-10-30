// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { CreateLibraryItemInput, LibraryItem } from '@shared/ostler-api'
import { LibraryPanel } from '@renderer/views/project-detail/library/LibraryPanel'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
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

function renderLibrary({ ai = false }: { ai?: boolean } = {}) {
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
    <StaticFeaturesProvider value={{ ai, agents: false }}>
      <MemoryRouter>
        <LibraryPanel projectId="p1" initialItemId={null} />
      </MemoryRouter>
    </StaticFeaturesProvider>
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

  it('shows the AI context and filters by access from the Ostler AI button', async () => {
    renderLibrary({ ai: true })
    await screen.findByText('Tester feedback')
    fireEvent.click(screen.getByRole('button', { name: 'Ostler AI' }))
    expect(await screen.findByRole('progressbar', { name: 'Text' })).toHaveAttribute(
      'aria-valuetext',
      '500 / 2,000'
    )
    const showOnly = screen.getByRole('region', { name: 'Show only' })
    fireEvent.click(within(showOnly).getByRole('button', { name: /Always/ }))
    expect(screen.queryByText('Tester feedback')).toBeNull()
    expect(screen.getByRole('button', { name: 'Ostler AI: Always' })).toBeTruthy()
  })

  it('filters by tag from the Tags menu, with no left-hand rail', async () => {
    renderLibrary()
    await screen.findByText('Writing style guide')
    expect(screen.queryByRole('complementary', { name: 'Library filters' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '#beta' }))
    expect(screen.queryByText('Writing style guide')).toBeNull()
    expect(screen.getByText('Tester feedback')).toBeTruthy()
    expect(screen.getByRole('button', { name: '#beta' })).toBeTruthy()
  })

  it('drags the details wider from their left edge, and remembers it', async () => {
    window.localStorage.removeItem('ostler.library-detail-width')
    renderLibrary()
    await screen.findByText('Writing style guide')
    const handle = screen.getByRole('separator', { name: 'Resize details' })
    const before = Number(handle.getAttribute('aria-valuenow'))
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(Number(handle.getAttribute('aria-valuenow'))).toBe(before + 32)
    expect(window.localStorage.getItem('ostler.library-detail-width')).toBe(String(before + 32))
  })

  it('sets Ostler AI access with a segmented control', async () => {
    const { updateLibraryItem } = renderLibrary({ ai: true })
    fireEvent.click(await screen.findByText('Writing style guide'))
    const access = await screen.findByRole('radiogroup', { name: 'Ostler AI reads it' })
    fireEvent.click(within(access).getByRole('radio', { name: 'Always' }))
    await waitFor(() =>
      expect(updateLibraryItem).toHaveBeenCalledWith('p1', 'a', { aiAccess: 'always' })
    )
  })

  it('without Ostler AI, shows no AI access, context or badges, and keeps tags', async () => {
    renderLibrary()
    fireEvent.click(await screen.findByText('Writing style guide'))
    await screen.findByLabelText('Summary')
    expect(screen.queryByRole('radiogroup', { name: 'Ostler AI reads it' })).toBeNull()
    expect(screen.queryByRole('progressbar', { name: 'Text' })).toBeNull()
    expect(screen.queryByText('AI when selected')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ostler AI' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Tags' })).toBeTruthy()
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
