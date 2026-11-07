import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

describe('PlanningService', () => {
  const tempDir = useTempDir('ostler-planning-')
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

  it('persists goals, milestones, and work items with human-authored defaults', () => {
    const goal = service.createGoal('project-one', {
      title: 'Ship planning',
      outcome: 'Ostler can organize work before execution'
    })
    const milestone = service.createMilestone('project-one', {
      name: 'Planning foundation',
      goalId: goal.id,
      targetDate: '2026-09-15',
      successCriteria: ['Planning records survive restart']
    })
    const dependency = service.createWorkItem(
      'project-one',
      {
        title: 'Define the data model',
        milestoneId: milestone.id,
        priority: 'high'
      },
      { kind: 'human' }
    )
    const item = service.createWorkItem(
      'project-one',
      {
        title: 'Build the board',
        description: 'Render persisted planning work',
        milestoneId: milestone.id,
        status: 'ready',
        labels: ['renderer', 'planning'],
        acceptanceCriteria: ['All workflow columns are visible'],
        dependencyIds: [dependency.id]
      },
      { kind: 'human' }
    )

    expect(item).toMatchObject({
      projectId: 'project-one',
      origin: 'human',
      linkedHarnessTaskId: null,
      dependencyIds: [dependency.id]
    })

    service.close()
    service = new PlanningService(databasePath, () => projectIds)

    expect(service.listGoals('project-one')).toEqual([goal])
    expect(service.listMilestones('project-one')).toEqual([milestone])
    expect(service.listWorkItems('project-one')).toEqual(
      expect.arrayContaining([
        dependency,
        expect.objectContaining({ id: item.id, dependencyIds: [dependency.id] })
      ])
    )
  })

  it('updates planning records while preserving immutable ownership fields', () => {
    const goal = service.createGoal('project-one', { title: 'Initial goal' })
    const milestone = service.createMilestone('project-one', { name: 'Initial milestone' })
    const item = service.createWorkItem('project-one', { title: 'Initial work' }, { kind: 'human' })

    expect(
      service.updateGoal(goal.id, { title: 'Updated goal', status: 'achieved' })
    ).toMatchObject({
      id: goal.id,
      projectId: 'project-one',
      title: 'Updated goal',
      status: 'achieved'
    })
    expect(
      service.updateMilestone(milestone.id, {
        goalId: goal.id,
        name: 'Updated milestone',
        status: 'active'
      })
    ).toMatchObject({ id: milestone.id, goalId: goal.id, status: 'active' })
    expect(
      service.updateWorkItem(
        item.id,
        {
          milestoneId: milestone.id,
          status: 'blocked',
          priority: 'critical'
        },
        { kind: 'human' }
      )
    ).toMatchObject({
      id: item.id,
      milestoneId: milestone.id,
      status: 'blocked',
      priority: 'critical',
      origin: 'human',
      linkedHarnessTaskId: null
    })
  })

  it('undoes empty goals and milestones but protects records that gained children', () => {
    const emptyGoal = service.createGoal('project-one', { title: 'Accidental goal' })
    const emptyMilestone = service.createMilestone('project-one', { name: 'Accidental milestone' })
    service.deleteGoal(emptyGoal.id)
    service.deleteMilestone(emptyMilestone.id)
    expect(service.listGoals('project-one')).toEqual([])
    expect(service.listMilestones('project-one')).toEqual([])

    const goal = service.createGoal('project-one', { title: 'Goal with milestone' })
    const milestone = service.createMilestone('project-one', {
      name: 'Milestone with task',
      goalId: goal.id
    })
    service.createWorkItem(
      'project-one',
      { title: 'Linked work', milestoneId: milestone.id },
      { kind: 'human' }
    )
    expect(() => service.deleteGoal(goal.id)).toThrow('has milestones')
    expect(() => service.deleteMilestone(milestone.id)).toThrow('This milestone still has tasks')
  })

  it('checks the comment rule in main, by the role in a shared project', async () => {
    const { default: Database } = await import('better-sqlite3')
    const side = new Database(databasePath)
    try {
      side.exec(`
        INSERT INTO people (id, name, initials, color, is_me, created_at, updated_at)
          VALUES ('me', 'Me', '', '#123456', 1, 1, 1), ('them', 'Them', '', '#654321', 0, 1, 1);
      `)
    } catch (error) {
      side.close()
      throw error
    }
    const me = { kind: 'human', personId: 'me' } as const
    const task = service.createWorkItem('project-one', { title: 'Talk' }, me)
    const mine = service.addComment(task.id, 'Mine', me)
    const theirs = service.addComment(task.id, 'Theirs', { kind: 'human', personId: 'them' })
    // Shared afterwards, with this PC's person a Viewer to begin with.
    side
      .prepare(
        `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at, my_role)
         VALUES ('project-one', 's1', 'C:/share', 'm1', 'dev-me', 1, 1, 'viewer')`
      )
      .run()
    const setRole = (role: string) =>
      side
        .prepare('UPDATE sync_shares SET my_role = ? WHERE project_id = ?')
        .run(role, 'project-one')
    try {
      // A Viewer edits and deletes their own comments, and pins none.
      expect(service.updateComment(mine.id, 'Mine, edited', me).body).toBe('Mine, edited')
      expect(() => service.pinComment(mine.id, true, me)).toThrow('Only its author')
      expect(() => service.deleteComment(theirs.id, me)).toThrow('Only its author')
      // An Editor pins any comment but edits and deletes only their own.
      setRole('editor')
      expect(service.pinComment(theirs.id, true, me).pinnedAt).toEqual(expect.any(Number))
      expect(() => service.updateComment(theirs.id, 'Not mine', me)).toThrow('Only its author')
      expect(() => service.deleteComment(theirs.id, me)).toThrow('Only its author')
      // An Owner deletes anyone's, and may restore it.
      setRole('owner')
      expect(service.deleteComment(theirs.id, me).deletedAt).toEqual(expect.any(Number))
      expect(service.restoreComment(theirs.id, me).deletedAt).toBeNull()
      expect(() => service.updateComment(theirs.id, 'Still not mine', me)).toThrow(
        'Only its author'
      )
    } finally {
      side.close()
    }
  })

  it('leaves tasks without the milestone when the person confirmed, their times kept as numbers', () => {
    const milestone = service.createMilestone('project-one', { name: 'Going away' })
    const task = service.createWorkItem(
      'project-one',
      { title: 'Stays', milestoneId: milestone.id },
      { kind: 'human' }
    )
    service.deleteMilestone(milestone.id, { detachTasks: true })
    const after = service.listWorkItems('project-one').find((item) => item.id === task.id)
    expect(after?.milestoneId).toBeNull()
    expect(typeof after?.updatedAt).toBe('number')
    expect(after!.updatedAt).toBeGreaterThanOrEqual(task.updatedAt)
    expect(service.listMilestones('project-one')).toEqual([])
  })

  it('deletes unlinked work but protects linked agent execution records', () => {
    const disposable = service.createWorkItem(
      'project-one',
      { title: 'Discard this' },
      { kind: 'human' }
    )
    service.deleteWorkItem(disposable.id, { kind: 'human' })
    expect(service.listWorkItems('project-one')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: disposable.id })])
    )

    const linked = service.createWorkItem(
      'project-one',
      {
        title: 'Agent-owned work',
        status: 'ready'
      },
      { kind: 'human' }
    )
    service.prepareHarnessHandoff('project-one', linked.id)
    expect(() => service.deleteWorkItem(linked.id, { kind: 'human' })).toThrow(/Linked agent work/)
  })

  it('creates human-approved AI suggestions atomically with attributable origins', () => {
    const approved = service.createAIApprovedWorkItems(
      'project-one',
      [
        { title: 'First suggested slice', priority: 'high' },
        { title: 'Second suggested slice', acceptanceCriteria: ['The behavior is tested'] }
      ],
      { kind: 'human' }
    )

    expect(approved).toHaveLength(2)
    expect(approved.every((item) => item.origin === 'ai-approved')).toBe(true)

    expect(() =>
      service.createAIApprovedWorkItems(
        'project-one',
        [{ title: 'Would otherwise be inserted' }, { title: '   ' }],
        { kind: 'human' }
      )
    ).toThrow('Work item title is required')
    expect(service.listWorkItems('project-one')).toHaveLength(2)
  })

  it('rejects unknown projects and cross-project relationships', () => {
    expect(() => service.createGoal('missing-project', { title: 'Unsafe goal' })).toThrow(
      'Project not found'
    )

    const otherGoal = service.createGoal('project-two', { title: 'Other project goal' })
    expect(() =>
      service.createMilestone('project-one', {
        name: 'Cross-project milestone',
        goalId: otherGoal.id
      })
    ).toThrow('Planning goal belongs to another project')

    const otherItem = service.createWorkItem(
      'project-two',
      { title: 'Other project work' },
      { kind: 'human' }
    )
    expect(() =>
      service.createWorkItem(
        'project-one',
        {
          title: 'Invalid dependency',
          dependencyIds: [otherItem.id]
        },
        { kind: 'human' }
      )
    ).toThrow('Planning dependencies cannot cross projects')
  })

  it('keeps a task editable when a task it depends on goes to the recycle bin', () => {
    const human = { kind: 'human' } as const
    const binned = service.createWorkItem('project-one', { title: 'Binned' }, human)
    const live = service.createWorkItem('project-one', { title: 'Live' }, human)
    const dependant = service.createWorkItem(
      'project-one',
      { title: 'Dependant', dependencyIds: [binned.id, live.id] },
      human
    )
    service.moveWorkItemToBin(binned.id, human)

    // A change that leaves dependencies alone, and one that keeps the binned one.
    expect(service.updateWorkItem(dependant.id, { status: 'active' }, human).status).toBe('active')
    expect(
      service.updateWorkItem(dependant.id, { dependencyIds: [binned.id] }, human).dependencyIds
    ).toEqual([binned.id])

    // Adding a binned task as a new dependency names it and why.
    const other = service.createWorkItem('project-one', { title: 'Other' }, human)
    expect(() => service.updateWorkItem(other.id, { dependencyIds: [binned.id] }, human)).toThrow(
      /is in the recycle bin/
    )
  })

  it('rejects dependency cycles and invalid dates', () => {
    const first = service.createWorkItem('project-one', { title: 'First' }, { kind: 'human' })
    const second = service.createWorkItem(
      'project-one',
      {
        title: 'Second',
        dependencyIds: [first.id]
      },
      { kind: 'human' }
    )

    expect(() =>
      service.updateWorkItem(first.id, { dependencyIds: [second.id] }, { kind: 'human' })
    ).toThrow("Tasks can't wait on each other in a loop")
    expect(() =>
      service.createWorkItem(
        'project-one',
        { title: 'Bad date', targetDate: '2026-02-30' },
        { kind: 'human' }
      )
    ).toThrow('Target date is invalid')
  })

  it('prepares one idempotent harness handoff only after dependencies are done', () => {
    const dependency = service.createWorkItem(
      'project-one',
      { title: 'Dependency' },
      { kind: 'human' }
    )
    const item = service.createWorkItem(
      'project-one',
      {
        title: 'Agent-ready work',
        status: 'ready',
        dependencyIds: [dependency.id]
      },
      { kind: 'human' }
    )

    expect(() => service.prepareHarnessHandoff('project-one', item.id)).toThrow(
      'Finish the tasks this one waits on before queuing it for an agent'
    )
    service.updateWorkItem(dependency.id, { status: 'done' }, { kind: 'human' })

    const prepared = service.prepareHarnessHandoff('project-one', item.id)
    const retried = service.prepareHarnessHandoff('project-one', item.id)
    expect(prepared.linkedHarnessTaskId).toMatch(/^[a-f0-9-]{36}$/)
    expect(retried.linkedHarnessTaskId).toBe(prepared.linkedHarnessTaskId)
    expect(service.getWorkItem(item.id).linkedHarnessTaskId).toBe(prepared.linkedHarnessTaskId)

    const returnedToPlanning = service.clearHarnessHandoff(
      'project-one',
      item.id,
      prepared.linkedHarnessTaskId!
    )
    expect(returnedToPlanning).toMatchObject({ status: 'ready', linkedHarnessTaskId: null })
    const requeued = service.prepareHarnessHandoff('project-one', item.id)
    expect(requeued.linkedHarnessTaskId).not.toBe(prepared.linkedHarnessTaskId)
  })

  it('rejects handoff for work that is not Ready or belongs to another project', () => {
    const backlog = service.createWorkItem(
      'project-one',
      { title: 'Unrefined work' },
      { kind: 'human' }
    )
    expect(() => service.prepareHarnessHandoff('project-one', backlog.id)).toThrow(
      'Only Ready work can be queued for an agent'
    )

    service.updateWorkItem(backlog.id, { status: 'ready' }, { kind: 'human' })
    expect(() => service.prepareHarnessHandoff('project-two', backlog.id)).toThrow(
      'Planning work item belongs to another project'
    )
  })

  it('validates bounded values received across the IPC boundary', () => {
    expect(() => service.createGoal('project-one', { title: '   ' })).toThrow(
      'Goal title is required'
    )
    expect(() =>
      service.createWorkItem(
        'project-one',
        {
          title: 'Too many labels',
          labels: Array.from({ length: 21 }, (_, index) => `label-${index}`)
        },
        { kind: 'human' }
      )
    ).toThrow('Labels must contain at most 20 items')
    expect(() =>
      service.createWorkItem(
        'project-one',
        {
          title: 'Invalid status',
          status: 'invented' as never
        },
        { kind: 'human' }
      )
    ).toThrow('Invalid work item status')
  })

  it('persists, updates, and deletes planning decisions with linked work items', () => {
    const item1 = service.createWorkItem(
      'project-one',
      { title: 'Setup database schema' },
      { kind: 'human' }
    )
    const item2 = service.createWorkItem(
      'project-one',
      { title: 'Setup migration runner' },
      { kind: 'human' }
    )

    const decision = service.createDecision('project-one', {
      title: 'Use SQLite WAL mode',
      context: 'Need reliable concurrent local reads without locking the UI',
      decision: 'Enable WAL mode and foreign keys on startup',
      alternativesConsidered: 'Standard DELETE mode journal, JSON flat files',
      consequences: 'Improves throughput, requires WAL file cleanup on close',
      date: '2026-08-25',
      linkedWorkItemIds: [item1.id, item2.id]
    })

    expect(decision).toMatchObject({
      projectId: 'project-one',
      title: 'Use SQLite WAL mode',
      context: 'Need reliable concurrent local reads without locking the UI',
      decision: 'Enable WAL mode and foreign keys on startup',
      alternativesConsidered: 'Standard DELETE mode journal, JSON flat files',
      consequences: 'Improves throughput, requires WAL file cleanup on close',
      date: '2026-08-25',
      linkedWorkItemIds: [item1.id, item2.id],
      origin: 'human'
    })
    expect(decision.id).toMatch(/^[a-f0-9-]{36}$/)

    service.close()
    service = new PlanningService(databasePath, () => projectIds)

    const list = service.listDecisions('project-one')
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual(decision)

    const updated = service.updateDecision(decision.id, {
      title: 'Use SQLite WAL mode and busy timeout',
      decision: 'Enable WAL mode, foreign keys, and 5000ms busy timeout',
      linkedWorkItemIds: [item1.id]
    })

    expect(updated.title).toBe('Use SQLite WAL mode and busy timeout')
    expect(updated.decision).toBe('Enable WAL mode, foreign keys, and 5000ms busy timeout')
    expect(updated.linkedWorkItemIds).toEqual([item1.id])
    expect(service.getDecision(decision.id).title).toBe('Use SQLite WAL mode and busy timeout')

    service.deleteDecision(decision.id)
    expect(service.listDecisions('project-one')).toEqual([])
    expect(() => service.getDecision(decision.id)).toThrow('Planning decision not found')
  })

  it('rejects decisions linking work items across projects or non-existent work items', () => {
    const itemOther = service.createWorkItem(
      'project-two',
      { title: 'Project two task' },
      { kind: 'human' }
    )

    expect(() =>
      service.createDecision('project-one', {
        title: 'Cross project link',
        decision: 'Should be rejected',
        linkedWorkItemIds: [itemOther.id]
      })
    ).toThrow('Planning decisions cannot link work items across projects')

    expect(() =>
      service.createDecision('project-one', {
        title: 'Non-existent item link',
        decision: 'Should be rejected',
        linkedWorkItemIds: ['non-existent-uuid']
      })
    ).toThrow('Linked planning work item not found')
  })

  it('supports ai-approved origin on decision creation', () => {
    const decision = service.createDecision(
      'project-one',
      {
        title: 'Adopt Vitest for test runner',
        decision: 'Migrate from Jest to Vitest for ESM compatibility'
      },
      'ai-approved'
    )

    expect(decision.origin).toBe('ai-approved')
    expect(service.getDecision(decision.id).origin).toBe('ai-approved')
  })

  describe("a decision's default date is the person's day, not Greenwich's", () => {
    const originalTz = process.env.TZ
    beforeEach(() => {
      process.env.TZ = 'Pacific/Auckland'
      vi.useFakeTimers({ toFake: ['Date'] })
    })
    afterEach(() => {
      vi.useRealTimers()
      if (originalTz === undefined) delete process.env.TZ
      else process.env.TZ = originalTz
    })

    const decidedAt = (instant: number) => {
      vi.setSystemTime(instant)
      return service.createDecision('project-one', { title: 'Pick a host', decision: 'Fly.io' })
        .date
    }

    // October 2026 in New Zealand is daylight time, UTC+13.
    it.each([
      ['just before local midnight', Date.UTC(2026, 9, 17, 10, 59, 30), '2026-10-17'],
      ['just after local midnight', Date.UTC(2026, 9, 17, 11, 0, 30), '2026-10-18'],
      ['just before 13:00 NZDT', Date.UTC(2026, 9, 17, 23, 59, 30), '2026-10-18'],
      ['just after 13:00 NZDT', Date.UTC(2026, 9, 18, 0, 0, 30), '2026-10-18']
    ])('%s', (_when, instant, day) => {
      expect(decidedAt(instant)).toBe(day)
    })

    it('still keeps a date the person gave', () => {
      vi.setSystemTime(Date.UTC(2026, 9, 17, 11, 0, 30))
      const decision = service.createDecision('project-one', {
        title: 'Pick a host',
        decision: 'Fly.io',
        date: '2026-10-01'
      })
      expect(decision.date).toBe('2026-10-01')
    })
  })

  it('sets, reads, and clears per-column WIP limits scoped to a project', () => {
    expect(service.getWipLimits('project-one')).toEqual({})

    const afterSet = service.setWipLimit('project-one', 'active', 3)
    expect(afterSet).toEqual({ active: 3 })
    expect(service.getWipLimits('project-one')).toEqual({ active: 3 })

    const afterSecondSet = service.setWipLimit('project-one', 'review', 2)
    expect(afterSecondSet).toEqual({ active: 3, review: 2 })

    const afterUpdate = service.setWipLimit('project-one', 'active', 5)
    expect(afterUpdate).toEqual({ active: 5, review: 2 })

    const afterClear = service.setWipLimit('project-one', 'active', null)
    expect(afterClear).toEqual({ review: 2 })

    expect(service.getWipLimits('project-two')).toEqual({})

    expect(() => service.setWipLimit('project-one', 'active', 0)).toThrow(
      'WIP limit must be a whole number between 1 and 9999'
    )
    expect(() => service.setWipLimit('project-one', 'active', 1.5)).toThrow(
      'WIP limit must be a whole number between 1 and 9999'
    )
    expect(() => service.setWipLimit('unknown-project', 'active', 1)).toThrow()
  })

  it('excludes work items with an open blocker or with children from dispatch eligibility', () => {
    const parent = service.createWorkItem(
      'project-one',
      { title: 'Parent', status: 'ready' },
      { kind: 'human' }
    )
    const child = service.createWorkItem(
      'project-one',
      {
        title: 'Child',
        status: 'ready',
        parentWorkItemId: parent.id
      },
      { kind: 'human' }
    )
    const standalone = service.createWorkItem(
      'project-one',
      {
        title: 'Standalone',
        status: 'ready'
      },
      { kind: 'human' }
    )

    expect(service.isWorkItemEligibleForDispatch('project-one', parent.id)).toBe(false)
    expect(service.isWorkItemEligibleForDispatch('project-one', child.id)).toBe(true)
    expect(service.isWorkItemEligibleForDispatch('project-one', standalone.id)).toBe(true)

    const blocker = service.reportBlocker(standalone.id, 'Waiting on design sign-off', 'human', [
      'Proceed anyway',
      'Cancel'
    ])
    expect(service.isWorkItemEligibleForDispatch('project-one', standalone.id)).toBe(false)
    expect(service.listOpenBlockers('project-one')).toEqual([
      expect.objectContaining({ id: blocker.id, workItemId: standalone.id, status: 'open' })
    ])

    service.resolveBlocker(blocker.id, 'Proceed anyway', 'Approved verbally', 'human')
    expect(service.isWorkItemEligibleForDispatch('project-one', standalone.id)).toBe(true)
    expect(service.listOpenBlockers('project-one')).toEqual([])
  })

  it("resolves a task's open blockers when it is marked Done", () => {
    const task = service.createWorkItem('project-one', { title: 'Go live' }, { kind: 'human' })
    const blocker = service.reportBlocker(task.id, 'Ready to go live?', 'agent')
    const changes: unknown[] = []
    service.setBlockersChangedListener((_projectId, change) => changes.push(change))

    service.updateWorkItem(task.id, { status: 'done' }, { kind: 'human' })

    expect(service.listBlockersForWorkItem(task.id)).toEqual([
      expect.objectContaining({
        id: blocker.id,
        status: 'resolved',
        resolutionChoice: 'Task done',
        resolvedBy: 'human'
      })
    ])
    expect(service.listOpenBlockers('project-one')).toEqual([])
    expect(changes).toEqual([{ kind: 'resolved', blockerId: blocker.id, workItemId: task.id }])
  })

  it('defaults a subtask to phase 1 and keeps a phase name consistent across its siblings', () => {
    const parent = service.createWorkItem('project-one', { title: 'Parent' }, { kind: 'human' })
    const child1 = service.createWorkItem(
      'project-one',
      {
        title: 'Child 1',
        parentWorkItemId: parent.id,
        subtaskPhaseName: 'Backend'
      },
      { kind: 'human' }
    )
    expect(child1).toMatchObject({ subtaskPhaseNumber: 1, subtaskPhaseName: 'Backend' })

    // A second child of the same phase inherits the name even if it omits it.
    const child2 = service.createWorkItem(
      'project-one',
      {
        title: 'Child 2',
        parentWorkItemId: parent.id,
        subtaskPhaseNumber: 1
      },
      { kind: 'human' }
    )
    expect(child2.subtaskPhaseName).toBe('Backend')

    // A conflicting name for the same phase number is rejected.
    expect(() =>
      service.createWorkItem(
        'project-one',
        {
          title: 'Child 3',
          parentWorkItemId: parent.id,
          subtaskPhaseNumber: 1,
          subtaskPhaseName: 'Frontend'
        },
        { kind: 'human' }
      )
    ).toThrow('already named "Backend"')

    // A different phase number under the same parent is independent.
    const phase2Child = service.createWorkItem(
      'project-one',
      {
        title: 'Phase 2 task',
        parentWorkItemId: parent.id,
        subtaskPhaseNumber: 2,
        subtaskPhaseName: 'Frontend'
      },
      { kind: 'human' }
    )
    expect(phase2Child).toMatchObject({ subtaskPhaseNumber: 2, subtaskPhaseName: 'Frontend' })
  })

  it('rejects subtasks nested more than three levels deep', () => {
    const top = service.createWorkItem('project-one', { title: 'Top' }, { kind: 'human' })
    const child = service.createWorkItem(
      'project-one',
      {
        title: 'Child',
        parentWorkItemId: top.id
      },
      { kind: 'human' }
    )
    const grandchild = service.createWorkItem(
      'project-one',
      {
        title: 'Grandchild',
        parentWorkItemId: child.id
      },
      { kind: 'human' }
    )
    expect(() =>
      service.createWorkItem(
        'project-one',
        {
          title: 'Great-grandchild',
          parentWorkItemId: grandchild.id
        },
        { kind: 'human' }
      )
    ).toThrow('Subtasks may only nest three levels deep')
  })

  it('restricts a subtask dependency picker to same-phase siblings, excluding its own parent', () => {
    const parent = service.createWorkItem('project-one', { title: 'Parent' }, { kind: 'human' })
    const sibling1 = service.createWorkItem(
      'project-one',
      {
        title: 'Sibling 1',
        parentWorkItemId: parent.id,
        subtaskPhaseNumber: 1
      },
      { kind: 'human' }
    )
    const sibling2 = service.createWorkItem(
      'project-one',
      {
        title: 'Sibling 2',
        parentWorkItemId: parent.id,
        subtaskPhaseNumber: 1
      },
      { kind: 'human' }
    )
    const otherPhaseTask = service.createWorkItem(
      'project-one',
      {
        title: 'Other phase task',
        parentWorkItemId: parent.id,
        subtaskPhaseNumber: 2
      },
      { kind: 'human' }
    )
    const unrelated = service.createWorkItem(
      'project-one',
      { title: 'Unrelated top-level task' },
      { kind: 'human' }
    )

    // Depending on a same-phase sibling is fine.
    const updated = service.updateWorkItem(
      sibling1.id,
      { dependencyIds: [sibling2.id] },
      { kind: 'human' }
    )
    expect(updated.dependencyIds).toEqual([sibling2.id])

    // Depending on its own parent is not: a parent with children is never
    // dispatched directly, so it can never reach done and the subtask would wait
    // on it forever.
    expect(() =>
      service.updateWorkItem(sibling1.id, { dependencyIds: [parent.id] }, { kind: 'human' })
    ).toThrow('cannot depend on its own parent')

    // Depending on a different phase's task or an unrelated top-level task is rejected.
    expect(() =>
      service.updateWorkItem(sibling1.id, { dependencyIds: [otherPhaseTask.id] }, { kind: 'human' })
    ).toThrow('same phase')
    expect(() =>
      service.updateWorkItem(sibling1.id, { dependencyIds: [unrelated.id] }, { kind: 'human' })
    ).toThrow('same phase')

    // Top-level items remain unrestricted.
    expect(() =>
      service.updateWorkItem(
        unrelated.id,
        { dependencyIds: [otherPhaseTask.id] },
        { kind: 'human' }
      )
    ).not.toThrow()
  })

  it('creates a full agent-plan-split tree, wires dependencies and parents, and is idempotent per draft', () => {
    const items = service.createAgentPlanTasks(
      'project-one',
      null,
      [
        {
          code: 'A',
          name: 'Foundation',
          tasks: [
            {
              code: 'A1',
              depth: 1,
              title: 'Set up schema',
              context: '',
              task: 'Add tables',
              constraints: [],
              acceptanceCriteria: [],
              outOfScope: [],
              reliesOn: [],
              priority: 'high',
              rationale: '',
              evidence: [],
              subtasks: [
                {
                  code: 'A1.1',
                  depth: 2,
                  title: 'Migration',
                  context: '',
                  task: 'Write migration',
                  constraints: [],
                  acceptanceCriteria: [],
                  outOfScope: [],
                  reliesOn: [],
                  priority: 'medium',
                  rationale: '',
                  evidence: [],
                  subtasks: []
                }
              ]
            },
            {
              code: 'A2',
              depth: 1,
              title: 'Build API',
              context: '',
              task: 'Expose endpoint',
              constraints: [],
              acceptanceCriteria: [],
              outOfScope: [],
              reliesOn: ['A1'],
              priority: 'medium',
              rationale: '',
              evidence: [],
              subtasks: []
            }
          ]
        }
      ],
      { kind: 'human', draftId: 'test-draft' }
    )

    expect(items).toHaveLength(3)
    const byCode = new Map(items.map((item) => [item.taskCode, item]))
    const a1 = byCode.get('A1')!
    const a1_1 = byCode.get('A1.1')!
    const a2 = byCode.get('A2')!

    expect(a1.status).toBe('ready')
    expect(a1.parentWorkItemId).toBeNull()
    expect(a1_1.parentWorkItemId).toBe(a1.id)
    expect(a1_1.status).toBe('ready')
    expect(a2.dependencyIds).toEqual([a1.id])
    expect(a2.status).toBe('backlog')
    expect(a1.phaseCode).toBe('A')
    expect(a1.phaseName).toBe('Foundation')
    // The draft that made them is in their history, not on a label people see.
    expect(a1.labels).toEqual([])

    expect(service.isWorkItemEligibleForDispatch('project-one', a1.id)).toBe(false) // has a child
    expect(service.isWorkItemEligibleForDispatch('project-one', a1_1.id)).toBe(true)
    expect(service.isWorkItemEligibleForDispatch('project-one', a2.id)).toBe(false) // unmet dependency

    const retried = service.createAgentPlanTasks(
      'project-one',
      null,
      [{ code: 'A', name: 'Foundation', tasks: [] }],
      { kind: 'human', draftId: 'test-draft' }
    )
    expect(retried.map((item) => item.id).sort()).toEqual(items.map((item) => item.id).sort())
  })

  it('drops a reliesOn reference to a rejected node instead of creating a dangling dependency', () => {
    const items = service.createAgentPlanTasks(
      'project-one',
      null,
      [
        {
          code: 'B',
          name: 'Phase B',
          tasks: [
            {
              code: 'B1',
              depth: 1,
              title: 'Kept task',
              context: '',
              task: 'Do the work',
              constraints: [],
              acceptanceCriteria: [],
              outOfScope: [],
              reliesOn: ['B2'],
              priority: 'medium',
              rationale: '',
              evidence: [],
              subtasks: []
            }
          ]
        }
      ],
      { kind: 'human', draftId: 'dropped-dep' }
    )
    // B2 was never included in the submitted phases, matching a rejected node.
    expect(items).toHaveLength(1)
    expect(items[0].dependencyIds).toEqual([])
    expect(items[0].status).toBe('ready')
  })
})
