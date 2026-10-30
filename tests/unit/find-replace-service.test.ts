import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { undoTextChanges } from '../../src/shared/planning/find-replace'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('electron', () => ({
  Notification: class {
    static isSupported = () => false
  },
  BrowserWindow: class {}
}))

const { PlanningService } = await import('../../electron/services/planning-service')
const { FindReplaceService } = await import('../../electron/services/find-replace-service')
const { createMigratedDatabase } = await import('../helpers/database')

const human = { kind: 'human' as const }
const query = (extra: object = {}) => ({
  projectId: 'p1',
  find: 'Acme',
  replace: 'Apex',
  matchCase: false,
  wholeWords: false,
  includeArchived: false,
  ...extra
})

describe('FindReplaceService (N2.5)', () => {
  const tempDir = useTempDir('ostler-find-replace-')
  let planning: InstanceType<typeof PlanningService>

  beforeEach(async () => {
    const databasePath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(databasePath, () => ['p1', 'p2'])
  })

  afterEach(() => {
    planning.close()
  })

  const service = () => new FindReplaceService(planning)
  const add = (title: string, extra: object = {}, projectId = 'p1') =>
    planning.createWorkItem(projectId, { title, ...extra }, human)

  it('previews this project only, and archived tasks only when asked', () => {
    add('Acme live')
    const archived = add('Acme archived')
    planning.archiveWorkItem(archived.id, human)
    add('Acme elsewhere', {}, 'p2')
    expect(
      service()
        .preview(query())
        .matches.map((m) => m.taskTitle)
    ).toEqual(['Acme live'])
    const all = service().preview(query({ includeArchived: true }))
    expect(all.matches.map((m) => [m.taskTitle, m.archived])).toEqual([
      ['Acme live', false],
      ['Acme archived', true]
    ])
    expect(all.taskCount).toBe(2)
  })

  it('applies in one go, keeps checklist ticks, and undo puts every field back', () => {
    const item = add('Acme invoice', {
      description: 'Ask Acme.',
      acceptanceCriteria: ['Acme signed', 'Filed']
    })
    planning.setChecklistItemChecked(item.id, 'Acme signed', true, human)
    const { matches } = service().preview(query())
    const result = service().apply('p1', 'Apex', matches, human)
    expect(result.skipped).toEqual([])
    const after = planning.getWorkItem(item.id)
    expect(after.title).toBe('Apex invoice')
    expect(after.description).toBe('Ask Apex.')
    expect(after.acceptanceCriteria).toEqual(['Apex signed', 'Filed'])
    expect(after.checkedCriteria).toEqual(['Apex signed'])

    const undone = service().applyChanges('p1', undoTextChanges(result.changed), human)
    expect(undone.skipped).toEqual([])
    const back = planning.getWorkItem(item.id)
    expect(back.title).toBe('Acme invoice')
    expect(back.description).toBe('Ask Acme.')
    expect(back.acceptanceCriteria).toEqual(['Acme signed', 'Filed'])
    expect(back.checkedCriteria).toEqual(['Acme signed'])
  })

  it('records the change in the task activity', () => {
    const item = add('Acme invoice')
    const before = planning.listActivity('p1', item.id).entries.length
    service().apply('p1', 'Apex', service().preview(query()).matches, human)
    expect(planning.listActivity('p1', item.id).entries.length).toBeGreaterThan(before)
  })

  it('skips a task changed since the preview', () => {
    const changed = add('Call Acme')
    const kept = add('Email Acme')
    const { matches } = service().preview(query())
    planning.updateWorkItem(changed.id, { title: 'Phone Acme' }, human)
    const result = service().apply('p1', 'Apex', matches, human)
    expect(result.changed.map((change) => change.id)).toEqual([kept.id])
    expect(result.skipped).toEqual([{ id: changed.id, title: 'Phone Acme', reason: 'changed' }])
    expect(planning.getWorkItem(changed.id).title).toBe('Phone Acme')
  })

  it('undo skips a task edited again, never overwriting the newer edit', () => {
    const item = add('Call Acme')
    const result = service().apply('p1', 'Apex', service().preview(query()).matches, human)
    planning.updateWorkItem(item.id, { title: 'Call Apex today' }, human)
    const undone = service().applyChanges('p1', undoTextChanges(result.changed), human)
    expect(undone.skipped).toEqual([{ id: item.id, title: 'Call Apex today', reason: 'changed' }])
    expect(planning.getWorkItem(item.id).title).toBe('Call Apex today')
  })

  it('applies by match id for the automation API', () => {
    add('Acme and Acme')
    const [, second] = service().preview(query()).matches
    const result = service().applyIds(query(), [second!.id, 'nope'], human)
    expect(result.changed[0]!.to.title).toBe('Acme and Apex')
    expect(result.skipped).toEqual([{ id: 'nope', title: '', reason: 'changed' }])
  })

  it('renames one checklist item with its tick', () => {
    const item = add('T', { acceptanceCriteria: ['One', 'Two'] })
    planning.setChecklistItemChecked(item.id, 'Two', true, human)
    const renamed = planning.renameChecklistItem(item.id, 'Two', 'Second', human)
    expect(renamed.acceptanceCriteria).toEqual(['One', 'Second'])
    expect(renamed.checkedCriteria).toEqual(['Second'])
    expect(planning.getWorkItem(item.id).checkedCriteria).toEqual(['Second'])
    expect(() => planning.renameChecklistItem(item.id, 'One', 'Second', human)).toThrow()
  })

  it('finds in 5,000 tasks quickly', () => {
    planning.runInTransaction(() => {
      for (let index = 0; index < 5000; index += 1)
        add(`Task ${index} for Acme`, { description: 'Talk to acme about it' })
    })
    const started = performance.now()
    const preview = service().preview(query())
    expect(preview.matches).toHaveLength(5000)
    expect(preview.truncated).toBe(true)
    expect(performance.now() - started).toBeLessThan(2000)
  }, 30_000) // Making 5,000 tasks is the slow part; the preview is timed above.
})
