import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { SessionTranscript } from '@shared/ostler-api'

export interface HarnessEventRecord {
  id: string
  project_id: string
  timestamp: number
  event_type: string
  agent_session_id: string
  agent_title: string
  details: string
}

interface TranscriptRow {
  project_id: string
  session_id: string
  received_at: number
  entries: string
}

/** Persistence for harness audit events and externally submitted session transcripts. */
export class HarnessRepository {
  constructor(private readonly db: Database.Database) {}

  insertTranscript(transcript: SessionTranscript): void {
    this.db
      .prepare(
        'INSERT INTO session_transcripts (id, project_id, session_id, received_at, entries) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        uuidv4(),
        transcript.projectId,
        transcript.sessionId,
        Date.parse(transcript.receivedAt),
        JSON.stringify(transcript.entries)
      )
  }

  /**
   * Makes `transcript` the session's only stored transcript. A running
   * embedded session is snapshotted repeatedly so a crash keeps its history;
   * inserting each snapshot would pile up full copies of the same entries.
   */
  replaceTranscript(transcript: SessionTranscript): void {
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM session_transcripts WHERE project_id = ? AND session_id = ?')
        .run(transcript.projectId, transcript.sessionId)
      this.insertTranscript(transcript)
    })()
  }

  getTranscript(projectId: string, sessionId: string): SessionTranscript | null {
    const row = this.db
      .prepare(
        'SELECT project_id, session_id, received_at, entries FROM session_transcripts WHERE project_id = ? AND session_id = ? ORDER BY received_at DESC LIMIT 1'
      )
      .get(projectId, sessionId) as TranscriptRow | undefined
    return row ? this.toTranscript(row) : null
  }

  listTranscripts(projectId: string, limit: number): SessionTranscript[] {
    const rows = this.db
      .prepare(
        'SELECT project_id, session_id, received_at, entries FROM session_transcripts WHERE project_id = ? ORDER BY received_at DESC LIMIT ?'
      )
      .all(projectId, limit) as TranscriptRow[]
    return rows.flatMap((row) => this.toTranscript(row) ?? [])
  }

  insertEvent(event: {
    id: string
    projectId: string
    timestamp: number
    eventType: string
    agentSessionId: string
    agentTitle: string
    details: string
  }): void {
    this.db
      .prepare(
        `INSERT INTO harness_events
         (id, project_id, timestamp, event_type, agent_session_id, agent_title, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.projectId,
        event.timestamp,
        event.eventType,
        event.agentSessionId,
        event.agentTitle,
        event.details
      )
  }

  listEvents(projectId: string, limit: number): HarnessEventRecord[] {
    return this.db
      .prepare('SELECT * FROM harness_events WHERE project_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(projectId, limit) as HarnessEventRecord[]
  }

  private toTranscript(row: TranscriptRow): SessionTranscript | null {
    try {
      return {
        projectId: row.project_id,
        sessionId: row.session_id,
        receivedAt: new Date(row.received_at).toISOString(),
        entries: JSON.parse(row.entries) as SessionTranscript['entries']
      }
    } catch {
      return null
    }
  }
}
