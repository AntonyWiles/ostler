import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { markAsDuplicate } from '../../electron/services/planning-deletion'
import { PeopleService } from '../../electron/services/people-service'
import { createMigratedDatabase } from '../helpers/database'
import type { PlanningWorkItem, WatchedProject } from '@shared/ostler-api'
import { useTempDir } from '../helpers/temp-dir'

const human = { kind: 'human' as const }
const project = { id: 'p1', name: 'One' } as WatchedProject

describe('Links between tasks (N2.4)', () => {
  const tempDir = useTempDir('ostler-task-links-')
  let planning: PlanningService
  let databasePath: string

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 7, 10, 0))
    databasePath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(databasePath, () => ['p1', 'p2'])
  })

  afterEach(() => {
    planning.close()
    vi.useRealTimers()
  })

  const create = (title: string, extra: Record<string, unknown> = {}, projectId = 'p1') =>
    planning.createWorkItem(projectId, { title, ...extra }, human)
  /** Moves the clock on, so links made one after another keep their order. */
  const tick = () => vi.setSystemTime(Date.now() + 1000)
  const roles = (item: PlanningWorkItem) =>
    planning.listWorkItemLinks(item.id).map((link) => [link.role, link.otherTitle])
  const summaries = (item: PlanningWorkItem) =>
    planning
      .listActivity('p1', item.id)
      .entries.filter((entry) => entry.field === 'linked' || entry.field === 'unlinked')
      .map((entry) => entry.summary)

  it('adds each kind and reads it from both ends with the right words', () => {
    const a = create('Login fails')
    const b = create('Sign-in broken')
    const c = create('Write the guide')
    planning.addWorkItemLink(b.id, a.id, 'duplicates', human)
    tick()
    planning.addWorkItemLink(a.id, c.id, 'relates', human)
    tick()
    planning.addWorkItemLink(c.id, b.id, 'copied-from', human)

    expect(roles(a)).toEqual([
      ['duplicated-by', 'Sign-in broken'],
      ['relates', 'Write the guide']
    ])
    expect(roles(b)).toEqual([
      ['duplicate-of', 'Login fails'],
      ['copied-to', 'Write the guide']
    ])
    expect(roles(c)).toEqual([
      ['relates', 'Login fails'],
      ['copied-from', 'Sign-in broken']
    ])
    const [link] = planning.listWorkItemLinks(b.id)
    expect(link).toMatchObject({
      kind: 'duplicates',
      otherWorkItemId: a.id,
      otherStatus: 'backlog',
      otherClosed: false
    })
    // Activity on both tasks, worded from each end.
    expect(summaries(b).at(-1)).toMatch(/added a link: Duplicate of “Login fails”/)
    expect(summaries(a).at(-1)).toMatch(/added a link: Duplicated by “Sign-in broken”/)
  })

  it('removes a link from either end, with activity on both', () => {
    const a = create('A')
    const b = create('B')
    const link = planning.addWorkItemLink(a.id, b.id, 'relates', human)
    tick()
    planning.removeWorkItemLink(b.id, link.id, human)
    expect(planning.listWorkItemLinks(a.id)).toEqual([])
    // Newest first.
    expect(summaries(a)[0]).toMatch(/removed a link: Relates to “B”/)
    expect(summaries(b)[0]).toMatch(/removed a link: Relates to “A”/)
    expect(() => planning.removeWorkItemLink(a.id, link.id, human)).toThrow(/not found/)
  })

  it('refuses a link to itself, to another project, an unknown kind and a pair twice', () => {
    const a = create('A')
    const b = create('B')
    const other = create('Elsewhere', {}, 'p2')
    expect(() => planning.addWorkItemLink(a.id, a.id, 'relates', human)).toThrow(/itself/)
    expect(() => planning.addWorkItemLink(a.id, other.id, 'relates', human)).toThrow(/same project/)
    expect(() => planning.addWorkItemLink(a.id, b.id, 'blocks', human)).toThrow(/kind of link/)
    planning.addWorkItemLink(a.id, b.id, 'relates', human)
    expect(() => planning.addWorkItemLink(a.id, b.id, 'relates', human)).toThrow(/already/)
    expect(() => planning.addWorkItemLink(b.id, a.id, 'relates', human)).toThrow(/already/)
    // Another kind between the same pair is a different link.
    planning.addWorkItemLink(b.id, a.id, 'duplicates', human)
    expect(planning.listWorkItemLinks(a.id)).toHaveLength(2)
  })

  it('removes a task’s links when it is deleted for good', () => {
    const a = create('A')
    const b = create('B')
    planning.addWorkItemLink(a.id, b.id, 'relates', human)
    planning.deleteWorkItem(a.id, human)
    expect(planning.listWorkItemLinks(b.id)).toEqual([])
    expect(planning.listProjectLinks('p1')).toEqual([])
  })

  it('never touches dates, waits-on or readiness', () => {
    const a = create('A', { startDate: '2026-10-10', targetDate: '2026-10-12' })
    const b = create('B', { startDate: '2026-10-01', targetDate: '2026-10-20' })
    for (const kind of ['relates', 'duplicates', 'copied-from'] as const)
      planning.addWorkItemLink(a.id, b.id, kind, human)
    const after = planning.getWorkItem(a.id)
    expect(after.dependencyIds).toEqual([])
    expect(after.startDate).toBe('2026-10-10')
    expect(after.targetDate).toBe('2026-10-12')
    expect(planning.unmetDependencyCount('p1', a.id)).toBe(0)
    expect(planning.unmetDependencyCount('p1', b.id)).toBe(0)
    expect('links' in after).toBe(false)
  })

  describe('Mark as duplicate', () => {
    it('links to the original and closes as won’t do with the reason', () => {
      const original = create('Login fails')
      const duplicate = create('Sign-in broken', { status: 'active' })
      const result = markAsDuplicate(planning, undefined, project, duplicate.id, original.id, human)
      expect(result.workItem).toMatchObject({
        resolution: 'wont-do',
        resolutionReason: 'Duplicate of Login fails',
        status: 'active'
      })
      expect(result.link.role).toBe('duplicate-of')
      expect(roles(original)).toEqual([['duplicated-by', 'Sign-in broken']])
      expect(planning.listWorkItemLinks(original.id)[0].otherClosed).toBe(true)
    })

    it('refuses a done task and changes nothing', () => {
      const original = create('Original')
      const done = create('Done one', { status: 'done' })
      expect(() =>
        markAsDuplicate(planning, undefined, project, done.id, original.id, human)
      ).toThrow(/done/)
      expect(planning.getWorkItem(done.id).resolution).toBeNull()
      expect(planning.listWorkItemLinks(done.id)).toEqual([])
    })

    it('refuses a bad original before closing anything', () => {
      const task = create('Task')
      expect(() => markAsDuplicate(planning, undefined, project, task.id, task.id, human)).toThrow(
        /itself/
      )
      expect(planning.getWorkItem(task.id).archivedAt).toBeNull()
    })

    it('undo reverses both: reopen and remove the link', () => {
      const original = create('Original')
      const duplicate = create('Duplicate')
      const result = markAsDuplicate(planning, undefined, project, duplicate.id, original.id, human)
      // What the toast's undo does.
      planning.unarchiveWorkItem(duplicate.id, human)
      planning.removeWorkItemLink(duplicate.id, result.link.id, human)
      expect(planning.getWorkItem(duplicate.id)).toMatchObject({
        resolution: null,
        archivedAt: null
      })
      expect(planning.listWorkItemLinks(original.id)).toEqual([])
    })

    it('allows a duplicate of a duplicate, without following the chain', () => {
      const first = create('First')
      const second = create('Second')
      const third = create('Third')
      markAsDuplicate(planning, undefined, project, second.id, first.id, human)
      markAsDuplicate(planning, undefined, project, third.id, second.id, human)
      expect(roles(third)).toEqual([['duplicate-of', 'Second']])
      expect(roles(first)).toEqual([['duplicated-by', 'Second']])
    })
  })

  describe('Copy task', () => {
    it('copies exactly the listed fields, in Backlog at the end, and links back', () => {
      const field = planning.createField('p1', { name: 'Size', type: 'number' })
      const people = new PeopleService(databasePath)
      const person = people.create({ name: 'Alex' })
      people.close()
      const milestone = planning.createMilestone('p1', { name: 'M1', outcome: '' })
      const iteration = planning.iterations.create('p1', {
        name: 'Sprint 4',
        startDate: '2026-10-05',
        endDate: '2026-10-16'
      })
      const blocker = create('Something first')
      const source = create('Write the guide', {
        description: 'All of it',
        status: 'active',
        priority: 'high',
        labels: ['docs'],
        acceptanceCriteria: ['Outline', 'Draft'],
        assigneeId: person.id,
        estimate: 3,
        startDate: '2026-10-08',
        targetDate: '2026-10-10',
        showFrom: '2026-10-07',
        fieldValues: { [field.id]: 5 },
        milestoneId: milestone.id,
        iterationId: iteration.id,
        dependencyIds: [blocker.id]
      })
      planning.setChecklistItemChecked(source.id, 'Outline', true, human)
      planning.addComment(source.id, 'A comment', human)
      tick()
      const last = create('Last so far')

      const { workItem: copy, link } = planning.copyWorkItem(source.id, human)

      expect(copy).toMatchObject({
        title: 'Write the guide (copy)',
        description: 'All of it',
        status: 'backlog',
        priority: 'high',
        labels: ['docs'],
        acceptanceCriteria: ['Outline', 'Draft'],
        checkedCriteria: [],
        assigneeId: person.id,
        estimate: 3,
        startDate: '2026-10-08',
        targetDate: '2026-10-10',
        showFrom: '2026-10-07',
        fieldValues: { [field.id]: 5 },
        // The milestone and iteration come too: the copy is part of the same plan.
        milestoneId: milestone.id,
        iterationId: iteration.id,
        dependencyIds: [],
        linkedHarnessTaskId: null
      })
      expect(copy.orderKey! > planning.getWorkItem(last.id).orderKey!).toBe(true)
      expect(planning.listComments(copy.id)).toEqual([])
      expect(link.role).toBe('copied-from')
      expect(roles(source)).toEqual([['copied-to', 'Write the guide (copy)']])
      // A create like any other.
      const created = planning
        .listActivity('p1', copy.id)
        .entries.filter((entry) => entry.field === 'created')
      expect(created).toHaveLength(1)
    })
  })
})
