// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanPeopleStep } from '@renderer/views/workspace/plan/PlanPeopleStep'
import { usePlanPeople } from '@renderer/views/workspace/plan/usePlanPeople'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { planProgress } from '@shared/planning/plan-steps'
import { formatIsoDate } from '@shared/dates'
import type {
  AssignedTask,
  OstlerAPI,
  Person,
  PlanningWorkItem,
  RendererProject
} from '@shared/ostler-api'
import { RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'

const project = {
  id: 'p1',
  name: 'Alpha',
  path: null,
  color: '#2563EB',
  hasAutomationToken: false,
  stage: 'planning'
} as unknown as RendererProject

const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({
  id,
  name,
  initials: name.slice(0, 2),
  color: '#3b82f6',
  isMe: false,
  archivedAt: null,
  weeklyCapacityHours: 40,
  workingDays: [1, 2, 3, 4, 5],
  projectId: null,
  createdAt: 1,
  updatedAt: 1,
  ...extra
})

function task(id: string, fields: Partial<PlanningWorkItem> = {}): PlanningWorkItem {
  return {
    id,
    projectId: 'p1',
    milestoneId: null,
    title: `Task ${id}`,
    status: 'backlog',
    dependencyIds: [],
    targetDate: null,
    startDate: null,
    assigneeId: null,
    estimate: null,
    ...fields
  } as unknown as PlanningWorkItem
}

/** The same task as the Workload query gives it. */
function assigned(item: PlanningWorkItem): AssignedTask {
  return {
    id: item.id,
    projectId: item.projectId,
    projectName: 'Alpha',
    projectColor: '#2563EB',
    estimateUnit: 'hours',
    title: item.title,
    status: item.status,
    priority: 'medium',
    targetDate: item.targetDate,
    startDate: item.startDate,
    assigneeId: item.assigneeId,
    milestoneId: null,
    milestoneName: null,
    estimate: item.estimate,
    labels: [],
    linked: false,
    createdAt: 0,
    updatedAt: 0
  }
}

// Ana has 50 h in the week of Monday 12 October 2026.
const anasWeek = task('w1', {
  title: 'Write the copy',
  assigneeId: 'ana',
  startDate: '2026-10-12',
  targetDate: '2026-10-16',
  estimate: 50
})

async function workspace(
  workItems: PlanningWorkItem[],
  api: Partial<OstlerAPI> = {},
  overrides: Partial<PlanningWorkspace> = {}
): Promise<PlanningWorkspace> {
  const base = await renderPlanningWorkspace({
    projectId: 'p1',
    api: {
      getConfig: async () => ({ ok: true, value: RENDERER_DEFAULT_CONFIG }),
      getWorkloadTasks: async () => ({ ok: true, value: workItems.map(assigned) }),
      ...api
    }
  })
  return withWorkspace(base, { workItems, ...overrides })
}

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

/** The pane as the Plan page gives it: facts from the hook, counts from `planProgress`. */
function Pane({ ws }: { ws: PlanningWorkspace }) {
  const people = usePlanPeople(project, ws)
  const progress = planProgress({
    goals: ws.goals,
    milestones: ws.milestones,
    workItems: ws.workItems,
    people: people.show ? { overCapacityCount: people.overWeeks.length } : null
  })
  return (
    <PlanPeopleStep
      project={project}
      ws={ws}
      features={{ hasFolder: false, agents: false, ai: false }}
      suggestTasks={{ busy: false, start: () => {} }}
      progress={progress}
      people={people.show ? people : null}
    />
  )
}

function renderPeople(ws: PlanningWorkspace, people: Person[]) {
  return render(
    <StaticPeopleProvider people={people}>
      <MemoryRouter initialEntries={['/projects/p1/plan']}>
        <Pane ws={ws} />
        <Where />
      </MemoryRouter>
    </StaticPeopleProvider>
  )
}

const ME = person('me', 'Me', { isMe: true })

describe('Plan, People step', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14, 12))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('names who is over capacity, and by how much, in words', async () => {
    renderPeople(await workspace([anasWeek]), [ME, person('ana', 'Ana')])

    const date = formatIsoDate('2026-10-12', { day: 'numeric', month: 'short' })
    expect(await screen.findByText(`Ana: over by 10 h in the week of ${date}`)).toBeInTheDocument()
    expect(screen.getByText('1 week where someone has more than they can do')).toBeInTheDocument()
  })

  it('says no one has too much when nobody is over', async () => {
    renderPeople(await workspace([anasWeek]), [
      ME,
      person('ana', 'Ana', { weeklyCapacityHours: 60 })
    ])

    expect(
      await screen.findByText('No one has more than they can do in these weeks.')
    ).toBeInTheDocument()
  })

  it('says who has no weekly hours set, and links to Settings › People', async () => {
    renderPeople(await workspace([anasWeek]), [
      ME,
      person('ana', 'Ana', { weeklyCapacityHours: null })
    ])

    expect(
      await screen.findByText("1 person has no weekly hours set, so their load can't be checked")
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set weekly hours' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/settings/people')
  })

  it('lists tasks with nobody on them, each opening its drawer, and counts unestimated ones', async () => {
    const openWorkItem = vi.fn()
    const loose = task('w2', { title: 'Book the venue' })
    renderPeople(await workspace([anasWeek, loose], {}, { openWorkItem }), [
      ME,
      person('ana', 'Ana')
    ])

    expect(await screen.findByText('1 task has no one assigned')).toBeInTheDocument()
    expect(screen.getByText('1 task has no estimate, so it adds no hours')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Book the venue' }))
    expect(openWorkItem).toHaveBeenCalledWith(loose)
  })

  it('opens Workload on this project', async () => {
    renderPeople(await workspace([anasWeek]), [ME, person('ana', 'Ana')])

    fireEvent.click(await screen.findByRole('button', { name: 'Open Workload' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/workload?project=p1')
  })

  it('says so when the load cannot be read', async () => {
    renderPeople(
      await workspace([anasWeek], {
        getWorkloadTasks: async () => ({ ok: false, error: 'The database is busy' })
      }),
      [ME, person('ana', 'Ana')]
    )

    expect(
      await screen.findByText("Couldn't check everyone's load: The database is busy")
    ).toBeInTheDocument()
  })
})
