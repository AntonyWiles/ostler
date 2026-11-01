/**
 * The weekly review on the phone: the desktop's own `WeeklyReviewService` over the phone's
 * database, so each step lists exactly what it lists on the PC (overdue, blocked for a while, not
 * touched in two weeks, Someday, the next two weeks, milestones at risk). A finished review is a
 * row of `weekly_reviews`, which syncs with the person's other devices.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type Database from 'better-sqlite3'
import type { WatchedProject, WeeklyReview, WeeklyReviewRecord } from '@shared/ostler-api'
import { buildProjectReport } from '../../../electron/services/report-builder'
import { WeeklyReviewService } from '../../../electron/services/weekly-review-service'
import { inboxList, type InboxDb } from './inbox'
import { projectReportInputs, projects, type QueryDb } from './queries'

export interface PhoneProjectInfo {
  name: (projectId: string) => string
  color: (projectId: string) => string
}

function meId(db: QueryDb): string | null {
  const row = db.prepare('SELECT id FROM people WHERE is_me = 1').get() as
    { id: string } | undefined
  return row?.id ?? null
}

/** A weekly review over the phone's database. Cheap to make: it holds no state of its own. */
export function phoneWeeklyReview(
  db: InboxDb & QueryDb,
  info: PhoneProjectInfo,
  now: () => number = Date.now
): WeeklyReviewService {
  return new WeeklyReviewService({
    db: db as unknown as Database.Database,
    // A project on the phone is one the person joined, so it counts as enabled.
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
    inboxCount: () => inboxList(db).items.length,
    // The at-risk milestones from the project's report, built as the phone builds its status.
    atRisk: (project) => {
      const inputs = projectReportInputs(db, project.id)
      return buildProjectReport({
        projectId: project.id,
        range: '30d',
        items: inputs.items,
        history: inputs.history,
        milestones: inputs.milestones,
        people: inputs.people,
        estimateUnit: 'points',
        now: now()
      }).atRisk
    },
    now
  })
}

/** Every step's list for `today`. */
export function weeklyReview(
  db: InboxDb & QueryDb,
  info: PhoneProjectInfo,
  today: string
): WeeklyReview {
  return phoneWeeklyReview(db, info).getReview({ today })
}

/** Records a finished review with each step's counts; the PC's Home shows when it was. */
export function finishWeeklyReview(
  db: InboxDb & QueryDb,
  info: PhoneProjectInfo,
  steps: WeeklyReviewRecord['steps']
): WeeklyReviewRecord {
  return phoneWeeklyReview(db, info).finish(steps)
}

/** The last finished review, from any device, or null. */
export function lastWeeklyReview(
  db: InboxDb & QueryDb,
  info: PhoneProjectInfo
): WeeklyReviewRecord | null {
  return phoneWeeklyReview(db, info).last()
}
