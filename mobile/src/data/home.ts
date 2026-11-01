/**
 * The PC's Home lists on the phone: Today (overdue, due today, in progress and new today, assigned
 * to Me or to nobody), the next seven days, and today's My day, from the desktop's own
 * `HomeService` over the phone's database. Agent attention is the PC's, so it is left out.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type Database from 'better-sqlite3'
import type { MyWork, WatchedProject } from '@shared/ostler-api'
import { HomeService } from '../../../electron/services/home-service'
import { projects, type QueryDb } from './queries'

export interface PhoneProjectInfo {
  name: (projectId: string) => string
  color: (projectId: string) => string
}

function meId(db: QueryDb): string | null {
  const row = db.prepare('SELECT id FROM people WHERE is_me = 1').get() as
    { id: string } | undefined
  return row?.id ?? null
}

/** Today, the next seven days and today's My day, across every project on the phone. */
export function myWork(db: QueryDb, info: PhoneProjectInfo, today: string): MyWork {
  const home = new HomeService({
    db: db as unknown as Database.Database,
    // A project on the phone is one the person joined: enabled, at no particular stage.
    getProjects: () =>
      projects(db).map(
        (project) =>
          ({
            id: project.id,
            name: info.name(project.id),
            color: info.color(project.id),
            enabled: true
          }) as unknown as WatchedProject
      ),
    getMeId: () => meId(db),
    agentsOn: () => false,
    agentAttention: () => null
  })
  return home.getMyWork({ today })
}
