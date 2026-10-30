import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROJECT, SimWorld, addTask, syncEveryone, type SimPc } from '../helpers/sync-simulation'

/*
 * Sign-offs (D9): the request travels like any other row, but only the approver's own PC can
 * answer it, whatever the approver's role, and every receiving PC skips an answer from anyone
 * else, an Editor or Owner included.
 */

describe('sign-offs travel, and only the approver answers', () => {
  let world: SimWorld
  let a: SimPc // Owner
  let b: SimPc // Viewer, the approver
  let c: SimPc // Editor
  let d: SimPc // Contributor

  const ask = (pc: SimPc, id: string, kind: string, itemId: string, approver: string) =>
    pc.db
      .prepare(
        `INSERT INTO planning_sign_offs
           (id, project_id, item_kind, item_id, approver_person_id, requested_by_person_id,
            state, note, requested_at, answered_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'waiting', '', 1, NULL, 1)`
      )
      .run(id, PROJECT, kind, itemId, approver, pc.me.personId)

  const answer = (pc: SimPc, id: string, state: string, note = '') =>
    pc.db
      .prepare(
        'UPDATE planning_sign_offs SET state = ?, note = ?, answered_at = 5, updated_at = 5 WHERE id = ?'
      )
      .run(state, note, id)

  const stateOn = (pc: SimPc, id: string) =>
    pc.db.prepare('SELECT state FROM planning_sign_offs WHERE id = ?').get(id) as
      { state: string } | undefined

  beforeEach(async () => {
    world = new SimWorld()
    a = await world.pc('A')
    b = await world.pc('B')
    c = await world.pc('C')
    d = await world.pc('D')
    const folder = path.join(world.dir, 'shared')
    await a.share(folder)
    await b.join(a.service.invite(PROJECT, 'viewer') as string, folder)
    await c.join(a.service.invite(PROJECT, 'editor') as string, folder)
    await d.join(a.service.invite(PROJECT, 'contributor') as string, folder)
    a.db
      .prepare(
        `INSERT INTO planning_decisions (id, project_id, title, decision, date, origin, created_at, updated_at)
         VALUES ('dec-1', ?, 'Use blue', 'Blue', '2026-10-01', 'human', 1, 1)`
      )
      .run(PROJECT)
    a.db
      .prepare(
        `INSERT INTO planning_milestones (id, project_id, name, status, created_at, updated_at)
         VALUES ('ms-1', ?, 'Launch', 'planned', 1, 1)`
      )
      .run(PROJECT)
    addTask(a, 'task-1', 'Paint hall')
    await syncEveryone([a, b, c, d])
  })

  afterEach(async () => {
    await world.close()
  })

  it('a Viewer approves a decision asked of them and every PC applies it', async () => {
    ask(a, 'so-1', 'decision', 'dec-1', b.me.personId)
    await syncEveryone([a, b, c, d])
    expect(stateOn(b, 'so-1')?.state).toBe('waiting')

    answer(b, 'so-1', 'approved')
    await syncEveryone([a, b, c, d])
    for (const pc of [a, b, c, d]) expect(stateOn(pc, 'so-1')?.state).toBe('approved')
  })

  it('an Editor cannot answer a sign-off addressed to the Viewer: it is skipped as not-allowed', async () => {
    ask(a, 'so-2', 'decision', 'dec-1', b.me.personId)
    await syncEveryone([a, b, c, d])

    // The Editor's PC lets them write it (an Editor may change anything); every other PC refuses it.
    answer(c, 'so-2', 'approved', 'Looks fine')
    await syncEveryone([a, b, c, d])
    for (const pc of [a, b, d]) expect(stateOn(pc, 'so-2')?.state).toBe('waiting')
    expect(a.errors).toEqual([])
  })

  it("an Editor's request on a milestone arrives everywhere", async () => {
    ask(c, 'so-3', 'milestone', 'ms-1', b.me.personId)
    await syncEveryone([a, b, c, d])
    for (const pc of [a, b, c, d]) expect(stateOn(pc, 'so-3')?.state).toBe('waiting')
  })

  it("a Contributor's request on someone else's task is refused by their own PC", async () => {
    expect(() => ask(d, 'so-4', 'task', 'task-1', b.me.personId)).toThrow(/contributor-only/)
    await syncEveryone([a, b, c, d])
    expect(stateOn(a, 'so-4')).toBeUndefined()
  })

  it('a Viewer cannot ask for a sign-off, and cannot answer one addressed to someone else', async () => {
    expect(() => ask(b, 'so-5', 'decision', 'dec-1', a.me.personId)).toThrow(/read-only/)
    ask(a, 'so-6', 'decision', 'dec-1', a.me.personId)
    await syncEveryone([a, b, c, d])
    expect(() => answer(b, 'so-6', 'approved')).toThrow(/read-only/)
  })

  it("the approver's pull reports the request, and the requester's pull reports the answer", async () => {
    ask(a, 'so-7', 'task', 'task-1', b.me.personId)
    await syncEveryone([a, b, c, d])
    expect(b.signOffRequested.map((event) => event.signOffId)).toEqual(['so-7'])
    expect(a.signOffRequested).toEqual([])
    expect(a.signOffAnswered).toEqual([])

    answer(b, 'so-7', 'changes', 'Not yet')
    await syncEveryone([a, b, c, d])
    expect(a.signOffAnswered.map((event) => [event.signOffId, event.state])).toEqual([
      ['so-7', 'changes']
    ])
    expect(b.signOffAnswered).toEqual([])
    // Nobody else is told: the Editor neither asked nor was asked.
    expect(c.signOffRequested).toEqual([])
    expect(c.signOffAnswered).toEqual([])
  })
})
