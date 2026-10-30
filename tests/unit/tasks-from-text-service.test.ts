import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type OstlerConfig } from '../../src/shared/ostler-api'

const chat = vi.fn()
const directories: string[] = []

vi.mock('../../electron/services/ai-provider', async (importActual) => ({
  ...(await importActual<typeof import('../../electron/services/ai-provider')>()),
  createProvider: () => ({ chat })
}))

import { AIPlanningService } from '../../electron/services/ai-planning-service'
import { makeWatchedProject } from '../helpers/projects'

function configured(vision: 'auto' | 'on' | 'off' = 'auto'): OstlerConfig {
  const config = structuredClone(DEFAULT_CONFIG)
  config.projects = [
    makeWatchedProject({
      id: 'project-one',
      name: 'Project One',
      notes: 'Private project notes',
      aiProfile: 'auto'
    })
  ]
  config.ai.provider = 'openai'
  config.ai.apiKey = 'encrypted-key-loaded-in-memory'
  config.ai.model = 'test-model'
  config.ai.vision = vision
  return config
}

function answer(value: unknown): AsyncGenerator<string> {
  return (async function* () {
    yield JSON.stringify(value)
  })()
}

function createService(vision: 'auto' | 'on' | 'off' = 'auto'): AIPlanningService {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-tasks-from-text-'))
  directories.push(directory)
  return new AIPlanningService(directory, () => configured(vision))
}

const people = [{ id: 'p-grace', name: 'Grace Hopper', initials: 'GH' }]
const photo = { mimeType: 'image/jpeg', base64: 'AAAA' }

beforeEach(() => chat.mockReset())

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('AIPlanningService.findTasksFromText', () => {
  it("sends only the person's text, with no project records or people", async () => {
    chat.mockReturnValue(
      answer({ tasks: [{ title: 'Call Grace', person: 'Grace', dueDate: '2026-10-16' }] })
    )
    const draft = await createService().findTasksFromText(
      'project-one',
      { text: 'Grace to call the venue tomorrow', photo: null, today: '2026-10-15', weekStart: 1 },
      people
    )
    expect(chat).toHaveBeenCalledTimes(1)
    const [messages] = chat.mock.calls[0]
    expect(messages).toHaveLength(2)
    expect(typeof messages[1].content).toBe('string')
    const sent = JSON.stringify(messages)
    expect(sent).toContain('Grace to call the venue tomorrow')
    expect(sent).toContain('Today is 2026-10-15.')
    expect(sent).not.toContain('Grace Hopper')
    expect(sent).not.toContain('p-grace')
    expect(sent).not.toContain('Private project notes')
    expect(sent).not.toContain('Project One')
    expect(draft.suggestions[0]).toMatchObject({ assigneeId: 'p-grace', dueDate: '2026-10-16' })
  })

  it('sends the photo as an image part beside the text when vision allows it', async () => {
    chat.mockReturnValue(answer({ tasks: [] }))
    await createService('on').findTasksFromText(
      'project-one',
      { text: 'Whiteboard', photo, today: '2026-10-15', weekStart: 1 },
      people
    )
    const [messages] = chat.mock.calls[0]
    expect(messages[1].content).toEqual([
      { type: 'text', text: expect.stringContaining('Whiteboard') },
      { type: 'image', mimeType: 'image/jpeg', base64: 'AAAA' }
    ])
  })

  it('never sends a photo when vision is off', async () => {
    await expect(
      createService('off').findTasksFromText(
        'project-one',
        { text: 'Whiteboard', photo, today: '2026-10-15', weekStart: 1 },
        people
      )
    ).rejects.toThrow(/Reading images is turned off/)
    expect(chat).not.toHaveBeenCalled()
  })

  it('says the model cannot read pictures, without retrying by description', async () => {
    chat.mockImplementation(() =>
      (async function* () {
        yield* []
        throw new Error('OpenAI API error: 400 image_url is only supported by vision models')
      })()
    )
    await expect(
      createService().findTasksFromText(
        'project-one',
        { text: '', photo, today: '2026-10-15', weekStart: 1 },
        people
      )
    ).rejects.toThrow(/^This model can't read pictures/)
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('refuses when Ostler AI is not set up, before anything is sent', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-tasks-from-text-'))
    directories.push(directory)
    const service = new AIPlanningService(directory, () => structuredClone(DEFAULT_CONFIG))
    await expect(
      service.findTasksFromText(
        'project-one',
        { text: 'Anything', photo: null, today: '2026-10-15', weekStart: 1 },
        people
      )
    ).rejects.toThrow()
    expect(chat).not.toHaveBeenCalled()
  })
})
