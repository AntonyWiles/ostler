import type Database from 'better-sqlite3'
import type { GettingStartedProgress } from '@shared/ostler-api'
import {
  GETTING_STARTED_ACTIVITIES,
  gettingStarted,
  type GettingStarted,
  type GettingStartedActivity
} from '@shared/getting-started'

export interface GettingStartedServiceDependencies {
  db: Database.Database
  /** Ids of the projects that count: enabled ones. */
  getProjectIds(): string[]
  aiConfigured(): boolean
  getProgress(): GettingStartedProgress
  saveProgress(progress: GettingStartedProgress): void
}

/**
 * Home's getting-started checklist (P8.1), worked out from real state. A task
 * counts as the person's own unless it came from a template (its `created`
 * change names one, which covers the sample project) or an import, so a
 * ready-made plan never ticks "Create a task" by itself. Tasks made through
 * the automation API count: they are the person's, made another way.
 */
export class GettingStartedService {
  constructor(private readonly deps: GettingStartedServiceDependencies) {}

  read(): GettingStarted {
    const own = this.ownTasks()
    return gettingStarted({
      createdTask: own.created,
      datedTask: own.dated,
      aiConfigured: this.deps.aiConfigured(),
      progress: this.deps.getProgress()
    })
  }

  /** Ticks something the person did. It never unticks. */
  record(activity: GettingStartedActivity): GettingStarted {
    if (!GETTING_STARTED_ACTIVITIES.includes(activity)) {
      throw new Error('Unknown getting-started step')
    }
    const progress = this.deps.getProgress()
    if (!progress[activity]) this.deps.saveProgress({ ...progress, [activity]: true })
    return this.read()
  }

  /** Hides the checklist for good. */
  dismiss(): GettingStarted {
    const progress = this.deps.getProgress()
    if (!progress.dismissed) this.deps.saveProgress({ ...progress, dismissed: true })
    return this.read()
  }

  private ownTasks(): { created: boolean; dated: boolean } {
    const ids = this.deps.getProjectIds()
    if (ids.length === 0) return { created: false, dated: false }
    const row = this.deps.db
      .prepare(
        `SELECT COUNT(*) AS created,
                COALESCE(SUM(CASE WHEN w.target_date IS NOT NULL AND w.target_date <> '' THEN 1 ELSE 0 END), 0) AS dated
           FROM planning_work_items w
          WHERE w.project_id IN (${ids.map(() => '?').join(', ')})
            AND w.import_batch_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM planning_field_changes c
               WHERE c.work_item_id = w.id
                 AND c.field = 'created'
                 AND json_extract(c.metadata, '$.template') IS NOT NULL
            )`
      )
      .get(...ids) as { created: number; dated: number }
    return { created: row.created > 0, dated: row.dated > 0 }
  }
}
