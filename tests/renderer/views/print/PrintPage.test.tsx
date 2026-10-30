// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Person, PlanningMilestone, RendererProject } from '@shared/ostler-api'
import { parsePrintHash, printHashPath } from '@shared/print-route'
import { PrintPage } from '@renderer/views/print/PrintPage'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { makeWorkItem } from '../../fixtures/planning-records'

const project = {
  id: 'p1',
  name: 'Website relaunch',
  path: null,
  color: '#3b82f6',
  enabled: true,
  customIgnorePatterns: [],
  notes: '',
  tags: [],
  addedAt: 0,
  lastActivity: null,
  hasAutomationToken: false
} as RendererProject

const people: Person[] = [
  {
    id: 'ana',
    name: 'Ana Lima',
    initials: 'AL',
    color: '#3b82f6',
    isMe: true,
    archivedAt: null,
    weeklyCapacityHours: null,
    workingDays: [1, 2, 3, 4, 5],
    projectId: null,
    createdAt: 0,
    updatedAt: 0
  }
]
const milestones = [
  { id: 'm1', name: 'Beta', goalId: null, targetDate: '2026-11-01', status: 'planned' }
] as unknown as PlanningMilestone[]

// 300 tasks: far more than a virtualised list would put on the page.
const items = Array.from({ length: 300 }, (_, index) =>
  makeWorkItem(`t${index}`, {
    title: `Task ${String(index).padStart(3, '0')}`,
    status: index % 10 === 0 ? 'done' : 'ready',
    assigneeId: index % 2 === 0 ? 'ana' : null,
    milestoneId: 'm1',
    startDate: '2026-10-01',
    targetDate: `2026-10-${String((index % 28) + 1).padStart(2, '0')}`
  })
)

beforeEach(() => {
  delete document.documentElement.dataset.printReady
  installOstlerApi({
    getProjects: async () => ({ ok: true, value: [project] }),
    getPlanningWorkItems: async () => ({ ok: true, value: items }),
    getPlanningFields: async () => ({ ok: true, value: [] }),
    getPlanningMilestones: async () => ({ ok: true, value: milestones }),
    getPlanningGoals: async () => ({ ok: true, value: [] }),
    getPeople: async () => ({ ok: true, value: people }),
    getPlanningCommentCounts: async () => ({ ok: true, value: {} }),
    getDefaultSavedView: async () => ({ ok: true, value: null })
  })
})

describe('the print route', () => {
  it('round trips its address', () => {
    const config = { filter: { match: 'all' as const, conditions: [] }, query: 'x', options: {} }
    expect(parsePrintHash(printHashPath('p 1', { view: 'list', config }))).toEqual({
      projectId: 'p 1',
      view: 'list',
      config
    })
    expect(parsePrintHash('/projects/p1/list')).toBeNull()
  })

  it('prints every row of the List, with its columns and a header, then says it is ready', async () => {
    render(
      <PrintPage
        route={{
          projectId: 'p1',
          view: 'list',
          config: {
            filter: { match: 'all', conditions: [] },
            query: '',
            options: {
              columns: [
                { id: 'title', visible: true, width: null },
                { id: 'assignee', visible: true, width: null },
                { id: 'due', visible: true, width: null }
              ],
              sort: [{ columnId: 'title', direction: 'desc' }],
              groupBy: 'none'
            }
          }
        }}
      />
    )
    expect(await screen.findByRole('heading', { name: 'Website relaunch' })).toBeInTheDocument()
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(301)
    expect(
      within(rows[0])
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual([
      'Title',
      'Assignee',
      'Due',
      // Missing from the saved columns, so shown as by default.
      'Status'
    ])
    // Sorted as the List is: title, descending.
    expect(within(rows[1]).getAllByRole('cell')[0]).toHaveTextContent('Task 299')
    expect(screen.getByText(/List · 300 tasks/)).toBeInTheDocument()
    expect(screen.getByText('All tasks')).toBeInTheDocument()
    await waitFor(() => expect(document.documentElement.dataset.printReady).toBe('1'))
  })

  it('applies the view’s filter and says which it is', async () => {
    render(
      <PrintPage
        route={{
          projectId: 'p1',
          view: 'list',
          config: {
            filter: {
              match: 'all',
              conditions: [{ field: 'assignee', op: 'is', value: ['ana'] }]
            },
            query: '',
            options: { hideDone: true }
          }
        }}
      />
    )
    await screen.findByRole('table')
    // Ana's tasks are the even ones; Done (every tenth) is hidden.
    expect(screen.getAllByRole('row')).toHaveLength(1 + 150 - 30)
    expect(screen.getByText(/Assignee is Ana Lima; Done hidden/)).toBeInTheDocument()
  })

  it('prints every task on the Timeline and the Overview', async () => {
    const { unmount } = render(
      <PrintPage route={{ projectId: 'p1', view: 'timeline', config: null }} />
    )
    await screen.findByRole('table')
    // As on screen: done work shows only with "Show done".
    expect(screen.getAllByText(/^Task \d{3}$/)).toHaveLength(270)
    unmount()
    const shown = render(
      <PrintPage
        route={{
          projectId: 'p1',
          view: 'timeline',
          config: {
            filter: { match: 'all', conditions: [] },
            query: '',
            options: { hideDone: false }
          }
        }}
      />
    )
    await screen.findByRole('table')
    expect(screen.getAllByText(/^Task \d{3}$/)).toHaveLength(300)
    shown.unmount()
    render(<PrintPage route={{ projectId: 'p1', view: 'overview', config: null }} />)
    expect(await screen.findByRole('heading', { name: 'Milestones' })).toBeInTheDocument()
    // Open tasks are listed by status (Done is counted, not listed).
    expect(screen.getAllByText(/^Task \d{3}$/)).toHaveLength(270)
  })

  it('tells main when it cannot print', async () => {
    window.ostlerAPI.getProjects = async () => ({ ok: true, value: [] })
    render(<PrintPage route={{ projectId: 'gone', view: 'list', config: null }} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Project not found')
    expect(document.documentElement.dataset.printReady).toBe('error')
  })
})
