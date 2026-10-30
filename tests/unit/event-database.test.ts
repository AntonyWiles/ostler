import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { EventDatabase } from '../../electron/services/event-database'
import type { WatchEvent } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'

describe('event-database.ts', () => {
  let tempDir: string
  let dbPath: string
  let db: EventDatabase

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-test-db-'))
    dbPath = await createMigratedDatabase(tempDir)
    db = new EventDatabase(dbPath)
  })

  afterEach(() => {
    db.close()
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup error
    }
  })

  it('inserts and queries watch events with filters and pagination', () => {
    const event1: WatchEvent = {
      id: 'event-1',
      projectId: 'proj-1',
      timestamp: 1000,
      type: 'add',
      relativePath: 'src/index.ts',
      extension: '.ts',
      sizeBytes: 120,
      category: 'source'
    }

    const event2: WatchEvent = {
      id: 'event-2',
      projectId: 'proj-1',
      timestamp: 2000,
      type: 'change',
      relativePath: 'README.md',
      extension: '.md',
      sizeBytes: 450,
      category: 'documentation'
    }

    const event3: WatchEvent = {
      id: 'event-3',
      projectId: 'proj-2',
      timestamp: 3000,
      type: 'unlink',
      relativePath: 'dist/out.js',
      extension: '.js',
      sizeBytes: 0,
      category: 'build'
    }

    db.insertWatchEvent(event1)
    db.insertWatchEvent(event2)
    db.insertWatchEvent(event3)

    // Query all for proj-1
    const proj1Events = db.getRecentEvents({ projectId: 'proj-1' })
    expect(proj1Events.length).toBe(2)
    expect(proj1Events[0].id).toBe('event-2') // Ordered by timestamp DESC
    expect(proj1Events[1].id).toBe('event-1')

    // Filter by category
    const docEvents = db.getRecentEvents({ category: 'documentation' })
    expect(docEvents.length).toBe(1)
    expect(docEvents[0].id).toBe('event-2')

    // Filter with search substring
    const searchEvents = db.getRecentEvents({ search: 'index' })
    expect(searchEvents.length).toBe(1)
    expect(searchEvents[0].id).toBe('event-1')
  })

  it('aggregates event statistics accurately', () => {
    const now = Date.now()
    const event: WatchEvent = {
      id: 'stat-event-1',
      projectId: 'proj-stats',
      timestamp: now - 5000,
      type: 'change',
      relativePath: 'src/app.tsx',
      extension: '.tsx',
      sizeBytes: 256,
      category: 'source'
    }
    db.insertWatchEvent(event)

    const stats = db.getEventStats('proj-stats', 60000)
    expect(stats.totalEvents).toBe(1)
    expect(stats.eventsByCategory.source).toBe(1)
    expect(stats.eventsByType.change).toBe(1)
    expect(stats.hotFiles[0]).toEqual({ path: 'src/app.tsx', count: 1 })
  })

  it('inserts and retrieves git events', () => {
    db.insertGitEvent('proj-git', {
      hash: 'abc1234567890',
      abbreviatedHash: 'abc1234',
      message: 'feat: add awesome feature',
      body: 'Tracks the motivation and intended follow-up.',
      author: 'Jordan',
      date: new Date().toISOString(),
      filesChanged: 3,
      insertions: 50,
      deletions: 10,
      branch: 'main'
    })

    const latestHash = db.getLatestGitHash('proj-git')
    expect(latestHash).toBe('abc1234567890')

    const events = db.getGitEvents('proj-git', 10)
    expect(events.length).toBe(1)
    expect(events[0].message).toBe('feat: add awesome feature')
    expect(events[0].body).toBe('Tracks the motivation and intended follow-up.')

    // Re-observing the same commit updates its record instead of making a
    // second history entry every time Ostler restarts monitoring.
    db.insertGitEvent('proj-git', {
      hash: 'abc1234567890',
      abbreviatedHash: 'abc1234',
      message: 'feat: add awesome feature',
      body: 'Updated rationale.',
      author: 'Jordan',
      date: new Date().toISOString(),
      filesChanged: 3,
      insertions: 50,
      deletions: 10,
      branch: 'main'
    })
    expect(db.getGitEvents('proj-git', 10)).toHaveLength(1)
    expect(db.getGitEvents('proj-git', 10)[0].body).toBe('Updated rationale.')
  })

  it('handles AI conversations CRUD', () => {
    db.createConversation('conv-1', 'Test Conversation', 'proj-1')

    let conv = db.getConversation('conv-1')
    expect(conv).not.toBeNull()
    expect(conv?.title).toBe('Test Conversation')
    expect(conv?.messages).toEqual([])

    db.updateConversationMessages('conv-1', [
      { role: 'user', content: 'Hello', timestamp: Date.now() },
      { role: 'assistant', content: 'Hi there', timestamp: Date.now() }
    ])

    conv = db.getConversation('conv-1')
    expect(conv?.messages.length).toBe(2)

    const allConvs = db.getConversations()
    expect(allConvs.length).toBe(1)

    db.deleteConversation('conv-1')
    expect(db.getConversation('conv-1')).toBeNull()
  })

  it('prunes old events and returns database stats', () => {
    const oldTimestamp = Date.now() - 40 * 24 * 60 * 60 * 1000 // 40 days ago
    const newTimestamp = Date.now() - 5 * 24 * 60 * 60 * 1000 // 5 days ago

    db.insertWatchEvent({
      id: 'old-event',
      projectId: 'proj-prune',
      timestamp: oldTimestamp,
      type: 'add',
      relativePath: 'old.txt',
      extension: '.txt',
      sizeBytes: 10,
      category: 'documentation'
    })

    db.insertWatchEvent({
      id: 'new-event',
      projectId: 'proj-prune',
      timestamp: newTimestamp,
      type: 'add',
      relativePath: 'new.txt',
      extension: '.txt',
      sizeBytes: 10,
      category: 'documentation'
    })

    const statsBefore = db.getStats()
    expect(statsBefore.watchEventCount).toBe(2)

    const pruneResult = db.prune(30) // Prune older than 30 days
    expect(pruneResult.deletedCount).toBe(1)

    const statsAfter = db.getStats()
    expect(statsAfter.watchEventCount).toBe(1)
  })

  it('reports the sync service the database folder is inside', async () => {
    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-test-sync-'))
    const dropboxDir = path.join(syncRoot, 'Dropbox')
    fs.mkdirSync(dropboxDir)
    const syncedDb = new EventDatabase(await createMigratedDatabase(dropboxDir))
    try {
      expect(syncedDb.getStats().syncedBy).toBe('Dropbox')
      expect(db.getStats().syncedBy).toBeNull()
    } finally {
      syncedDb.close()
      fs.rmSync(syncRoot, { recursive: true, force: true })
    }
  })
})
