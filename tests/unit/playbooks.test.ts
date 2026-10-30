import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import type { HarnessService } from '../../electron/services/harness-service'
import type { EffortSupportCheck } from '../../electron/services/agent-run-model'
import {
  checkTemplateBodyAgent,
  runPlaybook,
  validatePlaybookAgent
} from '../../electron/services/playbooks'
import { formatPlanningTaskDetails } from '../../electron/services/task-intake'
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  migrateOstlerDatabase
} from '../../electron/services/database/migrations'
import { parseTaskTemplateAgent, parseTaskTemplateBody } from '../../src/shared/task-templates'
import { DEFAULT_CONFIG } from '../../src/shared/ostler-api'
import type {
  HarnessTask,
  HarnessTaskPlaybook,
  OstlerConfig,
  WatchedProject
} from '../../src/shared/ostler-api'
import type { AgentRunChoice } from '../../src/shared/agent-model'
import { createMigratedDatabase } from '../helpers/database'

/** Playbooks (N9.6b, N64): task templates for agents, and Run playbook. */

const config: OstlerConfig = {
  ...DEFAULT_CONFIG,
  harness: { ...DEFAULT_CONFIG.harness, enabled: true },
  ai: { ...DEFAULT_CONFIG.ai, provider: 'anthropic', model: 'claude-sonnet-5-5', effort: '' }
}
// What the provider says a model takes, as the Settings Effort field asks it.
const effortSupport = vi.fn<EffortSupportCheck>(async (draft) => ({
  model: draft.model ?? '',
  levels: ['low', 'high'],
  source: 'listing'
}))

describe('migration 55', () => {
  let tempDir: string
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-playbook-migration-'))
  })
  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  it('marks every existing template an ordinary one, and takes only 0 or 1', async () => {
    const dbPath = path.join(tempDir, 'ostler.db')
    const options = { backupDir: path.join(tempDir, 'backups'), appVersion: 'test' }
    await migrateOstlerDatabase(
      dbPath,
      options,
      MIGRATIONS.filter((migration) => migration.version < 55)
    )
    const before = new Database(dbPath)
    before
      .prepare(
        `INSERT INTO planning_task_templates (id, project_id, name, body, created_at, updated_at)
         VALUES ('t1', NULL, 'Old', '{"title":"Old"}', 1, 1)`
      )
      .run()
    before.close()
    const result = await migrateOstlerDatabase(dbPath, options)
    expect(result.to).toBe(LATEST_SCHEMA_VERSION)
    const db = new Database(dbPath)
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(
      db.prepare("SELECT playbook FROM planning_task_templates WHERE id = 't1'").get()
    ).toEqual({ playbook: 0 })
    expect(() =>
      db.prepare("UPDATE planning_task_templates SET playbook = 2 WHERE id = 't1'").run()
    ).toThrow()
    db.close()
  })
})

describe('the agent part in the template validator', () => {
  it('leaves a template without one as it was', () => {
    expect(parseTaskTemplateBody({ title: 'Plain' })).not.toHaveProperty('agent')
  })

  it('fills in the agent part and checks its shape', () => {
    expect(parseTaskTemplateBody({ title: 'Deps', agent: {} }).agent).toEqual({
      model: '',
      effort: '',
      planFirst: 'default',
      instructions: ''
    })
    expect(
      parseTaskTemplateAgent({
        model: ' claude-haiku-5-5 ',
        effort: 'low',
        planFirst: 'yes',
        instructions: '  Run the tests.  '
      })
    ).toEqual({
      model: 'claude-haiku-5-5',
      effort: 'low',
      planFirst: 'yes',
      instructions: 'Run the tests.'
    })
    expect(() => parseTaskTemplateAgent({ instructions: 'x'.repeat(4001) })).toThrow(
      /longer than 4000 characters/
    )
    expect(parseTaskTemplateAgent({ instructions: 'x'.repeat(4000) }).instructions).toHaveLength(
      4000
    )
    expect(() => parseTaskTemplateAgent({ effort: 'turbo' })).toThrow(/effort levels/)
    expect(() => parseTaskTemplateAgent({ planFirst: 'maybe' })).toThrow(/Plan first/)
    expect(() => parseTaskTemplateAgent({ tools: ['shell'] })).toThrow(/can't hold "tools"/)
    expect(() => parseTaskTemplateAgent('plan first')).toThrow(/agent part/)
  })

  it('refuses a model the provider does not offer, and checks effort as Settings does', async () => {
    const project = { autoDispatch: undefined } as WatchedProject
    await expect(
      validatePlaybookAgent(config, project, { model: 'gpt-5' }, effortSupport)
    ).rejects.toThrow('"gpt-5" is not a model Settings offers for anthropic.')
    await expect(
      validatePlaybookAgent(
        config,
        null,
        { model: 'claude-haiku-5-5', effort: 'max' },
        effortSupport
      )
    ).rejects.toThrow('claude-haiku-5-5 does not take the effort "max".')
    await expect(
      validatePlaybookAgent(
        config,
        null,
        { model: 'claude-haiku-5-5', effort: 'low' },
        effortSupport
      )
    ).resolves.toMatchObject({ model: 'claude-haiku-5-5', effort: 'low' })
    await expect(
      checkTemplateBodyAgent(
        () => {
          throw new Error('an ordinary template never reads the settings')
        },
        null,
        { title: 'x' },
        effortSupport
      )
    ).resolves.toBeUndefined()
    await expect(
      checkTemplateBodyAgent(
        () => config,
        null,
        { title: 'x', agent: { model: 'gpt-5' } },
        effortSupport
      )
    ).rejects.toThrow(/not a model Settings offers/)
  })
})

describe('playbooks and Run playbook', () => {
  let tempDir: string
  let planning: PlanningService
  let tasks: (HarnessTask & { details: string })[]
  const human = { kind: 'human' } as const
  // The harness's queue as the queue path uses it: the real one is covered by
  // the automation API's integration test.
  const harness = {
    getState: () => ({ taskQueue: tasks }),
    addTask: (_project: WatchedProject, title: string, details: string, id: string) => {
      const task = { id, title, details, status: 'pending', claimedBy: null } as HarnessTask
      tasks.push(task)
      return task
    },
    setTaskPlanFirst: (_project: WatchedProject, taskId: string, on: boolean) => {
      const task = tasks.find((entry) => entry.id === taskId)!
      if (on) task.planFirst = true
      else delete task.planFirst
      return task
    },
    setTaskRunModel: (_project: WatchedProject, taskId: string, choice: AgentRunChoice) => {
      const task = tasks.find((entry) => entry.id === taskId)!
      task.model = choice.model
      task.effort = choice.effort
      return task
    },
    setTaskPlaybook: (_project: WatchedProject, taskId: string, playbook: HarnessTaskPlaybook) => {
      const task = tasks.find((entry) => entry.id === taskId)!
      task.playbook = playbook
      return task
    }
  }
  const project = (extra: Partial<WatchedProject> = {}) =>
    ({ id: 'p1', name: 'Site', path: tempDir, enabled: true, ...extra }) as WatchedProject
  const deps = (overrides: { config?: OstlerConfig } = {}) => ({
    config: overrides.config ?? config,
    planning,
    harness: harness as unknown as HarnessService,
    actor: planning.humanActor(),
    effortSupport
  })
  const agent = {
    model: 'claude-haiku-5-5',
    effort: 'low',
    planFirst: 'yes',
    instructions: 'Run `npm outdated` first, and keep major versions.'
  }
  const savePlaybook = (extra: Record<string, unknown> = {}) =>
    planning.taskTemplates.save({
      name: 'Update dependencies',
      projectId: null,
      body: { title: 'Update the dependencies', checklist: ['Tests pass'], agent, ...extra },
      playbook: true
    })

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-playbooks-'))
    planning = new PlanningService(await createMigratedDatabase(tempDir), () => ['p1'])
    tasks = []
  })
  afterEach(() => {
    planning.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('marks playbooks, and makes a template one or stops it being one', () => {
    const plain = planning.taskTemplates.save({
      name: 'Plain',
      projectId: 'p1',
      body: { title: 'x' }
    })
    expect(plain.playbook).toBe(false)
    const made = planning.taskTemplates.update(plain.id, { playbook: true })
    expect(planning.taskTemplates.get(made.id).playbook).toBe(true)
    const back = planning.taskTemplates.update(plain.id, { playbook: false })
    expect(back.playbook).toBe(false)
    expect(() => planning.taskTemplates.update(plain.id, { playbook: 'yes' as never })).toThrow(
      'playbook must be true or false.'
    )
    const deletion = planning.taskTemplates.delete(savePlaybook().id)
    expect(planning.taskTemplates.restore(deletion)).toMatchObject({ playbook: true })
  })

  it('saves a task as a playbook with its agent part', () => {
    const item = planning.createWorkItem('p1', { title: 'Bump deps' }, human)
    const saved = planning.taskTemplates.saveFromWorkItem(item.id, { scope: 'project', agent })
    expect(saved).toMatchObject({ playbook: true, body: { title: 'Bump deps', agent } })
    const template = planning.taskTemplates.saveFromWorkItem(item.id, {
      name: 'Just a template',
      scope: 'project'
    })
    expect(template.playbook).toBe(false)
    expect(template.body).not.toHaveProperty('agent')
  })

  it('makes the task and queues it in one step, with model, effort, plan first and instructions', async () => {
    const playbook = savePlaybook()
    const run = await runPlaybook(deps(), project(), playbook.id, {}, '2026-10-18')
    expect(run.workItem).toMatchObject({
      title: 'Update the dependencies',
      status: 'ready',
      planFirst: 'yes',
      acceptanceCriteria: ['Tests pass']
    })
    expect(run.workItem.linkedHarnessTaskId).toBe(run.task.id)
    expect(run.task).toMatchObject({
      model: 'claude-haiku-5-5',
      effort: 'low',
      planFirst: true,
      playbook: { templateId: playbook.id, name: 'Update dependencies' }
    })
    expect(tasks[0].details).toContain(
      'Playbook instructions:\nRun `npm outdated` first, and keep major versions.'
    )
    expect(run.modelNotOffered).toBeUndefined()
  })

  it('lets the person change the title and the agent part for this run', async () => {
    const playbook = savePlaybook()
    const run = await runPlaybook(deps(), project(), playbook.id, {
      title: 'Update the dependencies for November',
      model: '',
      effort: '',
      planFirst: 'no',
      instructions: ''
    })
    expect(run.workItem).toMatchObject({
      title: 'Update the dependencies for November',
      planFirst: 'no'
    })
    expect(run.task.model).toBeUndefined()
    expect(run.task.planFirst).toBeUndefined()
    expect(tasks[0].details).not.toContain('Playbook instructions')
    await expect(runPlaybook(deps(), project(), playbook.id, { model: 'gpt-5' })).rejects.toThrow(
      /not a model Settings offers/
    )
  })

  it("uses the project's default when the provider no longer offers the playbook's model", async () => {
    const playbook = savePlaybook({ agent: { ...agent, model: 'claude-old-1', effort: 'high' } })
    const run = await runPlaybook(deps(), project(), playbook.id)
    expect(run.modelNotOffered).toBe('claude-old-1')
    expect(run.task.model).toBeUndefined()
    expect(run.task.effort).toBeUndefined()
  })

  it('records "from playbook" in the task’s activity', async () => {
    const playbook = savePlaybook()
    const run = await runPlaybook(deps(), project(), playbook.id)
    const page = planning.listActivity('p1', run.workItem.id)
    const created = page.entries.find((entry) => entry.field === 'created')!
    expect(created.summary).toMatch(/created the task from playbook “Update dependencies”$/)
  })

  it('makes nothing when agents are off, there is no folder, or it is not a playbook', async () => {
    const playbook = savePlaybook()
    const off = { ...config, harness: { ...config.harness, enabled: false } }
    await expect(runPlaybook(deps({ config: off }), project(), playbook.id)).rejects.toThrow(
      'Agents are off.'
    )
    await expect(runPlaybook(deps(), project({ path: '' }), playbook.id)).rejects.toThrow()
    const plain = planning.taskTemplates.save({
      name: 'Plain',
      projectId: 'p1',
      body: { title: 'x' }
    })
    await expect(runPlaybook(deps(), project(), plain.id)).rejects.toThrow(
      'That task template is not a playbook.'
    )
    await expect(runPlaybook(deps(), project(), playbook.id, { tools: 'all' })).rejects.toThrow(
      /can't hold "tools"/
    )
    expect(planning.listWorkItems('p1')).toHaveLength(0)
    expect(tasks).toHaveLength(0)
  })

  it('puts instructions only in the task details, under their own heading', () => {
    const item = planning.createWorkItem('p1', { title: 'x', description: 'Body' }, human)
    expect(formatPlanningTaskDetails(item)).not.toContain('Playbook instructions')
    expect(formatPlanningTaskDetails(item, [], null, '  Keep it small.  ')).toContain(
      'Body\n\nPlaybook instructions:\nKeep it small.'
    )
  })
})
