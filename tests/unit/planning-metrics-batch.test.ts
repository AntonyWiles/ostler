import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const human = { kind: 'human' as const }

describe('project metrics from one history query (P9.1)', () => {
  const tempDir = useTempDir('ostler-metrics-')
  let planning: PlanningService

  beforeEach(async () => {
    planning = new PlanningService(await createMigratedDatabase(tempDir()), () => ['p1', 'p2'])
    const milestone = planning.createMilestone('p1', { name: 'Launch' })
    const statuses = ['ready', 'active', 'blocked', 'active', 'review', 'done'] as const
    for (let index = 0; index < 6; index += 1) {
      const item = planning.createWorkItem(
        'p1',
        { title: `Task ${index}`, milestoneId: index % 2 ? milestone.id : null },
        human
      )
      for (const status of statuses.slice(0, index + 1)) {
        planning.updateWorkItem(item.id, { status }, human)
      }
    }
    // Another project's history must not leak in.
    const other = planning.createWorkItem('p2', { title: 'Elsewhere' }, human)
    planning.updateWorkItem(other.id, { status: 'done' }, human)
    // Archived tasks count for the project's numbers; binned ones do not.
    const archived = planning.createWorkItem('p1', { title: 'Archived' }, human)
    planning.updateWorkItem(archived.id, { status: 'done' }, human)
    planning.archiveWorkItem(archived.id, human)
    const binned = planning.createWorkItem('p1', { title: 'Binned' }, human)
    planning.moveWorkItemToBin(binned.id, human)
  })

  afterEach(() => {
    planning.close()
  })

  it('gives every live task the same metrics as asking once per task', () => {
    const now = Date.now() + 60_000
    const batch = planning.getProjectWorkItemMetrics('p1', now)
    const live = planning.listWorkItems('p1')
    expect(Object.keys(batch).sort()).toEqual(live.map((item) => item.id).sort())
    for (const item of live) {
      expect(batch[item.id]).toEqual(planning.getWorkItemMetrics(item.id, now))
    }
  })

  it('keeps the project and milestone numbers as they were', () => {
    const now = Date.now() + 60_000
    const project = planning.getProjectMetrics('p1', now)
    expect(project.itemCount).toBe(7)
    expect(project.completedCount).toBe(2)
    const milestone = planning.listMilestones('p1')[0]
    const milestoneMetrics = planning.getMilestoneMetrics(milestone.id, now)
    expect(milestoneMetrics.itemCount).toBe(3)
    expect(milestoneMetrics.completedCount).toBe(1)
  })
})
