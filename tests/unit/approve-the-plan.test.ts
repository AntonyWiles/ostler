import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import Database from 'better-sqlite3'
import simpleGit from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../electron/safe-storage', () => ({
  isEncryptionAvailable: () => true,
  isEncryptedSecret: (value: string) => value.startsWith('ostler-secure:v1:'),
  encryptApiKey: (key: string) => key,
  decryptApiKey: (value: string) => value,
  sealSecret: (token: string) => token,
  openSecret: (value: string) => value
}))

import { CONFIG_MIGRATIONS, ConfigStore } from '../../electron/config-store'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { PlanningService } from '../../electron/services/planning-service'
import { TaskPlansService } from '../../electron/services/task-plans-service'
import { queueWorkItemForHarness } from '../../electron/services/task-intake'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import { HomeService, plansWaiting } from '../../electron/services/home-service'
import { agentSources } from '../../electron/services/inbox-sources'
import { MIGRATIONS, migrateOstlerDatabase } from '../../electron/services/database/migrations'
import type { HarnessTask, WatchedProject } from '../../src/shared/ostler-api'
import {
  PLAN_FIRST_AVAILABLE,
  comparePlanFiles,
  projectAgentsPlanFirst,
  resolvePlanFirst
} from '../../src/shared/plan-first'
import { createMigratedDatabase } from '../helpers/database'
import { makeWatchedProject } from '../helpers/projects'

/** Approve the plan (N9.3b, N61): the switch, the plans kept with tasks, and where they wait. */

const PLAN = {
  steps: ['Read src/app.ts', 'Change the greeting'],
  files: ['src/app.ts', 'docs/greeting.md'],
  risks: 'A snapshot may change.'
}

describe('plan first is on', () => {
  it('ships available', () => {
    expect(PLAN_FIRST_AVAILABLE).toBe(true)
  })

  it("lets the task's own choice win over the project's default", () => {
    expect(resolvePlanFirst('default', true)).toBe(true)
    expect(resolvePlanFirst('default', false)).toBe(false)
    expect(resolvePlanFirst(undefined, true)).toBe(true)
    expect(resolvePlanFirst('yes', false)).toBe(true)
    expect(resolvePlanFirst('no', true)).toBe(false)
    expect(projectAgentsPlanFirst({})).toBe(false)
    expect(projectAgentsPlanFirst({ autoDispatch: { agentsPlanFirst: true } })).toBe(true)
  })

  it('compares the plan’s files with the files changed', () => {
    expect(
      comparePlanFiles(
        ['src/app.ts', 'docs\\greeting.md', 'src/old.ts'],
        ['src/app.ts', 'src/new.ts']
      )
    ).toEqual({
      changedNotPlanned: ['src/new.ts'],
      plannedNotChanged: ['docs/greeting.md', 'src/old.ts']
    })
    expect(comparePlanFiles(['a.ts'], ['./a.ts'])).toEqual({
      changedNotPlanned: [],
      plannedNotChanged: []
    })
  })
})

describe('migration 41 and config migration 30', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-plan-migration-'))
  })
  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  it('gives existing tasks "default" and adds task_plans, keeping their rows', async () => {
    const file = path.join(tempDir, 'ostler.db')
    const options = { backupDir: path.join(tempDir, 'backups'), appVersion: 'test' }
    await migrateOstlerDatabase(
      file,
      options,
      MIGRATIONS.filter((migration) => migration.version <= 40)
    )
    const before = new Database(file)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('t1', 'p1', 'Kept', 'ready', 'medium', 'human', 1, 1)"
      )
      .run()
    before.close()
    const result = await migrateOstlerDatabase(file, options, MIGRATIONS)
    expect(result.from).toBe(40)
    expect(result.to).toBeGreaterThanOrEqual(41)
    const db = new Database(file)
    try {
      expect(
        db.prepare("SELECT plan_first FROM planning_work_items WHERE id = 't1'").get()
      ).toEqual({ plan_first: 'default' })
      const columns = (db.prepare('PRAGMA table_info(task_plans)').all() as { name: string }[]).map(
        (column) => column.name
      )
      expect(columns).toEqual([
        'id',
        'project_id',
        'work_item_id',
        'session_id',
        'task_id',
        'version',
        'steps',
        'files',
        'risks',
        'status',
        'changes_note',
        'submitted_at',
        'decided_at',
        'changed_before_approval'
      ])
      expect(() =>
        db.prepare("UPDATE planning_work_items SET plan_first = 'maybe' WHERE id = 't1'").run()
      ).toThrow()
    } finally {
      db.close()
    }
  })

  it("turns every project's Agents plan first off, and keeps its other agent settings", () => {
    const configPath = path.join(tempDir, 'config.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        configVersion: 29,
        projects: [
          {
            id: 'a',
            name: 'A',
            path: null,
            color: '#fff',
            enabled: true,
            autoDispatch: { enabled: true, maxConcurrentEmbeddedSessions: 2 }
          },
          { id: 'b', name: 'B', path: null, color: '#fff', enabled: true }
        ]
      })
    )
    const store = new ConfigStore(configPath)
    expect(store.getProjectAutoDispatchConfig('a')).toMatchObject({
      enabled: true,
      maxConcurrentEmbeddedSessions: 2,
      agentsPlanFirst: false
    })
    expect(store.getProjectAutoDispatchConfig('b').agentsPlanFirst).toBe(false)
    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(onDisk.configVersion).toBeGreaterThanOrEqual(30)
    expect(onDisk.projects[0].autoDispatch.agentsPlanFirst).toBe(false)
    expect(
      store.updateProjectAutoDispatchConfig('b', { agentsPlanFirst: true }).agentsPlanFirst
    ).toBe(true)
    expect(store.getProjects().find((project) => project.id === 'b')!.autoDispatch).toMatchObject({
      agentsPlanFirst: true
    })
    const migration = CONFIG_MIGRATIONS.find((entry) => entry.version === 30)!
    const config: Record<string, unknown> = {
      projects: [{ id: 'c', autoDispatch: { agentsPlanFirst: true } }]
    }
    migration.up(config, { newInstall: false })
    expect(config.projects).toEqual([{ id: 'c', autoDispatch: { agentsPlanFirst: true } }])
  })
})

describe('queuing a task sets its plan first', () => {
  let tempDir: string
  let planning: PlanningService
  let tasks: HarnessTask[]
  const harness = {
    getState: () => ({ taskQueue: tasks }),
    addTask: (_project: WatchedProject, title: string, _details: string, id: string) => {
      const task = { id, title, status: 'pending', claimedBy: null } as unknown as HarnessTask
      tasks.push(task)
      return task
    },
    setTaskPlanFirst: (_project: WatchedProject, taskId: string, on: boolean) => {
      const task = tasks.find((entry) => entry.id === taskId)!
      if (on) task.planFirst = true
      else delete task.planFirst
      return task
    }
  }

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-plan-queue-'))
    planning = new PlanningService(await createMigratedDatabase(tempDir), () => ['p1'])
    tasks = []
  })
  afterEach(() => {
    planning.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const projectWith = (agentsPlanFirst: boolean | undefined) =>
    ({
      id: 'p1',
      name: 'P',
      path: tempDir,
      enabled: true,
      ...(agentsPlanFirst === undefined ? {} : { autoDispatch: { agentsPlanFirst } })
    }) as unknown as WatchedProject

  const queue = (planFirst: 'default' | 'yes' | 'no', agentsPlanFirst?: boolean) => {
    const item = planning.createWorkItem(
      'p1',
      { title: `Task ${planFirst}`, status: 'ready', planFirst },
      planning.humanActor(),
      'human'
    )
    expect(item.planFirst).toBe(planFirst)
    return queueWorkItemForHarness(
      planning,
      harness as unknown as HarnessService,
      projectWith(agentsPlanFirst),
      item.id
    ).task
  }

  it('follows the project by default', () => {
    expect(queue('default', true).planFirst).toBe(true)
    expect(queue('default', false).planFirst).toBeUndefined()
    expect(queue('default').planFirst).toBeUndefined()
  })

  it("lets the task's Yes or No win over the project", () => {
    expect(queue('yes', false).planFirst).toBe(true)
    expect(queue('no', true).planFirst).toBeUndefined()
  })

  it('saves the choice on the task, and refuses anything else', () => {
    const item = planning.createWorkItem('p1', { title: 'T' }, planning.humanActor(), 'human')
    expect(item.planFirst).toBe('default')
    expect(
      planning.updateWorkItem(item.id, { planFirst: 'yes' }, planning.humanActor()).planFirst
    ).toBe('yes')
    expect(planning.getWorkItem(item.id).planFirst).toBe('yes')
    expect(() =>
      planning.updateWorkItem(item.id, { planFirst: 'sometimes' as never }, planning.humanActor())
    ).toThrow(/planFirst/)
  })
})

describe('plans kept with tasks, and where they wait', { timeout: 30_000 }, () => {
  let tempDir: string
  let projectDir: string
  let dbPath: string
  let database: EventDatabase
  let planning: PlanningService
  let service: HarnessService
  let plans: TaskPlansService
  let project: WatchedProject
  let workItemId: string

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-plan-kept-'))
    projectDir = path.join(tempDir, 'project')
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'src', 'app.ts'), 'original\n')
    const git = simpleGit(projectDir)
    await git.init()
    await git.addConfig('user.email', 'test@example.com')
    await git.addConfig('user.name', 'Test')
    await git.addConfig('core.autocrlf', 'false')
    await git.raw(['checkout', '-B', 'main'])
    await git.add('.')
    await git.commit('initial commit')
    dbPath = await createMigratedDatabase(tempDir)
    database = new EventDatabase(dbPath)
    planning = new PlanningService(dbPath, () => ['project-1'])
    service = new HarnessService(path.join(tempDir, 'data'), database)
    plans = new TaskPlansService(planning.database)
    service.setPlanListener((source, plan) => plans.record(source, plan))
    project = makeWatchedProject({
      id: 'project-1',
      name: 'Test project',
      path: projectDir,
      color: '#fff',
      addedAt: Date.now()
    })
    workItemId = planning.createWorkItem(
      'project-1',
      { title: 'Change the greeting', status: 'ready' },
      planning.humanActor(),
      'human'
    ).id
  })

  afterEach(() => {
    service.stopAll()
    planning.close()
    database.close()
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  async function planFirstSession() {
    const task = service.addTask(
      project,
      'Change the greeting',
      'Say hello',
      undefined as never,
      'medium',
      workItemId
    )
    service.setTaskPlanFirst(project, task.id, true)
    const session = await service.startSessionForTask(project, task.id)
    return { task, session }
  }

  it('keeps every version and decision, and a second decision returns the first', async () => {
    const { task, session } = await planFirstSession()
    service.submitPlan(project, session.id, PLAN)
    service.submitPlan(project, session.id, PLAN)
    service.requestPlanChanges(project, session.id, 'Leave the docs alone')
    service.submitPlan(project, session.id, { ...PLAN, files: ['src/app.ts'] })
    const approved = await service.approvePlan(project, session.id)
    expect(approved).toMatchObject({ version: 2, status: 'approved' })

    const again = await service.approvePlan(project, session.id)
    expect(again).toEqual(approved)
    const sentBackLate = service.requestPlanChanges(project, session.id, 'Too late')
    expect(sentBackLate.status).toBe('approved')

    const kept = plans.listForWorkItem(workItemId)
    expect(kept.map((plan) => [plan.version, plan.status, plan.changesNote])).toEqual([
      [1, 'changes-requested', 'Leave the docs alone'],
      [2, 'approved', null]
    ])
    expect(kept[0]).toMatchObject({
      sessionId: session.id,
      taskId: task.id,
      steps: PLAN.steps,
      files: ['src/app.ts', 'docs/greeting.md'],
      risks: PLAN.risks
    })
    expect(kept[1].decidedAt).not.toBeNull()
    expect(plans.listForSession(session.id)).toHaveLength(2)
  })

  it('records the files changed before approval with the plan', async () => {
    const { session } = await planFirstSession()
    fs.writeFileSync(path.join(session.workspace!.worktreePath, 'src', 'app.ts'), 'early\n')
    service.submitPlan(project, session.id, PLAN)
    await service.approvePlan(project, session.id)
    expect(plans.listForSession(session.id)[0].changedBeforeApproval).toEqual(['src/app.ts'])
  })

  it('cancels a run waiting on its plan when it is stopped', async () => {
    const { session } = await planFirstSession()
    service.submitPlan(project, session.id, PLAN)
    const stopped = await service.stopRun(project, session.id)
    expect(stopped.plan?.status).toBe('cancelled')
    expect(plans.listForSession(session.id)[0].status).toBe('cancelled')
  })

  it('shows a waiting plan in Needs you and the Inbox, and clears it on a decision', async () => {
    const { session } = await planFirstSession()
    service.submitPlan(project, session.id, PLAN)
    const attention = () => {
      const state = service.getState(project)
      return {
        questions: [],
        reviews: [],
        plans: plansWaiting(state.activeSessions, () => workItemId)
      }
    }
    const home = new HomeService({
      db: planning.database,
      getProjects: () => [project],
      getMeId: () => null,
      agentsOn: () => true,
      agentAttention: attention
    })
    const inbox = agentSources(
      () => [project],
      () => true,
      attention
    ).plans

    expect(home.getNeedsYou()).toEqual([
      {
        key: `plan:project-1:${session.id}:1`,
        kind: 'plan',
        projectId: 'project-1',
        title: 'Change the greeting',
        taskId: workItemId,
        sessionId: session.id
      }
    ])
    expect(inbox()).toMatchObject([
      { key: `plan:project-1:${session.id}:1`, kind: 'plan', sessionId: session.id }
    ])

    service.requestPlanChanges(project, session.id, 'Smaller')
    expect(home.getNeedsYou()).toEqual([])
    expect(inbox()).toEqual([])

    // The next version is a new item, so it notifies again.
    service.submitPlan(project, session.id, { ...PLAN, steps: ['One step'] })
    expect(inbox()).toMatchObject([{ key: `plan:project-1:${session.id}:2` }])
    await service.approvePlan(project, session.id)
    expect(home.getNeedsYou()).toEqual([])
    expect(inbox()).toEqual([])
  })

  it('keeps plans while the task is in the bin, removes them with it, and with the project', async () => {
    const { session } = await planFirstSession()
    service.submitPlan(project, session.id, PLAN)
    planning.moveWorkItemToBin(workItemId, planning.humanActor(), 1)
    expect(plans.listForWorkItem(workItemId)).toHaveLength(1)

    // Emptying the bin (purge, 30 days on) removes the task, and its plans with it.
    planning.purgeRecycleBin('project-1', 31 * 24 * 60 * 60 * 1000 + 1)
    expect(planning.listWorkItems('project-1').some((item) => item.id === workItemId)).toBe(false)
    expect(plans.listForWorkItem(workItemId)).toEqual([])
    expect(plans.listForSession(session.id)).toEqual([])

    plans.record(
      { projectId: 'project-1', sessionId: 'other', taskId: null, workItemId: null },
      { ...service.getSessionPlan(project, session.id)!, version: 1 }
    )
    expect(plans.listForSession('other')).toHaveLength(1)
    const removed = deleteProjectRows(planning.database, 'project-1')
    expect(removed.map((entry) => entry.table)).toContain('task_plans')
    expect(plans.listForSession('other')).toEqual([])
  })
})
