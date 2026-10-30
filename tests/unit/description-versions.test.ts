import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { createMigratedDatabase } from '../helpers/database'
import { MAX_DESCRIPTION_VERSIONS, type PlanningActor } from '@shared/ostler-api'
import { TEXT_SITTING_GAP_MS } from '@shared/planning/sitting'
import { useTempDir } from '../helpers/temp-dir'

const human: PlanningActor = { kind: 'human' }
const agent: PlanningActor = { kind: 'agent' }
const automation: PlanningActor = { kind: 'automation' }

describe('Description history (N2.6)', () => {
  const tempDir = useTempDir('ostler-description-versions-')
  let planning: PlanningService
  let databasePath: string

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 16, 10, 0))
    databasePath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(databasePath, () => ['p1'])
  })

  afterEach(() => {
    planning.close()
    vi.useRealTimers()
  })

  const wait = (ms: number) => vi.setSystemTime(Date.now() + ms)
  const create = (description = 'First draft') =>
    planning.createWorkItem('p1', { title: 'Write the brief', description }, human)
  const describe_ = (id: string, description: string, actor: PlanningActor = human) =>
    planning.updateWorkItem(id, { description }, actor)
  const texts = (id: string) => planning.listDescriptionVersions(id).map((version) => version.text)

  it('keeps one version per sitting: many saves within five minutes, then a pause', () => {
    const item = create()
    // The drawer saves about every second while typing.
    for (const text of ['First draft.', 'First draft. More', 'First draft. More words']) {
      wait(1000)
      describe_(item.id, text)
    }
    expect(texts(item.id)).toEqual(['First draft'])
    const [sitting] = planning.listDescriptionVersions(item.id)
    expect(sitting.endedAt - sitting.startedAt).toBe(2000)
    expect(sitting.actor).toMatchObject({ kind: 'human' })

    wait(TEXT_SITTING_GAP_MS + 1)
    describe_(item.id, 'Rewritten')
    expect(texts(item.id)).toEqual(['First draft. More words', 'First draft'])
  })

  it('starts a new version when another actor changes it', () => {
    const item = create()
    describe_(item.id, 'Mine')
    wait(1000)
    describe_(item.id, 'The agent’s', agent)
    wait(1000)
    describe_(item.id, 'The API’s', automation)
    const versions = planning.listDescriptionVersions(item.id)
    expect(versions.map((version) => [version.actor.kind, version.text])).toEqual([
      ['automation', 'The agent’s'],
      ['agent', 'Mine'],
      ['human', 'First draft']
    ])
    expect(versions[0].actor.name).toBeTruthy()
  })

  it('ignores changes that leave the description as it was', () => {
    const item = create()
    planning.updateWorkItem(item.id, { title: 'Renamed', priority: 'high' }, human)
    describe_(item.id, 'First draft')
    expect(planning.listDescriptionVersions(item.id)).toEqual([])
  })

  it(`keeps the newest ${MAX_DESCRIPTION_VERSIONS} versions per task`, () => {
    const item = create('v0')
    const other = create('other')
    describe_(other.id, 'other changed')
    for (let n = 1; n <= MAX_DESCRIPTION_VERSIONS + 5; n += 1) {
      wait(TEXT_SITTING_GAP_MS + 1)
      describe_(item.id, `v${n}`)
    }
    const kept = texts(item.id)
    expect(kept).toHaveLength(MAX_DESCRIPTION_VERSIONS)
    expect(kept[0]).toBe(`v${MAX_DESCRIPTION_VERSIONS + 4}`)
    expect(kept.at(-1)).toBe('v5')
    expect(texts(other.id)).toEqual(['other'])
  })

  it('keeps versions in the recycle bin and deletes them with the task for good', () => {
    const item = create()
    describe_(item.id, 'Second')
    planning.moveWorkItemToBin(item.id, human)
    expect(texts(item.id)).toEqual(['First draft'])
    planning.restoreWorkItem(item.id, human)
    expect(texts(item.id)).toEqual(['First draft'])
    planning.moveWorkItemToBin(item.id, human)
    planning.deleteWorkItem(item.id, human)
    const db = new Database(databasePath, { readonly: true })
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_description_versions').get()).toEqual({
        n: 0
      })
    } finally {
      db.close()
    }
  })

  it('a restore is a change of its own, with its own version, and can be undone', () => {
    const item = create()
    wait(1000)
    describe_(item.id, 'Typed over')
    const [old] = planning.listDescriptionVersions(item.id)
    // Mid-sitting: the restore still keeps the text it replaces.
    wait(1000)
    describe_(item.id, 'Typed over, and more')
    wait(1000)
    const restored = planning.restoreDescriptionVersion(item.id, old.id, human)
    expect(restored.description).toBe('First draft')
    expect(texts(item.id)).toEqual(['Typed over, and more', 'First draft'])
    const changes = planning
      .listActivity('p1', item.id)
      .entries.filter((entry) => entry.field === 'description')
    // Activity keeps its shape: one "description changed" row for the sitting, no text.
    expect(changes).toHaveLength(1)
    expect(JSON.stringify(changes)).not.toContain('Typed over')

    // Undo puts the replaced text back through the same path.
    wait(1000)
    const undone = describe_(item.id, 'Typed over, and more')
    expect(undone.description).toBe('Typed over, and more')
    expect(texts(item.id)).toEqual(['Typed over, and more', 'First draft'])
  })

  it('refuses a version of another task', () => {
    const a = create('a')
    const b = create('b')
    describe_(a.id, 'a2')
    const [version] = planning.listDescriptionVersions(a.id)
    expect(() => planning.restoreDescriptionVersion(b.id, version.id, human)).toThrow(/not found/)
    expect(() => planning.restoreDescriptionVersion(a.id, 'x', human)).toThrow(/not found/)
  })
})
