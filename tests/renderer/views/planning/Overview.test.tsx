// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { OverviewTab } from '@renderer/views/workspace/OverviewTab'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import type {
  AIProjectBrief,
  PlanningMilestone,
  PlanningWorkItem,
  RendererProject
} from '@shared/ostler-api'
import { RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'
import { overdueOnlyReport } from '../../fixtures/report'

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [], refreshProjects: async () => {} })
}))

const project = {
  id: 'p1',
  name: 'Alpha',
  path: null,
  color: '#2563EB',
  hasAutomationToken: false
} as unknown as RendererProject

const blocked = {
  id: 'w1',
  title: 'Stuck on the API',
  status: 'blocked'
} as PlanningWorkItem

const brief: AIProjectBrief = {
  schemaVersion: 1,
  promptVersion: 1,
  projectId: 'p1',
  generatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  provider: 'openai',
  model: 'test-model',
  health: 'on-track',
  headline: 'Steady progress',
  summary: 'The board is moving.',
  nextActions: [],
  risks: [],
  assumptions: [],
  warnings: ["Images were sent as descriptions: this model can't read images."]
}

async function workspace(): Promise<PlanningWorkspace> {
  const base = await renderPlanningWorkspace({
    projectId: 'p1',
    api: {
      getConfig: async () => ({ ok: true, value: RENDERER_DEFAULT_CONFIG }),
      listLibraryItems: async () => ({ ok: true, value: [] }),
      getLibraryAiContextSummary: async () => ({ ok: false, error: 'none' }),
      getConversations: async () => ({ ok: true, value: [] })
    }
  })
  return withWorkspace(base, {
    blockedNow: [blocked],
    pendingQuestions: [
      { id: 'q1', question: 'Which database?', sessionTitle: 'Agent run 1' }
    ] as PlanningWorkspace['pendingQuestions'],
    reviewSessions: [{ id: 's1', title: 'Add login' }] as PlanningWorkspace['reviewSessions'],
    projectBrief: brief
  })
}

function renderOverview(ws: PlanningWorkspace, features: { agents: boolean; ai: boolean }) {
  return render(
    <MemoryRouter>
      <StaticFeaturesProvider value={features}>
        <OverviewTab
          project={project}
          ws={ws}
          features={{ ...features, hasFolder: false }}
          suggestTasks={{ busy: false, start: () => {} }}
        />
      </StaticFeaturesProvider>
    </MemoryRouter>
  )
}

/** Shows one of the Overview's panes, as a person would. */
function showPane(name: string) {
  fireEvent.click(
    within(screen.getByRole('radiogroup', { name: 'Show' })).getByRole('radio', { name })
  )
}

describe('Overview', () => {
  it('shows its summary sections in order, with four stat tiles and no uppercase eyebrows', async () => {
    const ws = await workspace()
    renderOverview(ws, { agents: true, ai: true })

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual([
      // The project's own status update comes first (N5.5).
      'Status',
      'Needs you',
      'In progress',
      'Up next',
      'Recent activity',
      // No milestones in this project: no Milestones at a glance.
      'Project brief',
      'AI summary',
      'Notes chat'
    ])
    const tiles = screen.getByRole('group', { name: 'Project numbers' })
    expect(
      within(tiles)
        .getAllByRole('term')
        .map((term) => term.textContent)
    ).toEqual(['Open', 'Done this week', 'Overdue', 'Average cycle time'])
    // Insights replaced the "More numbers" popover (P6.2).
    expect(screen.queryByRole('button', { name: 'More numbers' })).toBeNull()
  })

  it('keeps the charts and the code tools in their own panes, and remembers the one chosen', async () => {
    localStorage.removeItem('ostler.overviewPane')
    const ws = await workspace()
    const { unmount } = renderOverview(ws, { agents: true, ai: false })
    expect(screen.queryByRole('heading', { name: 'Insights' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Agent task prompt' })).toBeNull()

    showPane('Insights')
    // Insights load on their own after the rest of the Overview (P9.1).
    expect(await screen.findByRole('heading', { level: 2, name: 'Insights' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Needs you' })).toBeNull()

    showPane('Code')
    expect(screen.getByRole('heading', { name: 'Agent task prompt' })).toBeInTheDocument()
    unmount()

    // The pane chosen is there next time.
    renderOverview(ws, { agents: true, ai: false })
    expect(screen.getByRole('radio', { name: 'Code' })).toBeChecked()
    localStorage.removeItem('ostler.overviewPane')
  })

  it('has no Code pane without a folder or agents, and falls back to the summary', async () => {
    localStorage.setItem('ostler.overviewPane', 'code')
    const ws = await workspace()
    renderOverview(ws, { agents: false, ai: false })
    expect(screen.queryByRole('radio', { name: 'Code' })).toBeNull()
    expect(screen.getByRole('radio', { name: 'Summary' })).toBeChecked()
    expect(screen.getByRole('heading', { name: 'Needs you' })).toBeInTheDocument()
    localStorage.removeItem('ostler.overviewPane')
  })

  it('shows milestones at a glance only in a project that has milestones', async () => {
    const ws = await workspace()
    const shipped = { id: 'm1', name: 'Launch', status: 'done' } as unknown as PlanningMilestone
    renderOverview(withWorkspace(ws, { milestones: [shipped] }), { agents: false, ai: false })
    expect(screen.getByRole('heading', { name: 'Milestones at a glance' })).toBeInTheDocument()
    expect(screen.getByText('No open milestones.')).toBeInTheDocument()
  })

  it('shows that it is loading, not empty numbers, until the tasks first arrive', async () => {
    const ws = withWorkspace(await workspace(), { loaded: false })
    renderOverview(ws, { agents: false, ai: false })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Project numbers' })).toBeNull()
    expect(screen.queryByText('No open milestones')).toBeNull()
  })

  it('lists agent questions and reviews in Needs you while agents are on', async () => {
    const ws = await workspace()
    renderOverview(ws, { agents: true, ai: false })

    const needs = screen.getByRole('list', { name: 'Needs you' })
    expect(within(needs).getByText('Stuck on the API')).toBeInTheDocument()
    expect(within(needs).getByText('Which database?')).toBeInTheDocument()
    expect(within(needs).getByText('Add login')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Agent questions' })).toBeInTheDocument()
  })

  it('hides the agent parts while agents are off', async () => {
    const ws = await workspace()
    renderOverview(ws, { agents: false, ai: true })

    const needs = screen.getByRole('list', { name: 'Needs you' })
    expect(within(needs).getByText('Stuck on the API')).toBeInTheDocument()
    expect(within(needs).queryByText('Which database?')).toBeNull()
    expect(within(needs).queryByText('Add login')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Agent questions' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Agent task prompt' })).toBeNull()
  })

  it('shows the AI summary with its age and warnings only while AI is on', async () => {
    const ws = await workspace()
    const { unmount } = renderOverview(ws, { agents: false, ai: true })

    expect(screen.getByText(/Summary from 3 hours ago/)).toBeInTheDocument()
    expect(screen.getByText(/Images were sent as descriptions/)).toBeInTheDocument()
    expect(screen.queryByText('Out of date')).toBeNull()
    unmount()

    renderOverview(ws, { agents: false, ai: false })
    expect(screen.queryByRole('heading', { name: 'AI summary' })).toBeNull()
    expect(screen.queryByRole('button', { name: /summary/i })).toBeNull()
  })

  it('marks a summary older than a day as out of date', async () => {
    const ws = await workspace()
    renderOverview(
      withWorkspace(ws, {
        projectBrief: { ...brief, generatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }
      }),
      { agents: false, ai: true }
    )
    expect(screen.getByText('Out of date')).toBeInTheDocument()
  })
})

describe('Overview recent activity', () => {
  it('shows the project’s last 15 entries, names their task, and loads more', async () => {
    const entry = (index: number) => ({
      id: `f:${index}`,
      kind: 'change' as const,
      projectId: 'p1',
      workItemId: 'w1',
      workItemTitle: 'Stuck on the API',
      at: Date.now() - index * 60_000,
      actor: { kind: 'automation' as const, personId: null, name: 'Automation API' },
      summary: `Automation API made change ${index}`
    })
    const getPlanningProjectActivity = vi.fn(
      async (_projectId: string, query?: { before?: string }) => ({
        ok: true as const,
        value: query?.before
          ? { entries: [entry(16)], nextBefore: null }
          : { entries: Array.from({ length: 15 }, (_, index) => entry(index + 1)), nextBefore: 'x' }
      })
    )
    const base = await renderPlanningWorkspace({
      projectId: 'p1',
      api: {
        getConfig: async () => ({ ok: true, value: RENDERER_DEFAULT_CONFIG }),
        listLibraryItems: async () => ({ ok: true, value: [] }),
        getLibraryAiContextSummary: async () => ({ ok: false, error: 'none' }),
        getConversations: async () => ({ ok: true, value: [] }),
        getPlanningProjectActivity
      }
    })
    const openWorkItem = vi.fn()
    const ws = withWorkspace(base, { workItems: [blocked], openWorkItem })
    renderOverview(ws, { agents: false, ai: false })

    const section = (await screen.findByText('Automation API made change 1')).closest(
      'section'
    ) as HTMLElement
    expect(getPlanningProjectActivity).toHaveBeenCalledWith('p1', { limit: 15, before: undefined })
    expect(within(section).getAllByRole('listitem')).toHaveLength(15)
    within(section).getAllByRole('button', { name: 'Stuck on the API' })[0].click()
    expect(openWorkItem).toHaveBeenCalledWith(blocked)

    within(section).getByRole('button', { name: 'Show more' }).click()
    expect(await within(section).findByText('Automation API made change 16')).toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: 'Show more' })).toBeNull()
  })
})

describe('Overview insights', () => {
  const DAY = 86_400_000
  const now = Date.now()
  const late = {
    ...blocked,
    id: 'late',
    title: 'Send the invoices',
    status: 'ready',
    targetDate: '2000-01-01',
    milestoneId: null,
    estimate: null,
    assigneeId: null,
    dependencyIds: [],
    startDate: null,
    createdAt: now - 20 * DAY
  } as PlanningWorkItem

  it('shows key numbers, charts with summaries and tables, and opens an at-risk task', async () => {
    const report = overdueOnlyReport(late)
    const getProjectReport = vi.fn(async () => ({ ok: true as const, value: report }))
    const base = await renderPlanningWorkspace({
      projectId: 'p1',
      api: {
        getConfig: async () => ({ ok: true, value: RENDERER_DEFAULT_CONFIG }),
        listLibraryItems: async () => ({ ok: true, value: [] }),
        getLibraryAiContextSummary: async () => ({ ok: false, error: 'none' }),
        getConversations: async () => ({ ok: true, value: [] }),
        getProjectReport
      }
    })
    const openWorkItem = vi.fn()
    renderOverview(withWorkspace(base, { workItems: [late], openWorkItem }), {
      agents: false,
      ai: false
    })
    showPane('Insights')

    const numbers = await screen.findByRole('group', { name: 'Key numbers' })
    expect(getProjectReport).toHaveBeenCalledWith('p1', '30d')
    expect(within(numbers).getByText('Overdue now').nextSibling).toHaveTextContent('1')
    const flow = screen.getByRole('figure', { name: 'Cumulative flow' })
    expect(flow).toHaveAccessibleDescription(report.cumulativeFlow.summary)
    expect(within(flow).getByRole('img').getAttribute('aria-label')).toMatch(/^Stacked area chart/)
    // Nothing finished: an empty state with its reason, not a row of zeros.
    const throughput = screen.getByRole('figure', { name: 'Throughput' })
    expect(throughput).toHaveAccessibleDescription(
      'Nothing has been finished yet, so there is no throughput to show.'
    )
    expect(within(throughput).queryByRole('img')).toBeNull()

    const risk = screen.getByRole('list', { name: 'Overdue' })
    within(risk)
      .getByRole('button', { name: /Send the invoices/ })
      .click()
    expect(openWorkItem).toHaveBeenCalledWith(late)
  })
})
