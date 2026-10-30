// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OverviewTab } from '@renderer/views/workspace/OverviewTab'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import type {
  OstlerAPI,
  Person,
  PlanningMilestone,
  PlanningSubproject,
  PlanningWorkItem,
  RendererProject
} from '@shared/ostler-api'
import { RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [], refreshProjects: async () => {} })
}))
vi.mock('@renderer/views/project-detail/ProjectBriefCard', () => ({ ProjectBriefCard: () => null }))
vi.mock('@renderer/costs/BudgetCard', () => ({ BudgetCard: () => null }))
vi.mock('@renderer/pins/OverviewShortcuts', () => ({ OverviewShortcuts: () => null }))
vi.mock('@renderer/components/status-updates/StatusUpdateSection', () => ({
  StatusUpdateSection: () => <p>Project status updates</p>
}))
vi.mock('@renderer/views/planning/RecentActivity', () => ({ RecentActivity: () => null }))

const project = {
  id: 'p1',
  name: 'Alpha',
  path: null,
  color: '#2563EB',
  hasAutomationToken: false,
  stage: 'planning'
} as unknown as RendererProject

function sub(
  id: string,
  name: string,
  extra: Partial<PlanningSubproject> = {}
): PlanningSubproject {
  return {
    id,
    projectId: 'p1',
    name,
    description: '',
    color: '#E11D48',
    icon: null,
    leadId: null,
    memberIds: [],
    status: 'active',
    position: 0,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...extra
  }
}

function task(id: string, subprojectId: string | null, status = 'backlog'): PlanningWorkItem {
  return {
    id,
    projectId: 'p1',
    milestoneId: null,
    subprojectId,
    title: `Task ${id}`,
    status,
    dependencyIds: [],
    targetDate: null,
    startDate: null,
    assigneeId: null,
    estimate: null
  } as unknown as PlanningWorkItem
}

function milestone(id: string, name: string, subprojectId: string): PlanningMilestone {
  return {
    id,
    projectId: 'p1',
    goalId: null,
    subprojectId,
    name,
    outcome: '',
    targetDate: '2030-06-01',
    successCriteria: [],
    status: 'active'
  } as unknown as PlanningMilestone
}

async function workspace(
  overrides: Partial<PlanningWorkspace> = {},
  api: Partial<OstlerAPI> = {}
): Promise<PlanningWorkspace> {
  const base = await renderPlanningWorkspace({
    projectId: 'p1',
    api: { getConfig: async () => ({ ok: true, value: RENDERER_DEFAULT_CONFIG }), ...api }
  })
  return withWorkspace(base, { loaded: true, error: null, ...overrides })
}

function renderOverview(ws: PlanningWorkspace, people: Person[] = []) {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <StaticPeopleProvider people={people}>
          <MemoryRouter initialEntries={['/projects/p1']}>
            <StaticFeaturesProvider value={{ agents: false, ai: false }}>
              <OverviewTab
                project={project}
                ws={ws}
                features={{ hasFolder: false, agents: false, ai: false }}
                suggestTasks={{ busy: false, start: () => {} }}
              />
            </StaticFeaturesProvider>
          </MemoryRouter>
        </StaticPeopleProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}

afterEach(() => {
  localStorage.clear()
})

describe('Overview workstreams', () => {
  it('has no Workstreams section for a project without one', async () => {
    renderOverview(await workspace({ subprojects: [] }))
    expect(screen.queryByRole('heading', { name: 'Workstreams' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New workstream' })).toBeInTheDocument()
  })

  it('shows each workstream with its counts, and the tasks outside any', async () => {
    const ws = await workspace({
      subprojects: [sub('s1', 'Design', { position: 0 }), sub('s2', 'Build', { position: 1 })],
      workItems: [
        task('a', 's1', 'done'),
        task('b', 's1'),
        task('c', 's1'),
        task('d', 's2'),
        task('e', null)
      ],
      milestones: [milestone('m1', 'Prototype', 's1')]
    })
    renderOverview(ws)

    const list = screen.getByRole('list', { name: 'Workstreams' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByRole('link', { name: 'Design' })).toHaveAttribute(
      'href',
      '/projects/p1?sub=s1'
    )
    expect(rows[0]).toHaveTextContent('Open 2')
    expect(rows[0]).toHaveTextContent('Done 1')
    expect(rows[0]).toHaveTextContent('Next: Prototype')
    expect(within(rows[0]).getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      '1 of 3 done'
    )
    expect(rows[1]).toHaveTextContent('Build')
    expect(rows[1]).toHaveTextContent('Open 1')
    expect(rows[2]).toHaveTextContent('Not in a workstream')
    expect(rows[2]).toHaveTextContent('Open 1')
    const loose = new URL(
      within(rows[2]).getByRole('link', { name: 'Not in a workstream' }).getAttribute('href') ?? '',
      'http://x'
    )
    expect(loose.pathname).toBe('/projects/p1/list')
    expect(JSON.parse(loose.searchParams.get('filter') ?? '')).toEqual({
      match: 'all',
      conditions: [{ field: 'subproject', op: 'is', value: ['none'] }]
    })
    expect(screen.getByText('Project status updates')).toBeInTheDocument()
  })

  it('folds archived workstreams and restores one', async () => {
    const archiveSubproject = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const ws = await workspace(
      { subprojects: [sub('s1', 'Design'), sub('s2', 'Old', { archivedAt: 5 })] },
      { archiveSubproject } as unknown as Partial<OstlerAPI>
    )
    renderOverview(ws)

    const fold = screen.getByRole('button', { name: 'Archived (1)' })
    expect(fold).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Restore workstream Old' })).not.toBeInTheDocument()

    fireEvent.click(fold)
    expect(fold).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Restore workstream Old' }))
    await waitFor(() => expect(archiveSubproject).toHaveBeenCalledWith('s2', false))
  })

  it('shows the workstream, not the section, when scoped', async () => {
    const design = sub('s1', 'Design', { description: 'Look and feel' })
    const ws = await workspace({
      subprojects: [design, sub('s2', 'Build')],
      subprojectScope: design
    })
    renderOverview(ws)

    expect(screen.getByRole('heading', { name: 'Design' })).toBeInTheDocument()
    expect(screen.getByText('Look and feel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit workstream Design' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Workstreams' })).not.toBeInTheDocument()
    // The project's status updates are not the workstream's: they stay on the project's Overview.
    expect(screen.queryByText('Project status updates')).not.toBeInTheDocument()
  })
})
