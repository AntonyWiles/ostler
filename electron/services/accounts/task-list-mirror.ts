/**
 * Writing back, my tasks (docs/plans/integrations/overview.md, phase 6): the
 * open tasks assigned to Me, across enabled projects, copied into one
 * Microsoft To Do or Google Tasks list, so they sit beside the person's other
 * to-dos on their phone. Two ways for the one thing that matters there:
 * ticking an item off marks the task done here (as Me). Everything else
 * flows one way: Ostler's title, project and due date win, and a task that is
 * done, reassigned or archived here is completed or removed there.
 *
 * An item deleted there is not made again until its task changes. Only the
 * task's title, its project's name and key, and its due date are sent.
 */
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type { AccountTaskList, TaskListTarget } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import type { ConnectedAccountsService } from './connected-accounts-service'
import { AccountCallError } from './account-fetch'
import { mirrorTargetHere } from './mirror-device'
import { thisDeviceId } from '../sync/sync-keys'
import { attachSyncCapture } from '../sync/capture'

const DEBOUNCE_MS = 10_000
const POLL_MS = 15 * 60_000
const MAX_PAGES = 20

type Accounts = Pick<ConnectedAccountsService, 'get' | 'call' | 'callJson' | 'list'>

export interface TaskListMirrorDependencies {
  accounts: Accounts
  /** Enabled projects: id, name and task key prefix. */
  projects(): { id: string; name: string }[]
  meId(): string | null
  /** Ticked off there: the task is marked done here, as Me. */
  markDone(workItemId: string): void
  changed?(): void
  now?(): number
}

interface TargetRow {
  account_id: string
  remote_list: string
  name: string
  synced_at: number | null
  failed_at: number | null
  failure: string | null
  /** The device that runs the write-back (mirror-device.ts). */
  device_id: string | null
}

interface ItemRow {
  work_item_id: string
  remote_id: string
  hash: string
  remote_done: number
}

interface TaskRow {
  id: string
  project_id: string
  title: string
  status: string
  target_date: string | null
  assignee_id: string | null
  archived_at: number | null
  deleted_at: number | null
}

interface Desired {
  title: string
  notes: string
  due: string | null
}

/** The task lists an account has. */
export async function listTaskLists(
  accounts: Pick<Accounts, 'get' | 'callJson'>,
  accountId: string
): Promise<AccountTaskList[]> {
  const provider = accounts.get(accountId).provider
  if (provider === 'google') {
    const answer = await accounts.callJson<{ items?: { id?: string; title?: string }[] }>(
      accountId,
      'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100'
    )
    return (answer.items ?? [])
      .filter((item) => typeof item.id === 'string')
      .map((item) => ({ remoteId: item.id as string, name: item.title || (item.id as string) }))
  }
  if (provider === 'microsoft') {
    const answer = await accounts.callJson<{ value?: { id?: string; displayName?: string }[] }>(
      accountId,
      'https://graph.microsoft.com/v1.0/me/todo/lists?$top=100'
    )
    return (answer.value ?? [])
      .filter((item) => typeof item.id === 'string')
      .map((item) => ({
        remoteId: item.id as string,
        name: item.displayName || (item.id as string)
      }))
  }
  return []
}

export class TaskListMirror {
  private readonly db: Database.Database
  private readonly now: () => number
  private queue: Promise<unknown> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null
  private poll: NodeJS.Timeout | null = null

  constructor(
    dbPath: string,
    private readonly deps: TaskListMirrorDependencies
  ) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    // The target rows sync to the other devices (settings follow the person, D18): their writes are captured here.
    attachSyncCapture(this.db)
    this.now = deps.now ?? Date.now
  }

  /** Reads the list every 15 minutes for items ticked off there. */
  start(): void {
    this.poll ??= setInterval(() => void this.sync(), POLL_MS)
    this.poll.unref?.()
    this.schedule(60_000)
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.poll) clearInterval(this.poll)
    this.timer = null
    this.poll = null
    this.db.close()
  }

  target(): TaskListTarget | null {
    const row = this.row()
    if (!row) return null
    return {
      accountId: row.account_id,
      name: row.name,
      syncedAt: row.synced_at,
      failedAt: row.failed_at,
      failure: (row.failure as TaskListTarget['failure']) ?? null
    }
  }

  async setTarget(input: { accountId: string; remoteId: string; name: string }): Promise<void> {
    const account = this.deps.accounts.list().find((entry) => entry.id === input?.accountId)
    if (!account || !account.capabilities.includes('tasks.sync')) {
      throw new Refusal(t('errors:accounts.notAllowed'))
    }
    if (typeof input.remoteId !== 'string' || !input.remoteId) {
      throw new Refusal(t('errors:accounts.notFound'))
    }
    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : '—'
    await this.enqueue(async () => {
      await this.removeCopies()
      this.db.prepare('DELETE FROM task_list_target').run()
      this.db
        .prepare(
          'INSERT INTO task_list_target (id, account_id, remote_list, name, device_id) VALUES (1, ?, ?, ?, ?)'
        )
        .run(account.id, input.remoteId, name.slice(0, 200), thisDeviceId(this.db))
    })
    this.deps.changed?.()
    this.schedule(0)
  }

  /** Stops, and deletes the open items Ostler made there. */
  async clearTarget(): Promise<void> {
    await this.enqueue(async () => {
      await this.removeCopies()
      this.db.prepare('DELETE FROM task_list_target').run()
    })
    this.deps.changed?.()
  }

  schedule(delay = DEBOUNCE_MS): void {
    if (!this.row()) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.sync()
    }, delay)
    this.timer.unref?.()
  }

  /** Reads what was ticked off there, then writes what changed here. Never throws. */
  sync(): Promise<void> {
    return this.enqueue(() => this.syncNow()).catch((error) =>
      console.error('Copying my tasks failed:', error)
    )
  }

  private async syncNow(): Promise<void> {
    const target = this.row()
    if (!target) return
    let failure: string | null = null
    try {
      await this.pull(target)
      await this.push(target)
    } catch (error) {
      if (!(error instanceof AccountCallError)) throw error
      failure = error.reason
    }
    const now = this.now()
    if (failure) {
      this.db.prepare('UPDATE task_list_target SET failed_at = ?, failure = ?').run(now, failure)
    } else {
      this.db
        .prepare('UPDATE task_list_target SET synced_at = ?, failed_at = NULL, failure = NULL')
        .run(now)
    }
    this.deps.changed?.()
  }

  /** Items ticked off or deleted there. */
  private async pull(target: TargetRow): Promise<void> {
    const remote = await this.remoteItems(target)
    const rows = this.db
      .prepare("SELECT * FROM task_list_items WHERE remote_id != ''")
      .all() as ItemRow[]
    for (const row of rows) {
      const done = remote.get(row.remote_id)
      if (done === undefined) {
        this.db
          .prepare("UPDATE task_list_items SET remote_id = '' WHERE work_item_id = ?")
          .run(row.work_item_id)
        continue
      }
      if (done && !row.remote_done) {
        const task = this.task(row.work_item_id)
        if (task && task.status !== 'done') {
          try {
            this.deps.markDone(task.id)
          } catch (error) {
            console.error('Marking a task done from the list failed:', error)
          }
        }
        this.db
          .prepare('UPDATE task_list_items SET remote_done = 1 WHERE work_item_id = ?')
          .run(row.work_item_id)
      }
    }
  }

  private async push(target: TargetRow): Promise<void> {
    const projects = new Map(this.deps.projects().map((project) => [project.id, project]))
    const meId = this.deps.meId()
    const mine =
      meId && projects.size > 0
        ? (this.db
            .prepare(
              `SELECT id, project_id, title, status, target_date, assignee_id, archived_at, deleted_at
               FROM planning_work_items
               WHERE assignee_id = ? AND status != 'done' AND deleted_at IS NULL
                 AND archived_at IS NULL AND project_id IN (${[...projects.keys()].map(() => '?').join(', ')})`
            )
            .all(meId, ...projects.keys()) as TaskRow[])
        : []
    const wanted = new Set(mine.map((task) => task.id))
    const rows = new Map(
      (this.db.prepare('SELECT * FROM task_list_items').all() as ItemRow[]).map((row) => [
        row.work_item_id,
        row
      ])
    )

    // Done, reassigned or archived here: completed or removed there.
    for (const [taskId, row] of rows) {
      if (wanted.has(taskId)) continue
      if (row.remote_id && !row.remote_done) {
        const task = this.task(taskId)
        if (task && task.status === 'done') await this.complete(target, row.remote_id)
        else await this.remove(target, row.remote_id)
      }
      this.db.prepare('DELETE FROM task_list_items WHERE work_item_id = ?').run(taskId)
    }

    for (const task of mine) {
      const desired: Desired = {
        title: task.title,
        notes: t('settings:taskList.itemNotes', {
          project: projects.get(task.project_id)?.name ?? ''
        }),
        due: task.target_date
      }
      const hash = createHash('sha256').update(JSON.stringify(desired)).digest('hex')
      const row = rows.get(task.id)
      if (row && row.hash === hash) continue
      let remoteId = row?.remote_id ?? ''
      if (remoteId) await this.update(target, remoteId, desired)
      else remoteId = await this.create(target, desired)
      this.db
        .prepare(
          `INSERT INTO task_list_items (work_item_id, remote_id, hash, remote_done, synced_at)
           VALUES (?, ?, ?, 0, ?)
           ON CONFLICT(work_item_id) DO UPDATE SET remote_id = excluded.remote_id,
             hash = excluded.hash, remote_done = 0, synced_at = excluded.synced_at`
        )
        .run(task.id, remoteId, hash, this.now())
    }
  }

  /** Every item in the list: its id and whether it is ticked off. */
  private async remoteItems(target: TargetRow): Promise<Map<string, boolean>> {
    const accounts = this.deps.accounts
    const list = encodeURIComponent(target.remote_list)
    const items = new Map<string, boolean>()
    if (this.provider(target) === 'google') {
      let pageToken: string | null = null
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${list}/tasks`)
        url.searchParams.set('showCompleted', 'true')
        url.searchParams.set('showHidden', 'true')
        url.searchParams.set('maxResults', '100')
        if (pageToken) url.searchParams.set('pageToken', pageToken)
        const answer = await accounts.callJson<{
          items?: { id?: string; status?: string }[]
          nextPageToken?: string
        }>(target.account_id, url.toString())
        for (const item of answer.items ?? []) {
          if (item.id) items.set(item.id, item.status === 'completed')
        }
        pageToken = answer.nextPageToken ?? null
        if (!pageToken) break
      }
      return items
    }
    let next: string | null =
      `https://graph.microsoft.com/v1.0/me/todo/lists/${list}/tasks?$top=100&$select=id,status`
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const answer: { value?: { id?: string; status?: string }[]; '@odata.nextLink'?: string } =
        await accounts.callJson(target.account_id, next)
      for (const item of answer.value ?? []) {
        if (item.id) items.set(item.id, item.status === 'completed')
      }
      next = answer['@odata.nextLink'] ?? null
    }
    return items
  }

  private async create(target: TargetRow, desired: Desired): Promise<string> {
    const made = await this.deps.accounts.callJson<{ id?: string }>(
      target.account_id,
      this.itemsUrl(target),
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(this.body(target, desired)) }
    )
    if (!made.id) throw new AccountCallError('server')
    return made.id
  }

  private async update(target: TargetRow, remoteId: string, desired: Desired): Promise<void> {
    await this.deps.accounts.callJson(target.account_id, this.itemUrl(target, remoteId), {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(this.body(target, desired))
    })
  }

  private async complete(target: TargetRow, remoteId: string): Promise<void> {
    try {
      await this.deps.accounts.callJson(target.account_id, this.itemUrl(target, remoteId), {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ status: 'completed' })
      })
    } catch (error) {
      if (!gone(error)) throw error
    }
  }

  private async remove(target: TargetRow, remoteId: string): Promise<void> {
    try {
      await this.deps.accounts.call(target.account_id, this.itemUrl(target, remoteId), {
        method: 'DELETE'
      })
    } catch (error) {
      if (!gone(error)) throw error
    }
  }

  private body(target: TargetRow, desired: Desired): Record<string, unknown> {
    if (this.provider(target) === 'google') {
      return {
        title: desired.title,
        notes: desired.notes,
        due: desired.due ? `${desired.due}T00:00:00.000Z` : null
      }
    }
    return {
      title: desired.title,
      body: { contentType: 'text', content: desired.notes },
      dueDateTime: desired.due ? { dateTime: `${desired.due}T00:00:00`, timeZone: 'UTC' } : null
    }
  }

  private itemsUrl(target: TargetRow): string {
    const list = encodeURIComponent(target.remote_list)
    return this.provider(target) === 'google'
      ? `https://tasks.googleapis.com/tasks/v1/lists/${list}/tasks`
      : `https://graph.microsoft.com/v1.0/me/todo/lists/${list}/tasks`
  }

  private itemUrl(target: TargetRow, remoteId: string): string {
    return `${this.itemsUrl(target)}/${encodeURIComponent(remoteId)}`
  }

  private provider(target: TargetRow): 'google' | 'microsoft' {
    const provider = this.deps.accounts.get(target.account_id).provider
    if (provider !== 'google' && provider !== 'microsoft') throw new AccountCallError('refused')
    return provider
  }

  /** Best effort: the open items Ostler made, before the list changes or copying stops. */
  private async removeCopies(): Promise<void> {
    const target = this.row()
    if (target) {
      const rows = this.db
        .prepare("SELECT * FROM task_list_items WHERE remote_id != '' AND remote_done = 0")
        .all() as ItemRow[]
      for (const row of rows) {
        try {
          await this.remove(target, row.remote_id)
        } catch (error) {
          console.error(
            'Removing a copied task failed:',
            error instanceof Error ? error.name : error
          )
        }
      }
    }
    this.db.prepare('DELETE FROM task_list_items').run()
  }

  private task(id: string): TaskRow | null {
    return (
      (this.db
        .prepare(
          `SELECT id, project_id, title, status, target_date, assignee_id, archived_at, deleted_at
           FROM planning_work_items WHERE id = ?`
        )
        .get(id) as TaskRow | undefined) ?? null
    )
  }

  /** The target, when this device runs it (see mirror-device.ts); other devices see it and skip it. */
  private row(): TargetRow | null {
    const row =
      (this.db.prepare('SELECT * FROM task_list_target WHERE id = 1').get() as
        TargetRow | undefined) ?? null
    return mirrorTargetHere(this.db, 'task_list_target', row)
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => undefined)
    return next
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function gone(error: unknown): boolean {
  return error instanceof AccountCallError && (error.status === 404 || error.status === 410)
}
