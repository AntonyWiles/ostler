import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import { SignOffService } from '../../electron/services/sign-off-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/*
 * Sign-offs (D9): any of a task, decision or milestone can be put to a named person; only they
 * answer; a task or milestone waiting for sign-off cannot be finished on this PC; a deleted
 * item takes its sign-offs with it.
 */

const PROJECT = 'p1'
const ME = 'person-me'
const ANA = 'person-ana'
const human = { kind: 'human' } as const

describe('sign-offs', () => {
  const tempDir = useTempDir('ostler-sign-offs-')
  let databasePath: string
  let planning: PlanningService
  let signOffs: SignOffService
  let raw: Database.Database

  beforeEach(async () => {
    databasePath = await createMigratedDatabase(tempDir())
    raw = new Database(databasePath)
    raw
      .prepare(
        `INSERT INTO people (id, name, initials, color, is_me, created_at, updated_at)
         VALUES (?, 'Me', 'M', '#000', 1, 1, 1), (?, 'Ana', 'A', '#000', 0, 1, 1)`
      )
      .run(ME, ANA)
    planning = new PlanningService(databasePath, () => [PROJECT])
    signOffs = new SignOffService(databasePath, {
      projectIds: () => [PROJECT],
      reopenTask: (taskId) => planning.updateWorkItem(taskId, { status: 'active' }, human),
      reopenMilestone: (id) => planning.updateMilestone(id, { status: 'active' })
    })
  })

  afterEach(() => {
    signOffs.close()
    planning.close()
    raw.close()
  })

  const task = (title = 'Paint hall') => planning.createWorkItem(PROJECT, { title }, human)
  const milestone = () => planning.createMilestone(PROJECT, { name: 'Launch' })
  const decision = () =>
    planning.createDecision(PROJECT, { title: 'Use blue', decision: 'Blue it is' })
  /** Another person answers: switch which person is Me, as another PC would have. */
  const actAs = (id: string) => {
    raw.prepare('UPDATE people SET is_me = 0 WHERE id != ?').run(id)
    raw.prepare('UPDATE people SET is_me = 1 WHERE id = ?').run(id)
  }

  it('asks a named person about a task, a decision and a milestone', () => {
    const items = [
      { kind: 'task', id: task().id },
      { kind: 'decision', id: decision().id },
      { kind: 'milestone', id: milestone().id }
    ] as const
    for (const item of items) {
      const created = signOffs.request({ item, approverPersonId: ANA })
      expect(created).toMatchObject({
        itemKind: item.kind,
        itemId: item.id,
        approverPersonId: ANA,
        requestedByPersonId: ME,
        state: 'waiting'
      })
      expect(signOffs.forItem(item)).toHaveLength(1)
    }
    expect(signOffs.waitingFor(ANA)).toHaveLength(3)
  })

  it('refuses a second open request to the same person for the same item', () => {
    const item = { kind: 'task', id: task().id } as const
    signOffs.request({ item, approverPersonId: ANA })
    expect(() => signOffs.request({ item, approverPersonId: ANA })).toThrow()
  })

  it('lets only the approver approve or send back', () => {
    const item = { kind: 'decision', id: decision().id } as const
    const created = signOffs.request({ item, approverPersonId: ANA })
    expect(() => signOffs.approve(created.id)).toThrow()
    expect(() => signOffs.sendBack(created.id, 'No')).toThrow()
    actAs(ANA)
    const approved = signOffs.approve(created.id)
    expect(approved.state).toBe('approved')
    expect(approved.answeredAt).not.toBeNull()
    expect(() => signOffs.approve(created.id)).toThrow()
  })

  it('sending a done task back moves it out of Done', () => {
    const made = task()
    signOffs.request({ item: { kind: 'task', id: made.id }, approverPersonId: ANA })
    // Waiting, it cannot be finished.
    expect(() => planning.updateWorkItem(made.id, { status: 'done' }, human)).toThrow()
    const [waiting] = signOffs.forItem({ kind: 'task', id: made.id })
    actAs(ANA)
    signOffs.approve(waiting.id)
    actAs(ME)
    planning.updateWorkItem(made.id, { status: 'done' }, human)
    signOffs.request({ item: { kind: 'task', id: made.id }, approverPersonId: ANA })
    // A fresh request on a done task: the approver sends it back.
    const [again] = signOffs.waitingFor(ANA)
    actAs(ANA)
    const sent = signOffs.sendBack(again.id, 'Needs a second coat')
    expect(sent).toMatchObject({ state: 'changes', note: 'Needs a second coat' })
    expect(statusOf(made.id)).not.toBe('done')
  })

  const statusOf = (id: string) =>
    (
      raw.prepare('SELECT status FROM planning_work_items WHERE id = ?').get(id) as {
        status: string
      }
    ).status

  it('a milestone waiting for sign-off cannot be completed', () => {
    const made = milestone()
    const created = signOffs.request({
      item: { kind: 'milestone', id: made.id },
      approverPersonId: ANA
    })
    expect(() => planning.updateMilestone(made.id, { status: 'complete' })).toThrow()
    actAs(ANA)
    signOffs.approve(created.id)
    actAs(ME)
    expect(planning.updateMilestone(made.id, { status: 'complete' }).status).toBe('complete')
  })

  it('cancelling removes a waiting request, by the requester only', () => {
    const item = { kind: 'task', id: task().id } as const
    const created = signOffs.request({ item, approverPersonId: ANA })
    signOffs.cancel(created.id)
    expect(signOffs.forItem(item)).toEqual([])
  })

  it('deleting an item deletes its sign-offs', () => {
    const made = task()
    const m = milestone()
    const d = decision()
    for (const item of [
      { kind: 'task', id: made.id },
      { kind: 'milestone', id: m.id },
      { kind: 'decision', id: d.id }
    ] as const)
      signOffs.request({ item, approverPersonId: ANA })
    planning.deleteWorkItem(made.id, human)
    planning.deleteMilestone(m.id)
    planning.deleteDecision(d.id)
    expect(raw.prepare('SELECT COUNT(*) AS n FROM planning_sign_offs').get()).toEqual({ n: 0 })
  })

  it('removing a whole project deletes its sign-offs', () => {
    signOffs.request({ item: { kind: 'task', id: task().id }, approverPersonId: ANA })
    deleteProjectRows(raw, PROJECT)
    expect(raw.prepare('SELECT COUNT(*) AS n FROM planning_sign_offs').get()).toEqual({ n: 0 })
  })
})
