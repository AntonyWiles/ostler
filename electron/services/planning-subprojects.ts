import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  CreatePlanningSubprojectInput,
  PlanningSubproject,
  PlanningSubprojectStatus,
  UpdatePlanningSubprojectInput
} from '@shared/ostler-api'
import { isProjectIcon, normalizeProjectIcon, type ProjectIcon } from '@shared/project-icons'
import { isHexColor, paletteColorFor } from '@shared/project-colors'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'

const STATUSES: readonly PlanningSubprojectStatus[] = ['active', 'on_hold', 'done']

/** The longest a workstream's name can be. */
export const MAX_SUBPROJECT_NAME_LENGTH = 80

interface SubprojectRow {
  id: string
  project_id: string
  name: string
  description: string
  color: string
  icon: string | null
  lead_id: string | null
  members: string
  status: PlanningSubprojectStatus
  position: number
  archived_at: number | null
  created_at: number
  updated_at: number
}

/** What sub-projects need from the planning service around them. */
export interface PlanningSubprojectsHost {
  requireProject(projectId: string): void
  changed(projectId: string): void
}

/**
 * Sub-projects (shown as workstreams), stored. A sub-project is a named part
 * of one project: it carries the project's own `project_id`, so everything the
 * project shares reaches it. Only tasks and milestones say which part they
 * belong to (`subproject_id`). Deleting one sets that to null on both, in the
 * same transaction; archiving only sets `archived_at`.
 */
export class PlanningSubprojects {
  constructor(
    private readonly db: Database.Database,
    private readonly host: PlanningSubprojectsHost
  ) {}

  /** A project's sub-projects, archived ones included, in their order. */
  list(projectId: string): PlanningSubproject[] {
    this.host.requireProject(projectId)
    return this.rows(projectId)
  }

  get(id: string): PlanningSubproject {
    const row =
      typeof id === 'string'
        ? (this.db.prepare('SELECT * FROM planning_subprojects WHERE id = ?').get(id) as
            SubprojectRow | undefined)
        : undefined
    if (!row) throw new Refusal(t('errors:planningSubprojects.notFound'))
    this.host.requireProject(row.project_id)
    return toSubproject(row)
  }

  /** Refuses an id that is not one of this project's sub-projects (D4). */
  requireInProject(id: string, projectId: string): PlanningSubproject {
    if (typeof id !== 'string' || id.length === 0)
      throw new Refusal(t('errors:planningSubprojects.notFound'))
    const found = this.db
      .prepare('SELECT project_id FROM planning_subprojects WHERE id = ?')
      .get(id) as { project_id: string } | undefined
    if (!found) throw new Refusal(t('errors:planningSubprojects.notFound'))
    if (found.project_id !== projectId)
      throw new Refusal(t('errors:planningSubprojects.otherProject'))
    return this.get(id)
  }

  create(
    projectId: string,
    input: CreatePlanningSubprojectInput,
    now = Date.now()
  ): PlanningSubproject {
    this.host.requireProject(projectId)
    const name = requiredName(input?.name)
    const top = this.db
      .prepare('SELECT MAX(position) AS top FROM planning_subprojects WHERE project_id = ?')
      .get(projectId) as { top: number | null }
    const subproject: PlanningSubproject = {
      id: uuidv4(),
      projectId,
      name,
      description: descriptionValue(input?.description),
      color: colorValue(input?.color, name),
      icon: iconValue(input?.icon),
      leadId: this.personValue(input?.leadId),
      memberIds: this.memberIdsValue(input?.memberIds),
      status: statusValue(input?.status),
      position: top.top === null ? 0 : top.top + 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now
    }
    this.db
      .prepare(
        `INSERT INTO planning_subprojects
           (id, project_id, name, description, color, icon, lead_id, members, status,
            position, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        subproject.id,
        subproject.projectId,
        subproject.name,
        subproject.description,
        subproject.color,
        subproject.icon ? JSON.stringify(subproject.icon) : null,
        subproject.leadId,
        JSON.stringify(subproject.memberIds),
        subproject.status,
        subproject.position,
        null,
        subproject.createdAt,
        subproject.updatedAt
      )
    this.host.changed(projectId)
    return subproject
  }

  update(id: string, updates: UpdatePlanningSubprojectInput, now = Date.now()): PlanningSubproject {
    const current = this.get(id)
    const input = updates ?? {}
    const name = input.name === undefined ? current.name : requiredName(input.name)
    const next: PlanningSubproject = {
      ...current,
      name,
      description:
        input.description === undefined ? current.description : descriptionValue(input.description),
      color: input.color === undefined ? current.color : colorValue(input.color, name),
      icon: input.icon === undefined ? current.icon : iconValue(input.icon),
      leadId: input.leadId === undefined ? current.leadId : this.personValue(input.leadId),
      memberIds:
        input.memberIds === undefined ? current.memberIds : this.memberIdsValue(input.memberIds),
      status: input.status === undefined ? current.status : statusValue(input.status),
      updatedAt: now
    }
    this.db
      .prepare(
        `UPDATE planning_subprojects
         SET name = ?, description = ?, color = ?, icon = ?, lead_id = ?, members = ?,
             status = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.name,
        next.description,
        next.color,
        next.icon ? JSON.stringify(next.icon) : null,
        next.leadId,
        JSON.stringify(next.memberIds),
        next.status,
        next.updatedAt,
        next.id
      )
    this.host.changed(next.projectId)
    return next
  }

  /** Moves it one place earlier (-1) or later (1) among its project's sub-projects. */
  move(id: string, direction: -1 | 1): PlanningSubproject[] {
    if (direction !== -1 && direction !== 1)
      throw new Refusal(t('errors:planningSubprojects.directionInvalid'))
    const current = this.get(id)
    const rows = this.rows(current.projectId)
    const from = rows.findIndex((row) => row.id === id)
    const to = from + direction
    if (to >= 0 && to < rows.length) {
      const order = rows.map((row) => row.id)
      ;[order[from], order[to]] = [order[to], order[from]]
      const put = this.db.prepare('UPDATE planning_subprojects SET position = ? WHERE id = ?')
      this.db.transaction(() => order.forEach((rowId, index) => put.run(index, rowId)))()
      this.host.changed(current.projectId)
    }
    return this.rows(current.projectId)
  }

  /** Sets or clears `archived_at`; archiving an archived one keeps its first time. */
  archive(id: string, archived: boolean, now = Date.now()): PlanningSubproject {
    const current = this.get(id)
    const archivedAt = archived ? (current.archivedAt ?? now) : null
    if (archivedAt === current.archivedAt) return current
    this.db
      .prepare('UPDATE planning_subprojects SET archived_at = ?, updated_at = ? WHERE id = ?')
      .run(archivedAt, now, id)
    this.host.changed(current.projectId)
    return { ...current, archivedAt, updatedAt: now }
  }

  /** Deletes it; its tasks and milestones go to the top level of the project (D10). */
  delete(id: string): PlanningSubproject {
    const current = this.get(id)
    this.db.transaction(() => {
      // Not an edit of the task: `updated_at` stays.
      this.db
        .prepare('UPDATE planning_work_items SET subproject_id = NULL WHERE subproject_id = ?')
        .run(id)
      this.db
        .prepare('UPDATE planning_milestones SET subproject_id = NULL WHERE subproject_id = ?')
        .run(id)
      this.db.prepare('DELETE FROM planning_subprojects WHERE id = ?').run(id)
    })()
    this.host.changed(current.projectId)
    return current
  }

  private rows(projectId: string): PlanningSubproject[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM planning_subprojects WHERE project_id = ? ORDER BY position, created_at, id'
      )
      .all(projectId) as SubprojectRow[]
    return rows.map(toSubproject)
  }

  private personValue(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null
    if (
      typeof value !== 'string' ||
      !this.db.prepare('SELECT 1 FROM people WHERE id = ?').get(value)
    )
      throw new Refusal(t('errors:planningSubprojects.unknownPerson'))
    return value
  }

  /** People ids from `people`, each once, in the order given. */
  private memberIdsValue(value: unknown): string[] {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value)) throw new Refusal(t('errors:planningSubprojects.unknownPerson'))
    const ids: string[] = []
    for (const id of value) {
      const checked = this.personValue(id)
      if (checked === null) throw new Refusal(t('errors:planningSubprojects.unknownPerson'))
      if (!ids.includes(checked)) ids.push(checked)
    }
    return ids
  }
}

function toSubproject(row: SubprojectRow): PlanningSubproject {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: parseIcon(row.icon),
    leadId: row.lead_id ?? null,
    memberIds: parseIds(row.members),
    status: STATUSES.includes(row.status) ? row.status : 'active',
    position: row.position,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function parseIcon(value: string | null): ProjectIcon | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return isProjectIcon(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseIds(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function requiredName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Refusal(t('errors:planningSubprojects.nameRequired'))
  const name = value.trim()
  if (name.length > MAX_SUBPROJECT_NAME_LENGTH)
    throw new Refusal(
      t('errors:planningSubprojects.nameTooLong', { max: MAX_SUBPROJECT_NAME_LENGTH })
    )
  return name
}

function descriptionValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > 4000)
    throw new Refusal(t('errors:planningSubprojects.descriptionInvalid'))
  return value
}

function colorValue(value: unknown, name: string): string {
  if (value === undefined || value === null || value === '') return paletteColorFor(name)
  if (!isHexColor(value)) throw new Refusal(t('errors:planningService.colourMustLookLike'))
  return value.toLowerCase()
}

function iconValue(value: unknown): ProjectIcon | null {
  try {
    return normalizeProjectIcon(value)
  } catch {
    throw new Refusal(t('errors:planningSubprojects.iconInvalid'))
  }
}

function statusValue(value: unknown): PlanningSubprojectStatus {
  if (value === undefined || value === null) return 'active'
  if (!STATUSES.includes(value as PlanningSubprojectStatus))
    throw new Refusal(t('errors:planningSubprojects.statusInvalid'))
  return value as PlanningSubprojectStatus
}
