import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import type { PlanningWorkItemStatus } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

describe('Planning Board Swimlanes', () => {
  const tempDir = useTempDir('ostler-swimlane-')
  let databasePath: string
  let service: PlanningService
  const projectIds = ['project-swimlane-test']

  beforeEach(async () => {
    databasePath = await createMigratedDatabase(tempDir())
    service = new PlanningService(databasePath, () => projectIds)
  })

  afterEach(() => {
    service.close()
  })

  it('correctly partitions items into milestone swimlanes including unassigned lane', () => {
    const goal = service.createGoal('project-swimlane-test', { title: 'Q3 Deliverables' })
    const milestoneA = service.createMilestone('project-swimlane-test', {
      name: 'Milestone Alpha',
      goalId: goal.id
    })
    const milestoneB = service.createMilestone('project-swimlane-test', {
      name: 'Milestone Beta',
      goalId: goal.id
    })

    const itemA = service.createWorkItem(
      'project-swimlane-test',
      {
        title: 'Alpha task',
        milestoneId: milestoneA.id,
        status: 'ready'
      },
      { kind: 'human' }
    )
    const itemB = service.createWorkItem(
      'project-swimlane-test',
      {
        title: 'Beta task',
        milestoneId: milestoneB.id,
        status: 'active'
      },
      { kind: 'human' }
    )
    const itemUnassigned = service.createWorkItem(
      'project-swimlane-test',
      {
        title: 'Ad-hoc task',
        milestoneId: null,
        status: 'backlog'
      },
      { kind: 'human' }
    )

    const allItems = service.listWorkItems('project-swimlane-test')
    const milestones = service.listMilestones('project-swimlane-test')

    // Simulate milestone swimlane partitioning logic
    const milestoneLanes = [
      ...milestones.map((m) => ({
        id: m.id,
        milestoneId: m.id,
        title: m.name,
        items: allItems.filter((i) => i.milestoneId === m.id)
      })),
      {
        id: 'unassigned',
        milestoneId: null,
        title: 'No milestone',
        items: allItems.filter((i) => !i.milestoneId)
      }
    ]

    expect(milestoneLanes).toHaveLength(3)
    expect(milestoneLanes.find((l) => l.id === milestoneA.id)?.items).toEqual([
      expect.objectContaining({ id: itemA.id, title: 'Alpha task' })
    ])
    expect(milestoneLanes.find((l) => l.id === milestoneB.id)?.items).toEqual([
      expect.objectContaining({ id: itemB.id, title: 'Beta task' })
    ])
    expect(milestoneLanes.find((l) => l.id === 'unassigned')?.items).toEqual([
      expect.objectContaining({ id: itemUnassigned.id, title: 'Ad-hoc task' })
    ])
  })

  it('correctly partitions items into origin swimlanes', () => {
    const itemHuman = service.createWorkItem(
      'project-swimlane-test',
      {
        title: 'Human task',
        status: 'ready'
      },
      { kind: 'human' }
    )
    const itemAi = service.createWorkItem(
      'project-swimlane-test',
      {
        title: 'AI generated task',
        status: 'backlog'
      },
      { kind: 'human' },
      'ai-approved'
    )
    const itemImported = service.createWorkItem(
      'project-swimlane-test',
      {
        title: 'Imported task',
        status: 'review'
      },
      { kind: 'human' },
      'imported'
    )

    const allItems = service.listWorkItems('project-swimlane-test')

    // Simulate origin swimlane partitioning logic
    const originLanes = [
      {
        id: 'origin-human',
        title: 'Human-authored',
        items: allItems.filter((i) => i.origin === 'human')
      },
      {
        id: 'origin-ai-approved',
        title: 'AI-approved',
        items: allItems.filter((i) => i.origin === 'ai-approved')
      },
      {
        id: 'origin-imported',
        title: 'Imported',
        items: allItems.filter((i) => i.origin === 'imported')
      }
    ]

    expect(originLanes.find((l) => l.id === 'origin-human')?.items).toEqual([
      expect.objectContaining({ id: itemHuman.id, origin: 'human' })
    ])
    expect(originLanes.find((l) => l.id === 'origin-ai-approved')?.items).toEqual([
      expect.objectContaining({ id: itemAi.id, origin: 'ai-approved' })
    ])
    expect(originLanes.find((l) => l.id === 'origin-imported')?.items).toEqual([
      expect.objectContaining({ id: itemImported.id, origin: 'imported' })
    ])
  })

  it('updates milestone and status atomically on cross-lane drop', () => {
    const milestoneA = service.createMilestone('project-swimlane-test', {
      name: 'Milestone Alpha'
    })
    const milestoneB = service.createMilestone('project-swimlane-test', {
      name: 'Milestone Beta'
    })
    const item = service.createWorkItem(
      'project-swimlane-test',
      {
        title: 'Cross-lane candidate',
        milestoneId: milestoneA.id,
        status: 'ready'
      },
      { kind: 'human' }
    )

    // Simulate moving from Milestone Alpha (ready) to Milestone Beta (active)
    const targetMilestoneId = milestoneB.id
    const targetStatus: PlanningWorkItemStatus = 'active'

    const updated = service.updateWorkItem(
      item.id,
      {
        milestoneId: targetMilestoneId,
        status: targetStatus
      },
      { kind: 'human' }
    )

    expect(updated.milestoneId).toBe(milestoneB.id)
    expect(updated.status).toBe('active')

    // Move to unassigned lane (No milestone) and update status to done
    const unassigned = service.updateWorkItem(
      item.id,
      {
        milestoneId: null,
        status: 'done'
      },
      { kind: 'human' }
    )

    expect(unassigned.milestoneId).toBeNull()
    expect(unassigned.status).toBe('done')
  })
})
