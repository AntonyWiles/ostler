import type {
  PlanningDependencyLink,
  PlanningDependencyLinkInput,
  PlanningDependencyType,
  PlanningWorkItem
} from '../ostler-api/planning-types'
import { MAX_DEPENDENCY_LAG_DAYS, PLANNING_DEPENDENCY_TYPES } from '../ostler-api/planning-types'

/**
 * Waits-on links with a type and a lag (N7.2a, decision N50). `dependencyIds`
 * stays the list of links; `dependencyLinks` carries each one's type and lag.
 * Every reader goes through `dependencyLinksOf`, so a task (or a fixture, or
 * an old file) without `dependencyLinks` reads as finish to start, 0 days.
 */

export const DEFAULT_DEPENDENCY_TYPE: PlanningDependencyType = 'finish-to-start'

export type DependencyLinkSource = Pick<PlanningWorkItem, 'dependencyIds' | 'dependencyLinks'>

/** A task's waits-on links, one per `dependencyIds` entry and in its order. */
export function dependencyLinksOf(item: DependencyLinkSource): PlanningDependencyLink[] {
  const given = new Map((item.dependencyLinks ?? []).map((link) => [link.id, link]))
  return item.dependencyIds.map((id) => {
    const link = given.get(id)
    return link
      ? { id, type: link.type, lagDays: link.lagDays }
      : { id, type: DEFAULT_DEPENDENCY_TYPE, lagDays: 0 }
  })
}

/** True for a link that holds work back from Ready and the agent queue. */
export function holdsBackWork(link: Pick<PlanningDependencyLink, 'type'>): boolean {
  return link.type === 'finish-to-start'
}

/** True for a type Ostler knows. */
export function isDependencyType(value: unknown): value is PlanningDependencyType {
  return (PLANNING_DEPENDENCY_TYPES as readonly unknown[]).includes(value)
}

/** True for a whole number of days from -365 to 365. */
export function isDependencyLag(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    Math.abs(value) <= MAX_DEPENDENCY_LAG_DAYS
  )
}

/**
 * Links as a file or an old caller gave them, made whole: a missing or
 * unknown type is finish to start, a missing or out-of-range lag is 0. For
 * reading files, which never refuse a link over its type; callers that write
 * through the planning service are checked there instead.
 */
export function normalisedDependencyLink(
  link: PlanningDependencyLinkInput | { id: string; type?: unknown; lagDays?: unknown }
): PlanningDependencyLink {
  return {
    id: link.id,
    type: isDependencyType(link.type) ? link.type : DEFAULT_DEPENDENCY_TYPE,
    lagDays: isDependencyLag(link.lagDays) ? link.lagDays : 0
  }
}

/** True when a link is finish to start with no lag: what a file may leave out. */
export function isPlainDependencyLink(link: Pick<PlanningDependencyLink, 'type' | 'lagDays'>) {
  return link.type === DEFAULT_DEPENDENCY_TYPE && link.lagDays === 0
}
