import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { ChangeHistoryService } from '../../electron/services/change-history/history-service'
import { recordChanges } from '../../electron/services/change-history/context'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const P1 = '0f8fad5b-d9cb-469f-a165-70867728950e'
const human = { kind: 'human' as const }

describe('undo history', () => {
  const tempDir = useTempDir('ostler-change-history-')
  let planning: PlanningService
  let history: ChangeHistoryService
  let clock: number
  let undone: string[]

  beforeEach(async () => {
    const dbPath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(dbPath, () => [P1])
    clock = Date.now()
    undone = []
    history = new ChangeHistoryService(dbPath, {
      getProjectIds: () => [P1],
      keepDays: () => 30,
      afterUndo: (rows) => undone.push(...rows.map((row) => row.table)),
      changed: () => {},
      now: () => clock
    })
  })

  afterEach(() => {
    history.close()
    planning.close()
  })

  /** One step, as one IPC call makes it. */
  const step = <T>(channel: string, run: () => T) => recordChanges(channel, async () => run())

  it('records a call from a window as one step and nothing from outside one', async () => {
    const task = await step('create', () =>
      planning.createWorkItem(P1, { title: 'Buy paint' }, human)
    )
    planning.updateWorkItem(task.id, { title: 'Not recorded' }, human)
    const { entries } = history.list()
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe('change')
    expect(entries[0].projectId).toBe(P1)
    expect(entries[0].subjects[0]).toMatchObject({
      kind: 'task',
      id: task.id,
      name: 'Buy paint',
      action: 'added'
    })
  })

  it('undoes one old step without undoing a later change to another field', async () => {
    const task = await step('create', () => planning.createWorkItem(P1, { title: 'Paint' }, human))
    await step('rename', () => planning.updateWorkItem(task.id, { title: 'Paint the hall' }, human))
    clock += 10 * 60_000
    await step('priority', () => planning.updateWorkItem(task.id, { priority: 'high' }, human))
    const rename = history
      .list()
      .entries.find((entry) => entry.subjects[0].fields.includes('title'))!

    const result = await step('undo', () => history.undo(rename.id))
    expect(result.reverted).toBe(1)
    expect(result.kept).toBe(0)
    const now = planning.getWorkItem(task.id)
    expect(now.title).toBe('Paint')
    expect(now.priority).toBe('high')
    expect(result.entry?.kind).toBe('undo')
    expect(history.get(rename.id)?.undoneById).toBe(result.entry?.id)
    expect(undone).toContain('planning_work_items')
  })

  it('keeps a value something changed later, and says so', async () => {
    const task = await step('create', () => planning.createWorkItem(P1, { title: 'One' }, human))
    await step('rename', () => planning.updateWorkItem(task.id, { title: 'Two' }, human))
    clock += 10 * 60_000
    await step('rename-again', () => planning.updateWorkItem(task.id, { title: 'Three' }, human))
    const renames = history.list().entries.filter((entry) => entry.subjects[0].action === 'changed')
    const first = renames[renames.length - 1]
    const result = await step('undo', () => history.undo(first.id))
    expect(result.kept).toBe(1)
    expect(planning.getWorkItem(task.id).title).toBe('Three')
  })

  it('redoes by undoing the undo, and Undo and Redo follow the newest step', async () => {
    const task = await step('create', () => planning.createWorkItem(P1, { title: 'A' }, human))
    await step('rename', () => planning.updateWorkItem(task.id, { title: 'B' }, human))
    expect(history.head().undo?.subjects[0].fields).toContain('title')

    await step('undo', () => history.undoLatest())
    expect(planning.getWorkItem(task.id).title).toBe('A')
    expect(history.head().redo?.kind).toBe('undo')

    const redo = await step('redo', () => history.redoLatest())
    expect(redo.entry?.kind).toBe('redo')
    expect(planning.getWorkItem(task.id).title).toBe('B')
    expect(history.head().redo).toBeNull()
  })

  it('brings a deleted task back with its comments', async () => {
    const task = await step('create', () =>
      planning.createWorkItem(P1, { title: 'Keep me' }, human)
    )
    await step('comment', () => planning.addComment(task.id, 'Remember the primer', human))
    await step('delete', () => planning.deleteWorkItem(task.id, human))
    expect(() => planning.getWorkItem(task.id)).toThrow()

    const removal = history.list().entries[0]
    expect(removal.subjects.find((subject) => subject.id === task.id)?.action).toBe('removed')
    await step('undo', () => history.undo(removal.id))
    expect(planning.getWorkItem(task.id).title).toBe('Keep me')
    expect(planning.listComments(task.id).map((comment) => comment.body)).toEqual([
      'Remember the primer'
    ])
  })

  it('undoes adding a task by removing it', async () => {
    const task = await step('create', () => planning.createWorkItem(P1, { title: 'Oops' }, human))
    await step('undo', () => history.undoLatest())
    expect(() => planning.getWorkItem(task.id)).toThrow()
  })

  it('joins edits to the same thing in a row into one step', async () => {
    const task = await step('create', () => planning.createWorkItem(P1, { title: 'T' }, human))
    await step('edit', () => planning.updateWorkItem(task.id, { description: 'a' }, human))
    await step('edit', () => planning.updateWorkItem(task.id, { description: 'ab' }, human))
    await step('edit', () => planning.updateWorkItem(task.id, { description: 'abc' }, human))
    expect(history.list().entries).toHaveLength(2)
    await step('undo', () => history.undoLatest())
    expect(planning.getWorkItem(task.id).description ?? '').toBe('')
  })

  it('refuses to undo the same step twice', async () => {
    const task = await step('create', () => planning.createWorkItem(P1, { title: 'T' }, human))
    await step('rename', () => planning.updateWorkItem(task.id, { title: 'U' }, human))
    const rename = history.head().undo!
    await step('undo', () => history.undo(rename.id))
    await expect(step('undo', () => history.undo(rename.id))).rejects.toThrow(/already undone/)
  })

  it('forgets a step with its undo, clears and prunes', async () => {
    const task = await step('create', () => planning.createWorkItem(P1, { title: 'T' }, human))
    await step('rename', () => planning.updateWorkItem(task.id, { title: 'U' }, human))
    const rename = history.head().undo!
    await step('undo', () => history.undo(rename.id))
    expect(history.delete(rename.id)).toBe(2)
    expect(history.list().entries).toHaveLength(1)
    expect(planning.getWorkItem(task.id).title).toBe('T')

    clock += 31 * 24 * 60 * 60_000
    expect(history.prune()).toBe(1)
    expect(history.stats().entries).toBe(0)
  })

  it("leaves a view's kept settings out, and records a named view", async () => {
    const config = { filter: { match: 'all' as const, conditions: [] }, query: '', options: {} }
    await step('default', () => planning.views.setDefault(P1, 'board', config))
    expect(history.list().entries).toHaveLength(0)
    await step('named', () =>
      planning.views.create(P1, { name: 'Blocked', viewType: 'list', config })
    )
    expect(history.list().entries[0].subjects[0]).toMatchObject({
      kind: 'savedView',
      name: 'Blocked',
      action: 'added'
    })
  })

  it('lists by search and pages with a cursor', async () => {
    for (const title of ['Alpha', 'Beta', 'Gamma'])
      await step(`create-${title}`, () => planning.createWorkItem(P1, { title }, human))
    expect(history.list({ search: 'beta' }).entries).toHaveLength(1)
    const first = history.list({ limit: 2 })
    expect(first.entries).toHaveLength(2)
    const second = history.list({ limit: 2, before: first.nextBefore! })
    expect(second.entries).toHaveLength(1)
    expect(second.nextBefore).toBeNull()
  })

  it('shows what a step changed, before and after', async () => {
    const task = await step('create', () => planning.createWorkItem(P1, { title: 'Old' }, human))
    await step('rename', () => planning.updateWorkItem(task.id, { title: 'New' }, human))
    const details = history.details(history.head().undo!.id)
    expect(details).toContainEqual(
      expect.objectContaining({ field: 'title', action: 'changed', before: 'Old', after: 'New' })
    )
  })

  it('names what an id points to in the details', async () => {
    const milestone = planning.createMilestone(P1, { name: 'Launch' })
    const task = await step('create', () => planning.createWorkItem(P1, { title: 'Ship' }, human))
    clock += 10 * 60_000
    await step('milestone', () =>
      planning.updateWorkItem(task.id, { milestoneId: milestone.id }, human)
    )
    const details = history.details(history.head().undo!.id)
    expect(details).toContainEqual(
      expect.objectContaining({ field: 'milestone_id', before: null, after: 'Launch' })
    )
  })
})
