import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CONFIG,
  LIBRARY_PLANNING_CONTEXT_BUDGET_CHARS,
  type OstlerConfig,
  type PlanningGoal,
  type PlanningWorkItem
} from '../../src/shared/ostler-api'

const chat = vi.fn()
const directories: string[] = []

vi.mock('../../electron/services/ai-provider', async (importActual) => ({
  ...(await importActual<typeof import('../../electron/services/ai-provider')>()),
  createProvider: () => ({ chat })
}))

import { AIPlanningService } from '../../electron/services/ai-planning-service'
import { makeWatchedProject } from '../helpers/projects'

const goal: PlanningGoal = {
  id: '10000000-0000-4000-8000-000000000001',
  projectId: 'project-one',
  title: 'Ship planning',
  outcome: 'Teams can turn goals into reviewed work.',
  status: 'active',
  createdAt: 0,
  updatedAt: 0
}

const existingItem: PlanningWorkItem = {
  id: '20000000-0000-4000-8000-000000000001',
  projectId: 'project-one',
  milestoneId: null,
  title: 'Existing work',
  description: 'Do not duplicate this.',
  status: 'backlog',
  priority: 'medium',
  labels: [],
  acceptanceCriteria: [],
  dependencyIds: [],
  targetDate: null,
  startDate: null,
  assigneeId: null,
  estimate: null,
  checkedCriteria: [],
  origin: 'human',
  linkedHarnessTaskId: null,
  autoQueue: false,
  parentWorkItemId: null,
  taskCode: '',
  phaseCode: '',
  phaseName: '',
  subtaskPhaseNumber: null,
  subtaskPhaseName: '',
  verificationStatus: 'unverified',
  verifiedBy: null,
  verifiedAt: null,
  verificationNotes: '',
  createdAt: 0,
  updatedAt: 0
}

function withProject(config: OstlerConfig): OstlerConfig {
  config.projects = [
    makeWatchedProject({ id: 'project-one', name: 'Project One', aiProfile: 'auto' })
  ]
  return config
}

function configured(): OstlerConfig {
  const config = withProject(structuredClone(DEFAULT_CONFIG))
  config.ai.provider = 'openai'
  config.ai.apiKey = 'encrypted-key-loaded-in-memory'
  config.ai.model = 'test-model'
  return config
}

function response(value: string): AsyncGenerator<string> {
  return (async function* () {
    yield value.slice(0, Math.floor(value.length / 2))
    yield value.slice(Math.floor(value.length / 2))
  })()
}

function createService(
  config: () => OstlerConfig = configured,
  profile: 'software' | 'general' = 'software',
  folder: string | null = null
): AIPlanningService {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-ai-planning-'))
  directories.push(directory)
  return new AIPlanningService(
    directory,
    config,
    () => null,
    () => (folder ? { root: folder, ignorePatterns: [] } : null),
    async () => profile
  )
}

beforeEach(() => chat.mockReset())

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('AIPlanningService', () => {
  it('generates exactly five next tasks from bounded database evidence and persists the draft', async () => {
    const suggestions = Array.from({ length: 5 }, (_, index) => ({
      title: `Next task ${index + 1}`,
      description: `Deliver independently scoped change ${index + 1}.`,
      priority: index === 0 ? 'high' : 'medium',
      acceptanceCriteria: [`Outcome ${index + 1} is observable.`],
      rationale: `Database evidence supports task ${index + 1}.`,
      evidence: [`Planning work item: Existing work (${index + 1})`]
    }))
    chat.mockReturnValue(
      response(
        `Here is the requested draft:\n\n\`\`\`json\n${JSON.stringify({
          summary: 'Five evidence-based next steps.',
          assumptions: ['Stored planning state is current.'],
          warnings: ['No project files were inspected.'],
          suggestions
        })}\n\`\`\``
      )
    )
    const service = createService()
    const evidenceSummary = {
      goals: 1,
      milestones: 2,
      workItems: 7,
      watchEvents: 12,
      gitCommits: 3,
      harnessEvents: 4,
      windowDays: 14
    }

    const draft = await service.generateNextTasks(
      'project-one',
      'Project One',
      {
        planningWorkItems: [{ title: 'Existing work', status: 'backlog' }],
        recentWatchEvents: [{ relativePath: 'src/renderer/App.tsx', type: 'change' }]
      },
      evidenceSummary
    )

    expect(draft).toMatchObject({
      schemaVersion: 1,
      promptVersion: 3,
      projectId: 'project-one',
      provider: 'openai',
      model: 'test-model',
      summary: 'Five evidence-based next steps.',
      evidenceSummary
    })
    expect(draft.draftId).toMatch(/^[a-f0-9-]{36}$/)
    expect(draft.suggestions).toHaveLength(5)
    expect(service.getNextTasksDraft('project-one', draft.draftId)).toEqual(draft)
    expect(JSON.stringify(chat.mock.calls[0])).toContain('src/renderer/App.tsx')
    expect(JSON.stringify(chat.mock.calls[0])).toContain('exactly five')
    expect(
      fs.existsSync(
        path.join(directories[0], 'ai', 'next-task-drafts', 'project-one', `${draft.draftId}.json`)
      )
    ).toBe(true)
  })

  it('rejects a next-task response that does not contain exactly five valid suggestions', async () => {
    chat.mockReturnValue(
      response(
        JSON.stringify({
          summary: 'Too few tasks.',
          assumptions: [],
          warnings: [],
          suggestions: Array.from({ length: 5 }, (_, index) => ({
            title: `Candidate ${index + 1}`,
            description: 'This candidate must cite evidence and define completion.',
            priority: 'medium',
            acceptanceCriteria: ['The outcome is observable.'],
            rationale: 'A rationale.',
            evidence: index === 4 ? [] : ['An Ostler database record.']
          }))
        })
      )
    )
    const service = createService()

    await expect(
      service.generateNextTasks(
        'project-one',
        'Project One',
        {},
        {
          goals: 0,
          milestones: 0,
          workItems: 0,
          watchEvents: 0,
          gitCommits: 0,
          harnessEvents: 0,
          windowDays: 14
        }
      )
    ).rejects.toThrow("The model's answer couldn't be used")
  })

  it('validates and stores a bounded structured draft without changing planning state', async () => {
    chat.mockReturnValue(
      response(
        JSON.stringify({
          summary: 'Two useful slices.',
          assumptions: ['The goal outcome is current.'],
          warnings: ['No repository files were inspected.'],
          suggestions: [
            {
              title: 'Build review dialog',
              description: 'Let a person inspect proposed work.',
              priority: 'high',
              acceptanceCriteria: ['Nothing is saved before approval.'],
              rationale: 'Human control is required.',
              evidence: ['Goal: Ship planning']
            },
            {
              title: 'Add tests',
              description: 'Cover parsing and validation.',
              priority: 'unexpected',
              acceptanceCriteria: ['Invalid JSON is rejected.'],
              rationale: 'Keep the boundary durable.',
              evidence: ['Existing work: Existing work']
            }
          ]
        })
      )
    )
    const service = createService()

    const draft = await service.breakDownGoal('project-one', 'Project One', goal, [existingItem])

    expect(draft).toMatchObject({
      schemaVersion: 1,
      promptVersion: 3,
      projectId: 'project-one',
      goalId: goal.id,
      provider: 'openai',
      model: 'test-model',
      summary: 'Two useful slices.',
      assumptions: ['The goal outcome is current.'],
      warnings: ['No repository files were inspected.']
    })
    expect(draft.suggestions).toHaveLength(2)
    expect(draft.suggestions[0].priority).toBe('high')
    expect(draft.suggestions[1].priority).toBe('medium')
    expect(draft.suggestions[0].evidence).toEqual(['Goal: Ship planning'])
    expect(service.getDraft('project-one', goal.id)).toEqual(draft)
    expect(chat).toHaveBeenCalledOnce()
    expect(JSON.stringify(chat.mock.calls[0])).toContain('Existing work')
    expect(
      fs.existsSync(
        path.join(directories[0], 'ai', 'planning-drafts', 'project-one', `${goal.id}.json`)
      )
    ).toBe(true)
  })

  it('rejects malformed provider output', async () => {
    chat.mockReturnValue(response('This is not JSON.'))
    const service = createService()
    await expect(service.breakDownGoal('project-one', 'Project One', goal, [])).rejects.toThrow(
      "The model's answer couldn't be used; try again or pick a stronger model."
    )
  })

  it('requires an API key before contacting a provider', async () => {
    const service = createService(() => withProject(structuredClone(DEFAULT_CONFIG)))
    await expect(service.breakDownGoal('project-one', 'Project One', goal, [])).rejects.toThrow(
      "isn't set up"
    )
    expect(chat).not.toHaveBeenCalled()
  })

  it('validates and stores an evidence-bounded project brief', async () => {
    chat.mockReturnValue(
      response(
        JSON.stringify({
          health: 'at-risk',
          headline: 'Review pressure is rising',
          summary: 'One workspace needs a human decision.',
          nextActions: [
            {
              title: 'Review the completed workspace',
              rationale: 'It is holding execution capacity.',
              evidence: ['One workspace is awaiting review.']
            }
          ],
          risks: ['New work may wait for capacity.'],
          assumptions: ['Workspace limits are unchanged.'],
          warnings: ['No project files were inspected.']
        })
      )
    )
    const service = createService()

    const brief = await service.generateProjectBrief('project-one', 'Project One', {
      execution: { workspacesAwaitingReview: 1 }
    })

    expect(brief).toMatchObject({
      health: 'at-risk',
      headline: 'Review pressure is rising',
      provider: 'openai',
      model: 'test-model'
    })
    expect(brief.nextActions[0].evidence).toEqual(['One workspace is awaiting review.'])
    const reviewed = service.updateProjectBriefActionReview(
      'project-one',
      brief.nextActions[0].id,
      'approved',
      ''
    )
    const created = service.recordProjectBriefActionCreation(
      'project-one',
      brief.nextActions[0].id,
      'milestone',
      'milestone-one'
    )
    expect(created.nextActions[0].creation).toMatchObject({
      type: 'milestone',
      recordId: 'milestone-one'
    })
    expect(service.getProjectBrief('project-one')).toEqual(created)
    expect(
      service.clearProjectBriefActionCreation('project-one', brief.nextActions[0].id).nextActions[0]
        .creation
    ).toBeNull()
    expect(reviewed.nextActions[0].reviewStatus).toBe('approved')
    expect(
      fs.existsSync(path.join(directories[0], 'ai', 'project-briefs', 'project-one', 'latest.json'))
    ).toBe(true)
  })

  it('returns a reviewable work-item improvement without saving planning changes', async () => {
    chat.mockReturnValue(
      response(
        JSON.stringify({
          title: 'Define the interactive planning behavior',
          description: 'Implement direct manipulation with a retained keyboard fallback.',
          priority: 'high',
          acceptanceCriteria: ['A card can move between columns.', 'The move survives reload.'],
          rationale: 'The original scope was not observable.',
          assumptions: ['The board remains the workflow editor.'],
          warnings: ['No source files were inspected.']
        })
      )
    )
    const service = createService()

    const draft = await service.improveWorkItem('project-one', 'Project One', existingItem, [
      existingItem
    ])

    expect(draft).toMatchObject({
      workItemId: existingItem.id,
      priority: 'high',
      title: 'Define the interactive planning behavior'
    })
    expect(draft.acceptanceCriteria).toHaveLength(2)
    expect(
      fs.existsSync(
        path.join(
          directories[0],
          'ai',
          'work-item-drafts',
          'project-one',
          `${existingItem.id}.json`
        )
      )
    ).toBe(true)
  })

  it('drafts a decision record persisted under ai/decision-drafts without writing planning records', async () => {
    chat.mockReturnValue(
      response(
        JSON.stringify({
          title: 'Use SQLite WAL mode for concurrency',
          context: 'UI threads need fast reads while background workers record events.',
          decision: 'Configure WAL mode and busy timeout on database connection.',
          alternativesConsidered: 'Multi-file JSON, LevelDB, Postgres over TCP',
          consequences: 'Improves read latency, introduces WAL checkpoint requirements.',
          date: '2026-08-25',
          linkedWorkItemIds: [existingItem.id],
          rationale:
            'WAL mode provides single-writer multi-reader concurrency with zero external setup.',
          evidence: ['Event database operates concurrently with file watcher.'],
          assumptions: ['Local filesystem supports POSIX locks.'],
          warnings: ['Checkpoints must be executed cleanly before backup.']
        })
      )
    )
    const service = createService()

    const draft = await service.draftDecision(
      'project-one',
      'Project One',
      { targetWorkItem: existingItem },
      [existingItem.id]
    )

    expect(draft).toMatchObject({
      projectId: 'project-one',
      title: 'Use SQLite WAL mode for concurrency',
      context: 'UI threads need fast reads while background workers record events.',
      decision: 'Configure WAL mode and busy timeout on database connection.',
      alternativesConsidered: 'Multi-file JSON, LevelDB, Postgres over TCP',
      consequences: 'Improves read latency, introduces WAL checkpoint requirements.',
      date: '2026-08-25',
      linkedWorkItemIds: [existingItem.id],
      provider: 'openai',
      model: 'test-model'
    })
    expect(draft.draftId).toMatch(/^[a-f0-9-]{36}$/)
    expect(
      fs.existsSync(
        path.join(directories[0], 'ai', 'decision-drafts', 'project-one', `${draft.draftId}.json`)
      )
    ).toBe(true)

    const loaded = service.getDecisionDraft('project-one', draft.draftId)
    expect(loaded).toEqual(draft)
  })

  it('links a drafted decision only to tasks the model was shown', async () => {
    // A goal's id, an invented id and a duplicate: none can be ticked in the
    // review, and saving with any of them failed with "Linked planning work
    // item not found" (found by the GUI monkey).
    chat.mockReturnValue(
      response(
        JSON.stringify({
          title: 'Use WinForms',
          decision: 'Build the window with WinForms.',
          linkedWorkItemIds: [goal.id, existingItem.id, 'made-up-id', existingItem.id]
        })
      )
    )
    const service = createService()

    const draft = await service.draftDecision(
      'project-one',
      'Project One',
      { planningSummary: { goals: [goal], recentWorkItems: [existingItem] } },
      [existingItem.id]
    )

    expect(draft.linkedWorkItemIds).toEqual([existingItem.id])
  })

  it('rejects invalid or malformed AI decision drafts', async () => {
    chat.mockReturnValue(response('Not JSON at all'))
    const service = createService()

    await expect(service.draftDecision('project-one', 'Project One', {})).rejects.toThrow(
      "The model's answer couldn't be used"
    )
  })

  it('reads the project folder: the file list, and the files a goal names', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-ai-planning-folder-'))
    directories.push(folder)
    fs.mkdirSync(path.join(folder, 'marketing', 'roles'), { recursive: true })
    fs.writeFileSync(path.join(folder, 'README.md'), 'A shop for kites.')
    fs.writeFileSync(path.join(folder, 'marketing', 'roles', 'writer.md'), 'Writes the blog.')
    chat.mockReturnValue(
      response(JSON.stringify({ summary: 'Plan', assumptions: [], warnings: [], suggestions: [] }))
    )
    const service = createService(configured, 'software', folder)
    await service
      .breakDownGoal(
        'project-one',
        'Project One',
        { ...goal, outcome: 'Make tasks from marketing/roles/' },
        []
      )
      .catch(() => undefined)
    const prompt = JSON.stringify(chat.mock.calls[0][0])
    expect(prompt).toContain('README.md')
    expect(prompt).toContain('Writes the blog.')
    expect(prompt).not.toContain('A shop for kites.')
  })

  it('writes tasks for a person when the project is not software', async () => {
    chat.mockReturnValue(
      response(
        JSON.stringify({
          summary: 'Plan the party',
          assumptions: [],
          warnings: [],
          suggestions: [
            {
              title: 'Book the hall',
              description: 'The hall is booked. Call the hall first.',
              priority: 'high',
              acceptanceCriteria: ['Booking confirmed'],
              rationale: 'Needed first',
              evidence: ['goal']
            }
          ]
        })
      )
    )
    const service = createService(configured, 'general')
    const draft = await service.breakDownGoal('project-one', 'Project One', goal, [])
    const prompt = chat.mock.calls[0][0][1].content as string
    expect(prompt).toContain('The person doing this task sees the task text and its attachments')
    expect(prompt).not.toMatch(/coding agent|repositor/i)
    expect(draft.promptVersion).toBe(3)
  })

  it('keeps plan and split to software projects', async () => {
    const service = createService(configured, 'general')
    await expect(service.draftMasterPlan('project-one', 'Project One', goal, [])).rejects.toThrow(
      'for software projects'
    )
    expect(chat).not.toHaveBeenCalled()
  })

  it('drafts a master plan and assigns single-letter phase codes in order', async () => {
    chat.mockReturnValue(
      response(
        JSON.stringify({
          summary: 'Ship the guided workflow.',
          auditFindings: ['No existing work covers this.'],
          nonNegotiableRules: ['Never touch production data.'],
          phases: [
            { name: 'Foundation', objective: 'Lay the schema groundwork.' },
            { name: 'Wizard UI', objective: 'Build the review flow.' }
          ],
          assumptions: [],
          warnings: []
        })
      )
    )
    const service = createService()
    const draft = await service.draftMasterPlan('project-one', 'Project One', goal, [existingItem])

    expect(draft.phases).toEqual([
      { code: 'A', name: 'Foundation', objective: 'Lay the schema groundwork.' },
      { code: 'B', name: 'Wizard UI', objective: 'Build the review flow.' }
    ])
    expect(service.getMasterPlanDraft('project-one', draft.draftId)).toEqual(draft)
  })

  it('splits an approved master plan into a coded task tree capped at depth three', async () => {
    chat.mockReturnValue(
      response(
        JSON.stringify({
          phases: [
            {
              code: 'A',
              name: 'Foundation',
              tasks: [
                {
                  title: 'Top task',
                  task: 'Do the top-level work.',
                  priority: 'high',
                  reliesOn: [],
                  subtasks: [
                    {
                      title: 'Nested task',
                      task: 'Do the nested work.',
                      subtasks: [
                        {
                          title: 'Deepest task',
                          task: 'Should be dropped past depth three.',
                          subtasks: [{ title: 'Too deep', task: 'Never reached.' }]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        })
      )
    )
    const service = createService()
    const phase = await service.draftPhaseSplit(
      'project-one',
      'Project One',
      goal.id,
      '20000000-0000-4000-8000-000000000002',
      'Ship the guided workflow.',
      ['Never touch production data.'],
      { code: 'A', name: 'Foundation', objective: 'Lay the schema groundwork.' },
      [],
      8
    )

    const draft = service.finishTaskSplit(
      'project-one',
      goal.id,
      '20000000-0000-4000-8000-000000000002',
      [phase]
    )
    expect(draft.phases).toHaveLength(1)
    expect(service.getTaskSplitDraft('project-one', draft.draftId)).toEqual(draft)
    const [top] = draft.phases[0].tasks
    expect(top.code).toBe('A1')
    expect(top.depth).toBe(1)
    expect(top.subtasks[0].code).toBe('A1.1')
    expect(top.subtasks[0].depth).toBe(2)
    // Depth three is the deepest allowed; its own subtasks are dropped.
    expect(top.subtasks[0].subtasks[0].code).toBe('A1.1.1')
    expect(top.subtasks[0].subtasks[0].depth).toBe(3)
    expect(top.subtasks[0].subtasks[0].subtasks).toEqual([])
  })

  it('reviews task status read-only, keeping only the four verification columns worth of data', async () => {
    chat.mockReturnValue(
      response(
        JSON.stringify({
          items: [
            {
              workItemId: existingItem.id,
              claimedStatus: 'done',
              evidenceAssessment: 'Session transcript shows the migration ran successfully.',
              concerns: [],
              recommendedVerification: 'passed',
              confidence: 'high',
              // Anything beyond the typed shape must never survive parsing.
              status: 'done',
              title: 'Hijacked title',
              dependencyIds: ['unrelated-id']
            },
            {
              // Not one of the requested work item ids; must be dropped.
              workItemId: 'some-other-id',
              recommendedVerification: 'passed',
              confidence: 'high'
            }
          ]
        })
      )
    )
    const service = createService()
    const draft = await service.reviewTaskStatus('project-one', [
      {
        workItemId: existingItem.id,
        title: existingItem.title,
        status: existingItem.status,
        verificationStatus: existingItem.verificationStatus,
        sessionEvidence: 'Migration script ran; tests passed.',
        blockers: []
      }
    ])

    expect(draft.items).toEqual([
      {
        workItemId: existingItem.id,
        claimedStatus: 'done',
        evidenceAssessment: 'Session transcript shows the migration ran successfully.',
        concerns: [],
        recommendedVerification: 'passed',
        confidence: 'high'
      }
    ])
  })
})

describe('the Library a planning action reads', () => {
  it('asks for the planning budget, not the chat one', async () => {
    const buildLibraryAiContext = vi.fn(() => ({
      markdown: '',
      images: [],
      included: [],
      listed: [],
      totalChars: 0,
      budgetChars: LIBRARY_PLANNING_CONTEXT_BUDGET_CHARS,
      imageCount: 0,
      maxImages: 8,
      overBudget: false,
      imagesDropped: 0
    }))
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-ai-planning-'))
    directories.push(directory)
    const service = new AIPlanningService(
      directory,
      configured,
      () => ({ aiVisibleItem: () => null, buildLibraryAiContext }),
      () => null,
      async () => 'software'
    )
    const suggestions = Array.from({ length: 5 }, (_, index) => ({
      title: `Task ${index + 1}`,
      description: 'Do it.',
      priority: 'medium',
      acceptanceCriteria: ['Done.'],
      rationale: 'Because.',
      evidence: ['Planning work item: Existing work']
    }))
    chat.mockReturnValue(
      response(`\`\`\`json\n${JSON.stringify({ summary: 'Next.', suggestions })}\n\`\`\``)
    )

    await service.generateNextTasks(
      'project-one',
      'Project One',
      {},
      {
        goals: 0,
        milestones: 0,
        workItems: 0,
        watchEvents: 0,
        gitCommits: 0,
        harnessEvents: 0,
        windowDays: 14
      }
    )

    expect(buildLibraryAiContext).toHaveBeenCalledWith(
      'project-one',
      expect.objectContaining({ budgetChars: LIBRARY_PLANNING_CONTEXT_BUDGET_CHARS })
    )
    expect(LIBRARY_PLANNING_CONTEXT_BUDGET_CHARS).toBe(100_000)
  })
})
