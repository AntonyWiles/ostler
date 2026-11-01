/**
 * People on the phone: the Team overview (a row per person across projects: open, overdue, due
 * this week, blocked, stalled, time this week, away soon) from the desktop's own
 * `queryTeamOverview`, and Contacts (the address book of suppliers and clients, with the tasks
 * that name them) through the desktop's own `ContactsService`.
 *
 * The phone keeps no search index (no fts5), so a contact changed here is indexed by the PC the
 * next time it reindexes, as for the phone's other edits.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type Database from 'better-sqlite3'
import type { Person, PlanningWorkItem, TeamOverviewRow, WatchedProject } from '@shared/ostler-api'
import type {
  Contact,
  ContactInput,
  ContactTask,
  DeletedContact,
  TaskContact
} from '@shared/contacts'
import { ContactsService } from '../../../electron/services/contacts-service'
import { PeopleRepository } from '../../../electron/services/database/people-repository'
import type { SearchService } from '../../../electron/services/search-service'
import { queryTeamOverview, sqlTeamOverviewDeps } from '../../../electron/services/team-overview'
import { EditRefused, guarded, type EditDb } from './edits'
import { projects, type QueryDb, type TaskSummary } from './queries'

type Db = EditDb & QueryDb

function raw(db: QueryDb): Database.Database {
  return db as unknown as Database.Database
}

/** Everyone in the address book and the projects' own people, archived ones included. */
export function people(db: QueryDb): Person[] {
  return new PeopleRepository(raw(db)).list(true)
}

export interface TeamRow extends TeamOverviewRow {
  person: Person
}

/** The Team overview across every project on the phone, a row per person, by name. */
export function teamOverview(db: QueryDb, today: string): TeamRow[] {
  const everyone = people(db)
  const byId = new Map(everyone.map((person) => [person.id, person]))
  const shaped = projects(db).map(
    (project) => ({ id: project.id, enabled: true }) as unknown as WatchedProject
  )
  return queryTeamOverview(
    raw(db),
    shaped,
    { today },
    sqlTeamOverviewDeps(raw(db), () => everyone)
  )
    .filter((row) => byId.has(row.personId))
    .map((row) => ({ ...row, person: byId.get(row.personId)! }))
}

/** A person's open tasks across projects, the soonest due first. */
export function personTasks(db: QueryDb, personId: string): TaskSummary[] {
  return (
    db
      .prepare(
        `SELECT id, project_id, title, status, priority, target_date, assignee_id
         FROM planning_work_items
         WHERE assignee_id = ? AND status <> 'done' AND deleted_at IS NULL
           AND archived_at IS NULL AND resolution IS NULL AND in_triage = 0
         ORDER BY target_date IS NULL, target_date, title`
      )
      .all(personId) as {
      id: string
      project_id: string
      title: string
      status: TaskSummary['status']
      priority: TaskSummary['priority']
      target_date: string | null
      assignee_id: string | null
    }[]
  ).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    targetDate: row.target_date,
    assigneeId: row.assignee_id
  }))
}

// The phone writes no search index; the PC indexes contacts when it next reindexes.
const NO_INDEX = { indexEntity: () => {}, removeEntity: () => {} } as unknown as SearchService

function contactsService(db: Db): ContactsService {
  return new ContactsService(raw(db), {
    getProjectIds: () => projects(db).map((project) => project.id),
    requireWorkItem: (workItemId) => {
      const row = db
        .prepare(
          'SELECT id, project_id FROM planning_work_items WHERE id = ? AND deleted_at IS NULL'
        )
        .get(workItemId) as { id: string; project_id: string } | undefined
      if (!row) throw new EditRefused('not-found')
      return { id: row.id, projectId: row.project_id } as PlanningWorkItem
    },
    changed: () => {},
    search: NO_INDEX
  })
}

/** Contacts by name, narrowed by words when given. */
export function contacts(db: Db, query = ''): Contact[] {
  return contactsService(db).list(query)
}

export function contact(db: Db, contactId: string): Contact | null {
  try {
    return contactsService(db).get(contactId)
  } catch {
    return null
  }
}

/** The tasks that name a contact, across projects. */
export function contactTasks(db: Db, contactId: string): ContactTask[] {
  return contactsService(db).tasksOf(contactId)
}

/** The contacts a task names, with their roles. */
export function taskContacts(db: Db, taskId: string): TaskContact[] {
  try {
    return contactsService(db).forTask(taskId)
  } catch {
    return []
  }
}

export function addContact(db: Db, input: ContactInput): Contact {
  return guarded(() => contactsService(db).create(input))
}

export function updateContact(db: Db, contactId: string, input: ContactInput): Contact {
  return guarded(() => contactsService(db).update(contactId, input))
}

/** Deletes a contact and its task links; `restoreContact` with the result undoes it. */
export function deleteContact(db: Db, contactId: string): DeletedContact {
  return guarded(() => contactsService(db).delete(contactId))
}

export function restoreContact(db: Db, deleted: DeletedContact): void {
  guarded(() => void contactsService(db).restore(deleted))
}
