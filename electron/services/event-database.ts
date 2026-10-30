import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import {
  WatchEvent,
  EventQuery,
  EventStats,
  GitCommit,
  AIConversation,
  AIMessage,
  SessionTranscript,
  DatabaseStats
} from '@shared/ostler-api'
import { ChatRepository } from './database/chat-repository'
import { HarnessRepository, type HarnessEventRecord } from './database/harness-repository'
import { WatchEventRepository } from './database/watch-event-repository'
import { GitEventRepository } from './database/git-event-repository'
import { AgentRunRepository } from './database/agent-run-repository'
import { syncedService } from './backup-second-place'

type HarnessEventRow = HarnessEventRecord

interface CountRow {
  count: number
}

interface MinTimeRow {
  minTime: number | null
}

export class EventDatabase {
  private db: Database.Database
  private dbPath: string
  private readonly chatRepository: ChatRepository
  private readonly harnessRepository: HarnessRepository
  private readonly watchEventRepository: WatchEventRepository
  private readonly gitEventRepository: GitEventRepository
  /** The agent run history (R5.3). */
  readonly agentRuns: AgentRunRepository

  /**
   * Opens the event tables in `ostler.db`. The file must already be migrated
   * (`migrateOstlerDatabase`); this class contains no schema.
   * @param dbPath Path to the SQLite database file
   */
  constructor(dbPath: string) {
    this.dbPath = dbPath
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.chatRepository = new ChatRepository(this.db)
    this.harnessRepository = new HarnessRepository(this.db)
    this.watchEventRepository = new WatchEventRepository(this.db)
    this.gitEventRepository = new GitEventRepository(this.db)
    this.agentRuns = new AgentRunRepository(this.db)
  }

  insertSessionTranscript(transcript: SessionTranscript): void {
    this.harnessRepository.insertTranscript(transcript)
  }

  replaceSessionTranscript(transcript: SessionTranscript): void {
    this.harnessRepository.replaceTranscript(transcript)
  }

  getSessionTranscript(projectId: string, sessionId: string): SessionTranscript | null {
    return this.harnessRepository.getTranscript(projectId, sessionId)
  }

  getRecentSessionTranscripts(projectId: string, limit = 20): SessionTranscript[] {
    return this.harnessRepository.listTranscripts(projectId, limit)
  }

  insertWatchEvent(event: WatchEvent): void {
    this.watchEventRepository.insert(event)
  }

  getRecentEvents(query: EventQuery): WatchEvent[] {
    return this.watchEventRepository.list(query)
  }

  getEventStats(projectId: string, windowMs: number): EventStats {
    return this.watchEventRepository.getStats(projectId, windowMs)
  }
  insertGitEvent(projectId: string, commit: GitCommit & { branch: string }): void {
    this.gitEventRepository.insert(projectId, commit)
  }

  getLatestGitHash(projectId: string): string | null {
    return this.gitEventRepository.getLatestHash(projectId)
  }

  getGitEvents(projectId: string, limit: number): GitCommit[] {
    return this.gitEventRepository.list(projectId, limit)
  }
  /**
   * Inserts a test harness agent event
   */
  insertHarnessEvent(event: {
    id: string
    projectId: string
    timestamp: number
    eventType: string
    agentSessionId: string
    agentTitle: string
    details: string
  }): void {
    try {
      this.harnessRepository.insertEvent(event)
    } catch (error) {
      console.error('Failed to insert harness event:', error)
    }
  }

  /**
   * Retrieves recent harness events for a project
   */
  getHarnessEvents(projectId: string, limit: number): HarnessEventRow[] {
    try {
      return this.harnessRepository.listEvents(projectId, limit)
    } catch (error) {
      console.error('Failed to get harness events:', error)
      return []
    }
  }

  /**
   * Creates a new AI conversation
   */
  createConversation(id: string, title: string, projectId: string | null): void {
    try {
      this.chatRepository.create(id, title, projectId)
    } catch (error) {
      console.error('Failed to create conversation:', error)
    }
  }

  /**
   * Retrieves all AI conversations
   */
  getConversations(): AIConversation[] {
    try {
      return this.chatRepository.list()
    } catch (error) {
      console.error('Failed to get conversations:', error)
      return []
    }
  }

  /**
   * Retrieves a single AI conversation by ID
   */
  getConversation(id: string): AIConversation | null {
    try {
      return this.chatRepository.get(id)
    } catch (error) {
      console.error('Failed to get conversation:', error)
      return null
    }
  }

  /**
   * Updates the messages in an AI conversation
   */
  updateConversationMessages(id: string, messages: AIMessage[]): void {
    try {
      this.chatRepository.updateMessages(id, messages)
    } catch (error) {
      console.error('Failed to update conversation messages:', error)
    }
  }

  /**
   * Deletes an AI conversation
   */
  deleteConversation(id: string): void {
    try {
      this.chatRepository.delete(id)
    } catch (error) {
      console.error('Failed to delete conversation:', error)
    }
  }

  /**
   * Prunes old events from the database
   */
  prune(olderThanDays: number): { deletedCount: number } {
    try {
      const threshold = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
      let deletedCount = 0

      this.db.transaction(() => {
        const watchResult = this.db
          .prepare('DELETE FROM watch_events WHERE timestamp < ?')
          .run(threshold)
        const gitResult = this.db
          .prepare('DELETE FROM git_events WHERE timestamp < ?')
          .run(threshold)
        const harnessResult = this.db
          .prepare('DELETE FROM harness_events WHERE timestamp < ?')
          .run(threshold)

        deletedCount = watchResult.changes + gitResult.changes + harnessResult.changes
      })()

      return { deletedCount }
    } catch (error) {
      console.error('Failed to prune database:', error)
      return { deletedCount: 0 }
    }
  }

  /**
   * Gets database statistics
   */
  getStats(): DatabaseStats {
    try {
      const watchCount = (
        this.db.prepare('SELECT COUNT(*) as count FROM watch_events').get() as CountRow
      ).count
      const gitCount = (
        this.db.prepare('SELECT COUNT(*) as count FROM git_events').get() as CountRow
      ).count
      const harnessCount = (
        this.db.prepare('SELECT COUNT(*) as count FROM harness_events').get() as CountRow
      ).count
      const conversationsCount = (
        this.db.prepare('SELECT COUNT(*) as count FROM ai_conversations').get() as CountRow
      ).count

      const oldestWatch = (
        this.db.prepare('SELECT MIN(timestamp) as minTime FROM watch_events').get() as
          MinTimeRow | undefined
      )?.minTime
      const oldestGit = (
        this.db.prepare('SELECT MIN(timestamp) as minTime FROM git_events').get() as
          MinTimeRow | undefined
      )?.minTime
      const oldestEvent = Math.min(oldestWatch ?? Infinity, oldestGit ?? Infinity)

      let sizeBytes = 0
      try {
        if (fs.existsSync(this.dbPath)) {
          sizeBytes = fs.statSync(this.dbPath).size
        }
      } catch {
        sizeBytes = 0
      }

      return {
        sizeBytes,
        watchEventCount: watchCount,
        gitEventCount: gitCount,
        harnessEventCount: harnessCount,
        conversationCount: conversationsCount,
        oldestEvent: oldestEvent === Infinity ? null : oldestEvent,
        syncedBy: syncedService(path.dirname(this.dbPath))
      }
    } catch (error) {
      console.error('Failed to get database stats:', error)
      return {
        sizeBytes: 0,
        watchEventCount: 0,
        gitEventCount: 0,
        harnessEventCount: 0,
        conversationCount: 0,
        oldestEvent: null,
        syncedBy: null
      }
    }
  }

  /**
   * Closes the database connection
   */
  close(): void {
    try {
      this.db.close()
    } catch (error) {
      console.error('Failed to close database:', error)
    }
  }
}
