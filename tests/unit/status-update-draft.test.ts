import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type OstlerConfig, type WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

const chat = vi.fn()

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('../../electron/services/ai-provider', async (importActual) => ({
  ...(await importActual<typeof import('../../electron/services/ai-provider')>()),
  createProvider: () => ({ chat })
}))

const { AIPlanningService } = await import('../../electron/services/ai-planning-service')
const { LibraryService } = await import('../../electron/services/library-service')
const { PlanningService } = await import('../../electron/services/planning-service')
const { statusDraftInput } = await import('../../electron/services/status-update-draft')
const { buildStatusUpdateUserPrompt } = await import('../../src/shared/ostler-ai-prompts')
const { parseStatusDraftAnswer } = await import('../../src/shared/status-updates')

const PROJECT = 'project-one'
const DAY = 86_400_000

const project = makeWatchedProject({
  id: PROJECT,
  name: 'Website',
  aiProfile: 'auto'
}) as WatchedProject

function configured(): OstlerConfig {
  const config = structuredClone(DEFAULT_CONFIG)
  config.projects = [project]
  config.ai.provider = 'openai'
  config.ai.apiKey = 'encrypted-key-loaded-in-memory'
  config.ai.model = 'test-model'
  return config
}

function answer(text: string): AsyncGenerator<string> {
  return (async function* () {
    yield text
  })()
}

function sentPrompt(): string {
  const messages = chat.mock.calls[0][0] as Array<{ role: string; content: string }>
  return messages.map((message) => message.content).join('\n')
}

const tempDir = useTempDir('ostler-status-draft-')
let library: InstanceType<typeof LibraryService>
let planning: InstanceType<typeof PlanningService>

beforeEach(async () => {
  chat.mockReset()
  const dbPath = await createMigratedDatabase(tempDir())
  library = new LibraryService(dbPath, tempDir())
  planning = new PlanningService(dbPath, () => [PROJECT])
})

afterEach(() => {
  library.close()
  planning.close()
})

const service = () => new AIPlanningService(tempDir(), configured, () => library)
const human = { kind: 'human' as const }

describe('Draft from activity (N5.5)', () => {
  it('reads only the activity since the last update, worded as the feed words it', () => {
    planning.createWorkItem(PROJECT, { title: 'Old work' }, human)
    planning.statusUpdates.post(PROJECT, { health: 'on-track', note: 'Earlier' }, human)
    const later = Date.now() + 1000
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(later)
    try {
      const milestone = planning.createMilestone(PROJECT, { name: 'Launch' })
      planning.createWorkItem(
        PROJECT,
        { title: 'Write the copy', milestoneId: milestone.id },
        human
      )
      const input = statusDraftInput(planning, project, later + 1000)
      expect(input.sinceLastUpdate).toBe(true)
      expect(input.activity.map((entry) => entry.task)).toEqual(['Write the copy'])
      expect(input.activity[0].summary).toMatch(/created the task/i)
      expect(input.milestones).toEqual([
        { name: 'Launch', status: 'planned', done: 0, total: 1, targetDate: null }
      ])
      const prompt = buildStatusUpdateUserPrompt(input)
      expect(prompt).toContain('since its last status update')
      expect(prompt).toContain('only 1 change since then')
      expect(prompt).toContain('- Launch (planned): 0 of 1 tasks done')
      expect(prompt).not.toContain('Old work')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the last two weeks when there is no update yet', () => {
    const now = Date.now() + DAY
    const input = statusDraftInput(planning, project, now)
    expect(input.sinceLastUpdate).toBe(false)
    expect(input.sinceAt).toBe(now - 14 * DAY)
    expect(buildStatusUpdateUserPrompt(input)).toContain('the last two weeks')
  })

  it('returns the suggested health and note through requireAi, and posts nothing', async () => {
    planning.createWorkItem(PROJECT, { title: 'Write the copy' }, human)
    chat.mockReturnValue(
      answer('```json\n{"health":"at-risk","note":"Only one change since the last update."}\n```')
    )
    const draft = await service().draftStatusUpdate(PROJECT, () =>
      statusDraftInput(planning, project, Date.now() + 1000)
    )
    expect(draft).toMatchObject({
      health: 'at-risk',
      note: 'Only one change since the last update.',
      changes: 1
    })
    expect(sentPrompt()).toContain('<project name="Website">')
    expect(planning.statusUpdates.list(PROJECT)).toEqual([])
  })

  it('refuses without AI set up, before reading anything', async () => {
    const build = vi.fn()
    const off = () => ({ ...configured(), ai: { ...DEFAULT_CONFIG.ai, provider: 'openai' } })
    await expect(
      new AIPlanningService(tempDir(), off as never, () => library).draftStatusUpdate(
        PROJECT,
        build
      )
    ).rejects.toThrow()
    expect(build).not.toHaveBeenCalled()
    expect(chat).not.toHaveBeenCalled()
  })

  it('parses an answer, leaving an unknown health for the person to pick', () => {
    expect(parseStatusDraftAnswer('{"health":"on-track","note":" Fine "}')).toEqual({
      health: 'on-track',
      note: 'Fine'
    })
    expect(parseStatusDraftAnswer('{"health":"green","note":"Fine"}')).toEqual({
      health: null,
      note: 'Fine'
    })
    expect(parseStatusDraftAnswer('{"health":"on-track","note":""}')).toBeNull()
    expect(parseStatusDraftAnswer('no json here')).toBeNull()
    expect(parseStatusDraftAnswer(`{"note":"${'x'.repeat(2500)}"}`)!.note).toHaveLength(2000)
  })
})
