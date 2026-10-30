import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  DEFAULT_WORKING_DAYS,
  MAX_WEEKLY_CAPACITY_HOURS,
  type CreatePersonInput,
  type DeletePersonOptions,
  type Person,
  type PersonUsage,
  type UpdatePersonInput
} from '@shared/ostler-api'
import { isHexColor, paletteColorFor } from '@shared/project-colors'
import { PeopleRepository } from './database/people-repository'
import { t } from '@shared/i18n'
import { attachChangeRecorder } from './change-history/recorder'

const MAX_NAME = 80
const MAX_INITIALS = 3

/**
 * People you assign work to (D5): records, not accounts, in the address book
 * (every project) or one project's own. Every surface (IPC, the automation
 * API) goes through here, so the rules are the same everywhere: a name is
 * required, initials follow the name unless set, a colour comes from the
 * project palette by a stable hash of the id unless chosen, and at most one
 * person is Me, always in the address book. Archiving keeps a person's
 * assignments and only hides them from pickers; deleting hands their work on.
 */
export class PeopleService {
  private readonly db: Database.Database
  private readonly repository: PeopleRepository

  constructor(
    dbPath: string,
    /** Whether a project with this id exists: a project's own person needs one. */
    private readonly projectExists: (projectId: string) => boolean = () => true
  ) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    attachChangeRecorder(this.db)
    this.repository = new PeopleRepository(this.db)
  }

  close(): void {
    this.db.close()
  }

  list(options: { includeArchived?: boolean } = {}): Person[] {
    return this.repository.list(Boolean(options.includeArchived))
  }

  /** People a project can give work to, not archived: the address book and its own. */
  offeredIn(projectId: string): Person[] {
    return this.list().filter(
      (person) => person.projectId === null || person.projectId === projectId
    )
  }

  get(id: string): Person {
    return this.require(id)
  }

  getMe(): Person | null {
    return this.repository.getMe()
  }

  create(input: CreatePersonInput): Person {
    const id = uuidv4()
    const now = Date.now()
    this.repository.insert({
      id,
      name: this.name(input?.name),
      initials: this.initials(input?.initials),
      color: input?.color === undefined ? paletteColorFor(id) : this.color(input.color),
      isMe: false,
      weeklyCapacityHours:
        input?.weeklyCapacityHours === undefined ? null : this.capacity(input.weeklyCapacityHours),
      workingDays:
        input?.workingDays === undefined
          ? [...DEFAULT_WORKING_DAYS]
          : this.workingDays(input.workingDays),
      projectId: this.projectId(input?.projectId),
      at: now
    })
    return this.require(id)
  }

  update(id: string, updates: UpdatePersonInput): Person {
    const current = this.require(id)
    this.repository.update(id, {
      name: updates?.name === undefined ? current.name : this.name(updates.name),
      initials:
        updates?.initials === undefined
          ? this.repository.storedInitials(id)
          : this.initials(updates.initials),
      color: updates?.color === undefined ? current.color : this.color(updates.color),
      weeklyCapacityHours:
        updates?.weeklyCapacityHours === undefined
          ? current.weeklyCapacityHours
          : this.capacity(updates.weeklyCapacityHours),
      workingDays:
        updates?.workingDays === undefined
          ? current.workingDays
          : this.workingDays(updates.workingDays),
      at: Date.now()
    })
    return this.require(id)
  }

  /** Hides a person from pickers. Their tasks stay assigned to them. */
  archive(id: string): Person {
    const current = this.require(id)
    if (current.isMe) throw new Error(t('errors:peopleService.chooseSomeoneElseBefore'))
    if (current.archivedAt === null) this.repository.setArchivedAt(id, Date.now(), Date.now())
    return this.require(id)
  }

  unarchive(id: string): Person {
    this.require(id)
    this.repository.setArchivedAt(id, null, Date.now())
    return this.require(id)
  }

  /** Makes this person Me; whoever was Me before no longer is. */
  setMe(id: string): Person {
    const current = this.require(id)
    if (current.archivedAt !== null) throw new Error(t('errors:peopleService.unarchivePersonFirst'))
    if (current.projectId !== null) throw new Error(t('errors:peopleService.meInAddressBook'))
    this.repository.setMe(id, Date.now())
    return this.require(id)
  }

  /**
   * Edits, archives or unarchives, and makes Me in one step, all or nothing:
   * a refused part leaves the person as they were.
   */
  change(
    id: string,
    edits: UpdatePersonInput | null,
    options: { archived?: boolean; isMe?: boolean }
  ): Person {
    return this.db.transaction(() => {
      let person = this.require(id)
      if (edits) person = this.update(id, edits)
      if (options.archived === true) person = this.archive(id)
      if (options.archived === false) person = this.unarchive(id)
      if (options.isMe === true) person = this.setMe(id)
      return person
    })()
  }

  /**
   * At start-up: makes sure someone is Me, named after the Windows user when
   * nobody is yet. P8.1 asks for a name on first run instead.
   */
  ensureMe(userName: string): Person {
    const existing = this.repository.getMe()
    if (existing) return existing
    const name = userName.trim().slice(0, MAX_NAME) || 'Me'
    const person = this.create({ name })
    return this.setMe(person.id)
  }

  /**
   * Where a person's work is, for the warning before deleting them: their
   * tasks by project (assigned, a checklist item theirs, or a turn in a
   * repeat), the rules that name them, and what stops the delete.
   */
  usage(id: string): PersonUsage {
    const person = this.require(id)
    const projects = this.db
      .prepare(
        `SELECT project_id AS projectId, COUNT(DISTINCT id) AS tasks FROM (
           SELECT id, project_id FROM planning_work_items
             WHERE assignee_id = @id AND deleted_at IS NULL
           UNION ALL
           SELECT d.work_item_id, d.project_id FROM planning_checklist_details d
             JOIN planning_work_items w ON w.id = d.work_item_id
             WHERE d.assignee_id = @id AND w.deleted_at IS NULL
           UNION ALL
           SELECT r.work_item_id, r.project_id FROM planning_recurrences r
             JOIN planning_work_items w ON w.id = r.work_item_id
             WHERE r.rotation IS NOT NULL AND w.deleted_at IS NULL
               AND EXISTS (SELECT 1 FROM json_each(r.rotation) WHERE value = @id)
         ) GROUP BY project_id ORDER BY project_id`
      )
      .all({ id }) as { projectId: string; tasks: number }[]
    return {
      projects,
      rules: this.rulesNaming(id).length,
      isMe: person.isMe,
      sharedMember: this.isSharedMember(id)
    }
  }

  /**
   * Deletes a person for good, in one transaction. Their tasks, checklist
   * items and turns in repeats go to `giveTasksTo`, who must be able to take
   * every one of them (the address book, or the same project's own people),
   * or are left with nobody. Rules that name them name `giveTasksTo` instead,
   * or are turned off. Their days off go. Comments, activity and time logged
   * keep the id and show as someone no longer here.
   */
  delete(id: string, options: DeletePersonOptions): void {
    const person = this.require(id)
    if (person.isMe) throw new Error(t('errors:peopleService.cantDeleteMe'))
    if (this.isSharedMember(id)) throw new Error(t('errors:peopleService.removeFromShareFirst'))
    const target = options?.giveTasksTo ?? null
    this.db.transaction(() => {
      if (target !== null) this.checkTaker(id, target)
      const now = Date.now()
      for (const table of ['planning_work_items', 'planning_checklist_details']) {
        this.db.prepare(`UPDATE ${table} SET assignee_id = ? WHERE assignee_id = ?`).run(target, id)
      }
      this.handOnTurns(id, target)
      for (const rule of this.rulesNaming(id)) {
        const swap = (json: string) => JSON.stringify(swapPerson(JSON.parse(json), id, target))
        this.db
          .prepare(
            `UPDATE planning_rules SET conditions = ?, actions = ?, enabled = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(
            swap(rule.conditions),
            swap(rule.actions),
            target === null ? 0 : rule.enabled,
            now,
            rule.id
          )
      }
      // A template whose person is gone already drops them when used; a taker replaces them.
      if (target !== null) {
        const templates = this.db
          .prepare('SELECT id, body FROM planning_task_templates WHERE instr(body, ?) > 0')
          .all(`"${id}"`) as { id: string; body: string }[]
        for (const template of templates) {
          this.db
            .prepare('UPDATE planning_task_templates SET body = ? WHERE id = ?')
            .run(JSON.stringify(swapPerson(JSON.parse(template.body), id, target)), template.id)
        }
      }
      this.db.prepare('DELETE FROM days_off WHERE person_id = ?').run(id)
      this.db.prepare('DELETE FROM people WHERE id = ?').run(id)
    })()
  }

  /**
   * Gives one person's open tasks in a project (and their checklist items on
   * those tasks) to `toPersonId`, or to nobody, in one transaction. Done,
   * archived and deleted tasks are left alone, as are other projects. Returns
   * how many tasks changed hands.
   */
  handOverOpenTasks(projectId: string, fromPersonId: string, toPersonId: string | null): number {
    return this.db.transaction(() => {
      if (toPersonId !== null) {
        if (toPersonId === fromPersonId) {
          throw new Error(t('errors:peopleService.chooseSomeoneElseToTake'))
        }
        const taker = this.require(toPersonId)
        if (taker.archivedAt !== null) {
          throw new Error(t('errors:peopleService.unarchivePersonFirst'))
        }
        if (!this.canTake(taker, projectId)) {
          throw new Error(t('errors:peopleService.cannotTakeTasks', { personName: taker.name }))
        }
      }
      const open = `FROM planning_work_items WHERE project_id = @projectId AND status <> 'done'
         AND deleted_at IS NULL AND archived_at IS NULL`
      const changed = (
        this.db
          .prepare(`SELECT COUNT(*) AS n ${open} AND assignee_id = @from`)
          .get({ projectId, from: fromPersonId }) as { n: number }
      ).n
      this.db
        .prepare(
          `UPDATE planning_checklist_details SET assignee_id = @to
           WHERE assignee_id = @from AND work_item_id IN (SELECT id ${open})`
        )
        .run({ projectId, from: fromPersonId, to: toPersonId })
      this.db
        .prepare(
          `UPDATE planning_work_items SET assignee_id = @to
           WHERE assignee_id = @from AND project_id = @projectId AND status <> 'done'
             AND deleted_at IS NULL AND archived_at IS NULL`
        )
        .run({ projectId, from: fromPersonId, to: toPersonId })
      return changed
    })()
  }

  /** Whether `person` may be given work in `projectId`: the address book, or that project's own. */
  canTake(person: Person, projectId: string): boolean {
    return person.projectId === null || person.projectId === projectId
  }

  /** Whether a live or archived person with this id is in the address book. */
  inAddressBook(id: string): boolean {
    return this.repository.get(id)?.projectId === null
  }

  /** Whether a live or archived person has this id: an assignee must exist. */
  exists(id: string): boolean {
    return this.repository.get(id) !== null
  }

  private checkTaker(id: string, target: string): void {
    if (target === id) throw new Error(t('errors:peopleService.chooseSomeoneElseToTake'))
    const taker = this.require(target)
    if (taker.archivedAt !== null) throw new Error(t('errors:peopleService.unarchivePersonFirst'))
    const projects = [
      ...this.usage(id).projects.map((entry) => entry.projectId),
      ...this.rulesNaming(id).map((rule) => rule.project_id)
    ]
    if (projects.some((projectId) => !this.canTake(taker, projectId))) {
      throw new Error(t('errors:peopleService.cannotTakeTasks', { personName: taker.name }))
    }
  }

  /** Takes a person out of every take-turns list, or puts `target` in their place. */
  private handOnTurns(id: string, target: string | null): void {
    const rows = this.db
      .prepare(
        `SELECT work_item_id, rotation, next_index FROM planning_recurrences
         WHERE rotation IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(rotation) WHERE value = ?)`
      )
      .all(id) as { work_item_id: string; rotation: string; next_index: number }[]
    const save = this.db.prepare(
      'UPDATE planning_recurrences SET rotation = ?, next_index = ? WHERE work_item_id = ?'
    )
    for (const row of rows) {
      const turns = JSON.parse(row.rotation) as string[]
      const at = turns.indexOf(id)
      let next = row.next_index
      // Each person takes a turn once: a taker already in the list keeps their own place.
      if (target !== null && !turns.includes(target)) {
        turns[at] = target
      } else {
        turns.splice(at, 1)
        if (at < next) next -= 1
        if (next >= turns.length) next = 0
      }
      save.run(turns.length > 0 ? JSON.stringify(turns) : null, next, row.work_item_id)
    }
  }

  private rulesNaming(id: string): {
    id: string
    project_id: string
    enabled: number
    conditions: string
    actions: string
  }[] {
    return this.db
      .prepare(
        `SELECT id, project_id, enabled, conditions, actions FROM planning_rules
         WHERE instr(conditions, @quoted) > 0 OR instr(actions, @quoted) > 0`
      )
      .all({ quoted: `"${id}"` }) as ReturnType<PeopleService['rulesNaming']>
  }

  private isSharedMember(id: string): boolean {
    return (
      this.db
        .prepare('SELECT 1 FROM sync_members WHERE person_id = ? AND removed_at IS NULL LIMIT 1')
        .get(id) !== undefined
    )
  }

  private projectId(value: unknown): string | null {
    if (value === undefined || value === null) return null
    if (typeof value !== 'string' || !value || !this.projectExists(value)) {
      throw new Error(t('errors:peopleService.projectNotFound'))
    }
    return value
  }

  private require(id: string): Person {
    if (typeof id !== 'string' || !id) throw new Error(t('errors:peopleService.personNotFound'))
    const person = this.repository.get(id)
    if (!person) throw new Error(t('errors:peopleService.personNotFound'))
    return person
  }

  private name(value: unknown): string {
    if (typeof value !== 'string' || !value.trim())
      throw new Error(t('errors:peopleService.personNeedsName'))
    if (value.trim().length > MAX_NAME) {
      throw new Error(t('errors:peopleService.nameCanMostCharacters', { MAX_NAME }))
    }
    return value.trim()
  }

  /** '' means "follow the name". */
  private initials(value: unknown): string {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string') throw new Error('Initials must be text')
    const trimmed = value.trim().toUpperCase()
    if ([...trimmed].length > MAX_INITIALS) {
      throw new Error(t('errors:peopleService.initialsCanMostLetters', { MAX_INITIALS }))
    }
    return trimmed
  }

  /** Hours a week, 0 to 168, or null for none. */
  private capacity(value: unknown): number | null {
    if (value === null) return null
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > MAX_WEEKLY_CAPACITY_HOURS
    ) {
      throw new Error(t('errors:peopleService.capacityBetween', { max: MAX_WEEKLY_CAPACITY_HOURS }))
    }
    return Math.round(value * 100) / 100
  }

  /** ISO weekdays, at least one; returned sorted without repeats. */
  private workingDays(value: unknown): number[] {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      !value.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    ) {
      throw new Error(t('errors:peopleService.workingDaysNeeded'))
    }
    return [...new Set(value as number[])].sort((a, b) => a - b)
  }

  private color(value: unknown): string {
    if (!isHexColor(value)) throw new Error(t('errors:peopleService.colourMustLookLike'))
    return value.toLowerCase()
  }
}

/** A rule's or template's JSON with every `personId` or `assigneeId` naming `from` set to `to`. */
function swapPerson(value: unknown, from: string, to: string | null): unknown {
  if (Array.isArray(value)) return value.map((item) => swapPerson(item, from, to))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) =>
      (key === 'personId' || key === 'assigneeId') && item === from
        ? [key, to]
        : [key, swapPerson(item, from, to)]
    )
  )
}
