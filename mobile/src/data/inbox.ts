/**
 * The phone's Inbox: the desktop's own `InboxService` over the phone's database, with the sources
 * that read only synced tables (reminders that fired, mentions of Me, sign-offs asked of Me, To
 * triage and open blockers). Read and archived state lives in `inbox_state`, which syncs, so an
 * item read or archived on one device is read or archived on the other.
 *
 * Left out, because each needs state only the PC has: agent questions, reviews and plans, token
 * limits, scheduled runs, imports, rule notices, commit links, updates, backups and the weekly
 * review. Snoozing is left out too: it reschedules the reminder, and only the PC delivers them.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type Database from 'better-sqlite3'
import type { InboxList, WatchedProject } from '@shared/ostler-api'
import { InboxService } from '../../../electron/services/inbox-service'
import {
  blockerSource,
  mentionSource,
  reminderSource,
  signOffSource,
  triageSource
} from '../../../electron/services/inbox-sources'
import { projects, type QueryDb } from './queries'
import type { EditDb } from './edits'

/** What the Inbox needs of a database; `OstlerDatabase` and better-sqlite3 both fit. */
export type InboxDb = QueryDb & EditDb

/**
 * The projects on the phone, shaped as the sources expect. A project on the phone is one the
 * person joined, so it counts as enabled; the phone does not know a project's stage.
 */
function phoneProjects(db: InboxDb, nameOf: (projectId: string) => string): WatchedProject[] {
  return projects(db).map(
    (project) =>
      ({ id: project.id, name: nameOf(project.id), enabled: true }) as unknown as WatchedProject
  )
}

export interface PhoneInboxOptions {
  /** A project's name, for the items' lines ("Due today · House"); the screen passes the phone's. */
  projectName?: (projectId: string) => string
  now?: () => number
}

/** An Inbox over the phone's database. Cheap to make: it holds no state of its own. */
export function phoneInbox(db: InboxDb, options: PhoneInboxOptions = {}): InboxService {
  const now = options.now ?? Date.now
  const nameOf = options.projectName ?? (() => '')
  // The sources and the service ask only for prepare/run/get/all/transaction, which both fit.
  const raw = db as unknown as Database.Database
  const getProjects = () => phoneProjects(db, nameOf)
  const inbox = new InboxService(raw, now)
  inbox.registerSource('reminders', reminderSource(raw, getProjects))
  inbox.registerSource('mentions', mentionSource(raw, getProjects, now))
  inbox.registerSource('signOffs', signOffSource(raw, getProjects))
  inbox.registerSource('triage', triageSource(raw, getProjects))
  inbox.registerSource('blockers', blockerSource(raw, getProjects))
  return inbox
}

/** The Inbox as it stands: items not archived, newest first, and how many are unread. */
export function inboxList(db: InboxDb, options: PhoneInboxOptions = {}): InboxList {
  return phoneInbox(db, options).list()
}
