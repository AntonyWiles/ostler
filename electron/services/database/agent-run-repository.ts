import type Database from 'better-sqlite3'
import type {
  AgentRunRecord,
  AgentRunRecordOutcome,
  HarnessSessionProvenance
} from '@shared/ostler-api'

interface AgentRunRow {
  session_id: string
  project_id: string
  task_id: string | null
  title: string
  provenance: string
  model: string | null
  effort: string | null
  started_at: number
  ended_at: number
  outcome: string
  ended_as: string
  detail: string
  stalls: number
  nudges: number
  guidance: number
  commits: number | null
  files_changed: number | null
  input_tokens: number | null
  output_tokens: number | null
  usage_reported: number
}

/** A run as the harness state describes it; commits and files may be filled in later. */
export type AgentRunInput = Omit<AgentRunRecord, 'durationMs'>

/**
 * The run history (R5.3, D43), in `agent_runs`. A run's row is written when
 * it ends and rewritten as its review moves on; when it ended, and how, stay
 * as first written, and so do commits and files once Git has filled them in.
 */
export class AgentRunRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(run: AgentRunInput, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO agent_runs (session_id, project_id, task_id, title, provenance, model, effort,
           started_at, ended_at, outcome, ended_as, detail, stalls, nudges, guidance, commits,
           files_changed, input_tokens, output_tokens, usage_reported, updated_at)
         VALUES (@sessionId, @projectId, @taskId, @title, @provenance, @model, @effort, @startedAt,
           @endedAt, @outcome, @endedAs, @detail, @stalls, @nudges, @guidance, @commits,
           @filesChanged, @inputTokens, @outputTokens, @usageReported, @now)
         ON CONFLICT(session_id) DO UPDATE SET
           task_id = excluded.task_id,
           title = excluded.title,
           model = COALESCE(excluded.model, agent_runs.model),
           effort = COALESCE(excluded.effort, agent_runs.effort),
           outcome = excluded.outcome,
           detail = excluded.detail,
           stalls = MAX(excluded.stalls, agent_runs.stalls),
           nudges = MAX(excluded.nudges, agent_runs.nudges),
           guidance = MAX(excluded.guidance, agent_runs.guidance),
           commits = COALESCE(agent_runs.commits, excluded.commits),
           files_changed = COALESCE(agent_runs.files_changed, excluded.files_changed),
           input_tokens = COALESCE(excluded.input_tokens, agent_runs.input_tokens),
           output_tokens = COALESCE(excluded.output_tokens, agent_runs.output_tokens),
           usage_reported = CASE WHEN excluded.input_tokens IS NULL AND excluded.output_tokens IS NULL
             THEN agent_runs.usage_reported ELSE excluded.usage_reported END,
           updated_at = excluded.updated_at`
      )
      .run({
        ...run,
        usageReported: run.usageReported ? 1 : 0,
        now
      })
  }

  /** Inserts a run only when it has no row yet: the history backfill at start-up. */
  insertMissing(run: AgentRunInput, now = Date.now()): boolean {
    if (this.has(run.sessionId)) return false
    this.upsert(run, now)
    return true
  }

  has(sessionId: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM agent_runs WHERE session_id = ?').get(sessionId) !== undefined
    )
  }

  /** Commits and files changed, read from Git after the run ended. */
  setWork(sessionId: string, commits: number, filesChanged: number): void {
    this.db
      .prepare('UPDATE agent_runs SET commits = ?, files_changed = ? WHERE session_id = ?')
      .run(commits, filesChanged, sessionId)
  }

  list(projectId: string): AgentRunRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_runs WHERE project_id = ? ORDER BY started_at DESC')
      .all(projectId) as AgentRunRow[]
    return rows.map(toRecord)
  }

  /** Built-in runs started at or after `since`, for the limits. */
  listEmbeddedSince(projectId: string, since: number): AgentRunRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_runs WHERE project_id = ? AND provenance = 'embedded' AND started_at >= ?`
      )
      .all(projectId, since) as AgentRunRow[]
    return rows.map(toRecord)
  }
}

function toRecord(row: AgentRunRow): AgentRunRecord {
  return {
    sessionId: row.session_id,
    projectId: row.project_id,
    taskId: row.task_id,
    title: row.title,
    provenance: row.provenance as HarnessSessionProvenance,
    model: row.model,
    effort: row.effort,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: Math.max(0, row.ended_at - row.started_at),
    outcome: row.outcome as AgentRunRecordOutcome,
    endedAs: row.ended_as as AgentRunRecordOutcome,
    detail: row.detail,
    stalls: row.stalls,
    nudges: row.nudges,
    guidance: row.guidance,
    commits: row.commits,
    filesChanged: row.files_changed,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    usageReported: row.usage_reported === 1
  }
}
