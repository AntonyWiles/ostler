import type {
  PlanningActor,
  PlanningWorkItem,
  TriageAcceptFields,
  TriageMoveResult,
  WatchedProject
} from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import type { LibraryService } from './library-service'
import type { PlanningService } from './planning-service'

/**
 * Triage (N4.3a, N33): the decisions on a quick capture waiting in its
 * project's To triage view, shared by the app (IPC) and the automation API.
 * Every decision ends in `PlanningService`, whose `setTriageMark` is the one
 * place the mark changes: Accept and Someday through `updateWorkItem`, Won't
 * do and Duplicate of through `closeWorkItemsAsWontDo`, and Move to project
 * through `moveTriagedWorkItem`.
 */

const ACCEPT_FIELDS = [
  'status',
  'priority',
  'assigneeId',
  'labels',
  'targetDate',
  'milestoneId'
] as const

/** Whether a project's quick captures land in To triage (config migration 34 writes false). */
export function triageOn(project: Pick<WatchedProject, 'triageCaptures'>): boolean {
  return project.triageCaptures === true
}

/**
 * Reads Accept's fields from an untrusted caller (the renderer or an HTTP
 * body): only status, priority, assignee, labels, due date and milestone.
 * Each value is checked by `updateWorkItem`, the one write path.
 */
export function readAcceptFields(input: unknown): TriageAcceptFields {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input))
    throw new Refusal('Accept fields must be an object')
  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(ACCEPT_FIELDS as readonly string[]).includes(key))
      throw new Refusal(`Accept cannot set ${key}; it sets ${ACCEPT_FIELDS.join(', ')}`)
    if (value !== undefined) fields[key] = value
  }
  return fields as TriageAcceptFields
}

function requireTriaged(
  planning: PlanningService,
  project: WatchedProject,
  workItemId: string
): PlanningWorkItem {
  const item = planning.getWorkItem(workItemId)
  if (item.projectId !== project.id)
    throw new Refusal('Planning work item belongs to another project')
  if (!item.inTriage || item.deletedAt || item.archivedAt)
    throw new Refusal('This task is not in To triage')
  return item
}

/**
 * Accept: the task leaves To triage with the fields the person set first
 * (Backlog unless a status is given), and counts from now on.
 */
export function acceptFromTriage(
  planning: PlanningService,
  project: WatchedProject,
  workItemId: string,
  fields: TriageAcceptFields,
  actor: PlanningActor
): PlanningWorkItem {
  requireTriaged(planning, project, workItemId)
  return planning.updateWorkItem(workItemId, { ...fields, inTriage: false }, actor)
}

/**
 * Turning triage off with tasks waiting: every one is accepted into the
 * Backlog as it is. Returns how many were accepted.
 */
export function acceptAllFromTriage(
  planning: PlanningService,
  project: WatchedProject,
  actor: PlanningActor
): number {
  const waiting = planning.listWorkItems(project.id, 'triage')
  for (const item of waiting) planning.updateWorkItem(item.id, { inTriage: false }, actor)
  return waiting.length
}

/**
 * Move to project: the task is made again in the other project, in its To
 * triage when that project triages new captures and as an ordinary Backlog
 * task when it does not (`moveTriagedWorkItem`), with its Library
 * attachments copied into that project's Library, and the original goes to
 * the recycle bin. The files are copied first: if a copy fails, nothing is
 * moved. If the move itself is refused, the copies go.
 */
export async function moveFromTriage(
  deps: { planning: PlanningService; library: LibraryService | null },
  project: WatchedProject,
  workItemId: string,
  toProject: WatchedProject,
  actor: PlanningActor
): Promise<TriageMoveResult> {
  const item = requireTriaged(deps.planning, project, workItemId)
  if (toProject.id === project.id) throw new Refusal('The task is already in that project')
  const copies = deps.library
    ? await deps.library.copyAttachmentsTo(project.id, item.id, toProject.id)
    : { itemIds: [], created: [] }
  let moved: PlanningWorkItem
  try {
    moved = deps.planning.moveTriagedWorkItem(item.id, toProject.id, actor)
  } catch (error) {
    removeCopies(deps.library, toProject.id, copies.created)
    throw error
  }
  if (deps.library && copies.itemIds.length > 0)
    deps.library.attachCopies(toProject.id, moved.id, copies.itemIds)
  return { workItem: moved, movedFromId: item.id, copiedItemIds: copies.created }
}

/**
 * Undo of Move to project: the original comes back from the recycle bin into
 * To triage, and the new task and the Library copies made for it are removed.
 * Only while the new task is as the move left it: still waiting in To triage,
 * or, where it landed as an ordinary task, never changed since.
 */
export function undoTriageMove(
  deps: { planning: PlanningService; library: LibraryService | null },
  project: WatchedProject,
  move: { workItemId: string; movedFromId: string; copiedItemIds?: string[] },
  actor: PlanningActor
): PlanningWorkItem {
  const original = deps.planning.getWorkItem(move.movedFromId)
  if (original.projectId !== project.id)
    throw new Refusal('Planning work item belongs to another project')
  const made = deps.planning.getWorkItem(move.workItemId)
  if (!asMoved(made)) throw new Refusal('The moved task has been decided on; it cannot be undone')
  const restored = deps.planning.restoreWorkItem(original.id, actor)
  deps.planning.deleteWorkItem(made.id, actor)
  removeCopies(deps.library, made.projectId, move.copiedItemIds ?? [])
  return restored
}

function asMoved(made: PlanningWorkItem): boolean {
  if (made.inTriage) return true
  // Accepted from To triage keeps its capturedBy; an ordinary landing has none.
  return (
    !made.capturedBy && made.updatedAt === made.createdAt && !made.archivedAt && !made.deletedAt
  )
}

function removeCopies(library: LibraryService | null, projectId: string, ids: string[]): void {
  if (!library) return
  for (const id of ids) {
    try {
      library.deleteItem(projectId, id)
    } catch (error) {
      console.error(`Could not remove the Library copy ${id}:`, error)
    }
  }
}
