import type Database from 'better-sqlite3'
import type { InboxEntry, InboxItem, InboxList } from '@shared/ostler-api'

interface InboxStateRow {
  item_key: string
  read_at: number | null
  archived_at: number | null
}

/** Returns the items one source has now. Called on every read: keep it to one query. */
export type InboxSource = () => InboxItem[]

/**
 * The Inbox (P5.6): what happened that wants attention, across every
 * project. Items are derived from registered sources (delivered reminders,
 * agent questions, sessions waiting for review, reported blockers; P6.1 and
 * P10.1 add theirs the same way). Only each item's read and archived state
 * is stored, in `inbox_state`, keyed by the item's key.
 *
 * Personal and cross-project, so it is not on the project-scoped automation
 * API.
 */
export class InboxService {
  private readonly sources = new Map<string, InboxSource>()
  /** Keys seen by the last `refresh`; null before the first. */
  private known: Set<string> | null = null

  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now
  ) {}

  registerSource(id: string, source: InboxSource): void {
    if (this.sources.has(id)) throw new Error(`Inbox source ${id} is already registered`)
    this.sources.set(id, source)
  }

  /** Every item from every source, archived ones included, newest first. */
  private items(): InboxItem[] {
    const items: InboxItem[] = []
    for (const [id, source] of this.sources) {
      try {
        items.push(...source())
      } catch (error) {
        // One broken source must not empty the Inbox.
        console.error(`Inbox source ${id} failed:`, error)
      }
    }
    return items.sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key))
  }

  private states(): Map<string, InboxStateRow> {
    const rows = this.db.prepare('SELECT * FROM inbox_state').all() as InboxStateRow[]
    return new Map(rows.map((row) => [row.item_key, row]))
  }

  list(): InboxList {
    const states = this.states()
    const items: InboxEntry[] = []
    for (const item of this.items()) {
      const state = states.get(item.key)
      if (state?.archived_at) continue
      items.push({ ...item, readAt: state?.read_at ?? null })
    }
    return { items, unreadCount: items.filter((item) => item.readAt === null).length }
  }

  unreadCount(): number {
    return this.list().unreadCount
  }

  /**
   * The items that appeared since the last call (none on the first: those
   * were there before Ostler looked). The caller turns them into desktop
   * notifications.
   */
  refresh(): InboxItem[] {
    const states = this.states()
    const items = this.items().filter((item) => !states.get(item.key)?.archived_at)
    const keys = new Set(items.map((item) => item.key))
    const previous = this.known
    this.known = keys
    if (previous === null) return []
    return items.filter((item) => !previous.has(item.key) && states.get(item.key)?.read_at == null)
  }

  setRead(keys: string[], read: boolean): void {
    const at = this.now()
    const upsert = this.db.prepare(
      `INSERT INTO inbox_state (item_key, read_at, archived_at) VALUES (?, ?, NULL)
       ON CONFLICT(item_key) DO UPDATE SET read_at = excluded.read_at`
    )
    this.db.transaction(() => {
      for (const key of keys) upsert.run(this.key(key), read ? at : null)
    })()
  }

  /** Archived items leave the list; they are read too. */
  archive(keys: string[]): void {
    const at = this.now()
    const upsert = this.db.prepare(
      `INSERT INTO inbox_state (item_key, read_at, archived_at) VALUES (?, ?, ?)
       ON CONFLICT(item_key) DO UPDATE SET archived_at = excluded.archived_at,
         read_at = COALESCE(inbox_state.read_at, excluded.read_at)`
    )
    this.db.transaction(() => {
      for (const key of keys) upsert.run(this.key(key), at, at)
    })()
  }

  unarchive(keys: string[]): void {
    const update = this.db.prepare('UPDATE inbox_state SET archived_at = NULL WHERE item_key = ?')
    this.db.transaction(() => {
      for (const key of keys) update.run(this.key(key))
    })()
  }

  markAllRead(): void {
    this.setRead(
      this.list()
        .items.filter((item) => item.readAt === null)
        .map((item) => item.key),
      true
    )
  }

  /** Forgets an item's state, so when it comes back (a snoozed reminder) it is unread. */
  forget(key: string): void {
    this.db.prepare('DELETE FROM inbox_state WHERE item_key = ?').run(this.key(key))
  }

  private key(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-z]+:[\w:.-]{1,200}$/i.test(value)) {
      throw new Error('That is not an Inbox item')
    }
    return value
  }
}
