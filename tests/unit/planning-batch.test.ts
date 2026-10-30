import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import {
  PlanBatchError,
  checkWorkItemBatch,
  createWorkItemBatch
} from '../../electron/services/planning-batch'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const HUMAN = { kind: 'human' as const }

describe('planning batch creation', () => {
  const tempDir = useTempDir('ostler-batch-')
  let databasePath: string
  let service: PlanningService
  const projectIds = ['project-one', 'project-two']

  beforeEach(async () => {
    databasePath = await createMigratedDatabase(tempDir())
    service = new PlanningService(databasePath, () => projectIds)
  })

  afterEach(() => {
    service.close()
  })

  it('creates a plan with subtasks, a dependency chain and a milestone in one call', () => {
    const milestone = service.createMilestone('project-one', { name: 'Launch' })
    const items = createWorkItemBatch(
      service,
      'project-one',
      [
        { title: 'Design', ref: 'design', milestoneRef: 'launch' },
        { title: 'Build', ref: 'build', dependencyRefs: ['design'], milestoneRef: 'launch' },
        { title: 'Write tests', parentRef: 'build', ref: 'tests' },
        { title: 'Ship', dependencyRefs: ['tests'], targetDate: '2026-10-30' }
      ],
      HUMAN,
      { milestoneIds: new Map([['launch', milestone.id]]) }
    )

    expect(items.map((item) => item.title)).toEqual(['Design', 'Build', 'Write tests', 'Ship'])
    const [design, build, tests, ship] = items
    expect(design.milestoneId).toBe(milestone.id)
    expect(build.dependencyIds).toEqual([design.id])
    expect(tests.parentWorkItemId).toBe(build.id)
    expect(tests.milestoneId).toBe(milestone.id)
    expect(ship.dependencyIds).toEqual([tests.id])
    expect(ship.targetDate).toBe('2026-10-30')
    expect(service.listWorkItems('project-one')).toHaveLength(4)
  })

  it('records one created entry per task, not one per field', () => {
    const [item] = createWorkItemBatch(
      service,
      'project-one',
      [{ title: 'Draft brief', priority: 'high', labels: ['docs'], estimate: 3 }],
      HUMAN
    )
    const created = service
      .listActivity('project-one', item.id)
      .entries.filter((entry) => entry.field === 'created')
    expect(created).toHaveLength(1)
  })

  it('accepts dependencies on existing tasks in the same project', () => {
    const existing = service.createWorkItem('project-one', { title: 'Already here' }, HUMAN)
    const [item] = createWorkItemBatch(
      service,
      'project-one',
      [{ title: 'New', dependencyIds: [existing.id] }],
      HUMAN
    )
    expect(item.dependencyIds).toEqual([existing.id])
  })

  it('refuses a dependency cycle and writes nothing', () => {
    expect(() =>
      createWorkItemBatch(
        service,
        'project-one',
        [
          { title: 'A', ref: 'a', dependencyRefs: ['b'] },
          { title: 'B', ref: 'b', dependencyRefs: ['a'] }
        ],
        HUMAN
      )
    ).toThrow(PlanBatchError)
    expect(service.listWorkItems('project-one')).toHaveLength(0)
  })

  it('refuses a start date after the due date and writes nothing, naming the row and field', () => {
    const attempt = () =>
      createWorkItemBatch(
        service,
        'project-one',
        [
          { title: 'Fine' },
          { title: 'Backwards', startDate: '2026-10-20', targetDate: '2026-10-10' }
        ],
        HUMAN
      )
    expect(attempt).toThrow(PlanBatchError)
    try {
      attempt()
    } catch (error) {
      expect(error).toBeInstanceOf(PlanBatchError)
      expect((error as PlanBatchError).errors).toEqual([
        expect.objectContaining({ index: 1, field: 'dueDate' })
      ])
    }
    expect(service.listWorkItems('project-one')).toHaveLength(0)
  })

  it('refuses an unknown dependency ref and writes nothing', () => {
    expect(() =>
      createWorkItemBatch(
        service,
        'project-one',
        [{ title: 'Lonely', dependencyRefs: ['ghost'] }],
        HUMAN
      )
    ).toThrow(PlanBatchError)
    expect(service.listWorkItems('project-one')).toHaveLength(0)
  })

  it('refuses a dependency on a task in another project', () => {
    const elsewhere = service.createWorkItem('project-two', { title: 'Elsewhere' }, HUMAN)
    expect(() =>
      createWorkItemBatch(
        service,
        'project-one',
        [{ title: 'Mine', dependencyIds: [elsewhere.id] }],
        HUMAN
      )
    ).toThrow(PlanBatchError)
    expect(service.listWorkItems('project-one')).toHaveLength(0)
  })

  it('checks every row without writing anything', () => {
    const errors = checkWorkItemBatch(
      service,
      'project-one',
      [
        { title: 'Good' },
        { title: 'Backwards', startDate: '2026-10-20', targetDate: '2026-10-10' },
        { title: 'Also good', dependencyRefs: [] },
        { title: 'Loose', dependencyIds: ['missing-task'] }
      ],
      HUMAN
    )
    expect(errors.map((error) => error.index)).toEqual([1, 3])
    expect(errors[0]).toMatchObject({ field: 'dueDate' })
    expect(errors[1].message).toBeTruthy()
    expect(service.listWorkItems('project-one')).toHaveLength(0)
  })

  it('reports a valid plan as having no errors', () => {
    expect(
      checkWorkItemBatch(
        service,
        'project-one',
        [
          { title: 'Parent', ref: 'p' },
          { title: 'Child', parentRef: 'p' }
        ],
        HUMAN
      )
    ).toEqual([])
    expect(service.listWorkItems('project-one')).toHaveLength(0)
  })
})
