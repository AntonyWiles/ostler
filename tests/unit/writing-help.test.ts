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
const { LibraryService } = await import('../../electron/services/library-service')
const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { addSummaryComment, summaryComments } =
  await import('../../electron/ipc/writing-help-handlers')
const { buildImproveWritingUserPrompt } = await import('../../src/shared/ostler-ai-prompts')
const {
  diffWords,
  findLinks,
  missingLinks,
  replaceRange,
  WRITING_STYLES,
  WRITING_HELP_MAX_CHARS,
  COMMENT_SUMMARY_MAX_COMMENTS
} = await import('../../src/shared/writing-help')

const PROJECT = 'project-one'

function configured(): OstlerConfig {
  const config = structuredClone(DEFAULT_CONFIG)
  config.projects = [makeWatchedProject({ id: PROJECT, name: 'Project One', aiProfile: 'auto' })]
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

const tempDir = useTempDir('ostler-writing-help-')
let library: InstanceType<typeof LibraryService>
let planning: InstanceType<typeof PlanningService>
let people: InstanceType<typeof PeopleService>

beforeEach(async () => {
  chat.mockReset()
  const dbPath = await createMigratedDatabase(tempDir())
  library = new LibraryService(dbPath, tempDir())
  planning = new PlanningService(dbPath, () => [PROJECT])
  people = new PeopleService(dbPath)
})

afterEach(() => {
  library.close()
  planning.close()
  people.close()
})

function service() {
  return new AIPlanningService(tempDir(), configured, () => library)
}

describe('the Improve writing prompt', () => {
  it('asks for each style differently and keeps links and Markdown', () => {
    const prompts = WRITING_STYLES.map((style) =>
      buildImproveWritingUserPrompt({ projectName: 'Garden', style, text: 'Some text' })
    )
    expect(new Set(prompts).size).toBe(WRITING_STYLES.length)
    for (const prompt of prompts) {
      expect(prompt).toContain('Keep every link exactly as written')
      expect(prompt).toContain('[[double bracket links]]')
      expect(prompt).toContain('"Garden"')
      expect(prompt).toMatch(/<content>\nSome text\n<\/content>/)
    }
    expect(prompts[WRITING_STYLES.indexOf('spelling')]).toContain('Fix spelling')
    expect(prompts[WRITING_STYLES.indexOf('list')]).toContain('bulleted list')
  })
})

describe('improveWriting', () => {
  it('sends only the text it is given, with the style and project name', async () => {
    chat.mockReturnValue(answer('Shorter words.'))
    const result = await service().improveWriting(PROJECT, 'Project One', {
      style: 'shorter',
      text: 'the selected part'
    })
    expect(result).toEqual({
      style: 'shorter',
      original: 'the selected part',
      suggestion: 'Shorter words.',
      missingLinks: []
    })
    const prompt = sentPrompt()
    expect(prompt).toContain('the selected part')
    expect(prompt).toContain('"Project One"')
  })

  it('warns when the suggestion drops a link', async () => {
    chat.mockReturnValue(answer('See the plan.'))
    const result = await service().improveWriting(PROJECT, 'Project One', {
      style: 'clearer',
      text: 'See [[Plan]] and [the site](https://example.com/a).'
    })
    expect(result.missingLinks).toEqual(['[[Plan]]', 'https://example.com/a'])
  })

  it('refuses a Library item set to Human only before sending anything', async () => {
    const item = library.createItem(PROJECT, {
      kind: 'note',
      title: 'Private',
      body: 'Secret',
      aiAccess: 'human-only'
    })
    await expect(
      service().improveWriting(PROJECT, 'Project One', {
        style: 'clearer',
        text: 'Secret',
        libraryItemId: item.id
      })
    ).rejects.toThrow(/Human only/)
    expect(chat).not.toHaveBeenCalled()
  })

  it('refuses a text over the cap and asks for a selection', async () => {
    await expect(
      service().improveWriting(PROJECT, 'Project One', {
        style: 'clearer',
        text: 'x'.repeat(WRITING_HELP_MAX_CHARS + 1)
      })
    ).rejects.toThrow(/Select a part/)
    expect(chat).not.toHaveBeenCalled()
  })
})

describe('links, ranges and the word diff', () => {
  it('finds wiki links, Markdown link targets and URLs', () => {
    expect(
      findLinks('[[A]] [b](https://b.example/x "t") <https://c.example> and https://d.example/y')
    ).toEqual(['[[A]]', 'https://b.example/x', 'https://c.example', 'https://d.example/y'])
    expect(missingLinks('[[A]] [[B]]', 'only [[B]]')).toEqual(['[[A]]'])
  })

  it('replaces the selection only, or the whole text', () => {
    expect(replaceRange('one two three', 4, 7, 'TWO')).toBe('one TWO three')
    expect(replaceRange('one two', 0, 0, 'new')).toBe('new')
  })

  it('marks words added and removed', () => {
    expect(diffWords('the quick fox', 'the slow fox')).toEqual([
      { kind: 'same', text: 'the' },
      { kind: 'removed', text: ' quick' },
      { kind: 'added', text: ' slow' },
      { kind: 'same', text: ' fox' }
    ])
  })
})

describe('Summarise comments', () => {
  function taskWithComments(count: number) {
    const grace = people.create({ name: 'Grace Hopper' })
    const task = planning.createWorkItem(PROJECT, { title: 'Book the venue' }, { kind: 'human' })
    const other = planning.createWorkItem(PROJECT, { title: 'Other task' }, { kind: 'human' })
    planning.addComment(other.id, 'Not this one', { kind: 'human' })
    for (let index = 0; index < count; index++) {
      planning.addComment(task.id, `Comment ${index}`, { kind: 'human', personId: grace.id })
    }
    return task
  }

  it("holds the task's comments, with names, and nothing from other tasks", async () => {
    const task = taskWithComments(8)
    const comments = summaryComments(planning, people, task.id)
    expect(comments).toHaveLength(8)
    expect(comments.every((c) => c.author === 'Grace Hopper')).toBe(true)
    expect(comments.map((c) => c.body).sort()).toContain('Comment 0')
    chat.mockReturnValue(answer('**Decided**: venue.'))
    const summary = await service().summariseComments(
      PROJECT,
      { id: task.id, title: task.title },
      comments
    )
    expect(summary).toMatchObject({ summary: '**Decided**: venue.', count: 8, total: 8 })
    const prompt = sentPrompt()
    expect(prompt).toContain('<task title="Book the venue">')
    expect(prompt).toContain('author="Grace Hopper"')
    expect(prompt).not.toContain('Not this one')
    expect(prompt).not.toContain('Other task')
  })

  it('sends at most the latest comments and says so', async () => {
    const comments = Array.from({ length: COMMENT_SUMMARY_MAX_COMMENTS + 5 }, (_, index) => ({
      author: 'A',
      at: 1000 + index,
      body: `c${index}`
    }))
    chat.mockReturnValue(answer('Summary'))
    const summary = await service().summariseComments(PROJECT, { id: 't', title: 'T' }, comments)
    expect(summary).toMatchObject({ count: COMMENT_SUMMARY_MAX_COMMENTS, total: 205, from: 1005 })
    expect(sentPrompt()).toContain('5 older ones are left out')
  })

  it('refuses fewer than 8 comments', async () => {
    const task = taskWithComments(7)
    await expect(
      service().summariseComments(
        PROJECT,
        { id: task.id, title: task.title },
        summaryComments(planning, people, task.id)
      )
    ).rejects.toThrow(/at least 8/)
  })

  it('saves an added summary as a comment by Ostler AI', () => {
    const task = taskWithComments(8)
    const comment = addSummaryComment(planning, task.id, '  Summary text  ')
    expect(comment).toMatchObject({ authorKind: 'ostler-ai', body: 'Summary text' })
    planning.deleteComment(comment.id, { kind: 'human' })
    expect(planning.listComments(task.id).some((c) => c.id === comment.id)).toBe(false)
  })
})
