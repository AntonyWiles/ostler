import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanningActor, Result, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  }
}))

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { registerPlanningHandlers } = await import('../../electron/ipc/planning-handlers')
const { runWorkItemHousekeeping } = await import('../../electron/services/work-item-housekeeping')
const { syncAgentWorkItemStatus } = await import('../../electron/services/agent-status-sync')
const { classifyHarnessEvent } = await import('../../electron/services/planning-activity')
const { IPC_CHANNELS } = await import('../../src/shared/ostler-api')

const HUMAN: PlanningActor = { kind: 'human' }
const PROJECT = 'project-one'

describe('P5.2 comments and activity', () => {
  const tempDir = useTempDir('ostler-activity-')
  let databasePath: string
  let planning: InstanceType<typeof PlanningService>
  let people: InstanceType<typeof PeopleService>
  let raw: Database.Database

  beforeEach(async () => {
    databasePath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(databasePath, () => [PROJECT, 'project-two'])
    people = new PeopleService(databasePath)
    raw = new Database(databasePath)
  })

  afterEach(() => {
    raw.close()
    planning.close()
    people.close()
  })

  const changes = (workItemId: string) =>
    raw
      .prepare(
        'SELECT field, from_value, to_value, actor_kind, actor_person_id, metadata FROM planning_field_changes WHERE work_item_id = ? ORDER BY id'
      )
      .all(workItemId) as {
      field: string
      from_value: string | null
      to_value: string | null
      actor_kind: string
      actor_person_id: string | null
      metadata: string | null
    }[]

  const history = (workItemId: string) =>
    raw
      .prepare(
        'SELECT from_status, to_status, actor_kind FROM planning_status_history WHERE work_item_id = ? ORDER BY sequence'
      )
      .all(workItemId)

  describe('field changes', () => {
    it('records one row per changed field, with the actor, and status only in its history', () => {
      const alex = people.create({ name: 'Alex' })
      const milestone = planning.createMilestone(PROJECT, { name: 'Beta' })
      const other = planning.createWorkItem(PROJECT, { title: 'Other' }, HUMAN)
      const item = planning.createWorkItem(
        PROJECT,
        { title: 'Write', description: 'First', acceptanceCriteria: ['A'], labels: ['x'] },
        HUMAN
      )
      const actor: PlanningActor = { kind: 'human', personId: alex.id }
      raw.prepare('DELETE FROM planning_field_changes').run()

      planning.updateWorkItem(
        item.id,
        {
          title: 'Write it',
          description: 'Second, much longer',
          priority: 'high',
          status: 'ready',
          assigneeId: alex.id,
          startDate: '2026-10-01',
          targetDate: '2026-10-03',
          estimate: 3,
          milestoneId: milestone.id,
          labels: ['y'],
          dependencyIds: [other.id],
          acceptanceCriteria: ['A', 'B']
        },
        actor
      )

      const rows = changes(item.id)
      expect(rows.map((row) => row.field)).toEqual([
        'title',
        'description',
        'priority',
        'assignee',
        'startDate',
        'dueDate',
        'estimate',
        'milestone',
        'labels',
        'dependencies',
        'checklist'
      ])
      expect(
        rows.every((row) => row.actor_kind === 'human' && row.actor_person_id === alex.id)
      ).toBe(true)
      // The description is "edited": its text is not stored twice.
      expect(rows[1]).toMatchObject({ from_value: null, to_value: null })
      expect(rows[5]).toMatchObject({ from_value: 'null', to_value: '"2026-10-03"' })
      expect(history(item.id)).toEqual([
        { from_status: null, to_status: 'backlog', actor_kind: 'human' },
        { from_status: 'backlog', to_status: 'ready', actor_kind: 'human' }
      ])

      // Saving the same values records nothing.
      planning.updateWorkItem(item.id, { title: 'Write it', labels: ['y'], status: 'ready' }, actor)
      expect(changes(item.id)).toHaveLength(11)
      expect(history(item.id)).toHaveLength(2)
    })

    it('keeps the first bin date when an item already in the bin is deleted again', () => {
      const item = planning.createWorkItem(PROJECT, { title: 'Old' }, HUMAN)
      planning.moveWorkItemToBin(item.id, HUMAN, 1000)
      const again = planning.moveWorkItemToBin(item.id, HUMAN, 5000)
      expect(again.deletedAt).toBe(1000)
    })

    it('records ticks, archive, restore, the recycle bin, verification and label renames', () => {
      const item = planning.createWorkItem(
        PROJECT,
        { title: 'Ship', acceptanceCriteria: ['Done'], labels: ['old'] },
        HUMAN
      )
      planning.setChecklistItemChecked(item.id, 'Done', true, HUMAN)
      planning.setChecklistItemChecked(item.id, 'Done', true, HUMAN) // no change, no row
      planning.archiveWorkItem(item.id, { kind: 'system' })
      planning.unarchiveWorkItem(item.id, HUMAN)
      planning.moveWorkItemToBin(item.id, HUMAN)
      planning.restoreWorkItem(item.id, { kind: 'automation' })
      planning.updateVerification(
        item.id,
        { verificationStatus: 'passed', verifiedBy: 'human', verificationNotes: '' },
        HUMAN
      )
      planning.renameLabel(PROJECT, 'old', 'new', HUMAN)

      expect(changes(item.id).map((row) => [row.field, row.actor_kind])).toEqual([
        ['created', 'human'],
        ['checklistTick', 'human'],
        ['archived', 'system'],
        ['unarchived', 'human'],
        ['deleted', 'human'],
        ['restored', 'automation'],
        ['verification', 'human'],
        ['labels', 'human']
      ])
    })

    it('stores the AI draft an approved task came from in the change metadata', () => {
      const [created] = planning.createAIApprovedWorkItems(PROJECT, [{ title: 'From AI' }], {
        kind: 'human',
        draftId: 'draft-7'
      })
      expect(changes(created.id)[0]).toMatchObject({
        field: 'created',
        actor_kind: 'human',
        metadata: '{"draftId":"draft-7"}'
      })
      expect(planning.listActivity(PROJECT, created.id).entries[0].summary).toBe(
        'Someone created the task from an Ostler AI suggestion'
      )
    })

    it('refuses a write without an actor, and the type requires one', () => {
      const item = planning.createWorkItem(PROJECT, { title: 'Typed' }, HUMAN)
      // @ts-expect-error -- the actor is required (P5.2): a new write path cannot forget it.
      expect(() => planning.updateWorkItem(item.id, { title: 'No actor' })).toThrow(
        'Every change must say who made it'
      )
      // @ts-expect-error -- the same for creating a task.
      expect(() => planning.createWorkItem(PROJECT, { title: 'x' })).toThrow()
      // @ts-expect-error -- and for archiving one.
      expect(() => planning.archiveWorkItem(item.id)).toThrow()
      expect(() =>
        planning.updateWorkItem(item.id, { title: 'Bad' }, { kind: 'robot' } as never)
      ).toThrow('Every change must say who made it')
    })
  })

  describe('actors for each entry point', () => {
    const project = { id: PROJECT, name: 'One', enabled: true } as WatchedProject

    it('IPC writes are human, as Me', async () => {
      const me = people.ensureMe('jordan')
      handlers.clear()
      registerPlanningHandlers({
        configStore: {} as never,
        database: {} as never,
        aiPlanningService: {} as never,
        gitReader: {} as never,
        harnessService: {} as never,
        planningService: planning,
        getProject: () => project,
        queueWorkItemForHarness: vi.fn(),
        notifyHarnessState: vi.fn(),
        notifyPlanningChanged: vi.fn(),
        recordWorkItemSources: vi.fn(),
        recordWorkItemAttachments: vi.fn()
      })
      const invoke = async <T>(channel: string, ...args: unknown[]) =>
        (await handlers.get(channel)!({}, ...args)) as Result<T>
      const created = await invoke<{ id: string }>(
        IPC_CHANNELS.CREATE_PLANNING_WORK_ITEM,
        PROJECT,
        {
          title: 'From the app'
        }
      )
      if (!created.ok) throw new Error(created.error)
      await invoke(IPC_CHANNELS.UPDATE_PLANNING_WORK_ITEM, created.value.id, { priority: 'high' })
      const comment = await invoke<{ authorKind: string; authorPersonId: string }>(
        IPC_CHANNELS.ADD_PLANNING_COMMENT,
        created.value.id,
        'Looks good'
      )

      expect(
        changes(created.value.id).map((row) => [row.field, row.actor_kind, row.actor_person_id])
      ).toEqual([
        ['created', 'human', me.id],
        ['priority', 'human', me.id]
      ])
      expect(comment).toMatchObject({
        ok: true,
        value: { authorKind: 'human', authorPersonId: me.id }
      })
    })

    it('tells open views about a task created over IPC, such as from Quick add', async () => {
      handlers.clear()
      const notifyPlanningChanged = vi.fn()
      registerPlanningHandlers({
        configStore: {} as never,
        database: {} as never,
        aiPlanningService: {} as never,
        gitReader: {} as never,
        harnessService: {} as never,
        planningService: planning,
        getProject: () => project,
        queueWorkItemForHarness: vi.fn(),
        notifyHarnessState: vi.fn(),
        notifyPlanningChanged,
        recordWorkItemSources: vi.fn(),
        recordWorkItemAttachments: vi.fn()
      })
      const created = (await handlers.get(IPC_CHANNELS.CREATE_PLANNING_WORK_ITEM)!({}, PROJECT, {
        title: 'Quick one'
      })) as Result<{ id: string }>

      expect(created.ok).toBe(true)
      expect(notifyPlanningChanged).toHaveBeenCalledWith(project)
    })

    it('agent status sync is the agent, and only a real move is recorded', () => {
      const item = planning.createWorkItem(PROJECT, { title: 'Run', status: 'ready' }, HUMAN)
      raw
        .prepare("UPDATE planning_work_items SET linked_harness_task_id = 'task-1' WHERE id = ?")
        .run(item.id)
      syncAgentWorkItemStatus(planning, PROJECT, 'task-1', 'active')
      syncAgentWorkItemStatus(planning, PROJECT, 'task-1', 'active')
      syncAgentWorkItemStatus(planning, PROJECT, 'task-1', 'active')
      expect(history(item.id)).toEqual([
        { from_status: null, to_status: 'ready', actor_kind: 'human' },
        { from_status: 'ready', to_status: 'active', actor_kind: 'agent' }
      ])
      expect(planning.listActivity(PROJECT, item.id).entries[0].summary).toBe(
        'An agent moved the task from Ready to In progress'
      )
    })

    it('housekeeping is the system', () => {
      const item = planning.createWorkItem(PROJECT, { title: 'Old', status: 'done' }, HUMAN)
      raw.prepare('UPDATE planning_work_items SET updated_at = 0 WHERE id = ?').run(item.id)
      const harness = {
        getState: () => ({ taskQueue: [], activeSessions: [], reviewSessions: [] })
      }
      const result = runWorkItemHousekeeping(planning, harness as never, project, {
        autoArchiveDoneAfterDays: 1
      })
      expect(result.archived).toBe(1)
      expect(changes(item.id).at(-1)).toMatchObject({ field: 'archived', actor_kind: 'system' })
      expect(planning.listActivity(PROJECT, item.id).entries[0]).toMatchObject({
        actor: { kind: 'system', name: 'Ostler' },
        summary: 'Ostler archived the task'
      })
    })
  })

  describe('comments', () => {
    it('adds, edits, deletes with undo, counts, and refuses agents', () => {
      const item = planning.createWorkItem(PROJECT, { title: 'Talk' }, HUMAN)
      const comment = planning.addComment(item.id, '  **Hello**  ', HUMAN)
      expect(comment).toMatchObject({ body: '**Hello**', authorKind: 'human', deletedAt: null })
      expect(planning.commentCounts(PROJECT)).toEqual({ [item.id]: 1 })

      const edited = planning.updateComment(comment.id, 'Hello again', HUMAN)
      expect(edited.body).toBe('Hello again')
      expect(edited.updatedAt).toBeGreaterThan(edited.createdAt)
      expect(
        planning.listActivity(PROJECT, item.id, { filter: 'comments' }).entries[0]
      ).toMatchObject({
        kind: 'comment',
        summary: 'Someone commented (edited)'
      })

      planning.deleteComment(comment.id, HUMAN)
      expect(planning.listComments(item.id)).toEqual([])
      expect(planning.commentCounts(PROJECT)).toEqual({})
      expect(() => planning.updateComment(comment.id, 'x', HUMAN)).toThrow(
        'That comment was deleted'
      )
      planning.restoreComment(comment.id, HUMAN)
      expect(planning.listComments(item.id).map((entry) => entry.body)).toEqual(['Hello again'])

      expect(() => planning.addComment(item.id, '   ', HUMAN)).toThrow('Write something first')
      expect(() => planning.addComment(item.id, 'Hi', { kind: 'agent' })).toThrow(
        'Only people and the automation API can write comments'
      )
    })

    it('goes for good with its task', () => {
      const item = planning.createWorkItem(PROJECT, { title: 'Gone' }, HUMAN)
      const comment = planning.addComment(item.id, 'Bye', HUMAN)
      planning.deleteComment(comment.id, HUMAN)
      planning.deleteWorkItem(item.id, HUMAN)
      expect(raw.prepare('SELECT COUNT(*) AS n FROM planning_comments').get()).toEqual({ n: 0 })
      expect(raw.prepare('SELECT COUNT(*) AS n FROM planning_field_changes').get()).toEqual({
        n: 0
      })
    })
  })

  describe('the activity read model', () => {
    const insertEvent = (
      id: string,
      timestamp: number,
      eventType: string,
      sessionId: string,
      details: string
    ) =>
      raw
        .prepare(
          `INSERT INTO harness_events (id, project_id, timestamp, event_type, agent_session_id, agent_title, details)
           VALUES (?, ?, ?, ?, ?, '', ?)`
        )
        .run(id, PROJECT, timestamp, eventType, sessionId, details)

    it('merges every source newest first and pages without gaps or repeats', () => {
      const item = planning.createWorkItem(PROJECT, { title: 'Merge' }, HUMAN)
      const other = planning.createWorkItem(PROJECT, { title: 'Elsewhere' }, HUMAN)
      planning.updateWorkItem(item.id, { priority: 'high' }, HUMAN)
      planning.updateWorkItem(item.id, { status: 'ready' }, HUMAN)
      planning.addComment(item.id, 'One', HUMAN)
      planning.addComment(other.id, 'Not this task', HUMAN)
      // Force a known order, with ties, across the four sources.
      raw.prepare("UPDATE planning_field_changes SET at = 100 WHERE field = 'created'").run()
      raw.prepare('UPDATE planning_status_history SET at = 100 WHERE from_status IS NULL').run()
      raw.prepare("UPDATE planning_field_changes SET at = 200 WHERE field = 'priority'").run()
      raw.prepare("UPDATE planning_status_history SET at = 300 WHERE to_status = 'ready'").run()
      raw.prepare('UPDATE planning_comments SET created_at = 300, updated_at = 300').run()
      insertEvent('e1', 250, 'task_queued', 'human', 'queued task t1')
      insertEvent('e2', 300, 'task_claimed', 's1', 'claim task t1')
      insertEvent('e3', 400, 'question_asked', 's1', 'Which task should I do first?')
      insertEvent('e4', 450, 'task_report_submitted', 's1', 'Submitted a report for task t1')
      insertEvent('e5', 500, 'session_end', 's1', 'Merged session "Merge" into main')
      insertEvent('e6', 500, 'session_end', 's1', 'Session failed: Merge') // not told
      insertEvent('e7', 600, 'task_claimed', 's2', 'claim task t2') // the other task's run
      planning.setHarnessActivityResolver(() => ({
        taskWorkItems: new Map([
          ['t1', item.id],
          ['t2', other.id]
        ]),
        sessions: new Map([
          ['s1', { builtIn: true, taskIds: ['t1'] }],
          ['s2', { builtIn: false, taskIds: ['t2'] }]
        ])
      }))

      const all = planning.listActivity(PROJECT, item.id, { limit: 100 })
      expect(all.entries.map((entry) => entry.summary)).toEqual([
        'Built-in agent’s work was applied',
        'Built-in agent submitted its report',
        'Built-in agent asked a question',
        'Someone moved the task from Backlog to Ready',
        'Built-in agent started work',
        'Someone commented',
        'The task was queued for an agent',
        'Someone changed the priority from Medium to High',
        'Someone created the task'
      ])
      expect(all.nextBefore).toBeNull()

      // Two at a time gives the same list, in order, with nothing twice.
      const paged: string[] = []
      let before: string | undefined
      for (let page = 0; page < 10; page++) {
        const result = planning.listActivity(PROJECT, item.id, { limit: 2, before })
        paged.push(...result.entries.map((entry) => entry.id))
        if (!result.nextBefore) break
        before = result.nextBefore
      }
      expect(paged).toEqual(all.entries.map((entry) => entry.id))

      expect(
        planning.listActivity(PROJECT, item.id, { filter: 'changes' }).entries.map((e) => e.kind)
      ).not.toContain('comment')
      expect(
        planning.listActivity(PROJECT, item.id, { filter: 'comments' }).entries.map((e) => e.kind)
      ).toEqual(['comment'])

      // The project feed has both tasks, each harness event on its own task.
      const project = planning.listProjectActivity(PROJECT, { limit: 100 })
      const started = project.entries.filter((entry) => entry.summary.endsWith('started work'))
      expect(started.map((entry) => [entry.workItemTitle, entry.actor.name])).toEqual([
        ['Elsewhere', 'Connected agent'],
        ['Merge', 'Built-in agent']
      ])
      expect(project.entries).toHaveLength(all.entries.length + 3)
    })

    it('shows status rows from before P5.2 as by someone unknown', () => {
      const item = planning.createWorkItem(PROJECT, { title: 'Legacy' }, HUMAN)
      raw.prepare('DELETE FROM planning_field_changes').run()
      raw.prepare('UPDATE planning_status_history SET actor_kind = NULL').run()
      expect(planning.listActivity(PROJECT, item.id).entries).toMatchObject([
        {
          kind: 'status',
          actor: { kind: 'unknown', name: 'Someone' },
          summary: 'Someone created the task'
        }
      ])
    })

    it('words changes in plain language with names and dates', () => {
      const alex = people.create({ name: 'Alex' })
      const sam = people.create({ name: 'Sam' })
      const item = planning.createWorkItem(
        PROJECT,
        { title: 'Dates', targetDate: '2026-10-03', assigneeId: sam.id },
        HUMAN
      )
      const asAlex: PlanningActor = { kind: 'human', personId: alex.id }
      planning.updateWorkItem(item.id, { targetDate: '2026-10-10' }, asAlex)
      planning.updateWorkItem(item.id, { assigneeId: alex.id }, asAlex)
      planning.updateWorkItem(item.id, { labels: ['design', 'web'] }, { kind: 'automation' })
      const summaries = planning
        .listActivity(PROJECT, item.id)
        .entries.map((entry) => entry.summary)
      const date = (iso: string) =>
        new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(
          new Date(`${iso}T00:00:00`)
        )
      expect(summaries.slice(0, 3)).toEqual([
        'Automation API added 2 labels',
        'Alex reassigned the task from Sam to Alex',
        `Alex changed the due date from ${date('2026-10-03')} to ${date('2026-10-10')}`
      ])
    })

    it('rejects a bad cursor or limit', () => {
      const item = planning.createWorkItem(PROJECT, { title: 'x' }, HUMAN)
      expect(() => planning.listActivity(PROJECT, item.id, { before: 'nonsense' })).toThrow(
        'before is not a valid cursor'
      )
      expect(() => planning.listActivity(PROJECT, item.id, { limit: 0 })).toThrow('limit must be')
      expect(() => planning.listActivity('project-two', item.id)).toThrow(
        'Planning work item belongs to another project'
      )
    })
  })

  describe('one row per sitting of text edits', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('folds the saves of one sitting into one row per field, from the text before it', () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-01T09:00:00Z'))
      const alex = people.create({ name: 'Alex' })
      const item = planning.createWorkItem(PROJECT, { title: 'Write', description: 'First' }, HUMAN)
      raw.prepare('DELETE FROM planning_field_changes').run()

      // Typing saves a few times a minute: one sitting.
      planning.updateWorkItem(item.id, { title: 'Write a', description: 'Second' }, HUMAN)
      vi.setSystemTime(new Date('2026-10-01T09:01:00Z'))
      planning.updateWorkItem(item.id, { title: 'Write a b' }, HUMAN)
      vi.setSystemTime(new Date('2026-10-01T09:02:00Z'))
      planning.updateWorkItem(item.id, { description: 'Third, longer' }, HUMAN)

      expect(changes(item.id).map((row) => [row.field, row.from_value, row.to_value])).toEqual([
        ['title', '"Write"', '"Write a b"'],
        ['description', null, null]
      ])

      // Five minutes idle starts the next sitting; another person's edit does too.
      vi.setSystemTime(new Date('2026-10-01T09:08:00Z'))
      planning.updateWorkItem(item.id, { title: 'Write a b c' }, HUMAN)
      vi.setSystemTime(new Date('2026-10-01T09:08:30Z'))
      planning.updateWorkItem(item.id, { title: 'Written' }, { kind: 'human', personId: alex.id })

      expect(changes(item.id).map((row) => [row.field, row.from_value, row.to_value])).toEqual([
        ['title', '"Write"', '"Write a b"'],
        ['description', null, null],
        ['title', '"Write a b"', '"Write a b c"'],
        ['title', '"Write a b c"', '"Written"']
      ])
      expect(changes(item.id)[3].actor_person_id).toBe(alex.id)
    })

    it('keeps one row per change to a field that is not typed into', () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-01T09:00:00Z'))
      const item = planning.createWorkItem(PROJECT, { title: 'Write' }, HUMAN)
      raw.prepare('DELETE FROM planning_field_changes').run()

      planning.updateWorkItem(item.id, { priority: 'high' }, HUMAN)
      vi.setSystemTime(new Date('2026-10-01T09:00:10Z'))
      planning.updateWorkItem(item.id, { priority: 'low' }, HUMAN)

      expect(changes(item.id).map((row) => [row.field, row.to_value])).toEqual([
        ['priority', '"high"'],
        ['priority', '"low"']
      ])
    })
  })

  it('classifies the harness events an agent run leaves', () => {
    expect(classifyHarnessEvent('task_claimed', 'claim task ab')).toBe('started')
    expect(classifyHarnessEvent('task_claimed', 'force-release task ab')).toBeNull()
    expect(classifyHarnessEvent('session_end', 'Accepted session "x" with no code changes')).toBe(
      'accepted'
    )
    expect(classifyHarnessEvent('session_end', 'Discarded session "x"')).toBe('discarded')
    expect(classifyHarnessEvent('session_end', 'Rejected session "x" (retry): no')).toBe('rejected')
    expect(classifyHarnessEvent('file_lock', 'anything')).toBeNull()
  })
})
