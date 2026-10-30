import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type OstlerConfig } from '../../src/shared/ostler-api'
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
const { PlanningService } = await import('../../electron/services/planning-service')
const { releaseNotesFor } = await import('../../electron/services/release-notes-service')
const { buildReleaseNotesUserPrompt, OSTLER_AI_RELEASE_NOTES_SYSTEM_PROMPT } =
  await import('../../src/shared/ostler-ai-prompts')

const PROJECT = 'project-one'
const HUMAN = { kind: 'human' } as const

function configured(apiKey = 'encrypted-key-loaded-in-memory'): OstlerConfig {
  const config = structuredClone(DEFAULT_CONFIG)
  config.projects = [
    makeWatchedProject({
      id: PROJECT,
      name: 'Secret project name',
      notes: 'Secret project notes',
      aiProfile: 'auto'
    })
  ]
  config.ai.provider = 'openai'
  config.ai.apiKey = apiKey
  config.ai.model = 'test-model'
  return config
}

function answer(text: string): AsyncGenerator<string> {
  return (async function* () {
    yield text
  })()
}

const tempDir = useTempDir('ostler-release-notes-ai-')
let planning: InstanceType<typeof PlanningService>

beforeEach(async () => {
  chat.mockReset()
  planning = new PlanningService(await createMigratedDatabase(tempDir()), () => [PROJECT])
})

afterEach(() => {
  planning.close()
})

function seed() {
  const milestone = planning.createMilestone(PROJECT, {
    name: 'Version 2',
    outcome: 'Secret outcome'
  })
  const done = planning.createWorkItem(
    PROJECT,
    {
      title: 'Dark mode',
      description: 'Adds a dark theme. Secret second sentence.',
      status: 'done',
      milestoneId: milestone.id,
      labels: ['secret-label'],
      acceptanceCriteria: ['Secret criterion']
    },
    HUMAN
  )
  planning.addComment(done.id, 'Secret comment', HUMAN)
  planning.createWorkItem(
    PROJECT,
    { title: 'Secret open task', status: 'active', milestoneId: milestone.id },
    HUMAN
  )
  return milestone
}

describe('Polish with AI', () => {
  it('sends the draft and nothing else', async () => {
    const milestone = seed()
    const build = () =>
      releaseNotesFor(
        planning,
        PROJECT,
        { kind: 'milestone', id: milestone.id },
        { groupBy: 'none', descriptions: true, subtasks: false }
      )
    chat.mockReturnValue(answer('# Release notes: Version 2\n\nWe added **Dark mode**.'))
    const result = await new AIPlanningService(tempDir(), () => configured()).polishReleaseNotes(
      PROJECT,
      build
    )
    const draft = build().markdown
    expect(draft).toContain('- Dark mode: Adds a dark theme.')
    const messages = chat.mock.calls[0][0] as Array<{ role: string; content: string }>
    expect(messages).toEqual([
      { role: 'system', content: OSTLER_AI_RELEASE_NOTES_SYSTEM_PROMPT },
      { role: 'user', content: buildReleaseNotesUserPrompt(draft) }
    ])
    const sent = messages.map((message) => message.content).join('\n')
    expect(sent).not.toMatch(/Secret/)
    expect(result).toEqual({
      draft,
      suggestion: '# Release notes: Version 2\n\nWe added **Dark mode**.',
      missingTitles: []
    })
  })

  it('names the tasks a suggestion leaves out', async () => {
    const milestone = seed()
    chat.mockReturnValue(answer('# Release notes\n\nLots of small fixes.'))
    const result = await new AIPlanningService(tempDir(), () => configured()).polishReleaseNotes(
      PROJECT,
      () =>
        releaseNotesFor(
          planning,
          PROJECT,
          { kind: 'milestone', id: milestone.id },
          { groupBy: 'type', descriptions: false, subtasks: false }
        )
    )
    expect(result.missingTitles).toEqual(['Dark mode'])
  })

  it('refuses before reading anything while Ostler AI is not set up, and with nothing finished', async () => {
    const build = vi.fn(() => ({ title: 'T', markdown: '# T\n', taskTitles: [] as string[] }))
    await expect(
      new AIPlanningService(tempDir(), () => configured('')).polishReleaseNotes(PROJECT, build)
    ).rejects.toThrow()
    expect(build).not.toHaveBeenCalled()
    await expect(
      new AIPlanningService(tempDir(), () => configured()).polishReleaseNotes(PROJECT, build)
    ).rejects.toThrow(/no finished tasks/)
    expect(chat).not.toHaveBeenCalled()
  })

  it('asks to keep every task and its section', () => {
    const prompt = buildReleaseNotesUserPrompt('# Draft')
    expect(prompt).toContain('never drop, merge or invent a task')
    expect(prompt).toMatch(/<content>\n# Draft\n<\/content>/)
  })
})
