// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { YearInReview } from '@shared/ostler-api'
import { YearInReviewPrintPage } from '@renderer/views/print/YearInReviewPrintPage'
import { installOstlerApi } from '../../fixtures/ostler-api'

const months = Array.from({ length: 12 }, (_, index) => ({
  month: index + 1,
  tasks: index === 2 ? 4 : index === 0 ? 2 : 0,
  milestones: index === 4 ? 1 : 0,
  approximate: index === 4
}))

const year: YearInReview = {
  year: 2026,
  years: [2026, 2025],
  totalTasks: 6,
  totalMilestones: 1,
  months,
  busiestWeek: { weekStart: '2026-03-09', count: 4 },
  projectsFinished: [{ projectId: 'p2', projectName: 'Garden', finishedOn: '2026-03-13' }],
  topProjects: [
    { projectId: 'p1', projectName: 'Website', count: 4 },
    { projectId: 'p2', projectName: 'Garden', count: 2 }
  ],
  time: {
    byMonth: [0, 10800, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    byProject: [{ projectId: 'p1', projectName: 'Website', seconds: 10800 }],
    totalSeconds: 10800
  }
}

describe('Your year, printed (N3.6)', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.printReady
  })

  it('draws the months, busiest week, projects and time, then sets data-print-ready', async () => {
    const getYearInReview = vi.fn(async () => ({ ok: true as const, value: year }))
    installOstlerApi({ getYearInReview })
    render(<YearInReviewPrintPage route={{ year: 2026, weekStart: 1 }} />)

    expect(await screen.findByRole('heading', { name: 'Your year 2026' })).toBeTruthy()
    expect(getYearInReview).toHaveBeenCalledWith({ year: 2026, weekStart: 1 })
    await waitFor(() => expect(document.documentElement.dataset.printReady).toBe('1'))

    const chart = screen.getByRole('img')
    expect(chart.getAttribute('aria-label')).toContain('March, 4')
    // The first March is the months table's; the second is time tracked's.
    const march = screen.getAllByRole('rowheader', { name: 'March' })[0].closest('tr')!
    expect(
      within(march)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual(['4', '0'])
    // An approximate month says so in words, not colour.
    expect(screen.getByRole('rowheader', { name: /May.*Approximate/ })).toBeTruthy()
    expect(screen.getByText(/Approximate: some milestones/)).toBeTruthy()
    expect(screen.getByText('The week of 9 March: 4 tasks finished.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Projects finished' })).toBeTruthy()
    expect(screen.getAllByRole('rowheader', { name: 'Garden' })).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'Time tracked' })).toBeTruthy()
    expect(screen.getByText(/3h tracked\./)).toBeTruthy()
  })

  it('leaves time out when none was tracked', async () => {
    installOstlerApi({
      getYearInReview: async () => ({
        ok: true,
        value: { ...year, time: null, projectsFinished: [], busiestWeek: null }
      })
    })
    render(<YearInReviewPrintPage route={{ year: 2026, weekStart: 1 }} />)
    await waitFor(() => expect(document.documentElement.dataset.printReady).toBe('1'))
    expect(screen.queryByRole('heading', { name: 'Time tracked' })).toBeNull()
    expect(screen.getByText('No projects finished this year.')).toBeTruthy()
    expect(screen.getByText('No tasks finished this year.')).toBeTruthy()
  })

  it('marks the page as failed when the year cannot be read', async () => {
    installOstlerApi({ getYearInReview: async () => ({ ok: false, error: 'No' }) })
    render(<YearInReviewPrintPage route={{ year: 2026, weekStart: 1 }} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(document.documentElement.dataset.printReady).toBe('error')
  })
})
