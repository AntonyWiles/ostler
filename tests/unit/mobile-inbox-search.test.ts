import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { createMigratedDatabase } = await import('../helpers/database')
const { phoneInbox, inboxList } = await import('../../mobile/src/data/inbox')
const { searchPhone } = await import('../../mobile/src/data/search')

// The phone's Inbox and Search over a database the desktop's own PlanningService filled.

const human = { kind: 'human' as const }
const PROJECT = 'p1'
const OTHER = 'p2'

describe("the phone's Inbox", () => {
  const tempDir = useTempDir('ostler-mobile-inbox-')
  let planning: InstanceType<typeof PlanningService>
  let blocked: string

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 16, 8, 0))
    const databasePath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(databasePath, () => [PROJECT, OTHER])
    blocked = planning.createWorkItem(PROJECT, { title: 'Fit sink', status: 'active' }, human).id
    planning.reportBlocker(blocked, 'Waiting for the plumber', 'human')
  })

  afterEach(() => {
    planning.close()
    vi.useRealTimers()
  })

  it('lists an open blocker with its project name, unread', () => {
    const list = inboxList(planning.database, { projectName: () => 'House' })
    expect(list.unreadCount).toBe(1)
    expect(list.items).toEqual([
      expect.objectContaining({
        kind: 'blocker',
        title: 'Fit sink',
        body: 'Waiting for the plumber',
        projectId: PROJECT,
        taskId: blocked,
        readAt: null
      })
    ])
  })

  it('keeps read and archived state in inbox_state, so it syncs', () => {
    const inbox = phoneInbox(planning.database)
    const key = inbox.list().items[0].key
    inbox.setRead([key], true)
    expect(inboxList(planning.database).unreadCount).toBe(0)
    inbox.archive([key])
    expect(inboxList(planning.database).items).toEqual([])
    const row = planning.database
      .prepare('SELECT read_at, archived_at FROM inbox_state WHERE item_key = ?')
      .get(key) as { read_at: number | null; archived_at: number | null }
    expect(row.read_at).not.toBeNull()
    expect(row.archived_at).not.toBeNull()
    inbox.unarchive([key])
    expect(inboxList(planning.database).items).toHaveLength(1)
  })

  it('shows a task waiting in To triage once for its project', () => {
    planning.createWorkItem(OTHER, { title: 'Idea' }, human, 'human', null, {
      triage: 'quick-add'
    })
    const triage = inboxList(planning.database).items.filter((item) => item.kind === 'triage')
    expect(triage).toEqual([expect.objectContaining({ projectId: OTHER, taskId: null })])
  })
})

describe("the phone's Search", () => {
  const tempDir = useTempDir('ostler-mobile-search-')
  let planning: InstanceType<typeof PlanningService>
  const ids: Record<string, string> = {}

  beforeEach(async () => {
    const databasePath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(databasePath, () => [PROJECT, OTHER])
    ids.sink = planning.createWorkItem(PROJECT, { title: 'Fit kitchen sink' }, human).id
    ids.paint = planning.createWorkItem(OTHER, { title: 'Paint the fence' }, human).id
    ids.old = planning.createWorkItem(PROJECT, { title: 'Old kitchen plan' }, human).id
    planning.addComment(ids.paint, 'Green paint for the kitchen door too.', human)
    planning.archiveWorkItem(ids.old, human)
  })

  afterEach(() => {
    planning.close()
  })

  it('finds tasks and comments in every project, best first, leaving archived work out', () => {
    const results = searchPhone(planning.database, 'kitchen')
    expect(results[0]).toEqual(expect.objectContaining({ type: 'task', id: ids.sink }))
    expect(results).toContainEqual(
      expect.objectContaining({ type: 'comment', projectId: OTHER, workItemId: ids.paint })
    )
    expect(results.map((result) => result.id)).not.toContain(ids.old)
  })

  it('narrows to one project', () => {
    const results = searchPhone(planning.database, 'kitchen', { projectId: OTHER })
    expect(results.every((result) => result.projectId === OTHER)).toBe(true)
  })

  it('reads the tables, not the full-text index the phone never writes', () => {
    planning.database.prepare('DELETE FROM search_index').run()
    expect(searchPhone(planning.database, 'fence').map((result) => result.id)).toEqual([ids.paint])
  })
})
