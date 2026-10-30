import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PlanningMilestone,
  PlanningWorkItem,
  TimelineOverviewProject,
  WatchedProject
} from '../../src/shared/ostler-api'
import {
  buildTimelineOverviewRows,
  filterOverviewProjects,
  meetingWeeks,
  weekStartOf
} from '../../src/shared/planning/timeline-overview'
import { parseTimelineOverviewHash, timelineOverviewHashPath } from '../../src/shared/print-route'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('electron', () => ({ Notification: class {}, BrowserWindow: class {} }))

const { PlanningService } = await import('../../electron/services/planning-service')
const { HomeService } = await import('../../electron/services/home-service')
const { createMigratedDatabase } = await import('../helpers/database')

const human = { kind: 'human' as const }

function project(id: string, name: string, enabled = true): WatchedProject {
  return { id, name, color: '#336699', enabled } as WatchedProject
}

function entry(
  projectId: string,
  milestones: [id: string, date: string][],
  span: [string, string] | null = null
): TimelineOverviewProject {
  return {
    projectId,
    milestones: milestones.map(([id, targetDate]) => ({
      id,
      name: id,
      targetDate,
      status: 'planned'
    })),
    firstDate: span?.[0] ?? null,
    lastDate: span?.[1] ?? null
  }
}

describe('Timeline across projects: the first draw’s one query (N5.4)', () => {
  const tempDir = useTempDir('ostler-timeline-overview-')
  let planning: InstanceType<typeof PlanningService>
  let projects: WatchedProject[]

  beforeEach(async () => {
    const databasePath = await createMigratedDatabase(tempDir())
    projects = [project('p1', 'House move'), project('p2', 'Launch'), project('p3', 'Old', false)]
    planning = new PlanningService(databasePath, () => projects.map((candidate) => candidate.id))
  })

  afterEach(() => {
    planning.close()
  })

  const home = () =>
    new HomeService({
      db: planning.database,
      getProjects: () => projects,
      getMeId: () => null,
      agentsOn: () => false,
      agentAttention: () => null
    })

  it('gives every enabled project its dated milestones and the span of its dated live tasks', () => {
    planning.createMilestone('p1', { name: 'Keys', targetDate: '2026-11-06' })
    planning.createMilestone('p1', { name: 'Undated' })
    const archived = planning.createMilestone('p1', { name: 'Gone', targetDate: '2026-11-01' })
    planning.updateMilestone(archived.id, { status: 'archived' })
    planning.createWorkItem(
      'p1',
      { title: 'Pack', startDate: '2026-10-20', targetDate: '2026-10-30' },
      human
    )
    planning.createWorkItem('p1', { title: 'Clean', targetDate: '2026-11-10' }, human)
    planning.createWorkItem('p1', { title: 'Undated' }, human)
    const binned = planning.createWorkItem(
      'p1',
      { title: 'Binned', targetDate: '2027-01-01' },
      human
    )
    planning.deleteWorkItem(binned.id, human)
    planning.createMilestone('p3', { name: 'Disabled', targetDate: '2026-11-06' })

    const overview = home().getTimelineOverview()
    expect(overview.map((row) => row.projectId)).toEqual(['p1', 'p2'])
    const [move, launch] = overview
    expect(move.milestones.map((milestone) => [milestone.name, milestone.targetDate])).toEqual([
      ['Keys', '2026-11-06']
    ])
    expect([move.firstDate, move.lastDate]).toEqual(['2026-10-20', '2026-11-10'])
    // A project without dates still has its row.
    expect(launch).toEqual({ projectId: 'p2', milestones: [], firstDate: null, lastDate: null })
  })
})

describe('Timeline across projects: where milestones meet (N5.4)', () => {
  it('marks a week holding milestones from two projects, with each milestone listed', () => {
    // 2026-11-02 is a Monday.
    const weeks = meetingWeeks(
      [entry('a', [['a1', '2026-11-06']]), entry('b', [['b1', '2026-11-03']])],
      1
    )
    expect(weeks).toEqual([
      {
        start: '2026-11-02',
        end: '2026-11-08',
        projectCount: 2,
        milestones: [
          { projectId: 'b', milestoneId: 'b1', name: 'b1', targetDate: '2026-11-03' },
          { projectId: 'a', milestoneId: 'a1', name: 'a1', targetDate: '2026-11-06' }
        ]
      }
    ])
  })

  it('does not count one project with two milestones in a week', () => {
    expect(
      meetingWeeks(
        [
          entry('a', [
            ['a1', '2026-11-03'],
            ['a2', '2026-11-05']
          ]),
          entry('b', [['b1', '2026-11-10']])
        ],
        1
      )
    ).toEqual([])
  })

  it('counts milestones and projects, and starts weeks on the given day', () => {
    const projects = [
      entry('a', [
        ['a1', '2026-11-01'],
        ['a2', '2026-11-02']
      ]),
      entry('b', [['b1', '2026-11-07']]),
      entry('c', [['c1', '2026-11-04']])
    ]
    // Monday weeks: 1 November is a Sunday, the week before.
    const monday = meetingWeeks(projects, 1)
    expect(monday.map((week) => [week.start, week.milestones.length, week.projectCount])).toEqual([
      ['2026-11-02', 3, 3]
    ])
    // Sunday weeks hold all four.
    const sunday = meetingWeeks(projects, 0)
    expect(sunday.map((week) => [week.start, week.milestones.length, week.projectCount])).toEqual([
      ['2026-11-01', 4, 3]
    ])
    expect(weekStartOf('2026-11-01', 1)).toBe('2026-10-26')
  })
})

describe('Timeline across projects: choosing projects (N5.4)', () => {
  const projects = [
    { id: 'a', areaId: 'home' },
    { id: 'b', areaId: 'work' },
    { id: 'c', areaId: null }
  ]
  it('keeps all, an area, or the chosen ones, in their order', () => {
    expect(filterOverviewProjects(projects, { kind: 'all' }).map((p) => p.id)).toEqual([
      'a',
      'b',
      'c'
    ])
    expect(
      filterOverviewProjects(projects, { kind: 'area', areaId: 'work' }).map((p) => p.id)
    ).toEqual(['b'])
    expect(
      filterOverviewProjects(projects, { kind: 'chosen', projectIds: ['c', 'a'] }).map((p) => p.id)
    ).toEqual(['a', 'c'])
  })
})

describe('Timeline across projects: the rows (N5.4)', () => {
  const projects = [
    { id: 'a', name: 'House move', areaId: 'home' },
    { id: 'b', name: 'Launch', areaId: null },
    { id: 'c', name: 'Garden', areaId: 'home' }
  ]
  const areas = [
    { id: 'home', name: 'Home' },
    { id: 'empty', name: 'Empty' }
  ]
  const overview = [
    entry('a', [['a1', '2026-11-06']], ['2026-10-01', '2026-11-20']),
    entry('b', [])
  ]

  it('gives one row per project, in areas, with empty areas left out', () => {
    const rows = buildTimelineOverviewRows({
      projects,
      areas,
      overview,
      opened: new Map(),
      people: new Map()
    })
    expect(rows.map((row) => row.id)).toEqual([
      'area:home',
      'project:a',
      'project:c',
      'area:none',
      'project:b'
    ])
    const first = rows[1]
    expect(first.kind === 'project' && first.entry?.milestones.map((m) => m.id)).toEqual(['a1'])
    // Not in the overview yet: the row is there, with nothing to draw.
    const garden = rows[2]
    expect(garden.kind === 'project' && garden.entry).toBeNull()
  })

  it('has no area rows when there are no areas', () => {
    const rows = buildTimelineOverviewRows({
      projects,
      areas: [],
      overview,
      opened: new Map(),
      people: new Map()
    })
    expect(rows.map((row) => row.kind)).toEqual(['project', 'project', 'project'])
  })

  it('opens a project to its dated tasks by milestone, after a loading row', () => {
    const milestone = {
      id: 'a1',
      projectId: 'a',
      name: 'Keys',
      targetDate: '2026-11-06',
      status: 'planned'
    } as PlanningMilestone
    const task = (id: string, extra: Partial<PlanningWorkItem>) =>
      ({
        id,
        projectId: 'a',
        title: id,
        status: 'ready',
        milestoneId: null,
        targetDate: null,
        startDate: null,
        assigneeId: null,
        ...extra
      }) as PlanningWorkItem
    const loading = buildTimelineOverviewRows({
      projects,
      areas: [],
      overview,
      opened: new Map([['a', null]]),
      people: new Map()
    })
    expect(loading.map((row) => row.id)).toEqual([
      'project:a',
      'a:loading',
      'project:b',
      'project:c'
    ])

    const rows = buildTimelineOverviewRows({
      projects,
      areas: [],
      overview,
      opened: new Map([
        [
          'a',
          {
            items: [
              task('pack', { milestoneId: 'a1', targetDate: '2026-11-01' }),
              task('undated', {})
            ],
            milestones: [milestone]
          }
        ],
        ['b', { items: [], milestones: [] }]
      ]),
      people: new Map()
    })
    expect(rows.map((row) => row.id)).toEqual([
      'project:a',
      'a:group:milestone:a1',
      'a:pack',
      'project:b',
      'b:empty',
      'project:c'
    ])
    expect(rows[0].kind === 'project' && rows[0].open).toBe(true)
  })
})

describe('Timeline across projects: the print route (N5.4)', () => {
  it('round-trips every project or the chosen ones', () => {
    expect(parseTimelineOverviewHash(timelineOverviewHashPath(null))).toEqual({ projectIds: null })
    expect(parseTimelineOverviewHash(timelineOverviewHashPath(['a b', 'c']))).toEqual({
      projectIds: ['a b', 'c']
    })
    expect(parseTimelineOverviewHash('/print/my-week?today=2026-10-14')).toBeNull()
  })
})
