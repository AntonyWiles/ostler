import Database from 'better-sqlite3'
import { attachChangeRecorder } from './change-history/recorder'

/**
 * Following (team-leaders plan, D8): which tasks Me follows, to hear when someone else changes
 * them. Personal: the rows travel only between the person's own devices. An explicit unfollow
 * keeps its row with `following = 0`, so an automatic follow never brings the task back.
 */
export class FollowService {
  private readonly db: Database.Database

  constructor(
    dbPath: string,
    private readonly now: () => number = Date.now
  ) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    attachChangeRecorder(this.db)
  }

  close(): void {
    this.db.close()
  }

  isFollowing(taskId: string): boolean {
    const row = this.db
      .prepare('SELECT following FROM task_follows WHERE work_item_id = ?')
      .get(taskId) as { following: number } | undefined
    return row?.following === 1
  }

  /** Follows the task now, whatever was chosen before (the person asked). */
  follow(projectId: string, taskId: string): void {
    this.db
      .prepare(
        `INSERT INTO task_follows (work_item_id, project_id, followed_at, following)
         VALUES (@taskId, @projectId, @now, 1)
         ON CONFLICT (work_item_id) DO UPDATE SET following = 1, followed_at = @now`
      )
      .run({ taskId, projectId, now: this.now() })
  }

  /** Stops following, and keeps the choice so an automatic follow does not undo it. */
  unfollow(projectId: string, taskId: string): void {
    this.db
      .prepare(
        `INSERT INTO task_follows (work_item_id, project_id, followed_at, following)
         VALUES (@taskId, @projectId, @now, 0)
         ON CONFLICT (work_item_id) DO UPDATE SET following = 0`
      )
      .run({ taskId, projectId, now: this.now() })
  }

  /** Follows when nothing was chosen yet for the task; never overrides a follow or an unfollow. */
  autoFollow(projectId: string, taskId: string): void {
    autoFollowTask(this.db, projectId, taskId, this.now())
  }

  /** Which of these tasks are followed. */
  followedIn(taskIds: readonly string[]): Set<string> {
    const followed = new Set<string>()
    for (let start = 0; start < taskIds.length; start += 500) {
      const chunk = taskIds.slice(start, start + 500)
      const rows = this.db
        .prepare(
          `SELECT work_item_id FROM task_follows WHERE following = 1
           AND work_item_id IN (${chunk.map(() => '?').join(', ')})`
        )
        .all(...chunk) as { work_item_id: string }[]
      for (const row of rows) followed.add(row.work_item_id)
    }
    return followed
  }
}

/**
 * The automatic follow on any connection. Planning writes it on its own, so a follow made inside
 * one of its transactions joins it instead of waiting on the write lock from a second connection.
 */
export function autoFollowTask(
  db: Database.Database,
  projectId: string,
  taskId: string,
  now: number
): void {
  db.prepare(
    `INSERT OR IGNORE INTO task_follows (work_item_id, project_id, followed_at, following)
     VALUES (?, ?, ?, 1)`
  ).run(taskId, projectId, now)
}
