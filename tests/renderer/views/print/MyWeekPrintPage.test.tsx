// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  HomeTask,
  MyWork,
  Person,
  PlanningMilestone,
  RendererProject
} from '@shared/ostler-api'
import { MyWeekPrintPage } from '@renderer/views/print/MyWeekPrintPage'
import { installOstlerApi } from '../../fixtures/ostler-api'

const project = (id: string, name: string, enabled = true) =>
  ({ id, name, path: null, color: '#3b82f6', enabled }) as RendererProject

const me: Person = {
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

const task = (id: string, overrides: Partial<HomeTask> = {}): HomeTask => ({
  id,
  projectId: 'p1',
  projectName: 'Website relaunch',
  projectColor: '#3b82f6',
  title: `Task ${id}`,
  status: 'ready',
  priority: 'medium',
  targetDate: null,
  assigneeId: 'ana',
  linked: false,
  ...overrides
})

const work: MyWork = {
  today: [
    task('late', {
      title: 'Send the invoice',
      reason: 'overdue',
      targetDate: '2026-10-12',
      priority: 'high'
    }),
    task('due', { title: 'Call the printer', reason: 'today', targetDate: '2026-10-15' }),
    task('doing', { title: 'Draft the brochure', reason: 'in-progress', status: 'active' })
  ],
  upcoming: [
    {
      date: '2026-10-17',
      tasks: [
        task('sat', { title: 'Book the hall', priority: 'critical', targetDate: '2026-10-17' })
      ]
    }
  ],
  myDay: [],
  leftOver: null
}

const milestone = (id: string, projectId: string, targetDate: string, status = 'planned') =>
  ({ id, projectId, name: `Launch ${id}`, targetDate, status }) as unknown as PlanningMilestone

beforeEach(() => {
  delete document.documentElement.dataset.printReady
  installOstlerApi({
    getMyWork: async (today) => {
      expect(today).toBe('2026-10-15')
      return { ok: true, value: work }
    },
    getProjects: async () => ({
      ok: true,
      value: [project('p1', 'Website relaunch'), project('p2', 'Paused', false)]
    }),
    getPeople: async () => ({ ok: true, value: [me] }),
    getPlanningMilestones: async (projectId) => ({
      ok: true,
      value:
        projectId === 'p1'
          ? [
              milestone('m1', 'p1', '2026-10-20'),
              milestone('done', 'p1', '2026-10-20', 'complete'),
              milestone('later', 'p1', '2026-11-20')
            ]
          : [milestone('paused', 'p2', '2026-10-20')]
    })
  })
})

describe('the my-week print page', () => {
  it('prints Today with reasons, every day of Upcoming, milestones and priority in words', async () => {
    render(<MyWeekPrintPage route={{ today: '2026-10-15' }} />)
    await waitFor(() => expect(document.documentElement.dataset.printReady).toBe('1'))

    expect(screen.getByRole('heading', { level: 1, name: 'My week' })).toBeInTheDocument()
    expect(screen.getByText(/For Ana Lima · Printed /)).toBeInTheDocument()
    // The dates it covers: today to the last day of Upcoming.
    expect(document.querySelector('.my-week__range')?.textContent).toMatch(/15.*22.*October/)

    const days = screen.getAllByRole('table')
    // Today and the seven days after it, empty ones included.
    expect(days).toHaveLength(8)
    expect(within(days[0]).getByText(/^Today, Thursday,? 15 October$/)).toBeInTheDocument()
    expect(within(days[7]).getByText(/^Thursday,? 22 October$/)).toBeInTheDocument()

    expect(
      within(days[0]).getByText(/^Website relaunch · High priority · Overdue, due 12 Oct 2026$/)
    ).toBeInTheDocument()
    expect(within(days[0]).getByText(/Due today/)).toBeInTheDocument()
    expect(within(days[0]).getByText(/In progress/)).toBeInTheDocument()

    expect(within(days[2]).getByText('Book the hall')).toBeInTheDocument()
    expect(within(days[2]).getByText(/Critical priority/)).toBeInTheDocument()

    // An empty day is ruled to write in.
    expect(within(days[1]).getByText('Nothing due')).toBeInTheDocument()
    expect(days[1].querySelectorAll('.my-week__rule').length).toBeGreaterThan(0)

    // Milestones due that week in enabled projects, open ones only.
    expect(within(days[5]).getByText('Milestone: Launch m1')).toBeInTheDocument()
    expect(screen.queryByText(/Launch done/)).toBeNull()
    expect(screen.queryByText(/Launch paused/)).toBeNull()
    expect(screen.queryByText(/Launch later/)).toBeNull()

    // A tick box on every task row, none on milestones.
    expect(document.querySelectorAll('.my-week__box')).toHaveLength(4)
  })

  it('says the page failed when the lists cannot be read', async () => {
    installOstlerApi({
      getMyWork: async () => ({ ok: false, error: 'Database is locked' }),
      getProjects: async () => ({ ok: true, value: [] }),
      getPeople: async () => ({ ok: true, value: [] })
    })
    render(<MyWeekPrintPage route={{ today: '2026-10-15' }} />)
    await waitFor(() => expect(document.documentElement.dataset.printReady).toBe('error'))
    expect(screen.getByRole('alert')).toHaveTextContent('Database is locked')
  })
})
