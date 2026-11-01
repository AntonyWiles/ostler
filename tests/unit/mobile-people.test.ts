import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditDb } from '../../mobile/src/data/edits'
import type { QueryDb } from '../../mobile/src/data/queries'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { createMigratedDatabase } = await import('../helpers/database')
const people = await import('../../mobile/src/data/people')

// Team and contacts on the phone: the desktop's queryTeamOverview and ContactsService.

const human = { kind: 'human' as const }
const PROJECT = 'p1'

describe('team and contacts on the phone', () => {
  const tempDir = useTempDir('ostler-mobile-people-')
  let db: Database.Database
  const ids: Record<string, string> = {}

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 16, 10, 0))
    const path = await createMigratedDatabase(tempDir())
    const planning = new PlanningService(path, () => [PROJECT])
    const peopleService = new PeopleService(path)
    ids.sam = peopleService.create({ name: 'Sam Example' }).id
    ids.riley = peopleService.create({ name: 'Riley Test' }).id
    ids.late = planning.createWorkItem(
      PROJECT,
      { title: 'Fit sink', assigneeId: ids.sam, targetDate: '2026-10-10' },
      human
    ).id
    ids.soon = planning.createWorkItem(
      PROJECT,
      { title: 'Paint hall', assigneeId: ids.sam, targetDate: '2026-10-17' },
      human
    ).id
    planning.close()
    peopleService.close()
    db = new Database(path)
  })

  afterEach(() => {
    db.close()
    vi.useRealTimers()
  })

  const phone = () => db as unknown as EditDb & QueryDb

  it('lists each person with work and what needs attention', () => {
    const rows = people.teamOverview(phone(), '2026-10-16')
    const sam = rows.find((row) => row.personId === ids.sam)!
    expect(sam).toMatchObject({ open: 2, overdue: 1, dueThisWeek: 1, projectIds: [PROJECT] })
    expect(sam.person.name).toBe('Sam Example')
    expect(people.personTasks(phone(), ids.sam).map((task) => task.title)).toEqual([
      'Fit sink',
      'Paint hall'
    ])
  })

  it('adds, finds, deletes and restores a contact', () => {
    const made = people.addContact(phone(), {
      name: 'Pat Plumber',
      organisation: 'Pipes Ltd',
      phones: [{ label: '', number: '+44 20 7946 0018' }],
      emails: ['pat@example.com']
    })
    expect(people.contacts(phone(), 'pipes').map((contact) => contact.id)).toEqual([made.id])
    expect(people.contacts(phone(), 'nobody')).toEqual([])
    const gone = people.deleteContact(phone(), made.id)
    expect(people.contact(phone(), made.id)).toBeNull()
    people.restoreContact(phone(), gone)
    expect(people.contact(phone(), made.id)?.emails).toEqual(['pat@example.com'])
    // The phone never writes the search index (it has no fts5).
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM search_index WHERE entity_type = 'contact'").get()
    ).toEqual({ n: 0 })
  })
})
