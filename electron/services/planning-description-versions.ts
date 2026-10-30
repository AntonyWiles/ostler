import type Database from 'better-sqlite3'
import {
  MAX_DESCRIPTION_VERSIONS,
  type ActivityActor,
  type ActorKind,
  type PlanningActor,
  type PlanningDescriptionVersion
} from '@shared/ostler-api'
import { continuesSitting } from '@shared/planning/sitting'

interface VersionRow {
  id: number
  project_id: string
  work_item_id: string
  text: string
  actor_kind: ActorKind
  actor_person_id: string | null
  rule_name: string | null
  started_at: number
  ended_at: number
}

/**
 * Description history (N2.6, N21): the text a task's description had before
 * each sitting of changes. Owned by `PlanningService`, which calls `keep`
 * inside `updateWorkItem`'s transaction, the one path every surface's
 * description change takes.
 */
export class PlanningDescriptionVersions {
  constructor(
    private readonly db: Database.Database,
    private readonly nameActor: (
      kind: ActorKind,
      personId: string | null,
      ruleName: string | null
    ) => ActivityActor
  ) {}

  /**
   * A description is about to change from `before`. A change in the same
   * sitting as the task's newest version (same actor, within
   * `TEXT_SITTING_GAP_MS` of its end) only moves that version's end: it keeps
   * the text from before the sitting began. Otherwise `before` becomes a new
   * version, and the oldest beyond `MAX_DESCRIPTION_VERSIONS` go.
   * `newVersion` starts one whatever the sitting: a restore is a change of
   * its own.
   */
  keep(
    item: { id: string; projectId: string },
    before: string,
    actor: PlanningActor,
    at: number,
    newVersion = false
  ): void {
    const personId = actor.personId ?? null
    const ruleName = actor.ruleName ?? null
    const last = this.db
      .prepare(
        `SELECT id, actor_kind, actor_person_id, rule_name, ended_at
         FROM planning_description_versions
         WHERE work_item_id = ? ORDER BY ended_at DESC, id DESC LIMIT 1`
      )
      .get(item.id) as
      | Pick<VersionRow, 'id' | 'actor_kind' | 'actor_person_id' | 'rule_name' | 'ended_at'>
      | undefined
    if (
      !newVersion &&
      last &&
      last.actor_kind === actor.kind &&
      last.actor_person_id === personId &&
      last.rule_name === ruleName &&
      continuesSitting(last.ended_at, at)
    ) {
      this.db
        .prepare('UPDATE planning_description_versions SET ended_at = ? WHERE id = ?')
        .run(at, last.id)
      return
    }
    this.db
      .prepare(
        `INSERT INTO planning_description_versions
           (project_id, work_item_id, text, actor_kind, actor_person_id, rule_name, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(item.projectId, item.id, before, actor.kind, personId, ruleName, at, at)
    this.db
      .prepare(
        `DELETE FROM planning_description_versions
         WHERE work_item_id = ? AND id NOT IN (
           SELECT id FROM planning_description_versions
           WHERE work_item_id = ? ORDER BY ended_at DESC, id DESC LIMIT ?
         )`
      )
      .run(item.id, item.id, MAX_DESCRIPTION_VERSIONS)
  }

  /** A task's versions, newest first, with their text, in one query. */
  forWorkItem(workItemId: string): PlanningDescriptionVersion[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM planning_description_versions
         WHERE work_item_id = ? ORDER BY ended_at DESC, id DESC`
      )
      .all(workItemId) as VersionRow[]
    return rows.map((row) => this.toVersion(row))
  }

  get(versionId: number): PlanningDescriptionVersion | null {
    const row = this.db
      .prepare('SELECT * FROM planning_description_versions WHERE id = ?')
      .get(versionId) as VersionRow | undefined
    return row ? this.toVersion(row) : null
  }

  private toVersion(row: VersionRow): PlanningDescriptionVersion {
    return {
      id: row.id,
      projectId: row.project_id,
      workItemId: row.work_item_id,
      text: row.text,
      actor: this.nameActor(row.actor_kind, row.actor_person_id, row.rule_name),
      startedAt: row.started_at,
      endedAt: row.ended_at
    }
  }
}
