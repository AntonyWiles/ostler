import type { PlanningWorkItem, WatchedProject } from '@shared/ostler-api'
import { parseTaskKey } from '@shared/task-key'
import { localLinksAsText } from '@shared/local-links'
import { Refusal } from '@shared/refusal'

interface FindsByNumber {
  findWorkItemByNumber(projectId: string, number: number): PlanningWorkItem | null
}

/**
 * The task a task's ID (BRI-26) names in this project: its id; null when the
 * ID is this project's but no task has that number; undefined when the text
 * is not one of this project's IDs (an id, or another project's ID), which
 * callers pass on as it is.
 */
export function taskIdForKey(
  planning: FindsByNumber,
  project: WatchedProject,
  text: string
): string | null | undefined {
  const parsed = parseTaskKey(text)
  if (!parsed || !project.taskPrefix || parsed.prefix !== project.taskPrefix) return undefined
  return planning.findWorkItemByNumber(project.id, parsed.number)?.id ?? null
}

/** One id or ID from a body, as an id: an ID no task has is refused. */
export function resolveOne(
  planning: FindsByNumber,
  project: WatchedProject,
  value: unknown
): unknown {
  if (typeof value !== 'string') return value
  const id = taskIdForKey(planning, project, value)
  if (id === null) throw new Refusal(`No task of this project has the ID ${value}`)
  return id ?? value
}

/**
 * A work item body as the automation API stores it: task IDs written where
 * ids go (dependencyIds, dependencyLinks[].id, parentWorkItemId) turned into
 * ids, so a caller can write BRI-26 anywhere it would write the task's id,
 * and links to this computer in the description kept as text
 * (`local-links.ts`).
 */
export function workItemBodyFromApi(
  planning: FindsByNumber,
  project: WatchedProject,
  body: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...body }
  if (typeof out.description === 'string') out.description = localLinksAsText(out.description)
  if (Array.isArray(out.dependencyIds))
    out.dependencyIds = out.dependencyIds.map((value) => resolveOne(planning, project, value))
  if (Array.isArray(out.dependencyLinks))
    out.dependencyLinks = out.dependencyLinks.map((link) =>
      link && typeof link === 'object' && 'id' in link
        ? { ...link, id: resolveOne(planning, project, (link as { id: unknown }).id) }
        : link
    )
  if (out.parentWorkItemId !== undefined)
    out.parentWorkItemId = resolveOne(planning, project, out.parentWorkItemId)
  return out
}

/** Each item with only the fields asked for, and always its id. */
export function pickFields<T extends { id: string }>(
  items: readonly T[],
  fields: string | null
): unknown[] {
  if (!fields) return [...items]
  const wanted = fields
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean)
  if (wanted.length === 0) return [...items]
  return items.map((item) => {
    const picked: Record<string, unknown> = { id: item.id }
    for (const field of wanted)
      if (field in item) picked[field] = (item as unknown as Record<string, unknown>)[field]
    return picked
  })
}
