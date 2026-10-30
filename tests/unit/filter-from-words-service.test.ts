import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type OstlerConfig } from '../../src/shared/ostler-api'
import type { FilterVocabulary } from '../../src/shared/filter-from-words'

const chat = vi.fn()
const directories: string[] = []

vi.mock('../../electron/services/ai-provider', async (importActual) => ({
  ...(await importActual<typeof import('../../electron/services/ai-provider')>()),
  createProvider: () => ({ chat })
}))

import { AIPlanningService } from '../../electron/services/ai-planning-service'
import { makeWatchedProject } from '../helpers/projects'

function configured(ai = true): OstlerConfig {
  const config = structuredClone(DEFAULT_CONFIG)
  config.projects = [
    makeWatchedProject({
      id: 'project-one',
      name: 'Project One',
      notes: 'Private project notes',
      aiProfile: 'auto'
    })
  ]
  if (ai) {
    config.ai.provider = 'openai'
    config.ai.apiKey = 'encrypted-key-loaded-in-memory'
    config.ai.model = 'test-model'
  }
  return config
}

function answer(value: string): AsyncGenerator<string> {
  return (async function* () {
    yield value
  })()
}

function createService(ai = true): AIPlanningService {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-filter-from-words-'))
  directories.push(directory)
  return new AIPlanningService(directory, () => configured(ai))
}

const vocabulary: FilterVocabulary = {
  statuses: [{ value: 'done', name: 'Shipped' }],
  priorities: [{ value: 'high', name: 'High' }],
  labels: ['Design'],
  milestones: [{ id: 'm-launch', name: 'Launch' }],
  goals: [{ id: 'g-grow', name: 'Grow revenue' }],
  iterations: [],
  people: [{ id: 'p-sam', name: 'Sam Lee' }]
}

const input = { text: "Sam's high-priority tasks, not done", today: '2026-10-16', weekStart: 1 }

beforeEach(() => chat.mockReset())

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('AIPlanningService.filterFromWords', () => {
  it("sends the words, the date, the grammar and the project's names, and no task or project notes", async () => {
    chat.mockReturnValue(
      answer(
        '{"match":"all","conditions":[{"field":"assignee","op":"is","value":["Sam Lee"]},{"field":"labels","op":"hasAny","value":["urgent"]}]}'
      )
    )
    const result = await createService().filterFromWords('project-one', input, vocabulary)
    const [messages] = chat.mock.calls[0] as [Array<{ role: string; content: string }>]
    const sent = messages.map((message) => message.content).join('\n')
    expect(sent).toContain(input.text)
    expect(sent).toContain('Today is 2026-10-16. The week starts on Monday.')
    expect(sent).toContain('- due before: a date written YYYY-MM-DD')
    for (const name of ['done: Shipped', 'Design', 'Launch', 'Grow revenue', 'Sam Lee']) {
      expect(sent).toContain(name)
    }
    expect(sent).not.toContain('Private project notes')
    expect(sent).not.toContain('m-launch')
    expect(sent).not.toContain('p-sam')
    expect(result.filter.conditions).toEqual([{ field: 'assignee', op: 'is', value: ['p-sam'] }])
    expect(result.notes).toEqual([{ kind: 'unknownName', field: 'labels', name: 'urgent' }])
  })

  it('reads an answer in a code fence', async () => {
    chat.mockReturnValue(
      answer('```json\n{"conditions":[{"field":"due","op":"is","value":"thisWeek"}]}\n```')
    )
    const result = await createService().filterFromWords('project-one', input, vocabulary)
    expect(result.filter).toEqual({
      match: 'all',
      conditions: [{ field: 'due', op: 'is', value: 'thisWeek' }]
    })
  })

  it('refuses an answer that is not JSON', async () => {
    chat.mockReturnValue(answer('Here are the tasks Sam has.'))
    await expect(createService().filterFromWords('project-one', input, vocabulary)).rejects.toThrow(
      'The filter was not valid JSON.'
    )
  })

  it('sends nothing while Ostler AI is not set up', async () => {
    await expect(
      createService(false).filterFromWords('project-one', input, vocabulary)
    ).rejects.toThrow()
    expect(chat).not.toHaveBeenCalled()
  })
})
