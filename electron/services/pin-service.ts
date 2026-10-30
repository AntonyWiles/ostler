import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  CreatePinInput,
  LibraryItemKind,
  ListPinsQuery,
  MovePinInput,
  Pin,
  PinKind,
  PinPlace,
  PinView,
  PlanningWorkItemStatus,
  SavedViewType,
  SetPinCountdownInput
} from '@shared/ostler-api'
import { PERSONAL_PIN_PROJECT, PIN_KINDS, PIN_PLACES, PIN_SIDEBAR_MAX } from '@shared/ostler-api'
import { orderKeyBetween } from '@shared/planning/order-key'
import { Refusal } from '@shared/refusal'
import { todayIsoDate } from '@shared/dates'
import { COUNTDOWN_MAX, countdownWords } from '@shared/planning/countdown'
import type { PersonWorkingDays } from '@shared/planning/working-days'

/**
 * What a countdown is worded with: the person's local date and their own
 * working days (`myWorkingDays`: Me's working days and days off, and
 * everyone's).
 */
export interface CountdownContext extends PersonWorkingDays {
  today: string
}

interface PinRow {
  id: string
  place: PinPlace
  project_id: string
  kind: PinKind
  target_id: string
  order_key: string
  created_at: number
  countdown: number
}

/** A project view's id: the app names it; main checks only its shape (the registry is the list). */
const PROJECT_VIEW_ID = /^[a-z][a-z-]{1,39}$/

interface TargetRow {
  id: string
  project_id: string
  title: string
  archived?: number
  status?: PlanningWorkItemStatus
  library_kind?: LibraryItemKind
  url?: string | null
  view_type?: SavedViewType
  date?: string | null
  done?: number
}

/** One query per kind, for every pin of that kind: titles are read, never stored (N37). */
const TARGETS: Record<Exclude<PinKind, 'project-view'>, (marks: string) => string> = {
  task: (marks) =>
    `SELECT id, project_id, title, status, (archived_at IS NOT NULL) AS archived,
       target_date AS date, (status = 'done') AS done
     FROM planning_work_items WHERE id IN (${marks}) AND deleted_at IS NULL`,
  milestone: (marks) =>
    `SELECT id, project_id, name AS title, target_date AS date, (status = 'complete') AS done
     FROM planning_milestones WHERE id IN (${marks})`,
  decision: (marks) =>
    `SELECT id, project_id, title FROM planning_decisions WHERE id IN (${marks})`,
  library: (marks) =>
    `SELECT id, project_id, title, kind AS library_kind, url, (archived_at IS NOT NULL) AS archived
     FROM library_items WHERE id IN (${marks})`,
  'saved-view': (marks) =>
    `SELECT id, project_id, name AS title, view_type FROM saved_views
     WHERE id IN (${marks}) AND is_default = 0`,
  // A goal of one's own (N5.6b) is in no project; it counts down to its measure's target date.
  'personal-goal': (marks) =>
    `SELECT id, '' AS project_id, title, measure_target_date AS date, (status <> 'active') AS done
     FROM personal_goals WHERE id IN (${marks})`
}

/** The kinds that have a date and can count down (N5.2b, N5.6b). */
function isDated(kind: PinKind): boolean {
  return kind === 'task' || kind === 'milestone' || kind === 'personal-goal'
}

export function isPinPlace(value: unknown): value is PinPlace {
  return typeof value === 'string' && (PIN_PLACES as readonly string[]).includes(value)
}

export function isPinKind(value: unknown): value is PinKind {
  return typeof value === 'string' && (PIN_KINDS as readonly string[]).includes(value)
}

/**
 * Pins (N5.2a, N37): pointers to tasks, milestones, decisions, Library items,
 * saved views and project views, in the sidebar or on a project's Overview.
 * The desktop app and the automation API both write through here. A pin never
 * touches its target: unpinning leaves the item as it is. Deleting the item
 * keeps the pin but leaves it out of every list (MOP-39), so restoring the
 * item from the recycle bin brings its pin back where it was.
 */
export class PinService {
  /** Today and the working days a countdown is worded with (N5.2b); set by the app. */
  private countdownContext: () => CountdownContext = () => ({
    today: todayIsoDate()
  })

  constructor(
    private readonly db: Database.Database,
    private readonly getProjectIds: () => string[],
    private readonly changed: (projectId: string) => void = () => {}
  ) {}

  /** Where today and the working days come from when a countdown is worded. */
  setCountdownContext(context: () => CountdownContext): void {
    this.countdownContext = context
  }

  /**
   * Every countdown (N5.2b), in pin order: the sidebar's, then each project's
   * Overview's. A target pinned in both places counts down once.
   */
  countdowns(): PinView[] {
    const known = this.known()
    const rows = this.db
      .prepare(
        `SELECT * FROM pins WHERE countdown = 1
         AND project_id IN (${known.map(() => '?').join(', ')})
         ORDER BY place = 'overview', CASE WHEN place = 'overview' THEN project_id END, order_key`
      )
      .all(...known) as PinRow[]
    const seen = new Set<string>()
    const unique = rows.filter((row) => {
      const key = `${row.kind}:${row.target_id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return this.resolve(unique.map(toPin))
  }

  /**
   * Turns a pin's countdown on or off (N5.2b). Only a pin of a milestone with
   * a target date or a task with a due date counts down, and at most
   * `COUNTDOWN_MAX` items at once: a fourth is refused unless `replacePinId`
   * names one of the three to turn off in the same change.
   */
  setCountdown(pinId: string, input: SetPinCountdownInput): PinView {
    const pin = this.get(pinId)
    if (!input || typeof input !== 'object' || typeof input.countdown !== 'boolean')
      throw new Refusal('Send { countdown: true } or { countdown: false }')
    if (input.replacePinId !== undefined && typeof input.replacePinId !== 'string')
      throw new Refusal('replacePinId must be a pin id')
    const sameTarget = this.db
      .prepare('SELECT id FROM pins WHERE kind = ? AND target_id = ? AND project_id = ?')
      .all(pin.kind, pin.targetId, pin.projectId) as { id: string }[]
    if (!input.countdown) {
      // Off for the item: a target pinned in both places stops counting down in both.
      this.db
        .prepare(
          `UPDATE pins SET countdown = 0 WHERE id IN (${sameTarget.map(() => '?').join(', ')})`
        )
        .run(...sameTarget.map((row) => row.id))
      this.changed(pin.projectId)
      return this.resolve([{ ...pin, countdown: false }])[0]
    }
    const [view] = this.resolve([pin])
    if (!isDated(pin.kind))
      throw new Refusal(
        'Only a pinned milestone or task, or a goal of your own, can show as a countdown'
      )
    if (!view.exists) throw new Refusal(`${KIND_NAMES[pin.kind]} not found`)
    if (!view.date)
      throw new Refusal(
        pin.kind === 'task'
          ? 'Give the task a due date before it can show as a countdown'
          : pin.kind === 'milestone'
            ? 'Give the milestone a target date before it can show as a countdown'
            : 'Give the goal a measure with a target date before it can show as a countdown'
      )
    if (pin.countdown) return view
    const others = this.countdowns().filter(
      (other) => !(other.kind === pin.kind && other.targetId === pin.targetId)
    )
    let replaced: PinView | null = null
    if (others.length >= COUNTDOWN_MAX) {
      if (input.replacePinId === undefined)
        throw new Refusal(
          `At most ${COUNTDOWN_MAX} countdowns show at once. Turn one off first, or send replacePinId.`
        )
      replaced = others.find((other) => other.id === input.replacePinId) ?? null
      if (!replaced) {
        // The id may be the other place's pin of a counting-down target.
        const named = this.db.prepare('SELECT * FROM pins WHERE id = ?').get(input.replacePinId) as
          PinRow | undefined
        replaced =
          (named &&
            others.find(
              (other) => other.kind === named.kind && other.targetId === named.target_id
            )) ??
          null
      }
      if (!replaced) throw new Refusal('replacePinId is not one of the countdowns')
    }
    this.db.transaction(() => {
      if (replaced)
        this.db
          .prepare(
            'UPDATE pins SET countdown = 0 WHERE kind = ? AND target_id = ? AND project_id = ?'
          )
          .run(replaced.kind, replaced.targetId, replaced.projectId)
      this.db.prepare('UPDATE pins SET countdown = 1 WHERE id = ?').run(pin.id)
    })()
    if (replaced && replaced.projectId !== pin.projectId) this.changed(replaced.projectId)
    this.changed(pin.projectId)
    return this.resolve([{ ...pin, countdown: true }])[0]
  }

  /** The sidebar's pins, or one project's Overview's, in order, with their targets' current titles. */
  list(query: ListPinsQuery): PinView[] {
    const place = this.parsePlace(query?.place)
    const known = this.known()
    let rows: PinRow[]
    if (place === 'overview') {
      const projectId = this.requireProject(query.projectId)
      rows = this.db
        .prepare(
          "SELECT * FROM pins WHERE place = 'overview' AND project_id = ? ORDER BY order_key"
        )
        .all(projectId) as PinRow[]
    } else {
      rows = this.db
        .prepare(
          `SELECT * FROM pins WHERE place = 'sidebar'
           AND project_id IN (${known.map(() => '?').join(', ')}) ORDER BY order_key`
        )
        .all(...known) as PinRow[]
      if (query.projectId !== undefined) {
        const projectId = this.requireProject(query.projectId)
        rows = rows.filter((row) => row.project_id === projectId)
      }
    }
    // A pin whose item was deleted is left out (MOP-39); it is kept so a restore brings it back.
    return this.resolve(rows.map(toPin)).filter((pin) => pin.exists)
  }

  get(pinId: string): Pin {
    if (typeof pinId !== 'string') throw new Refusal('Pin not found')
    const row = this.db.prepare('SELECT * FROM pins WHERE id = ?').get(pinId) as PinRow | undefined
    if (!row || !this.known().includes(row.project_id)) throw new Refusal('Pin not found')
    return toPin(row)
  }

  /** The projects Ostler knows, and no project: the pins of goals of one's own (N5.6b). */
  private known(): string[] {
    return [...this.getProjectIds(), PERSONAL_PIN_PROJECT]
  }

  /**
   * Pins a target. Pinning what is already pinned in that place returns the
   * pin that is there. The target must exist, in a project Ostler knows; an
   * overview pin goes on its target's own project.
   */
  create(input: CreatePinInput): PinView {
    if (!input || typeof input !== 'object') throw new Refusal('Send { place, kind, targetId }')
    const place = this.parsePlace(input.place)
    if (!isPinKind(input.kind))
      throw new Refusal(`A pin's kind must be one of: ${PIN_KINDS.join(', ')}`)
    if (typeof input.targetId !== 'string' || !input.targetId)
      throw new Refusal('Send the targetId of the item to pin')
    if (input.kind === 'personal-goal' && place !== 'sidebar')
      throw new Refusal('A goal of your own pins to the sidebar only')
    const projectId = this.targetProject(input.kind, input.targetId, input.projectId)
    const existing = this.db
      .prepare(
        'SELECT * FROM pins WHERE place = ? AND project_id = ? AND kind = ? AND target_id = ?'
      )
      .get(place, projectId, input.kind, input.targetId) as PinRow | undefined
    if (existing) return this.resolve([toPin(existing)])[0]
    this.checkRoom(place)
    const pin: Pin = {
      id: uuidv4(),
      place,
      projectId,
      kind: input.kind,
      targetId: input.targetId,
      orderKey: orderKeyBetween(this.lastKey(place, projectId), null),
      createdAt: Date.now(),
      countdown: false
    }
    this.insert(pin)
    this.changed(projectId)
    return this.resolve([pin])[0]
  }

  /** Unpins. Returns the pin, so the app can offer undo (`restore`). The target is not touched. */
  delete(pinId: string): Pin {
    const pin = this.get(pinId)
    this.db.prepare('DELETE FROM pins WHERE id = ?').run(pin.id)
    this.changed(pin.projectId)
    return pin
  }

  /** Puts an unpinned pin back where it was, with its id. */
  restore(pin: Pin): PinView {
    if (!pin || typeof pin !== 'object' || typeof pin.id !== 'string')
      throw new Refusal('Nothing to restore')
    const exists = this.db.prepare('SELECT * FROM pins WHERE id = ?').get(pin.id) as
      PinRow | undefined
    if (exists) return this.resolve([toPin(exists)])[0]
    const place = this.parsePlace(pin.place)
    if (!isPinKind(pin.kind) || typeof pin.targetId !== 'string')
      throw new Refusal('Nothing to restore')
    if (pin.kind === 'personal-goal') {
      if (pin.projectId !== PERSONAL_PIN_PROJECT || place !== 'sidebar')
        throw new Refusal('Nothing to restore')
    } else this.requireProject(pin.projectId)
    const duplicate = this.db
      .prepare(
        'SELECT * FROM pins WHERE place = ? AND project_id = ? AND kind = ? AND target_id = ?'
      )
      .get(place, pin.projectId, pin.kind, pin.targetId) as PinRow | undefined
    if (duplicate) return this.resolve([toPin(duplicate)])[0]
    this.checkRoom(place)
    const taken =
      typeof pin.orderKey === 'string' &&
      this.db
        .prepare('SELECT 1 FROM pins WHERE place = ? AND order_key = ?')
        .get(place, pin.orderKey)
    const restored: Pin = {
      id: pin.id,
      place,
      projectId: pin.projectId,
      kind: pin.kind,
      targetId: pin.targetId,
      orderKey:
        typeof pin.orderKey === 'string' && /^[0-9A-Za-z]*[1-9A-Za-z]$/.test(pin.orderKey) && !taken
          ? pin.orderKey
          : orderKeyBetween(this.lastKey(place, pin.projectId), null),
      createdAt: Number.isFinite(pin.createdAt) ? pin.createdAt : Date.now(),
      countdown: false
    }
    this.insert(restored)
    // Its countdown comes back too, while there is room for it (N5.2b).
    if (pin.countdown === true) {
      try {
        this.setCountdown(restored.id, { countdown: true })
        restored.countdown = true
      } catch {
        // Three others count down now, or its date has gone: it comes back without one.
      }
    }
    this.changed(restored.projectId)
    return this.resolve([restored])[0]
  }

  /** Moves a pin before or after another in the same place; with neither, to the end. */
  move(pinId: string, input: MovePinInput = {}): PinView {
    const pin = this.get(pinId)
    const { beforeId, afterId } = input ?? {}
    if (beforeId !== undefined && afterId !== undefined)
      throw new Refusal('Send beforeId or afterId, not both')
    const siblings = this.siblings(pin).filter((row) => row.id !== pin.id)
    let index = siblings.length
    const anchorId = beforeId ?? afterId
    if (anchorId !== undefined) {
      const at = siblings.findIndex((row) => row.id === anchorId)
      if (at === -1) throw new Refusal('The pin to move next to is not in the same place')
      index = beforeId !== undefined ? at : at + 1
    }
    const before = siblings[index - 1]?.order_key ?? null
    const after = siblings[index]?.order_key ?? null
    const orderKey = orderKeyBetween(before, after)
    this.db.prepare('UPDATE pins SET order_key = ? WHERE id = ?').run(orderKey, pin.id)
    this.changed(pin.projectId)
    return this.resolve([{ ...pin, orderKey }])[0]
  }

  /** A project's overview pins, for its project file (sidebar pins are the person's). */
  overviewPins(projectId: string): Pin[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM pins WHERE place = 'overview' AND project_id = ? ORDER BY order_key"
        )
        .all(projectId) as PinRow[]
    ).map(toPin)
  }

  /**
   * Writes overview pins for a project being created from its project file,
   * with targets already mapped to the new ids. Pins whose target did not come
   * across are left out.
   */
  importOverviewPins(projectId: string, entries: { kind: PinKind; targetId: string }[]): number {
    let added = 0
    let last = this.lastKey('overview', projectId)
    for (const entry of entries) {
      if (!isPinKind(entry.kind) || typeof entry.targetId !== 'string') continue
      try {
        if (this.targetProject(entry.kind, entry.targetId, projectId) !== projectId) continue
      } catch {
        continue
      }
      const orderKey = orderKeyBetween(last, null)
      const result = this.db
        .prepare(
          `INSERT OR IGNORE INTO pins (id, place, project_id, kind, target_id, order_key, created_at)
           VALUES (?, 'overview', ?, ?, ?, ?, ?)`
        )
        .run(uuidv4(), projectId, entry.kind, entry.targetId, orderKey, Date.now())
      if (result.changes > 0) {
        last = orderKey
        added++
      }
    }
    return added
  }

  /** The pins with their targets' current titles, in one query per kind. */
  resolve(pins: Pin[]): PinView[] {
    let context: CountdownContext | null = null
    const found = new Map<string, TargetRow>()
    const byKind = new Map<Exclude<PinKind, 'project-view'>, string[]>()
    for (const pin of pins) {
      if (pin.kind === 'project-view') continue
      byKind.set(pin.kind, [...(byKind.get(pin.kind) ?? []), pin.targetId])
    }
    for (const [kind, ids] of byKind) {
      const unique = [...new Set(ids)]
      const rows = this.db
        .prepare(TARGETS[kind](unique.map(() => '?').join(', ')))
        .all(...unique) as TargetRow[]
      for (const row of rows) found.set(`${kind}:${row.id}`, row)
    }
    return pins.map((pin) => {
      if (pin.kind === 'project-view') {
        return { ...pin, exists: PROJECT_VIEW_ID.test(pin.targetId), title: null, archived: false }
      }
      const row = found.get(`${pin.kind}:${pin.targetId}`)
      // A target must still be in the pin's project: a pin cannot borrow another project's item.
      if (!row || row.project_id !== pin.projectId)
        return { ...pin, exists: false, title: null, archived: false }
      const dated = isDated(pin.kind)
      const date = dated ? (row.date ?? null) : undefined
      const done = dated ? Boolean(row.done) : undefined
      let countdownText: string | null | undefined = dated ? null : undefined
      if (dated && pin.countdown && date) {
        context ??= this.countdownContext()
        countdownText = countdownWords(
          { title: row.title, date, done: Boolean(done) },
          context.today,
          context
        )
      }
      return {
        ...pin,
        exists: true,
        title: row.title,
        archived: Boolean(row.archived),
        ...(row.status ? { status: row.status } : {}),
        ...(row.library_kind ? { libraryKind: row.library_kind, url: row.url ?? null } : {}),
        ...(row.view_type ? { viewType: row.view_type } : {}),
        ...(dated ? { date, done, countdownText } : {})
      }
    })
  }

  /** The project a target belongs to, checked: it exists and Ostler knows its project. */
  private targetProject(kind: PinKind, targetId: string, projectId?: string): string {
    if (kind === 'project-view') {
      if (!PROJECT_VIEW_ID.test(targetId)) throw new Refusal('Unknown project view')
      return this.requireProject(projectId)
    }
    const row = this.db.prepare(TARGETS[kind]('?')).get(targetId) as TargetRow | undefined
    if (!row || !this.known().includes(row.project_id))
      throw new Refusal(`${KIND_NAMES[kind]} not found`)
    if (projectId !== undefined && projectId !== row.project_id)
      throw new Refusal(`${KIND_NAMES[kind]} not found`)
    return row.project_id
  }

  private checkRoom(place: PinPlace): void {
    if (place !== 'sidebar') return
    const known = this.known()
    const { n } = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM pins WHERE place = 'sidebar'
         AND project_id IN (${known.map(() => '?').join(', ')})`
      )
      .get(...known) as { n: number }
    if (n >= PIN_SIDEBAR_MAX)
      throw new Refusal(
        `The sidebar holds at most ${PIN_SIDEBAR_MAX} pins. Unpin one to make room.`
      )
  }

  /** The pins sharing a pin's order: every sidebar pin, or the project's overview pins. */
  private siblings(pin: Pin): PinRow[] {
    return pin.place === 'sidebar'
      ? (this.db
          .prepare("SELECT * FROM pins WHERE place = 'sidebar' ORDER BY order_key")
          .all() as PinRow[])
      : (this.db
          .prepare(
            "SELECT * FROM pins WHERE place = 'overview' AND project_id = ? ORDER BY order_key"
          )
          .all(pin.projectId) as PinRow[])
  }

  private lastKey(place: PinPlace, projectId: string): string | null {
    const row = (
      place === 'sidebar'
        ? this.db.prepare("SELECT MAX(order_key) AS k FROM pins WHERE place = 'sidebar'").get()
        : this.db
            .prepare(
              "SELECT MAX(order_key) AS k FROM pins WHERE place = 'overview' AND project_id = ?"
            )
            .get(projectId)
    ) as { k: string | null }
    return row.k
  }

  private parsePlace(value: unknown): PinPlace {
    if (!isPinPlace(value))
      throw new Refusal(`A pin's place must be one of: ${PIN_PLACES.join(', ')}`)
    return value
  }

  private requireProject(projectId: unknown): string {
    if (typeof projectId !== 'string' || !this.getProjectIds().includes(projectId))
      throw new Refusal('Project not found')
    return projectId
  }

  private insert(pin: Pin): void {
    this.db
      .prepare(
        `INSERT INTO pins (id, place, project_id, kind, target_id, order_key, created_at, countdown)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        pin.id,
        pin.place,
        pin.projectId,
        pin.kind,
        pin.targetId,
        pin.orderKey,
        pin.createdAt,
        pin.countdown ? 1 : 0
      )
  }
}

const KIND_NAMES: Record<PinKind, string> = {
  task: 'Task',
  milestone: 'Milestone',
  decision: 'Decision',
  library: 'Library item',
  'saved-view': 'Saved view',
  'project-view': 'Project view',
  'personal-goal': 'Goal'
}

function toPin(row: PinRow): Pin {
  return {
    id: row.id,
    place: row.place,
    projectId: row.project_id,
    kind: row.kind,
    targetId: row.target_id,
    orderKey: row.order_key,
    createdAt: row.created_at,
    countdown: row.countdown === 1
  }
}
