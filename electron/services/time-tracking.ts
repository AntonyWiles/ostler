import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  CreateTimeEntryInput,
  TimeEntry,
  TimeEntryQuery,
  TimeEntrySource,
  TimerStart,
  TimerState,
  TimeTotals,
  UpdateTimeEntryInput
} from '@shared/ostler-api'
import { MAX_TIME_ENTRY_SECONDS, MAX_TIME_NOTE_LENGTH } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import { formatDate } from '@shared/format'

interface EntryRow {
  id: string
  project_id: string
  work_item_id: string
  title: string | null
  person_id: string | null
  started_at: number
  duration_seconds: number | null
  note: string
  source: TimeEntrySource
  billable: number
  billing_id: string | null
  heartbeat_at: number | null
  created_at: number
  updated_at: number
}

interface TaskRow {
  id: string
  project_id: string
  archived_at: number | null
  deleted_at: number | null
}

export interface TimeTrackingDependencies {
  /** Refuses a project Ostler does not know. */
  requireProject(projectId: string): void
  /** Me's person id, the default person on an entry. */
  meId(): string | null
  personExists(personId: string): boolean
  /** Called after any entry or the timer changed, with the project it belongs to. */
  changed(projectId: string): void
}

const SELECT = `SELECT e.*, w.title AS title FROM planning_time_entries e
  LEFT JOIN planning_work_items w ON w.id = e.work_item_id`

/**
 * Time tracking (R2.3, D33): entries on tasks and the one timer. The planning
 * service owns this, so the app, the automation API and every other surface
 * go through the same validation and the same rule: one timer runs at a time
 * across Ostler, and starting another stops the first.
 *
 * A running timer is the entry with no duration. Its elapsed time is always
 * `now - startedAt`; nothing counts in memory, so it survives a restart.
 * `heartbeat_at` records the last time Ostler was seen running with it
 * (`heartbeat`, every minute and on quit), which is "the time Ostler closed"
 * when the next start finds it still running.
 */
export class TimeTracking {
  /** Set at start when a timer was running as Ostler closed, until the person chooses (D33). */
  private interrupted: TimerState['interrupted']

  constructor(
    private readonly db: Database.Database,
    private readonly deps: TimeTrackingDependencies
  ) {
    const running = this.runningRow()
    this.interrupted = running
      ? { entryId: running.id, closedAt: running.heartbeat_at ?? running.started_at }
      : null
  }

  private listener: ((projectId: string) => void) | null = null

  /** Called after any entry or the timer changed, from any surface: the status bar, tray and jump list. */
  setChangedListener(listener: ((projectId: string) => void) | null): void {
    this.listener = listener
  }

  private changed(projectId: string): void {
    this.deps.changed(projectId)
    try {
      this.listener?.(projectId)
    } catch (error) {
      console.error('Time tracking change listener failed:', error)
    }
  }

  // ─── Reading ──────────────────────────────────────────────────────────────

  get(entryId: string): TimeEntry {
    if (typeof entryId !== 'string') throw new Refusal(t('errors:timeTracking.entryNotFound'))
    const row = this.db.prepare(`${SELECT} WHERE e.id = ?`).get(entryId) as EntryRow | undefined
    if (!row) throw new Refusal(t('errors:timeTracking.entryNotFound'))
    return toEntry(row)
  }

  /** The entry, refused unless it is one of `projectId`'s. */
  getForProject(projectId: string, entryId: string): TimeEntry {
    const entry = this.get(entryId)
    if (entry.projectId !== projectId) throw new Refusal(t('errors:timeTracking.entryNotFound'))
    return entry
  }

  /** A task's entries, newest first. */
  listForWorkItem(workItemId: string): TimeEntry[] {
    this.task(workItemId)
    return (
      this.db
        .prepare(`${SELECT} WHERE e.work_item_id = ? ORDER BY e.started_at DESC`)
        .all(workItemId) as EntryRow[]
    ).map(toEntry)
  }

  /** Every entry in a project, in start order (the project file, reports). */
  listForProject(projectId: string): TimeEntry[] {
    this.deps.requireProject(projectId)
    return (
      this.db
        .prepare(`${SELECT} WHERE e.project_id = ? ORDER BY e.started_at`)
        .all(projectId) as EntryRow[]
    ).map(toEntry)
  }

  /** Entries that started in `[from, to)`, across projects, in start order (the Timesheet). */
  list(query: TimeEntryQuery, knownProjectIds: readonly string[]): TimeEntry[] {
    const from = Number(query?.from)
    const to = Number(query?.to)
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from)
      throw new Refusal(t('errors:timeTracking.rangeInvalid'))
    const wanted = Array.isArray(query.projectIds)
      ? query.projectIds.filter((id) => knownProjectIds.includes(id))
      : [...knownProjectIds]
    if (wanted.length === 0) return []
    const params: unknown[] = [from, to, ...wanted]
    let personClause = ''
    if (query.personId !== undefined) {
      personClause = query.personId === null ? ' AND e.person_id IS NULL' : ' AND e.person_id = ?'
      if (query.personId !== null) params.push(query.personId)
    }
    return (
      this.db
        .prepare(
          `${SELECT} WHERE e.started_at >= ? AND e.started_at < ? AND e.project_id IN (${wanted
            .map(() => '?')
            .join(', ')})${personClause} ORDER BY e.started_at`
        )
        .all(...params) as EntryRow[]
    ).map(toEntry)
  }

  /** Seconds logged per task in a project, finished entries only: one query for cards. */
  totals(projectId: string): TimeTotals {
    this.deps.requireProject(projectId)
    const rows = this.db
      .prepare(
        `SELECT work_item_id, SUM(duration_seconds) AS seconds FROM planning_time_entries
         WHERE project_id = ? AND duration_seconds IS NOT NULL GROUP BY work_item_id`
      )
      .all(projectId) as Array<{ work_item_id: string; seconds: number }>
    return Object.fromEntries(rows.map((row) => [row.work_item_id, row.seconds]))
  }

  // ─── Entries by hand ──────────────────────────────────────────────────────

  create(projectId: string, input: CreateTimeEntryInput, now = Date.now()): TimeEntry {
    const task = this.liveTask(projectId, input?.workItemId)
    const entry: TimeEntry = {
      id: uuidv4(),
      projectId,
      workItemId: task.id,
      workItemTitle: '',
      personId: this.person(input.personId === undefined ? this.deps.meId() : input.personId),
      startedAt: startOf(input.startedAt),
      durationSeconds: durationOf(input.durationSeconds),
      note: noteOf(input.note ?? ''),
      source: 'manual',
      billable:
        input.billable === undefined ? this.newTimeBillable(projectId) : billableOf(input.billable),
      billingId: null,
      createdAt: now,
      updatedAt: now
    }
    this.insert(entry, null)
    this.changed(projectId)
    return this.get(entry.id)
  }

  /** Changes a finished entry's start, duration, note or person. A running timer's start only. */
  update(
    projectId: string,
    entryId: string,
    input: UpdateTimeEntryInput,
    now = Date.now()
  ): TimeEntry {
    const current = this.getForProject(projectId, entryId)
    this.refuseBilled(current)
    const changes = input ?? {}
    if (current.durationSeconds === null && changes.durationSeconds !== undefined)
      throw new Refusal(t('errors:timeTracking.stopFirst'))
    const next: TimeEntry = {
      ...current,
      startedAt: changes.startedAt === undefined ? current.startedAt : startOf(changes.startedAt),
      durationSeconds:
        changes.durationSeconds === undefined
          ? current.durationSeconds
          : durationOf(changes.durationSeconds),
      note: changes.note === undefined ? current.note : noteOf(changes.note),
      personId: changes.personId === undefined ? current.personId : this.person(changes.personId),
      billable: changes.billable === undefined ? current.billable : billableOf(changes.billable),
      updatedAt: now
    }
    if (next.durationSeconds === null && next.startedAt > now)
      throw new Refusal(t('errors:timeTracking.startInvalid'))
    this.db
      .prepare(
        `UPDATE planning_time_entries SET started_at = ?, duration_seconds = ?, note = ?,
         person_id = ?, billable = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        next.startedAt,
        next.durationSeconds,
        next.note,
        next.personId,
        next.billable ? 1 : 0,
        now,
        entryId
      )
    this.changed(projectId)
    return this.get(entryId)
  }

  /** Deletes an entry; the result is what `restore` puts back. A running timer stops with it. */
  delete(projectId: string, entryId: string): TimeEntry {
    const entry = this.getForProject(projectId, entryId)
    this.refuseBilled(entry)
    this.db.prepare('DELETE FROM planning_time_entries WHERE id = ?').run(entryId)
    if (this.interrupted?.entryId === entryId) this.interrupted = null
    this.changed(projectId)
    return entry
  }

  /** Undoes `delete`. A deleted running timer comes back stopped if another one runs now. */
  restore(projectId: string, entry: TimeEntry, now = Date.now()): TimeEntry {
    this.deps.requireProject(projectId)
    if (!entry || typeof entry.id !== 'string')
      throw new Refusal(t('errors:timeTracking.entryNotFound'))
    if (this.db.prepare('SELECT 1 FROM planning_time_entries WHERE id = ?').get(entry.id))
      return this.get(entry.id)
    const task = this.task(entry.workItemId)
    if (task.project_id !== projectId) throw new Refusal(t('errors:timeTracking.taskNotInProject'))
    let durationSeconds = entry.durationSeconds === null ? null : durationOf(entry.durationSeconds)
    if (durationSeconds === null && this.runningRow())
      durationSeconds = Math.max(1, Math.floor((now - startOf(entry.startedAt)) / 1000))
    const restored: TimeEntry = {
      ...entry,
      projectId,
      personId: entry.personId && this.deps.personExists(entry.personId) ? entry.personId : null,
      startedAt: startOf(entry.startedAt),
      durationSeconds,
      note: noteOf(entry.note ?? ''),
      source: entry.source === 'timer' ? 'timer' : 'manual',
      billable: entry.billable === true,
      // A deleted entry was never billed: billed time cannot be deleted.
      billingId: null,
      updatedAt: now
    }
    this.insert(restored, durationSeconds === null ? now : null)
    this.changed(projectId)
    return this.get(entry.id)
  }

  // ─── The timer ────────────────────────────────────────────────────────────

  timerState(): TimerState {
    const running = this.runningRow()
    if (this.interrupted && running?.id !== this.interrupted.entryId) this.interrupted = null
    return { running: running ? toEntry(running) : null, interrupted: this.interrupted }
  }

  /**
   * Starts a timer on a task for Me. A timer already running stops now (D33);
   * the result names it so the toast can undo the switch.
   */
  startTimer(projectId: string, workItemId: string, now = Date.now()): TimerStart {
    const task = this.liveTask(projectId, workItemId)
    const start = this.db.transaction((): TimerStart => {
      const stopped = this.stopRunning(now)
      const entry: TimeEntry = {
        id: uuidv4(),
        projectId,
        workItemId: task.id,
        workItemTitle: '',
        personId: this.person(this.deps.meId()),
        startedAt: now,
        durationSeconds: null,
        note: '',
        source: 'timer',
        billable: this.newTimeBillable(projectId),
        billingId: null,
        createdAt: now,
        updatedAt: now
      }
      this.insert(entry, now)
      // A timer stopped as it started left no entry, so there is nothing to undo back to.
      return { started: this.get(entry.id), stopped: stopped?.durationSeconds ? stopped : null }
    })()
    this.interrupted = null
    if (start.stopped && start.stopped.projectId !== projectId)
      this.changed(start.stopped.projectId)
    this.changed(projectId)
    return start
  }

  /** Stops the running timer now, or at `at`. Null when none runs. */
  stopTimer(at = Date.now()): TimeEntry | null {
    const stopped = this.stopRunning(at)
    this.interrupted = null
    if (stopped) this.changed(stopped.projectId)
    return stopped
  }

  /**
   * Undoes a start: the started entry goes, and the timer it stopped runs on
   * from its own start, as if it had never stopped.
   */
  undoStart(startedId: string, stoppedId: string | null): TimerState {
    const started = this.get(startedId)
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM planning_time_entries WHERE id = ?').run(started.id)
      if (stoppedId && !this.runningRow()) {
        const stopped = this.get(stoppedId)
        this.db
          .prepare(
            'UPDATE planning_time_entries SET duration_seconds = NULL, heartbeat_at = ?, updated_at = ? WHERE id = ?'
          )
          .run(Date.now(), Date.now(), stopped.id)
        if (stopped.projectId !== started.projectId) this.changed(stopped.projectId)
      }
    })()
    this.changed(started.projectId)
    return this.timerState()
  }

  /**
   * The person's answer to a timer found running at start (D33): keep it
   * running, or stop it at the time Ostler closed.
   */
  resolveInterrupted(choice: 'keep' | 'stop'): TimerState {
    const interrupted = this.timerState().interrupted
    if (interrupted && choice === 'stop') this.stopRunning(interrupted.closedAt)
    this.interrupted = null
    const state = this.timerState()
    if (interrupted) {
      const entry = this.db
        .prepare('SELECT project_id FROM planning_time_entries WHERE id = ?')
        .get(interrupted.entryId) as { project_id: string } | undefined
      if (entry) this.changed(entry.project_id)
    }
    return state
  }

  /** Records that Ostler is running with the timer now (every minute, and on quit). */
  heartbeat(now = Date.now()): void {
    // While the person has not answered, the last moment before the close stays as it was.
    if (this.interrupted) return
    this.db
      .prepare('UPDATE planning_time_entries SET heartbeat_at = ? WHERE duration_seconds IS NULL')
      .run(now)
  }

  // ─── The project file ─────────────────────────────────────────────────────

  /** Writes entries read from a project file; their tasks must be in the project. */
  importEntries(projectId: string, entries: readonly TimeEntry[]): void {
    const insert = this.db.transaction(() => {
      for (const entry of entries) this.insert({ ...entry, projectId }, null)
    })
    insert()
  }

  // ─── Billing (N6.4) ───────────────────────────────────────────────────────

  /** The project's "New time is billable": new entries start with it, from the timer or by hand. */
  newTimeBillable(projectId: string): boolean {
    const row = this.db
      .prepare('SELECT new_time_billable FROM project_budgets WHERE project_id = ?')
      .get(projectId) as { new_time_billable: number } | undefined
    return row?.new_time_billable === 1
  }

  /** A billing was marked, unmarked or restored: entries' locks changed, so every surface reloads. */
  billingChanged(projectId: string): void {
    this.changed(projectId)
  }

  /**
   * Billed time is locked until its billing is unmarked: every surface that
   * changes or deletes an entry comes through here.
   */
  refuseBilled(entry: Pick<TimeEntry, 'billingId'>): void {
    if (entry.billingId === null) return
    const billing = this.db
      .prepare('SELECT marked_at FROM billings WHERE id = ?')
      .get(entry.billingId) as { marked_at: number } | undefined
    if (!billing) return
    throw new Refusal(
      t('errors:timeTracking.billed', {
        date: formatDate(billing.marked_at, { day: 'numeric', month: 'long' })
      })
    )
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private stopRunning(at: number): TimeEntry | null {
    const running = this.runningRow()
    if (!running) return null
    const seconds = Math.min(
      MAX_TIME_ENTRY_SECONDS,
      Math.max(0, Math.floor((at - running.started_at) / 1000))
    )
    if (seconds === 0) {
      // A timer stopped as it started logged nothing; keep no empty entry.
      this.db.prepare('DELETE FROM planning_time_entries WHERE id = ?').run(running.id)
      return { ...toEntry(running), durationSeconds: 0 }
    }
    this.db
      .prepare('UPDATE planning_time_entries SET duration_seconds = ?, updated_at = ? WHERE id = ?')
      .run(seconds, Date.now(), running.id)
    return this.get(running.id)
  }

  private runningRow(): EntryRow | undefined {
    return this.db.prepare(`${SELECT} WHERE e.duration_seconds IS NULL LIMIT 1`).get() as
      EntryRow | undefined
  }

  private insert(entry: TimeEntry, heartbeatAt: number | null): void {
    this.db
      .prepare(
        `INSERT INTO planning_time_entries (id, project_id, work_item_id, person_id, started_at,
          duration_seconds, note, source, billable, billing_id, heartbeat_at, created_at,
          updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.projectId,
        entry.workItemId,
        entry.personId,
        entry.startedAt,
        entry.durationSeconds,
        entry.note,
        entry.source,
        entry.billable ? 1 : 0,
        entry.billingId ?? null,
        heartbeatAt,
        entry.createdAt,
        entry.updatedAt
      )
  }

  private task(workItemId: unknown): TaskRow {
    if (typeof workItemId !== 'string') throw new Refusal(t('errors:timeTracking.taskNotFound'))
    const row = this.db
      .prepare(
        'SELECT id, project_id, archived_at, deleted_at FROM planning_work_items WHERE id = ?'
      )
      .get(workItemId) as TaskRow | undefined
    if (!row) throw new Refusal(t('errors:timeTracking.taskNotFound'))
    return row
  }

  /** A task in `projectId` that is not archived or in the bin. */
  private liveTask(projectId: string, workItemId: unknown): TaskRow {
    this.deps.requireProject(projectId)
    const task = this.task(workItemId)
    if (task.project_id !== projectId) throw new Refusal(t('errors:timeTracking.taskNotInProject'))
    if (task.archived_at !== null || task.deleted_at !== null)
      throw new Refusal(t('errors:timeTracking.taskClosed'))
    return task
  }

  private person(personId: unknown): string | null {
    if (personId === null || personId === undefined) return null
    if (typeof personId !== 'string' || !this.deps.personExists(personId))
      throw new Refusal(t('errors:timeTracking.personNotFound'))
    return personId
  }
}

function startOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new Refusal(t('errors:timeTracking.startInvalid'))
  return Math.round(value)
}

function durationOf(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_TIME_ENTRY_SECONDS
  )
    throw new Refusal(t('errors:timeTracking.durationInvalid'))
  return Math.round(value)
}

function billableOf(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Refusal(t('errors:timeTracking.billableInvalid'))
  return value
}

function noteOf(value: unknown): string {
  if (typeof value !== 'string') throw new Refusal(t('errors:timeTracking.noteInvalid'))
  const note = value.trim()
  if (note.length > MAX_TIME_NOTE_LENGTH)
    throw new Refusal(t('errors:timeTracking.noteTooLong', { max: MAX_TIME_NOTE_LENGTH }))
  return note
}

function toEntry(row: EntryRow): TimeEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    workItemTitle: row.title ?? '',
    personId: row.person_id,
    startedAt: row.started_at,
    durationSeconds: row.duration_seconds,
    note: row.note,
    source: row.source,
    billable: row.billable === 1,
    billingId: row.billing_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
