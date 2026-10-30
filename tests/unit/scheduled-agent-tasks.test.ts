import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import type { HarnessService } from '../../electron/services/harness-service'
import { queueWorkItemForHarness } from '../../electron/services/task-intake'
import {
  queueDueScheduledTasks,
  queueScheduledTaskNow,
  type ScheduledQueueDeps
} from '../../electron/services/scheduled-agent-tasks'
import { scheduledQueueSource } from '../../electron/services/inbox-sources'
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  migrateOstlerDatabase
} from '../../electron/services/database/migrations'
import type { HarnessTask, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'

/** Scheduled agent tasks (N9.7, N65): a repeating task that goes to agents when it comes round. */

describe('migration 56', () => {
  let tempDir: string
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-scheduled-migration-'))
  })
  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  it('leaves every existing repeat off and every task not yet acted on', async () => {
    const dbPath = path.join(tempDir, 'ostler.db')
    const options = { backupDir: path.join(tempDir, 'backups'), appVersion: 'test' }
    await migrateOstlerDatabase(
      dbPath,
      options,
      MIGRATIONS.filter((migration) => migration.version < 56)
    )
    const before = new Database(dbPath)
    before.exec(`
      INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
        VALUES ('w1', 'p1', 'Old', 'backlog', 'medium', 'human', 1, 1);
      INSERT INTO planning_recurrences (work_item_id, project_id, rule)
        VALUES ('w1', 'p1', '{"every":"week","interval":1}');
    `)
    before.close()
    const result = await migrateOstlerDatabase(dbPath, options)
    expect(result.to).toBe(LATEST_SCHEMA_VERSION)
    const db = new Database(dbPath)
    expect(db.prepare('SELECT go_to_agents FROM planning_recurrences').get()).toEqual({
      go_to_agents: 0
    })
    expect(
      db
        .prepare(
          "SELECT scheduled_queue, scheduled_queue_at, scheduled_queue_note FROM planning_work_items WHERE id = 'w1'"
        )
        .get()
    ).toEqual({ scheduled_queue: null, scheduled_queue_at: null, scheduled_queue_note: null })
    expect(() => db.prepare('UPDATE planning_recurrences SET go_to_agents = 2').run()).toThrow(
      /CHECK/
    )
    expect(() =>
      db.prepare("UPDATE planning_work_items SET scheduled_queue = 'maybe'").run()
    ).toThrow(/CHECK/)
    db.close()
  })
})

describe('scheduled agent tasks', () => {
  let tempDir: string
  let databasePath: string
  let planning: PlanningService
  let tasks: HarnessTask[]
  let agentsOn: boolean
  const human = { kind: 'human' } as const
  const weekly = { every: 'week' as const, interval: 1 }
  // The harness's queue as the queue path uses it; the real one is covered by
  // the automation API's integration test. Nothing here starts an agent.
  const harness = {
    getState: () => ({ taskQueue: tasks }),
    addTask: (_project: WatchedProject, title: string, _details: string, id: string) => {
      const task = { id, title, status: 'pending', claimedBy: null } as HarnessTask
      tasks.push(task)
      return task
    },
    setTaskPriority: (_project: WatchedProject, taskId: string) =>
      tasks.find((entry) => entry.id === taskId)!,
    setTaskPlanFirst: (_project: WatchedProject, taskId: string, on: boolean) => {
      const task = tasks.find((entry) => entry.id === taskId)!
      if (on) task.planFirst = true
      else delete task.planFirst
      return task
    },
    setTaskScheduled: (_project: WatchedProject, taskId: string) => {
      const task = tasks.find((entry) => entry.id === taskId)!
      task.scheduled = true
      return task
    }
  }
  let projectPath: string | null
  const project = () =>
    ({ id: 'p1', name: 'Site', path: projectPath, enabled: true }) as WatchedProject
  const deps = (): ScheduledQueueDeps => ({
    planning,
    getProjects: () => [project()],
    agentsOn: () => agentsOn,
    queuedTasks: () => tasks,
    queue: (target, workItemId) => {
      queueWorkItemForHarness(planning, harness as unknown as HarnessService, target, workItemId, {
        allowUnmetDependencies: true,
        scheduled: true
      })
    },
    now: () => Date.now()
  })
  const run = (today: string) => queueDueScheduledTasks(deps(), today)
  const queueNow = (workItemId: string) => queueScheduledTaskNow(deps(), workItemId, human)
  let reader: Database.Database | null = null
  const inbox = () => {
    reader ??= new Database(databasePath, { readonly: true })
    return scheduledQueueSource(reader, () => [project()])()
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // Wednesday 7 October 2026.
    vi.setSystemTime(new Date(2026, 9, 7, 10, 0))
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-scheduled-'))
    databasePath = await createMigratedDatabase(tempDir)
    planning = new PlanningService(databasePath, () => ['p1'])
    tasks = []
    agentsOn = true
    projectPath = tempDir
  })
  afterEach(() => {
    reader?.close()
    reader = null
    planning.close()
    vi.useRealTimers()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const repeating = (
    input: { startDate?: string | null; targetDate?: string | null; planFirst?: 'yes' } = {},
    goToAgents = true
  ) => {
    const item = planning.createWorkItem(
      'p1',
      { title: 'Update the dependencies', status: 'backlog', ...input },
      human
    )
    planning.setRecurrence(item.id, { rule: weekly, goToAgents }, human)
    return item
  }

  it('is off by default, and moves with the rule with the plan-first choice', () => {
    const plain = planning.createWorkItem('p1', { title: 'Bins', targetDate: '2026-10-07' }, human)
    expect(planning.setRecurrence(plain.id, { rule: weekly }, human)?.goToAgents).toBe(false)
    const first = repeating({ targetDate: '2026-10-07', planFirst: 'yes' })
    expect(planning.getRecurrence(first.id)?.goToAgents).toBe(true)
    // Left out, it stays as it was.
    planning.setRecurrence(first.id, { rule: { every: 'week', interval: 2 } }, human)
    expect(planning.getRecurrence(first.id)?.goToAgents).toBe(true)
    expect(() =>
      planning.setRecurrence(first.id, { rule: weekly, goToAgents: 'yes' as never }, human)
    ).toThrow('goToAgents must be true or false')
    const next = planning.getWorkItem(
      planning.updateWorkItem(first.id, { status: 'done' }, human).repeatedAs!
    )
    expect(planning.getRecurrence(next.id)?.goToAgents).toBe(true)
    expect(next.planFirst).toBe('yes')
    expect(next.scheduledQueue).toBeUndefined()
  })

  it('queues an occurrence on its start date, once, through the queue path', () => {
    const item = repeating({ startDate: '2026-10-09', targetDate: '2026-10-12' })
    expect(run('2026-10-08')).toEqual([])
    expect(tasks).toHaveLength(0)
    expect(run('2026-10-09')).toEqual([{ workItemId: item.id, projectId: 'p1', outcome: 'queued' }])
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ status: 'pending', scheduled: true })
    const queued = planning.getWorkItem(item.id)
    expect(queued.status).toBe('ready')
    expect(queued.linkedHarnessTaskId).toBe(tasks[0].id)
    expect(queued.scheduledQueue).toMatchObject({ outcome: 'queued' })
    // Never twice: the next check, and the next day, do nothing.
    tasks[0].status = 'complete'
    expect(run('2026-10-09')).toEqual([])
    expect(run('2026-10-10')).toEqual([])
    expect(tasks).toHaveLength(1)
    expect(inbox()).toEqual([
      expect.objectContaining({
        key: `scheduled:${item.id}`,
        kind: 'scheduled',
        title: 'Queued for agents: Update the dependencies',
        body: 'Weekly · Site',
        taskId: item.id
      })
    ])
  })

  it('uses the due date when there is no start date, and catches up a missed day once', () => {
    const item = repeating({ targetDate: '2026-10-05' })
    // Ostler was closed through the 5th and 6th: one queuing, not one per day.
    expect(run('2026-10-07').map((result) => result.outcome)).toEqual(['queued'])
    expect(run('2026-10-07')).toEqual([])
    expect(tasks).toHaveLength(1)
    expect(planning.getWorkItem(item.id).scheduledQueue?.outcome).toBe('queued')
  })

  it('leaves a task with no dates, or whose repeat does not go to agents, alone', () => {
    repeating({})
    repeating({ targetDate: '2026-10-01' }, false)
    expect(run('2026-10-07')).toEqual([])
    expect(tasks).toHaveLength(0)
  })

  it('does not queue when agents are off, and says why in the Inbox once', () => {
    agentsOn = false
    const item = repeating({ targetDate: '2026-10-07' })
    expect(run('2026-10-07').map((result) => result.outcome)).toEqual(['agentsOff'])
    expect(run('2026-10-07')).toEqual([])
    expect(tasks).toHaveLength(0)
    // It stays an ordinary task the person can queue.
    expect(planning.getWorkItem(item.id)).toMatchObject({
      status: 'backlog',
      linkedHarnessTaskId: null
    })
    expect(inbox()).toEqual([
      expect.objectContaining({
        title: 'Not queued for agents: Update the dependencies',
        body: 'Not queued: agents are off · Site'
      })
    ])
    // Turning agents on later does not queue the occurrence its day has passed for.
    agentsOn = true
    expect(run('2026-10-08')).toEqual([])
  })

  it('does not queue without a linked folder, with one Inbox note', () => {
    projectPath = null
    repeating({ targetDate: '2026-10-07' })
    expect(run('2026-10-07').map((result) => result.outcome)).toEqual(['noFolder'])
    expect(run('2026-10-07')).toEqual([])
    expect(tasks).toHaveLength(0)
    expect(inbox().map((item) => item.body)).toEqual([
      'Not queued: the project has no linked folder · Site'
    ])
  })

  it('does not queue a task already queued or running, with one Inbox note', () => {
    const item = repeating({ targetDate: '2026-10-07' })
    planning.updateWorkItem(item.id, { status: 'ready' }, human)
    queueWorkItemForHarness(planning, harness as unknown as HarnessService, project(), item.id)
    tasks[0].status = 'claimed'
    expect(run('2026-10-07').map((result) => result.outcome)).toEqual(['alreadyQueued'])
    expect(run('2026-10-07')).toEqual([])
    expect(tasks).toHaveLength(1)
    expect(tasks[0].scheduled).toBeUndefined()
    expect(inbox().map((entry) => entry.body)).toEqual([
      'Not queued: it is already queued or running · Site'
    ])
  })

  it('records a refusal with its reason, once', () => {
    const item = repeating({ targetDate: '2026-10-07' })
    planning.updateWorkItem(item.id, { status: 'active' }, human)
    expect(run('2026-10-07').map((result) => result.outcome)).toEqual(['refused'])
    expect(run('2026-10-07')).toEqual([])
    expect(planning.getWorkItem(item.id).scheduledQueue).toMatchObject({
      outcome: 'refused',
      note: expect.any(String)
    })
    expect(tasks).toHaveLength(0)
  })

  it('queues the next occurrence when its day comes, after the last was done', () => {
    const first = repeating({ startDate: '2026-10-07', targetDate: '2026-10-07' })
    expect(run('2026-10-07').map((result) => result.outcome)).toEqual(['queued'])
    tasks[0].status = 'complete'
    const next = planning.getWorkItem(
      planning.updateWorkItem(first.id, { status: 'done' }, human).repeatedAs!
    )
    expect(next.startDate).toBe('2026-10-14')
    expect(run('2026-10-13')).toEqual([])
    expect(run('2026-10-14')).toEqual([{ workItemId: next.id, projectId: 'p1', outcome: 'queued' }])
    expect(tasks).toHaveLength(2)
    expect(tasks[1]).toMatchObject({ scheduled: true, status: 'pending' })
  })

  describe('Queue it now, from the Inbox note', () => {
    it('is offered on a note that was not queued, never on one that was', () => {
      const queued = repeating({ targetDate: '2026-10-06' })
      run('2026-10-07')
      agentsOn = false
      const off = repeating({ targetDate: '2026-10-07' })
      run('2026-10-07')
      const notes = () => new Map(inbox().map((entry) => [entry.taskId, entry]))
      expect(notes().get(queued.id)?.queueNow).toBeUndefined()
      expect(notes().get(off.id)?.queueNow).toBe(true)
      agentsOn = true
      queueNow(off.id)
      expect(notes().get(off.id)).toMatchObject({
        title: 'Queued for agents: Update the dependencies'
      })
      expect(notes().get(off.id)?.queueNow).toBeUndefined()
    })

    it('queues it at the person’s click on the schedule’s path, and the note says so', () => {
      agentsOn = false
      const item = repeating({ targetDate: '2026-10-07' })
      run('2026-10-07')
      // Never queued later on its own, even once agents are on.
      agentsOn = true
      vi.setSystemTime(new Date(2026, 9, 8, 10, 0))
      expect(run('2026-10-08')).toEqual([])
      expect(tasks).toHaveLength(0)

      const queued = queueNow(item.id)
      expect(queued).toMatchObject({ status: 'ready', linkedHarnessTaskId: tasks[0].id })
      expect(queued.scheduledQueue).toMatchObject({ outcome: 'queued', at: Date.now() })
      expect(tasks).toHaveLength(1)
      expect(tasks[0]).toMatchObject({ status: 'pending', scheduled: true })
      // Moved to Ready by the person, not by the schedule.
      const moved = planning
        .listActivity('p1', item.id)
        .entries.filter((entry) => entry.kind === 'status')
      expect(moved.map((entry) => entry.actor.kind)).toEqual(['human'])
      expect(inbox()).toEqual([
        expect.objectContaining({
          title: 'Queued for agents: Update the dependencies',
          body: 'Weekly · Site',
          createdAt: Date.now()
        })
      ])
      // Once: it is not queued a second time, from the note or the next check.
      expect(() => queueNow(item.id)).toThrow(
        'Only a repeating task its schedule could not queue for agents can be queued from its Inbox note'
      )
      expect(run('2026-10-08')).toEqual([])
      expect(tasks).toHaveLength(1)
    })

    it('is refused with the usual plain reason while it still holds, and the note says it as it stands', () => {
      projectPath = null
      const item = repeating({ targetDate: '2026-10-07' })
      run('2026-10-07')
      const at = planning.getWorkItem(item.id).scheduledQueue!.at
      expect(() => queueNow(item.id)).toThrow('Not queued: the project has no linked folder')
      // The folder is linked, but agents are now off: the note says the new reason, in its place.
      projectPath = tempDir
      agentsOn = false
      vi.setSystemTime(new Date(2026, 9, 7, 12, 0))
      expect(() => queueNow(item.id)).toThrow('Not queued: agents are off')
      expect(planning.getWorkItem(item.id).scheduledQueue).toMatchObject({
        outcome: 'agentsOff',
        at
      })
      expect(inbox()).toEqual([
        expect.objectContaining({
          body: 'Not queued: agents are off · Site',
          createdAt: at,
          queueNow: true
        })
      ])
      expect(tasks).toHaveLength(0)
      expect(planning.getWorkItem(item.id)).toMatchObject({
        status: 'backlog',
        linkedHarnessTaskId: null
      })
    })

    it('says why the queue path refused it, as the schedule would', () => {
      const item = repeating({ targetDate: '2026-10-07' })
      planning.updateWorkItem(item.id, { status: 'active' }, human)
      run('2026-10-07')
      expect(() => queueNow(item.id)).toThrow(/^Not queued: Only Ready work can be queued/)
      expect(planning.getWorkItem(item.id).scheduledQueue?.outcome).toBe('refused')
      // Back in Ready, it queues.
      planning.updateWorkItem(item.id, { status: 'ready' }, human)
      expect(queueNow(item.id).scheduledQueue?.outcome).toBe('queued')
      expect(tasks).toHaveLength(1)
    })

    it('is refused for a task its schedule never acted on, and not offered once the task is done', () => {
      const later = repeating({ targetDate: '2026-10-20' })
      expect(() => queueNow(later.id)).toThrow(/can be queued from its Inbox note/)
      agentsOn = false
      const item = repeating({ targetDate: '2026-10-07' })
      run('2026-10-07')
      planning.updateWorkItem(item.id, { status: 'done' }, human)
      expect(inbox().find((entry) => entry.taskId === item.id)?.queueNow).toBeUndefined()
    })
  })
})
