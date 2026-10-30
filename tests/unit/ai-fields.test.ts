import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type OstlerConfig } from '../../src/shared/ostler-api'

const chat = vi.fn()
vi.mock('../../electron/services/ai-provider', async (importActual) => ({
  ...(await importActual<typeof import('../../electron/services/ai-provider')>()),
  createProvider: () => ({ chat })
}))

import { PlanningService } from '../../electron/services/planning-service'
import { AIPlanningService } from '../../electron/services/ai-planning-service'
import { ConfigStore } from '../../electron/config-store'
import { PeopleService } from '../../electron/services/people-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import {
  aiFieldRequest,
  aiFieldSourceHash,
  canHaveAiInstruction,
  isAiFillOutOfDate,
  readAiFieldAnswer
} from '../../src/shared/planning/ai-fields'
import { buildAiFieldFillUserPrompt } from '../../src/shared/ostler-ai-prompts'
import { validateProjectPackage } from '../../src/shared/project-package'
import { createMigratedDatabase } from '../helpers/database'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

/** AI fields (N8.4, N58 choice A): Ostler AI suggests, and the person's Fill with AI saves. */

function answer(value: unknown): AsyncGenerator<string> {
  return (async function* () {
    yield JSON.stringify({ answer: value })
  })()
}

function configured(apiKey = 'key-in-memory'): OstlerConfig {
  const config = structuredClone(DEFAULT_CONFIG)
  config.ai.provider = 'openai'
  config.ai.apiKey = apiKey
  config.ai.model = 'test-model'
  config.projects = [makeWatchedProject({ id: 'p1', name: 'House', aiProfile: 'auto' })]
  return config
}

describe('AI fields', () => {
  const tempDir = useTempDir('ostler-ai-fields-')
  let databasePath: string
  let planning: PlanningService
  let moreProjects: () => string[] = () => []
  const human = { kind: 'human' } as const

  beforeEach(async () => {
    chat.mockReset()
    databasePath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(databasePath, () => ['p1', 'p2', ...moreProjects()])
  })

  afterEach(() => {
    planning.close()
  })

  const roomField = () =>
    planning.createField('p1', {
      name: 'Room',
      type: 'choice',
      options: [{ name: 'Kitchen' }, { name: 'Hall' }],
      aiInstruction: 'Which room is this for?'
    })
  const summaryField = () =>
    planning.createField('p1', {
      name: 'Summary',
      type: 'text',
      aiInstruction: 'Summarise in one line'
    })
  const task = (title: string, extra: Record<string, unknown> = {}) =>
    planning.createWorkItem('p1', { title, description: 'Paint it', ...extra }, human)
  const suggest = (workItemId: string, fieldId: string, config = configured()) =>
    new AIPlanningService(tempDir(), () => config).suggestAiFieldValue('p1', () => ({
      field: planning.getField('p1', fieldId),
      item: planning.getWorkItem(workItemId)
    }))

  it('takes an instruction on Text and Choice fields only', () => {
    expect(['text', 'choice'].every((type) => canHaveAiInstruction(type as 'text'))).toBe(true)
    expect(roomField().aiInstruction).toBe('Which room is this for?')
    expect(planning.createField('p1', { name: 'Plain', type: 'text' }).aiInstruction).toBeNull()
    for (const type of ['number', 'date', 'choices', 'checkbox'] as const)
      expect(() =>
        planning.createField('p1', { name: `A ${type}`, type, aiInstruction: 'Guess' })
      ).toThrow(/Only Text and Choice/)
    expect(() =>
      planning.createField('p1', { name: 'Long', type: 'text', aiInstruction: 'x'.repeat(501) })
    ).toThrow(/500/)
    const summary = summaryField()
    expect(planning.updateField('p1', summary.id, { aiInstruction: '' }).aiInstruction).toBeNull()
    expect(planning.listFields('p1').find((field) => field.id === summary.id)?.aiInstruction).toBe(
      null
    )
  })

  it('sends only the field’s name, instruction and options and the task’s own text', async () => {
    const room = roomField()
    const secret = planning.createField('p1', { name: 'Budget code', type: 'text' })
    const item = task('Paint the walls', {
      acceptanceCriteria: ['Buy paint'],
      fieldValues: { [secret.id]: 'SECRET-42', [room.id]: room.options[1].id }
    })
    planning.addComment(item.id, 'A private comment', human)
    const request = aiFieldRequest(room, item)
    expect(Object.keys(request).sort()).toEqual(
      ['checklist', 'description', 'fieldName', 'instruction', 'options', 'title'].sort()
    )
    chat.mockReturnValue(answer('Kitchen'))
    await suggest(item.id, room.id)
    const [messages] = chat.mock.calls[0] as [Array<{ role: string; content: string }>]
    const sent = messages.map((message) => message.content).join('\n')
    expect(sent).toContain('Which room is this for?')
    expect(sent).toContain('Kitchen\nHall')
    expect(sent).toContain('Title: Paint the walls')
    expect(sent).toContain('- Buy paint')
    expect(sent).not.toContain('SECRET-42')
    expect(sent).not.toContain('A private comment')
    expect(sent).not.toContain(room.options[1].id)
    expect(buildAiFieldFillUserPrompt(request)).toContain('<task>')
  })

  it('suggests without writing: nothing is saved until the person’s Fill with AI', async () => {
    const room = roomField()
    const item = task('Paint the kitchen')
    const before = planning.listWorkItems('p1')
    chat.mockReturnValue(answer('kitchen'))
    const suggestion = await suggest(item.id, room.id)
    expect(suggestion).toMatchObject({
      value: room.options[0].id,
      note: null,
      sourceHash: aiFieldSourceHash(item)
    })
    // The AI path saved nothing, and left no activity.
    expect(planning.listWorkItems('p1')).toEqual(before)
    expect(planning.getWorkItem(item.id).fieldValues).toEqual({})
    expect(
      planning.listActivity('p1', item.id).entries.some((entry) => entry.field === 'aiFilled')
    ).toBe(false)
    // Only the person's explicit apply writes it.
    planning.applyAiFieldFills('p1', room.id, [
      { workItemId: item.id, value: suggestion.value, sourceHash: suggestion.sourceHash }
    ])
    expect(planning.getWorkItem(item.id).fieldFills?.[room.id]).toEqual({
      filledBy: 'ostler-ai',
      sourceHash: suggestion.sourceHash
    })
  })

  it('leaves a Choice answer outside the options empty with a note, and cuts Text to 500', async () => {
    const room = roomField()
    expect(readAiFieldAnswer(room, 'Garage')).toEqual({ value: null, note: 'notAnOption' })
    expect(readAiFieldAnswer(room, null)).toEqual({ value: null, note: 'noAnswer' })
    const summary = summaryField()
    expect(String(readAiFieldAnswer(summary, 'y'.repeat(900)).value)).toHaveLength(500)
    const item = task('Paint')
    chat.mockReturnValue(answer('Garage'))
    expect(await suggest(item.id, room.id)).toMatchObject({ value: null, note: 'notAnOption' })
  })

  it('refuses to suggest while Ostler AI is not set up, and reads nothing', async () => {
    const build = vi.fn()
    await expect(
      new AIPlanningService(tempDir(), () => configured('')).suggestAiFieldValue('p1', build)
    ).rejects.toThrow()
    expect(build).not.toHaveBeenCalled()
    expect(chat).not.toHaveBeenCalled()
  })

  it('keeps the person’s values unless they confirm, and undoes a batch at once', () => {
    const summary = summaryField()
    const mine = task('Mine', { fieldValues: { [summary.id]: 'My words' } })
    const empty = task('Empty')
    const hash = (id: string) => aiFieldSourceHash(planning.getWorkItem(id))
    const fills = [
      { workItemId: mine.id, value: 'AI words', sourceHash: hash(mine.id) },
      { workItemId: empty.id, value: 'AI for empty', sourceHash: hash(empty.id) }
    ]
    const kept = planning.applyAiFieldFills('p1', summary.id, fills)
    expect(kept.filled).toEqual([empty.id])
    expect(kept.skipped).toEqual([{ workItemId: mine.id, reason: 'personValue' }])
    expect(planning.getWorkItem(mine.id).fieldValues?.[summary.id]).toBe('My words')

    const replaced = planning.applyAiFieldFills('p1', summary.id, fills, {
      replacePersonValues: true
    })
    expect(replaced.filled).toEqual([mine.id, empty.id])
    expect(planning.getWorkItem(mine.id).fieldValues?.[summary.id]).toBe('AI words')
    const activity = planning.listActivity('p1', mine.id).entries
    expect(activity.map((entry) => entry.summary)).toContain('Ostler AI filled Summary')

    // One undo for the whole batch: every value and who filled it as before.
    planning.restoreAiFieldFills('p1', replaced.before)
    expect(planning.getWorkItem(mine.id).fieldValues?.[summary.id]).toBe('My words')
    expect(planning.getWorkItem(mine.id).fieldFills?.[summary.id]?.filledBy).toBe('person')
    expect(planning.getWorkItem(empty.id).fieldFills?.[summary.id]?.filledBy).toBe('ostler-ai')
    planning.restoreAiFieldFills('p1', kept.before)
    expect(planning.getWorkItem(empty.id).fieldValues).toEqual({})
  })

  it('undoes one fill', () => {
    const summary = summaryField()
    const item = task('One')
    const result = planning.applyAiFieldFills('p1', summary.id, [
      { workItemId: item.id, value: 'Filled', sourceHash: aiFieldSourceHash(item) }
    ])
    expect(planning.getWorkItem(item.id).fieldValues?.[summary.id]).toBe('Filled')
    planning.restoreAiFieldFills('p1', result.before)
    expect(planning.getWorkItem(item.id).fieldValues).toEqual({})
  })

  it('says a value may be out of date once the task’s text changes', () => {
    const summary = summaryField()
    const item = task('Paint')
    planning.applyAiFieldFills('p1', summary.id, [
      { workItemId: item.id, value: 'Paint job', sourceHash: aiFieldSourceHash(item) }
    ])
    const filled = planning.getWorkItem(item.id)
    expect(isAiFillOutOfDate(filled.fieldFills?.[summary.id], filled)).toBe(false)
    planning.updateWorkItem(item.id, { description: 'Paint and plaster' }, human)
    const changed = planning.getWorkItem(item.id)
    expect(isAiFillOutOfDate(changed.fieldFills?.[summary.id], changed)).toBe(true)
    planning.updateWorkItem(item.id, { acceptanceCriteria: ['New item'] }, human)
    expect(aiFieldSourceHash(planning.getWorkItem(item.id))).not.toBe(aiFieldSourceHash(changed))
  })

  it('makes an edited value the person’s', () => {
    const summary = summaryField()
    const item = task('Paint')
    planning.applyAiFieldFills('p1', summary.id, [
      { workItemId: item.id, value: 'Paint job', sourceHash: aiFieldSourceHash(item) }
    ])
    planning.updateWorkItem(item.id, { fieldValues: { [summary.id]: 'My version' } }, human)
    expect(planning.getWorkItem(item.id).fieldFills?.[summary.id]).toEqual({
      filledBy: 'person',
      sourceHash: null
    })
  })

  it('refuses an ordinary field, a value the field does not take and a batch over 100', () => {
    const plain = planning.createField('p1', { name: 'Plain', type: 'text' })
    const room = roomField()
    const item = task('Paint')
    const hash = aiFieldSourceHash(item)
    expect(() =>
      planning.applyAiFieldFills('p1', plain.id, [
        { workItemId: item.id, value: 'x', sourceHash: hash }
      ])
    ).toThrow(/no instruction/)
    expect(() =>
      planning.applyAiFieldFills('p1', room.id, [
        { workItemId: item.id, value: 'not-an-option-id', sourceHash: hash }
      ])
    ).toThrow()
    expect(planning.getWorkItem(item.id).fieldValues).toEqual({})
    expect(() =>
      planning.applyAiFieldFills(
        'p1',
        room.id,
        Array.from({ length: 101 }, () => ({ workItemId: item.id, value: null, sourceHash: hash }))
      )
    ).toThrow(/100/)
  })

  it('carries instructions and who filled each value in the project file', async () => {
    const store = new ConfigStore(path.join(tempDir(), 'config.json'))
    moreProjects = () => store.getProjects().map((project) => project.id)
    const people = new PeopleService(databasePath)
    people.ensureMe('Me')
    const scaffold = new ProjectScaffoldService(store, () => tempDir())
    const packages = new ProjectPackageService({
      planning,
      registerProject: async (request, fixed) => scaffold.createProject(request, fixed),
      getProject: (projectId) => {
        const project = store.getProjects().find((entry) => entry.id === projectId)
        if (!project) throw new Error('Project not found')
        return project
      },
      dataDir: tempDir(),
      appVersion: 'test'
    })
    try {
      const source = packages.createProjectFromPackage
      const pkg = validateProjectPackage({
        format: 'ostler-project-package',
        version: 1,
        project: { name: 'House', color: '#ec4899', estimateUnit: 'points' },
        fields: [
          { ref: 'f1', name: 'Summary', type: 'text', aiInstruction: 'Summarise in one line' },
          { ref: 'f2', name: 'Notes', type: 'text' }
        ],
        tasks: [
          {
            ref: 't1',
            title: 'Paint',
            fieldValues: { f1: 'A paint job', f2: 'Mine' },
            aiFills: { f1: { sourceHash: 'abcdef12' } }
          }
        ]
      })
      if (!pkg.ok) throw new Error(pkg.error)
      const { project } = await source.call(packages, pkg.value, {}, '2026-10-18')
      const [summary, notes] = planning.listFields(project.id)
      expect(summary.aiInstruction).toBe('Summarise in one line')
      expect(notes.aiInstruction).toBeNull()
      const item = planning.listWorkItems(project.id)[0]
      expect(item.fieldFills).toEqual({
        [summary.id]: { filledBy: 'ostler-ai', sourceHash: 'abcdef12' },
        [notes.id]: { filledBy: 'person', sourceHash: null }
      })
      const exported = packages.exportProjectAsPackage(project.id, {
        kind: 'export',
        relativeDates: false
      })
      expect(validateProjectPackage(exported).ok).toBe(true)
      expect(exported.fields?.[0]).toMatchObject({ aiInstruction: 'Summarise in one line' })
      expect(exported.fields?.[1]).not.toHaveProperty('aiInstruction')
      expect(exported.tasks[0].aiFills).toEqual({ f1: { sourceHash: 'abcdef12' } })
      // An instruction on a type that cannot have one is refused.
      expect(
        validateProjectPackage({
          format: 'ostler-project-package',
          version: 1,
          project: { name: 'Bad', color: '#ec4899', estimateUnit: 'points' },
          fields: [{ ref: 'f1', name: 'Count', type: 'number', aiInstruction: 'Guess' }],
          tasks: []
        }).ok
      ).toBe(false)
    } finally {
      people.close()
    }
  })
})
