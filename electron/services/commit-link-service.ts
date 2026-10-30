import type Database from 'better-sqlite3'
import type { PlanningWorkItemStatus, TaskCommit } from '@shared/ostler-api'
import { findCommitTaskMentions } from '@shared/commit-task-ids'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'

/** What linking reads of a commit: its hash and its message. */
export interface LinkableCommit {
  hash: string
  /** The first line. */
  message: string
  body?: string
}

/** A new commit that says it fixes an open task: what the Inbox offers Mark as done for. */
export interface CommitFixOffer {
  linkId: number
  projectId: string
  workItemId: string
  taskTitle: string
  taskNumber: number
  status: PlanningWorkItemStatus
  abbreviatedHash: string
  offeredAt: number
}

/**
 * Smart commits (N9.8b, N66): links tasks to the commits whose messages name
 * their IDs. Every way a commit arrives (new commits seen by the watcher, the
 * first history import, the one-time reading of commits stored before this
 * feature) goes through `link`, in one transaction per batch, one insert per
 * link. Only new commits may offer Mark as done, and Ostler never changes a
 * status here: the Inbox offers it, and the person's choice goes through the
 * normal status change.
 */
export class CommitLinkService {
  constructor(
    private readonly db: Database.Database,
    /** The project's task prefix (N9.8a), read on every batch so a changed one applies at once. */
    private readonly getTaskPrefix: (projectId: string) => string | null,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Links a batch of commits to the tasks they name. IDs of tasks that do not
   * exist are ignored; a link already made is kept as it is. With `offer`, a
   * commit that fixes an open task is offered for Mark as done, except an
   * Apply entry (its subject is the task's own title: Apply already finished
   * the task). Returns how many links were made.
   */
  link(projectId: string, commits: LinkableCommit[], options: { offer: boolean }): number {
    const prefix = this.getTaskPrefix(projectId)
    if (!prefix || commits.length === 0) return 0
    const findTask = this.db.prepare(
      'SELECT id, title, status FROM planning_work_items WHERE project_id = ? AND number = ?'
    )
    const insert = this.db.prepare(
      `INSERT INTO task_commit_links (project_id, work_item_id, commit_hash, kind, found_at, offered_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(work_item_id, commit_hash) DO NOTHING`
    )
    const at = this.now()
    let made = 0
    this.db.transaction(() => {
      for (const commit of commits) {
        for (const mention of findCommitTaskMentions(prefix, commit.message, commit.body ?? '')) {
          const task = findTask.get(projectId, mention.number) as
            { id: string; title: string; status: PlanningWorkItemStatus } | undefined
          if (!task) continue
          const offered =
            options.offer &&
            mention.kind === 'fixes' &&
            task.status !== 'done' &&
            commit.message.trim() !== task.title.trim()
          made += insert.run(
            projectId,
            task.id,
            commit.hash,
            mention.kind,
            at,
            offered ? at : null
          ).changes
        }
      }
    })()
    return made
  }

  /**
   * Reads every commit already stored for the project once (the first start
   * after this feature, or a project's first history import), linking without
   * offering anything. Later calls do nothing.
   */
  linkStoredOnce(projectId: string): boolean {
    const scanned = this.db
      .prepare('SELECT 1 FROM commit_link_scans WHERE project_id = ?')
      .get(projectId)
    if (scanned) return false
    const commits = this.db
      .prepare('SELECT hash, message, body FROM git_events WHERE project_id = ?')
      .all(projectId) as { hash: string; message: string; body: string | null }[]
    this.link(
      projectId,
      commits.map((row) => ({ hash: row.hash, message: row.message, body: row.body ?? '' })),
      { offer: false }
    )
    this.db
      .prepare(
        'INSERT INTO commit_link_scans (project_id, scanned_at) VALUES (?, ?) ON CONFLICT DO NOTHING'
      )
      .run(projectId, this.now())
    return true
  }

  /** A task's linked commits, newest first, with "fixes" marked. */
  listForWorkItem(projectId: string, workItemId: string): TaskCommit[] {
    if (typeof workItemId !== 'string' || workItemId === '')
      throw new Refusal(t('errors:commitLinks.taskNotFound'))
    const task = this.db
      .prepare('SELECT 1 FROM planning_work_items WHERE id = ? AND project_id = ?')
      .get(workItemId, projectId)
    if (!task) throw new Refusal(t('errors:commitLinks.taskNotFound'))
    const rows = this.db
      .prepare(
        `SELECT link.commit_hash, link.kind, git.abbreviated_hash, git.message, git.author, git.date,
                git.timestamp
         FROM task_commit_links link
         JOIN git_events git ON git.project_id = link.project_id AND git.hash = link.commit_hash
         WHERE link.work_item_id = ? AND link.project_id = ?
         ORDER BY git.timestamp DESC, link.id DESC`
      )
      .all(workItemId, projectId) as {
      commit_hash: string
      kind: 'mention' | 'fixes'
      abbreviated_hash: string | null
      message: string
      author: string
      date: string | null
      timestamp: number
    }[]
    return rows.map((row) => ({
      hash: row.commit_hash,
      abbreviatedHash: row.abbreviated_hash || row.commit_hash.slice(0, 7),
      subject: row.message,
      author: row.author,
      date: row.date || new Date(row.timestamp).toISOString(),
      fixes: row.kind === 'fixes'
    }))
  }

  /** Offers still standing: their task open (not done, archived or in the recycle bin). */
  openOffers(projectIds: string[]): CommitFixOffer[] {
    if (projectIds.length === 0) return []
    const rows = this.db
      .prepare(
        `SELECT link.id, link.project_id, link.work_item_id, link.offered_at, link.commit_hash,
                git.abbreviated_hash, item.title, item.number, item.status
         FROM task_commit_links link
         JOIN planning_work_items item ON item.id = link.work_item_id
         LEFT JOIN git_events git ON git.project_id = link.project_id AND git.hash = link.commit_hash
         WHERE link.offered_at IS NOT NULL AND item.status <> 'done'
           AND item.archived_at IS NULL AND item.deleted_at IS NULL
           AND link.project_id IN (${projectIds.map(() => '?').join(', ')})`
      )
      .all(...projectIds) as {
      id: number
      project_id: string
      work_item_id: string
      offered_at: number
      commit_hash: string
      abbreviated_hash: string | null
      title: string
      number: number
      status: PlanningWorkItemStatus
    }[]
    return rows.map((row) => ({
      linkId: row.id,
      projectId: row.project_id,
      workItemId: row.work_item_id,
      taskTitle: row.title,
      taskNumber: row.number,
      status: row.status,
      abbreviatedHash: row.abbreviated_hash || row.commit_hash.slice(0, 7),
      offeredAt: row.offered_at
    }))
  }
}
