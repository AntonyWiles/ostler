// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryItem } from '@shared/ostler-api'
import { cleanWhiteboardObject, type WhiteboardObject } from '@shared/whiteboard/model'
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
    tags: [],
    revision: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    archivedAt: null
  }
}

const NOTE_OBJECT: WhiteboardObject = {
  ...cleanWhiteboardObject({
    id: 'o1',
    kind: 'note',
    text: 'Hello',
    x: 0,
    y: 0,
    width: 160,
    height: 120,
    z: 1
  }),
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z'
}

const ITEMS = [
  item('n1', 'note', 'Tester feedback'),
  item('wb1', 'whiteboard', 'Ideas'),
  item('wb2', 'whiteboard', 'Blank board')
]

function setup() {
  installOstlerApi({
    listLibraryItems: async () => ({ ok: true, value: ITEMS }),
    getLibraryAiContextSummary: async () => ({
      ok: true,
      value: {
        included: [],
        listed: [],
        totalChars: 0,
        budgetChars: 2000,
        imageCount: 0,
        maxImages: 4,
        overBudget: false,
        imagesDropped: 0
      }
    }),
    listItemWorkItems: async () => ({ ok: true, value: [] }),
    listItemAttachments: async () => ({ ok: true, value: [] }),
    getWhiteboard: async (_projectId, id) => {
      const board = ITEMS.find((each) => each.id === id)!
      return { ok: true, value: { item: board, objects: id === 'wb1' ? [NOTE_OBJECT] : [] } }
    }
  })
}

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function renderLibrary(itemId: string | null = null) {
  setup()
  const entry = `/projects/p1/library${itemId ? `?item=${itemId}` : ''}`
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/projects/p1/library"
          element={<LibraryPanel projectId="p1" initialItemId={itemId} />}
        />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>
  )
}

const where = () => screen.getByTestId('where').textContent

describe('Library, whiteboards', () => {
  // jsdom's canvas has no 2D context; stubbed so the preview's text measure does not log.
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    return () => vi.restoreAllMocks()
  })

  it('has a Whiteboards section that lists only whiteboards', async () => {
    renderLibrary()
    await screen.findByText('Tester feedback')
    const sections = screen.getByRole('tablist', { name: 'Library sections' })
    fireEvent.click(within(sections).getByRole('tab', { name: /Whiteboards/ }))

    expect(screen.getByText('Ideas')).toBeInTheDocument()
    expect(screen.getByText('Blank board')).toBeInTheDocument()
    expect(screen.queryByText('Tester feedback')).not.toBeInTheDocument()
  })

  it('makes a new whiteboard through the Plan', async () => {
    renderLibrary()
    await screen.findByText('Tester feedback')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New whiteboard' }))

    expect(where()).toBe('/projects/p1/plan?newWhiteboard=1')
  })

  it('opens a whiteboard row in the Plan', async () => {
    renderLibrary()
    fireEvent.doubleClick(await screen.findByText('Ideas'))

    expect(where()).toBe('/projects/p1/plan?whiteboard=wb1')
  })

  it('sends ?item=<whiteboard> on to the Plan, in place of the address', async () => {
    renderLibrary('wb1')

    await waitFor(() => expect(where()).toBe('/projects/p1/plan?whiteboard=wb1'))
  })

  it('still selects a note named by ?item=', async () => {
    renderLibrary('n1')

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Tester feedback' })
    ).toBeInTheDocument()
    expect(where()).toBe('/projects/p1/library?item=n1')
  })

  it('shows a whiteboard’s preview with Open whiteboard and no Edit', async () => {
    renderLibrary()
    fireEvent.click(await screen.findByText('Ideas'))

    const detail = await screen.findByRole('complementary', { name: 'Library item' })
    expect(await within(detail).findByRole('img', { name: 'Preview of Ideas' })).toBeInTheDocument()
    expect(within(detail).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()

    fireEvent.click(within(detail).getByRole('button', { name: 'Open whiteboard' }))
    expect(where()).toBe('/projects/p1/plan?whiteboard=wb1')
  })

  it('says when a whiteboard is empty', async () => {
    renderLibrary()
    fireEvent.click(await screen.findByText('Blank board'))

    const detail = await screen.findByRole('complementary', { name: 'Library item' })
    expect(await within(detail).findByText('This whiteboard is empty')).toBeInTheDocument()
    expect(within(detail).queryByRole('img')).not.toBeInTheDocument()
  })
})
