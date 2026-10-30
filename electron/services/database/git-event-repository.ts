import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { GitCommit } from '@shared/ostler-api'

interface GitEventRow {
  id: string
  project_id: string
  timestamp: number
  hash: string
  abbreviated_hash: string
  author: string
  message: string
  body: string
  date: string
  files_changed: number
  insertions: number
  deletions: number
  branch: string
}

/** Persistence for observed Git commits. */
export class GitEventRepository {
  constructor(private readonly db: Database.Database) {}
  /**
   * Inserts a git commit event
   */
  insert(projectId: string, commit: GitCommit & { branch: string }): void {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO git_events (id, project_id, timestamp, hash, abbreviated_hash, author, message, body, date, files_changed, insertions, deletions, branch)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, hash) DO UPDATE SET
          timestamp=excluded.timestamp,
          abbreviated_hash=excluded.abbreviated_hash,
          author=excluded.author,
          message=excluded.message,
          body=excluded.body,
          date=excluded.date,
          files_changed=excluded.files_changed,
          insertions=excluded.insertions,
          deletions=excluded.deletions,
          branch=excluded.branch
      `)
      stmt.run(
        uuidv4(),
        projectId,
        Date.parse(commit.date) || Date.now(),
        commit.hash,
        commit.abbreviatedHash || commit.hash.substring(0, 7),
        commit.author,
        commit.message,
        commit.body || '',
        commit.date,
        commit.filesChanged || 0,
        commit.insertions || 0,
        commit.deletions || 0,
        commit.branch
      )
    } catch (error) {
      console.error('Failed to insert git event:', error)
    }
  }

  /**
   * Retrieves the latest commit hash for a project
   */
  getLatestHash(projectId: string): string | null {
    try {
      const stmt = this.db.prepare(`
        SELECT hash FROM git_events
        WHERE project_id = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `)
      const row = stmt.get(projectId) as { hash: string } | undefined
      return row ? row.hash : null
    } catch (error) {
      console.error('Failed to get latest git hash:', error)
      return null
    }
  }

  /**
   * Retrieves recent git events for a project
   */
  list(projectId: string, limit: number): GitCommit[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM git_events
        WHERE project_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `)
      const rows = stmt.all(projectId, limit) as GitEventRow[]
      return rows.map((row) => ({
        hash: row.hash,
        abbreviatedHash: row.abbreviated_hash || (row.hash ? row.hash.substring(0, 7) : ''),
        message: row.message,
        body: row.body || '',
        author: row.author,
        date: row.date || new Date(row.timestamp).toISOString(),
        filesChanged: row.files_changed,
        insertions: row.insertions,
        deletions: row.deletions
      }))
    } catch (error) {
      console.error('Failed to get git events:', error)
      return []
    }
  }
}
