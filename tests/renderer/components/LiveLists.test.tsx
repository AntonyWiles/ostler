// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { SavedView } from '@shared/ostler-api'
import type { LiveListResult } from '@shared/live-list'
import { Markdown } from '@renderer/ui'
import { LiveListInsertDialog } from '@renderer/views/project-detail/library/LiveListInsertDialog'
import { installOstlerApi } from '../fixtures/ostler-api'

const P = '0f8fad5b-d9cb-469f-a165-70867728950e'
const FILTER = {
  match: 'all' as const,
  conditions: [{ field: 'status' as const, op: 'is' as const, value: ['active'] }]
}

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.search}</output>
}

const shown = (tasks: number, total: number): LiveListResult => ({
  ok: true,
  title: 'Open design work',
  words: 'Tasks where status is In progress',
  viewName: null,
  filter: FILTER,
  query: '',
  total,
  counts: [
    { status: 'active', label: 'in progress', count: 4 },
    { status: 'review', label: 'in review', count: 2 }
  ],
  tasks: Array.from({ length: tasks }, (_, index) => ({
    id: `task-${index}`,
    title: `Design ${index}`,
    status: 'active' as const,
    assigneeName: index === 0 ? 'Sam' : null,
    targetDate: null
  }))
})

function renderNote(text: string) {
  return render(
    <MemoryRouter>
      <Markdown projectId={P}>{text}</Markdown>
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('live lists in Markdown (N4.4c)', () => {
  it('draws a block as its tasks with counts, the limit and "and N more", in one call', async () => {
    const query = vi.fn(async (_projectId: string, blocks: string[]) => ({
      ok: true as const,
      value: blocks.map((block) =>
        block.includes('broken')
          ? ({
              ok: false,
              reason: 'invalid',
              problem: 'The filter is not valid JSON on one line.'
            } as const)
          : shown(2, 6)
      )
    }))
    installOstlerApi({ queryLiveLists: query })
    renderNote(
      [
        'Where things stand:',
        '',
        '```ostler-tasks',
        '# Tasks where status is In progress',
        `filter: ${JSON.stringify(FILTER)}`,
        'limit: 2',
        '```',
        '',
        '```ostler-tasks',
        'filter: {broken',
        '```'
      ].join('\n')
    )
    const list = await screen.findByRole('region', { name: 'Live list: Open design work' })
    expect(list.textContent).toContain('4 in progress, 2 in review')
    expect(screen.getByText('Design 0')).toBeTruthy()
    expect(screen.getByText('Design 1')).toBeTruthy()
    expect(screen.getByText('Sam')).toBeTruthy()
    // The broken block is a quiet note with its own text, not an error page.
    expect(screen.getByText(/This live list could not be read/)).toBeTruthy()
    expect(screen.getByText('filter: {broken')).toBeTruthy()
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][1]).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'and 4 more' }))
    const where = screen.getByTestId('where').textContent ?? ''
    expect(where.startsWith(`/projects/${P}/list?`)).toBe(true)
    const params = new URLSearchParams(where.split('?')[1])
    expect(JSON.parse(params.get('filter') ?? '')).toEqual(FILTER)
  })

  it('shows a deleted view quietly, with the block text', async () => {
    installOstlerApi({
      queryLiveLists: async () => ({
        ok: true,
        value: [
          {
            ok: false,
            reason: 'missingView',
            problem: 'The saved view this live list shows was deleted.'
          }
        ]
      })
    })
    renderNote('```ostler-tasks\nview: gone-view\n```')
    expect(await screen.findByText('The saved view this live list shows was deleted.')).toBeTruthy()
    expect(screen.getByText('view: gone-view')).toBeTruthy()
  })
})

describe('Insert a live list (N4.4c)', () => {
  const view: SavedView = {
    id: 'view-1',
    projectId: P,
    name: 'Design in progress',
    viewType: 'board',
    config: { filter: FILTER, query: '', options: {} },
    isDefault: false,
    position: 0,
    createdAt: 0,
    updatedAt: 0
  } as SavedView

  function install(views: SavedView[]) {
    const query = vi.fn(async (_projectId: string, blocks: string[]) => ({
      ok: true as const,
      value: blocks.map(() => ({
        ...shown(1, 1),
        title: null,
        words: 'Tasks in the saved view “Design in progress”'
      }))
    }))
    installOstlerApi({
      listSavedViews: async () => ({ ok: true, value: views }),
      getPlanningMilestones: async () => ({ ok: true, value: [] }),
      getPlanningGoals: async () => ({ ok: true, value: [] }),
      getPlanningLabels: async () => ({ ok: true, value: [] }),
      getPlanningIterations: async () => ({ ok: true, value: [] }),
      getPlanningTaskTypes: async () => ({ ok: true, value: [] }),
      getPlanningFields: async () => ({ ok: true, value: [] }),
      queryLiveLists: query
    })
    return query
  }

  it('inserts a block from a saved view, with its words line, title and limit', async () => {
    install([view])
    const onInsert = vi.fn()
    render(
      <MemoryRouter>
        <LiveListInsertDialog open projectId={P} onClose={() => {}} onInsert={onInsert} />
      </MemoryRouter>
    )
    expect(await screen.findByText(/uses the view’s filter and search only/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Design now' } })
    // The preview is the live list itself.
    await screen.findByText('Design 0')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Insert' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    const block = onInsert.mock.calls[0][0] as string
    expect(block).toBe(
      [
        '```ostler-tasks',
        '# Tasks in the saved view “Design in progress”',
        'view: view-1',
        'title: Design now',
        '```'
      ].join('\n')
    )
  })

  it('inserts a block from a filter when the project has no saved views', async () => {
    install([])
    const onInsert = vi.fn()
    render(
      <MemoryRouter>
        <LiveListInsertDialog open projectId={P} onClose={() => {}} onInsert={onInsert} />
      </MemoryRouter>
    )
    expect(await screen.findByText(/has no saved views yet/)).toBeTruthy()
    const limit = screen.getByLabelText(/Show at most/)
    fireEvent.change(limit, { target: { value: '5' } })
    await screen.findByText('Design 0')
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    const block = onInsert.mock.calls[0][0] as string
    expect(block).toContain('filter: {"match":"all","conditions":[]}')
    expect(block).toContain('limit: 5')
    expect(block.startsWith('```ostler-tasks\n# ')).toBe(true)
  })
})
