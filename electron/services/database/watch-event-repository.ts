import type Database from 'better-sqlite3'
import type {
  EventQuery,
  EventStats,
  FileCategory,
  FileChangeType,
  WatchEvent
} from '@shared/ostler-api'

const ALL_CATEGORIES: FileCategory[] = [
  'source',
  'style',
  'markup',
  'config',
  'documentation',
  'build',
  'test',
  'media',
  'dependency',
  'other'
]
const ALL_TYPES: FileChangeType[] = ['add', 'change', 'unlink', 'addDir', 'unlinkDir']

interface WatchEventRow {
  id: string
  project_id: string
  timestamp: number
  type: string
  relative_path: string
  extension: string
  size_bytes: number | null
  category: string
}
/** Persistence and aggregate queries for watched filesystem events. */
export class WatchEventRepository {
  constructor(private readonly db: Database.Database) {}
  /**
   * Inserts a file system watch event
   */
  insert(event: WatchEvent): void {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO watch_events (id, project_id, timestamp, type, relative_path, extension, size_bytes, category)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      stmt.run(
        event.id,
        event.projectId,
        event.timestamp,
        event.type,
        event.relativePath,
        event.extension || '',
        event.sizeBytes || null,
        event.category
      )
    } catch (error) {
      console.error('Failed to insert watch event:', error)
    }
  }

  /**
   * Retrieves recent watch events based on query parameters
   */
  list(query: EventQuery): WatchEvent[] {
    try {
      const conditions: string[] = []
      const params: (string | number)[] = []

      if (query.projectId) {
        conditions.push('project_id = ?')
        params.push(query.projectId)
      }
      if (query.category) {
        conditions.push('category = ?')
        params.push(query.category)
      }
      if (query.type) {
        conditions.push('type = ?')
        params.push(query.type)
      }
      if (query.since) {
        conditions.push('timestamp >= ?')
        params.push(query.since)
      }
      if (query.until) {
        conditions.push('timestamp <= ?')
        params.push(query.until)
      }
      if (query.search) {
        conditions.push('relative_path LIKE ?')
        params.push(`%${query.search}%`)
      }

      let sql = 'SELECT * FROM watch_events'
      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ')
      }

      sql += ' ORDER BY timestamp DESC'

      if (query.limit) {
        sql += ' LIMIT ?'
        params.push(query.limit)
        if (query.offset) {
          sql += ' OFFSET ?'
          params.push(query.offset)
        }
      } else {
        sql += ' LIMIT 100'
      }

      const stmt = this.db.prepare(sql)
      const rows = stmt.all(...params) as WatchEventRow[]

      return rows.map((row) => ({
        id: row.id,
        projectId: row.project_id,
        timestamp: row.timestamp,
        type: row.type as FileChangeType,
        relativePath: row.relative_path,
        extension: row.extension,
        sizeBytes: row.size_bytes,
        category: row.category as FileCategory
      }))
    } catch (error) {
      console.error('Failed to get recent events:', error)
      return []
    }
  }

  /**
   * Gets aggregated statistics for file events within a time window
   */
  getStats(projectId: string, windowMs: number): EventStats {
    const defaultStats: EventStats = {
      totalEvents: 0,
      eventsByCategory: ALL_CATEGORIES.reduce(
        (acc, cat) => {
          acc[cat] = 0
          return acc
        },
        {} as Record<FileCategory, number>
      ),
      eventsByType: ALL_TYPES.reduce(
        (acc, type) => {
          acc[type] = 0
          return acc
        },
        {} as Record<FileChangeType, number>
      ),
      hotFiles: [],
      eventsPerHour: []
    }

    try {
      const now = Date.now()
      const since = now - windowMs

      // Category breakdown
      const catStmt = this.db.prepare(`
        SELECT category, COUNT(*) as count
        FROM watch_events
        WHERE project_id = ? AND timestamp >= ?
        GROUP BY category
      `)
      const catRows = catStmt.all(projectId, since) as { category: string; count: number }[]
      const eventsByCategory = { ...defaultStats.eventsByCategory }
      let totalEvents = 0
      for (const row of catRows) {
        if (row.category in eventsByCategory) {
          eventsByCategory[row.category as FileCategory] = row.count
        }
        totalEvents += row.count
      }

      // Type breakdown
      const typeStmt = this.db.prepare(`
        SELECT type, COUNT(*) as count
        FROM watch_events
        WHERE project_id = ? AND timestamp >= ?
        GROUP BY type
      `)
      const typeRows = typeStmt.all(projectId, since) as { type: string; count: number }[]
      const eventsByType = { ...defaultStats.eventsByType }
      for (const row of typeRows) {
        if (row.type in eventsByType) {
          eventsByType[row.type as FileChangeType] = row.count
        }
      }

      // Hot files
      const hotStmt = this.db.prepare(`
        SELECT relative_path as path, COUNT(*) as count
        FROM watch_events
        WHERE project_id = ? AND timestamp >= ?
        GROUP BY relative_path
        ORDER BY count DESC
        LIMIT 10
      `)
      const hotFiles = (hotStmt.all(projectId, since) as { path: string; count: number }[]).map(
        (r) => ({
          path: r.path,
          count: r.count
        })
      )

      // Events per hour (last 24h)
      const hourStmt = this.db.prepare(`
        SELECT ((timestamp / 3600000) % 24) as hour, COUNT(*) as count
        FROM watch_events
        WHERE project_id = ? AND timestamp >= ?
        GROUP BY hour
        ORDER BY hour ASC
      `)
      const eventsPerHour = (
        hourStmt.all(projectId, since) as { hour: number; count: number }[]
      ).map((r) => ({
        hour: r.hour,
        count: r.count
      }))

      return {
        totalEvents,
        eventsByCategory,
        eventsByType,
        hotFiles,
        eventsPerHour
      }
    } catch (error) {
      console.error('Failed to get event stats:', error)
      return defaultStats
    }
  }
}
