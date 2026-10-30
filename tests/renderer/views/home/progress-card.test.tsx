// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { HomeProgress, RendererProject } from '@shared/ostler-api'
import { HomeView } from '@renderer/views/home/HomeView'
import { ProgressCard, progressSentence } from '@renderer/views/home/ProgressCard'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'

const project = {
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

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [project], areas: [], loading: false })
}))
vi.mock('@renderer/views/planning/PortfolioView', () => ({ PortfolioView: () => null }))

const progress: HomeProgress = {
  thisWeek: 12,
  streak: 6,
  weeks: [
    '2026-08-24',
    '2026-08-31',
    '2026-09-07',
    '2026-09-14',
    '2026-09-21',
    '2026-09-28',
    '2026-10-05',
    '2026-10-12'
  ].map((weekStart, index) => ({ weekStart, count: index === 7 ? 12 : index }))
}

function homeApi(showProgress: boolean) {
  const getHomeProgress = vi.fn(async () => ({ ok: true as const, value: progress }))
  installOstlerApi({
    getConfig: async () => ({
      ok: true,
      value: { ...RENDERER_DEFAULT_CONFIG, ui: { ...RENDERER_DEFAULT_CONFIG.ui, showProgress } }
    }),
    getMyWork: async () => ({
      ok: true,
      value: { today: [], todayItems: [], upcoming: [], myDay: [], leftOver: null }
    }),
    getNeedsYou: async () => ({ ok: true, value: [] }),
    getLastWeeklyReview: async () => ({ ok: true, value: null }),
    getHomeProgress
  })
  return getHomeProgress
}

function renderHome() {
  render(
    <ToastProvider>
      <StaticFeaturesProvider value={{ agents: false, ai: false }}>
        <MemoryRouter>
          <HomeView />
        </MemoryRouter>
      </StaticFeaturesProvider>
    </ToastProvider>
  )
}

describe('the progress card (N3.6)', () => {
  it('is off by default: Home shows no card and asks for no progress', async () => {
    const getHomeProgress = homeApi(false)
    renderHome()
    await screen.findByRole('heading', { name: /today/i })
    expect(screen.queryByRole('heading', { name: 'Your progress' })).toBeNull()
    expect(getHomeProgress).not.toHaveBeenCalled()
  })

  it('shows this week and the streak in plain words once Show my progress is on', async () => {
    const getHomeProgress = homeApi(true)
    renderHome()
    expect(await screen.findByRole('heading', { name: 'Your progress' })).toBeTruthy()
    expect(await screen.findByText('12 this week. 6 working days in a row.')).toBeTruthy()
    expect(getHomeProgress).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Your year…' })).toBeTruthy()
  })

  it("names each bar's number for screen readers", async () => {
    installOstlerApi({ getHomeProgress: async () => ({ ok: true, value: progress }) })
    render(
      <ToastProvider>
        <ProgressCard today="2026-10-17" />
      </ToastProvider>
    )
    const chart = await screen.findByRole('img')
    const label = chart.getAttribute('aria-label') ?? ''
    expect(label).toContain('Tasks finished each week')
    expect(label).toContain('week of 24 Aug, 0 tasks')
    expect(label).toContain('week of 31 Aug, 1 task;')
    expect(label).toContain('week of 12 Oct, 12 tasks')
    await waitFor(() => expect(screen.getByText(/12 this week/)).toBeTruthy())
  })

  it('leaves the streak out when there is none, with no praise either way', () => {
    expect(progressSentence({ thisWeek: 0, streak: 0, weeks: [] })).toBe('0 this week.')
    expect(progressSentence({ thisWeek: 1, streak: 1, weeks: [] })).toBe(
      '1 this week. 1 working day in a row.'
    )
  })
})
