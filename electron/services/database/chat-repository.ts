import type Database from 'better-sqlite3'
import type { AIConversation, AIMessage } from '@shared/ostler-api'

interface AIConversationRow {
  id: string
  timestamp: number
  project_id: string | null
  title: string
  messages: string
}

/** Persistence for Ostler's reporting-only AI conversations. */
export class ChatRepository {
  constructor(private readonly db: Database.Database) {}

  create(id: string, title: string, projectId: string | null): void {
    this.db
      .prepare(
        `INSERT INTO ai_conversations (id, timestamp, project_id, title, messages)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, Date.now(), projectId, title, '[]')
  }

  list(): AIConversation[] {
    const rows = this.db
      .prepare('SELECT * FROM ai_conversations ORDER BY timestamp DESC')
      .all() as AIConversationRow[]
    return rows.map((row) => this.toConversation(row))
  }

  get(id: string): AIConversation | null {
    const row = this.db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(id) as
      AIConversationRow | undefined
    return row ? this.toConversation(row) : null
  }

  updateMessages(id: string, messages: AIMessage[]): void {
    this.db
      .prepare('UPDATE ai_conversations SET messages = ?, timestamp = ? WHERE id = ?')
      .run(JSON.stringify(messages), Date.now(), id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM ai_conversations WHERE id = ?').run(id)
  }

  private toConversation(row: AIConversationRow): AIConversation {
    return {
      id: row.id,
      timestamp: row.timestamp,
      projectId: row.project_id,
      title: row.title,
      messages: JSON.parse(row.messages || '[]') as AIMessage[]
    }
  }
}
