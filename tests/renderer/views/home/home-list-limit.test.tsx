// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type {
  HomeChecklistItem,
  HomeTask,
  MyWork,
  NeedsYouEntry,
  RendererProject
} from '@shared/ostler-api'
import { shiftIsoDate, todayIsoDate } from '@shared/dates'
import { HomeView } from '@renderer/views/home/HomeView'
import { HOME_LIST_LIMIT, shareLimit } from '@renderer/views/home/HomeListMore'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const projects = [
  {
    id: 'web',
    name: 'Website',
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
]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects, loading: false })
}))
// Home's lists are what is under test.
vi.mock('@renderer/views/home/HomeProjects', () => ({
  HomeProjects: () => null,
  ProjectsLayoutSwitch: () => null,
  useProjectsLayout: () => ['cards', () => {}]
}))

const today = todayIsoDate()
const task = (index: number, date: string): HomeTask => ({
  id: `t${index}`,
  projectId: 'web',
  projectName: 'Website',
  projectColor: '#3b82f6',
  title: `Task ${index}`,
  status: 'ready',
  priority: 'medium',
  targetDate: date,
  assigneeId: null,
  linked: false,
  reason: 'today'
})
const item = (index: number): HomeChecklistItem => ({
  workItemId: 't0',
  projectId: 'web',
  projectName: 'Website',
  projectColor: '#3b82f6',
  taskTitle: 'Task 0',
  text: `Item ${index}`,
  dueDate: today,
  assigneeId: null,
  overdue: false
})
const needs = (index: number): NeedsYouEntry => ({
  key: `blocked:b${index}`,
  kind: 'blocked',
  projectId: 'web',
  title: `Blocked ${index}`,
  taskId: `b${index}`
})

function renderHome(work: MyWork, waiting: NeedsYouEntry[]) {
  installOstlerApi({
    getMyWork: async () => ({ ok: true, value: work }),
    getNeedsYou: async () => ({ ok: true, value: waiting }),
    getPlanningLabels: async () => ({ ok: true, value: [] })
  })
  render(
    <ToastProvider>
      <MemoryRouter>
        <HomeView />
      </MemoryRouter>
    </ToastProvider>
  )
}

describe("Home's long lists", () => {
  it('share their first rows between their parts, in order', () => {
    expect(shareLimit([30, 5], 20, false)).toEqual([20, 0])
    expect(shareLimit([12, 5, 9], 20, false)).toEqual([12, 5, 3])
    expect(shareLimit([30, 5], 20, true)).toEqual([30, 5])
  })

  it('show the first rows of Today and Needs you, and the rest on request', async () => {
    const work: MyWork = {
      today: Array.from({ length: 30 }, (_, index) => task(index, today)),
      todayItems: Array.from({ length: 5 }, (_, index) => item(index)),
      upcoming: [],
      myDay: [],
      leftOver: null
    }
    renderHome(
      work,
      Array.from({ length: 50 }, (_, index) => needs(index))
    )
    await screen.findByRole('link', { name: 'Task 0' })
    expect(screen.getAllByRole('link', { name: /^Task \d+$/ })).toHaveLength(HOME_LIST_LIMIT)
    expect(screen.queryByText(/^Item 0/)).toBeNull()
    expect(screen.getAllByRole('link', { name: /^Blocked \d+/ })).toHaveLength(HOME_LIST_LIMIT)

    fireEvent.click(screen.getByRole('button', { name: 'Show 15 more' }))
    expect(screen.getAllByRole('link', { name: /^Task \d+$/ })).toHaveLength(30)
    expect(screen.getByText(/^Item 4/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.getAllByRole('link', { name: /^Task \d+$/ })).toHaveLength(HOME_LIST_LIMIT)

    fireEvent.click(screen.getByRole('button', { name: 'Show 30 more' }))
    expect(screen.getAllByRole('link', { name: /^Blocked \d+/ })).toHaveLength(50)
  })

  it('show Upcoming by day up to the first rows, leaving out days with none shown', async () => {
    const days = [1, 2, 3].map((offset) => ({
      date: shiftIsoDate(today, offset),
      tasks: Array.from({ length: 12 }, (_, index) =>
        task(offset * 100 + index, shiftIsoDate(today, offset))
      )
    }))
    renderHome({ today: [], todayItems: [], upcoming: days, myDay: [], leftOver: null }, [])
    await screen.findByRole('region', { name: 'Tomorrow' })
    const upcoming = () => screen.getAllByRole('link', { name: /^Task [123]\d\d$/ })
    expect(upcoming()).toHaveLength(HOME_LIST_LIMIT)
    // Twelve tomorrow, eight the day after, none the third day.
    expect(document.querySelectorAll('.ostler-home-day')).toHaveLength(2)
    expect(screen.queryByRole('link', { name: 'Task 300' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show 16 more' }))
    expect(upcoming()).toHaveLength(36)
    expect(within(document.body).getByRole('link', { name: 'Task 311' })).toBeInTheDocument()
  })
})
