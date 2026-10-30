import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OstlerConfig, Result, WatchedProject } from '../../src/shared/ostler-api'
import { makeWatchedProject } from '../helpers/projects'

/**
 * Every Ostler AI request passes one gate, `requireAi` (P7.1). This test
 * registers the real AI IPC handlers over the real AI services and calls every
 * channel that reaches a model while Ostler AI is not set up: each must refuse,
 * and no provider may be created. The channel lists are exhaustive: a new AI
 * channel fails the first test until it is listed here, so it cannot slip past
 * the gate.
 */

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
const providerCreated = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: async () => undefined },
  session: {}
}))

vi.mock('../../electron/services/ai-provider', async (importActual) => ({
  ...(await importActual<typeof import('../../electron/services/ai-provider')>()),
  createProvider: (...args: unknown[]) => {
    providerCreated(...args)
    throw new Error('A provider was created while AI was not set up')
  }
}))

const { IPC_CHANNELS, DEFAULT_CONFIG } = await import('../../src/shared/ostler-api')
const { aiNotSetUp } = await import('../../electron/services/ai-access')
const { registerAiHandlers } = await import('../../electron/ipc/ai-handlers')
const { registerPlanningHandlers } = await import('../../electron/ipc/planning-handlers')
const { registerPlanningWorkflowHandlers } =
  await import('../../electron/ipc/planning-workflow-handlers')
const { AIPlanningService } = await import('../../electron/services/ai-planning-service')
const { TaskReviewService } = await import('../../electron/services/task-review-service')
const { TaskSplitJobService } = await import('../../electron/services/task-split-job-service')
const { ProjectAiSettingsService } = await import('../../electron/services/project-ai-settings')
const { registerWritingHelpHandlers } = await import('../../electron/ipc/writing-help-handlers')
const { registerTriageHandlers } = await import('../../electron/ipc/triage-handlers')

type ChannelKey = keyof typeof IPC_CHANNELS
const P = 'project-1'
const GOAL = '10000000-0000-4000-8000-000000000001'
const ITEM = '20000000-0000-4000-8000-000000000001'
const MILESTONE = '30000000-0000-4000-8000-000000000001'

/** Every channel that sends anything to a model, with arguments for project `P`. */
const GATED: Partial<Record<ChannelKey, unknown[]>> = {
  SEND_MESSAGE: ['conversation-1', 'hello', P],
  BREAK_DOWN_PLANNING_GOAL: [P, GOAL],
  IMPROVE_PLANNING_WORK_ITEM: [P, ITEM],
  REVIEW_AI_MILESTONE: [P, MILESTONE],
  GENERATE_AI_NEXT_TASKS: [P],
  GENERATE_AI_PROJECT_BRIEF: [P],
  REGENERATE_AI_PROJECT_BRIEF_ACTION: [P, 'action-1', 'Shorter, please'],
  PROPOSE_AI_GOAL_FROM_LIBRARY: [P, ['library-1']],
  GENERATE_AI_MASTER_PLAN: [P, GOAL],
  START_AI_TASK_SPLIT: [P, GOAL, 'master-plan-1'],
  REVIEW_TASK_STATUS: [P, [ITEM]],
  TASK_REVIEW_REFRESH: [P, ITEM],
  TASK_REVIEW_RESOLVE: ['review-1', ITEM, false],
  IMPROVE_WRITING: [
    P,
    { target: { kind: 'task', workItemId: ITEM }, style: 'clearer', text: 'Hi' }
  ],
  SUMMARISE_COMMENTS: [P, ITEM],
  POLISH_RELEASE_NOTES: [
    P,
    {
      source: { kind: 'milestone', id: MILESTONE },
      options: { groupBy: 'none', descriptions: false, subtasks: false }
    }
  ],
  SUGGEST_AI_TRIAGE: [P, ITEM],
  SUGGEST_AI_FIELD_VALUE: [P, ITEM, 'field-1']
}

/** AI-named channels that send nothing about a project to a model, and why. */
const NOT_GATED: Partial<Record<ChannelKey, string>> = {
  TEST_AI_CONNECTION: 'tests the settings with "hello"; reads no project',
  LIST_AI_MODELS: 'lists models; reads no project',
  GET_AI_MODEL_EFFORT_SUPPORT:
    'asks the provider which effort levels a model takes; reads no project',
  FIND_LOCAL_AI: 'asks a local address which models it has; reads no project',
  CREATE_CONVERSATION: 'stores an empty conversation; no model call',
  OPEN_AI_PROVIDER_PAGE: "opens a provider's web page",
  GET_PROJECT_AI_SETTINGS: 'reads the setting itself',
  UPDATE_PROJECT_AI_SETTINGS: 'changes the setting itself',
  EMERGENCY_STOP_AI: 'stops requests',
  RESUME_AI: 'lifts the stop',
  GET_AI_HALT_STATE: 'reads the stop',
  CLEAR_AI_API_KEY: 'removes the key',
  GET_CONVERSATIONS: 'stored conversations; no model call',
  GET_CONVERSATION: 'a stored conversation; no model call',
  DELETE_CONVERSATION: 'deletes a stored conversation',
  ON_AI_STREAM_CHUNK: 'an event, not a call',
  GET_AI_MILESTONE_ADVISORY: 'a stored draft; no model call',
  GET_AI_PROJECT_BRIEF: 'a stored draft; no model call',
  GET_AI_TASK_SPLIT_JOB: 'a stored job; no model call',
  GET_AI_TASK_SPLIT_DRAFT: 'a stored draft; no model call',
  RETRY_AI_TASK_SPLIT_PHASE:
    'needs a job START_AI_TASK_SPLIT made through the gate, and retryPhase passes the gate again',
  CANCEL_AI_TASK_SPLIT: 'stops a split',
  ON_TASK_SPLIT_PROGRESS: 'an event, not a call',
  APPROVE_AI_PLANNING_DRAFT: 'turns an approved draft into tasks; no model call',
  APPROVE_AI_NEXT_TASKS: 'turns an approved draft into tasks; no model call',
  APPROVE_AI_MASTER_PLAN: 'stores the human edits; no model call',
  APPROVE_AI_DECISION: 'creates a decision; no model call',
  DRAFT_AI_DECISION: 'has no handler in main',
  REVIEW_AI_PROJECT_BRIEF_ACTION: 'stores a review; no model call',
  RECORD_AI_PROJECT_BRIEF_ACTION_CREATION: 'records a link; no model call',
  UNDO_AI_PROJECT_BRIEF_ACTION_CREATION: 'removes a link; no model call',
  TASK_REVIEW_GET: 'stored reviews; no model call',
  TASK_REVIEW_ANNOTATE: 'stores a comment; no model call',
  TASK_REVIEW_ACCEPT: 'creates a task from a stored review; no model call',
  TASK_REVIEW_DISMISS: 'dismisses a stored review',
  LIBRARY_GET_AI_CONTEXT_SUMMARY: 'says what the Library would send; no model call',
  ACCEPT_TASK_STATUS_REVIEW: 'applies a stored review; no model call',
  APPLY_AI_FIELD_FILLS: "saves the person's chosen suggestions; no model call",
  RESTORE_AI_FIELD_FILLS: 'undoes a fill; no model call'
}

/** Names that mark a channel as AI's: every match must be classified above. */
const AI_CHANNEL_NAME =
  /(?:^|_)AI(?:_|$)|BREAK_DOWN|IMPROVE|TASK_REVIEW|REVIEW_TASK_STATUS|CONVERSATION|SEND_MESSAGE|MASTER_PLAN|TASK_SPLIT/

const project: WatchedProject = makeWatchedProject({ id: P, name: 'Project', aiProfile: 'auto' })

function configured(): OstlerConfig {
  const config = structuredClone(DEFAULT_CONFIG)
  config.ai.provider = 'openai'
  // No key: Ostler AI is not set up.
  config.ai.apiKey = ''
  config.ai.model = 'test-model'
  config.projects = [structuredClone(project)]
  return config
}

/** Answers every read with something plausible, so a handler reaches its AI call. */
function stub(values: Record<string, unknown>): never {
  return new Proxy(values, {
    get: (target, key: string) => (key in target ? target[key] : () => [])
  }) as never
}

describe('the AI gate', () => {
  let dataDir: string
  let config: OstlerConfig

  beforeEach(() => {
    handlers.clear()
    providerCreated.mockReset()
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-ai-gate-'))
    config = configured()
    const getConfig = () => config
    const getProject = (id: string) => {
      const found = config.projects.find((candidate) => candidate.id === id)
      if (!found) throw new Error('Project not found')
      return found
    }
    const workItem = { id: ITEM, projectId: P, title: 'Task', linkedHarnessTaskId: null }
    const planningService = stub({
      getGoal: () => ({ id: GOAL, projectId: P, title: 'Goal', outcome: '' }),
      getWorkItem: () => workItem,
      listComments: () => [],
      listMilestones: () => [
        {
          id: MILESTONE,
          projectId: P,
          name: 'M',
          outcome: '',
          status: 'active',
          targetDate: null,
          successCriteria: [],
          goalId: null
        }
      ]
    })
    const harnessService = stub({
      getState: () => ({
        activeSessions: [],
        reviewSessions: [],
        taskQueue: [],
        questions: []
      })
    })
    const database = stub({
      getConversation: () => ({ id: 'conversation-1', projectId: P, messages: [] }),
      getEventStats: () => ({})
    })
    const aiPlanningService = new AIPlanningService(dataDir, getConfig)
    const taskReviewService = new TaskReviewService(
      dataDir,
      database,
      planningService,
      harnessService,
      getConfig,
      () => undefined
    )
    const projectAiSettings = new ProjectAiSettingsService({
      getProject,
      updateProject: () => project,
      isGitRepo: async () => false
    })
    const common = {
      getProject,
      notifyHarnessState: () => undefined,
      recordWorkItemSources: () => undefined,
      recordWorkItemAttachments: () => undefined
    }
    registerAiHandlers({
      dataDir,
      configStore: { get: getConfig, getProjects: () => config.projects } as never,
      database,
      planningService,
      libraryService: stub({}),
      taskReviewService,
      openCodeRunnerService: stub({}),
      getMainWindow: () => null,
      getProject,
      queueWorkItemForHarness: () => {
        throw new Error('not used')
      },
      notifyHarnessState: () => undefined,
      projectAiSettings,
      stopAllAi: async () => ({ halted: true })
    })
    registerPlanningHandlers({
      ...common,
      configStore: { get: getConfig } as never,
      database,
      aiPlanningService,
      gitReader: stub({}),
      harnessService,
      planningService,
      queueWorkItemForHarness: () => {
        throw new Error('not used')
      },
      notifyPlanningChanged: () => undefined
    })
    registerPlanningWorkflowHandlers({
      ...common,
      aiPlanningService,
      taskSplitJobService: new TaskSplitJobService({
        aiPlanningService,
        emitProgress: () => undefined
      } as never),
      harnessService,
      planningService,
      formatPlanningTaskDetails: () => ''
    })
    registerWritingHelpHandlers({
      aiPlanningService,
      planningService,
      peopleService: stub({}),
      getProject,
      notifyPlanningChanged: () => undefined
    })
    registerTriageHandlers({
      planningService,
      libraryService: null,
      aiPlanningService,
      getProject,
      notifyHarnessState: () => undefined
    })
  })

  afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }))

  it('classifies every AI channel as gated or not', () => {
    const unclassified = (Object.keys(IPC_CHANNELS) as ChannelKey[]).filter(
      (key) => AI_CHANNEL_NAME.test(key) && !(key in GATED) && !(key in NOT_GATED)
    )
    expect(unclassified).toEqual([])
    for (const key of Object.keys(GATED) as ChannelKey[]) {
      expect(handlers.has(IPC_CHANNELS[key]), `${key} has a handler`).toBe(true)
    }
  })

  it.each(Object.entries(GATED))('%s refuses while AI is not set up', async (key, args) => {
    const handler = handlers.get(IPC_CHANNELS[key as ChannelKey])!
    const result = (await handler({}, ...(args as unknown[]))) as Result<unknown>
    expect(result).toEqual({ ok: false, error: aiNotSetUp() })
    expect(providerCreated).not.toHaveBeenCalled()
  })

  it('lets the same calls through once AI is set up', async () => {
    config.ai.apiKey = 'key'
    const handler = handlers.get(IPC_CHANNELS.BREAK_DOWN_PLANNING_GOAL)!
    const result = (await handler({}, P, GOAL)) as Result<unknown>
    expect(result.ok).toBe(false)
    expect(providerCreated).toHaveBeenCalledTimes(1)
  })

  it('gives the automation API no route that reaches a model', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../electron/services/automation-http-server.ts'),
      'utf8'
    )
    expect(source).not.toMatch(/ai-planning-service|ai-service|ai-access|task-review-service/)
  })
})
