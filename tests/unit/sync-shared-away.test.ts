import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AwaySharingService } from '../../electron/services/away-sharing-service'
import { PROJECT, SimWorld, syncEveryone, type SimPc } from '../helpers/sync-simulation'

/*
 * Shared away days (D6): a person may show the people of a shared project the dates they are
 * away, never the day-off names. Only the person themself writes those rows, on every PC and
 * whatever their role.
 */

const TODAY = '2026-10-14'

describe('shared away days', () => {
  let world: SimWorld
  let a: SimPc
  let b: SimPc
  let awayA: AwaySharingService
  const services: AwaySharingService[] = []

  const awayService = (pc: SimPc) => {
    const service = new AwaySharingService(pc.db.name, {
      projectIds: () => [PROJECT],
      today: () => TODAY
    })
    services.push(service)
    return service
  }

  const addDayOff = (pc: SimPc, id: string, first: string, last: string, name = 'Dentist') =>
    pc.db
      .prepare(
        `INSERT INTO days_off (id, person_id, first_date, last_date, name, source_file, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, 1, 1)`
      )
      .run(id, pc.me.personId, first, last, name)

  const awayRows = (pc: SimPc) =>
    pc.db
      .prepare(
        'SELECT person_id AS personId, first_date AS firstDate, last_date AS lastDate FROM shared_away ORDER BY first_date'
      )
      .all()

  beforeEach(async () => {
    world = new SimWorld()
    a = await world.pc('A')
    b = await world.pc('B')
    const folder = path.join(world.dir, 'shared')
    await a.share(folder)
    // B joins as a Viewer: even so, B may share their own away days.
    await b.join(a.service.invite(PROJECT, 'viewer') as string, folder)
    awayA = awayService(a)
    await syncEveryone([a, b])
  })

  afterEach(async () => {
    for (const service of services.splice(0)) service.close()
    await world.close()
  })

  it('B sees the dates A shares and never the names, and A turning it off removes them', async () => {
    addDayOff(a, 'd1', '2026-10-19', '2026-10-20', 'Dentist')
    addDayOff(a, 'd2', '2026-09-01', '2026-09-02', 'Already over')
    awayA.setShared(PROJECT, true)
    expect(awayA.isShared(PROJECT)).toBe(true)
    await syncEveryone([a, b])

    expect(awayRows(b)).toEqual([
      { personId: a.me.personId, firstDate: '2026-10-19', lastDate: '2026-10-20' }
    ])
    const columns = (
      b.db.prepare('PRAGMA table_info(shared_away)').all() as { name: string }[]
    ).map((column) => column.name)
    expect(columns).not.toContain('name')

    awayA.setShared(PROJECT, false)
    await syncEveryone([a, b])
    expect(awayRows(a)).toEqual([])
    expect(awayRows(b)).toEqual([])
    // The day off itself is still A's.
    expect(a.db.prepare('SELECT COUNT(*) AS n FROM days_off').get()).toEqual({ n: 2 })
  })

  it('follows a change to the day off', async () => {
    addDayOff(a, 'd1', '2026-10-19', '2026-10-20')
    awayA.setShared(PROJECT, true)
    a.db.prepare("UPDATE days_off SET last_date = '2026-10-23' WHERE id = 'd1'").run()
    awayA.reconcile()
    await syncEveryone([a, b])
    expect(awayRows(b)).toEqual([
      { personId: a.me.personId, firstDate: '2026-10-19', lastDate: '2026-10-23' }
    ])
    a.db.prepare("DELETE FROM days_off WHERE id = 'd1'").run()
    awayA.reconcile()
    await syncEveryone([a, b])
    expect(awayRows(b)).toEqual([])
  })

  it('a Viewer can share their own away days', async () => {
    const awayB = awayService(b)
    addDayOff(b, 'd9', '2026-10-21', '2026-10-21')
    awayB.setShared(PROJECT, true)
    await syncEveryone([a, b])
    expect(awayRows(a)).toEqual([
      { personId: b.me.personId, firstDate: '2026-10-21', lastDate: '2026-10-21' }
    ])
    expect(awayA.listOthers({ from: '2026-10-01', through: '2026-10-31' })).toEqual([
      { personId: b.me.personId, firstDate: '2026-10-21', lastDate: '2026-10-21' }
    ])
  })

  it('a Viewer cannot write a row for someone else, and a forged row is skipped on receipt', async () => {
    const insert = (pc: SimPc, id: string, person: string) =>
      pc.db
        .prepare(
          `INSERT INTO shared_away (id, project_id, person_id, first_date, last_date, updated_at)
           VALUES (?, ?, ?, '2026-10-19', '2026-10-20', 1)`
        )
        .run(id, PROJECT, person)
    expect(() => insert(b, 'forged-b', a.me.personId)).toThrow(/read-only/)

    // The Owner's PC writes a row claiming to be B's: B, and every PC, skips it.
    insert(a, 'forged-a', b.me.personId)
    await syncEveryone([a, b])
    expect(awayRows(b)).toEqual([])
  })
})
