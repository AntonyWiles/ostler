import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DaysOffService } from '../../electron/services/days-off-service'
import { PeopleService } from '../../electron/services/people-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const ics = (...events: [string, string][]) =>
  [
    'BEGIN:VCALENDAR',
    ...events.flatMap(([date, name]) => [
      'BEGIN:VEVENT',
      `DTSTART;VALUE=DATE:${date}`,
      `SUMMARY:${name}`,
      'END:VEVENT'
    ]),
    'END:VCALENDAR'
  ].join('\r\n')

describe('DaysOffService (N3.2)', () => {
  const root = useTempDir('ostler-days-off-')
  let people: PeopleService
  let service: DaysOffService
  let samId: string

  beforeEach(async () => {
    const databasePath = await createMigratedDatabase(root())
    people = new PeopleService(databasePath)
    samId = people.create({ name: 'Sam' }).id
    service = new DaysOffService(databasePath, {
      personExists: (id) => people.exists(id),
      today: () => '2026-10-16'
    })
  })

  afterEach(() => {
    service.close()
    people.close()
  })

  it('adds, edits, lists by range and person, and removes and restores', () => {
    const xmas = service.create({ firstDate: '2026-12-25', name: ' Christmas Day ' })
    expect(xmas).toMatchObject({ personId: null, lastDate: '2026-12-25', name: 'Christmas Day' })
    const leave = service.create({
      personId: samId,
      firstDate: '2026-08-03',
      lastDate: '2026-08-14',
      name: 'Leave'
    })
    expect(service.list({ from: '2026-08-10', to: '2026-08-10' })).toEqual([leave])
    expect(service.list({ personId: samId }).map((day) => day.name)).toEqual([
      'Leave',
      'Christmas Day'
    ])
    expect(service.update(xmas.id, { name: 'Christmas' }).name).toBe('Christmas')
    // Moving a single day keeps it a single day.
    expect(service.update(xmas.id, { firstDate: '2027-12-25' })).toMatchObject({
      firstDate: '2027-12-25',
      lastDate: '2027-12-25'
    })
    const removed = service.remove(leave.id)
    expect(service.list()).toHaveLength(1)
    service.restore([removed])
    expect(service.get(leave.id)).toMatchObject({ name: 'Leave', personId: samId })
  })

  it('refuses a bad date, a backwards range, no name and an unknown person', () => {
    expect(() => service.create({ firstDate: '25/12/2026', name: 'X' })).toThrow(/2026-12-25/)
    expect(() =>
      service.create({ firstDate: '2026-12-25', lastDate: '2026-12-24', name: 'X' })
    ).toThrow(/before the first/)
    expect(() => service.create({ firstDate: '2026-12-25', name: ' ' })).toThrow(/name/)
    expect(() =>
      service.create({ firstDate: '2026-12-25', name: 'X', personId: 'nobody' })
    ).toThrow(/Person not found/)
    expect(() =>
      service.create({ firstDate: '2026-01-01', lastDate: '2027-06-01', name: 'X' })
    ).toThrow(/366/)
  })

  it('keeps an archived person’s days off', () => {
    service.create({ personId: samId, firstDate: '2026-08-03', name: 'Leave' })
    people.archive(samId)
    expect(service.list({ personId: samId })).toHaveLength(1)
  })

  it('previews an import without writing, then replaces the same file’s days when loaded again', () => {
    const first = ics(['20261225', 'Christmas Day'], ['20261228', 'Boxing Day'])
    const preview = service.importFile(
      { fileName: 'C:\\Users\\me\\england.ics', text: first },
      { dryRun: true }
    )
    expect(preview).toMatchObject({ fileName: 'england.ics', replacedCount: 0, personId: null })
    expect(preview.days).toHaveLength(2)
    expect(service.list()).toEqual([])

    service.importFile({ fileName: 'england.ics', text: first })
    service.create({ firstDate: '2026-12-31', name: 'By hand' })
    const again = service.importFile({
      fileName: 'england.ics',
      text: ics(['20270101', 'New Year'])
    })
    expect(again.replacedCount).toBe(2)
    expect(again.replaced.map((day) => day.name)).toEqual(['Christmas Day', 'Boxing Day'])
    expect(service.list().map((day) => day.name)).toEqual(['By hand', 'New Year'])
  })

  it('imports for one person, and removes a file’s days', () => {
    const result = service.importFile({
      fileName: 'sam.ics',
      text: ics(['20260803', 'Holiday']),
      personId: samId
    })
    expect(result.added[0]).toMatchObject({ personId: samId, sourceFile: 'sam.ics' })
    service.create({ firstDate: '2026-12-25', name: 'Christmas Day' })
    const removed = service.removeFile('sam.ics')
    expect(removed).toHaveLength(1)
    expect(service.list().map((day) => day.name)).toEqual(['Christmas Day'])
  })

  it('keeps the same file name loaded for two people, and replaces only the same person’s load', () => {
    const alexId = people.create({ name: 'Alex' }).id
    const team = ics(['20260803', 'Away'])
    service.importFile({ fileName: 'team.ics', text: team, personId: samId })
    // The same name for someone else is another load: both are kept.
    const alex = service.importFile({ fileName: 'team.ics', text: team, personId: alexId })
    expect(alex.replacedCount).toBe(0)
    expect(
      service
        .list()
        .map((day) => day.personId)
        .sort()
    ).toEqual([alexId, samId].sort())
    // For everyone it is a third load, and the preview says it replaces nothing.
    expect(
      service.importFile({ fileName: 'team.ics', text: team }, { dryRun: true }).replacedCount
    ).toBe(0)
    service.importFile({ fileName: 'team.ics', text: team })
    expect(service.list()).toHaveLength(3)

    // The same name for the same person (or for everyone again) replaces that load only.
    const samAgain = service.importFile({
      fileName: 'team.ics',
      text: ics(['20260810', 'Away again']),
      personId: samId
    })
    expect(samAgain.replaced.map((day) => day.personId)).toEqual([samId])
    const everyoneAgain = service.importFile({ fileName: 'team.ics', text: team })
    expect(everyoneAgain.replaced.map((day) => day.personId)).toEqual([null])
    expect(service.list()).toHaveLength(3)

    // Removing one load leaves the others; with no person given, every load of the file goes.
    expect(service.removeFile('team.ics', alexId).map((day) => day.personId)).toEqual([alexId])
    expect(service.removeFile('team.ics', null).map((day) => day.personId)).toEqual([null])
    expect(service.list().map((day) => [day.personId, day.name])).toEqual([[samId, 'Away again']])
    service.importFile({ fileName: 'team.ics', text: team, personId: alexId })
    expect(service.removeFile('team.ics')).toHaveLength(2)
    expect(service.list()).toEqual([])
  })

  it('refuses to import a file with nothing to add', () => {
    expect(() => service.importFile({ fileName: 'x.ics', text: ics() })).toThrow(/no all-day/)
    expect(() => service.importFile({ fileName: 'x.ics', text: 'nope' })).toThrow(/not a calendar/)
  })
})
