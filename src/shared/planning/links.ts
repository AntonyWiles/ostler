import {
  PLANNING_LINK_KINDS,
  type PlanningLinkKind,
  type PlanningLinkRole
} from '../ostler-api/planning-types'
import { t } from '../i18n'

/**
 * Links between tasks (N2.4, N19): the pure parts the app, the main process
 * and the automation API share, so a link reads the same everywhere. None of
 * this is scheduling: waits-on lives in `dependencies.ts`.
 */

/** Whether a value is one of the link kinds. */
export function isLinkKind(value: unknown): value is PlanningLinkKind {
  return typeof value === 'string' && (PLANNING_LINK_KINDS as readonly string[]).includes(value)
}

/**
 * How a link reads from one of its ends. A row points from the duplicate to
 * its original, and from the copy to the task it was copied from.
 */
export function linkRole(kind: PlanningLinkKind, fromThisTask: boolean): PlanningLinkRole {
  if (kind === 'relates') return 'relates'
  if (kind === 'duplicates') return fromThisTask ? 'duplicate-of' : 'duplicated-by'
  return fromThisTask ? 'copied-from' : 'copied-to'
}

/** The words for a role: "Duplicate of", "Copied to"… */
export function linkRoleLabel(role: PlanningLinkRole): string {
  return t(`tasks:taskLinks.roles.${role}`)
}

/** The words for a kind as the person picks it, read from this task: "Duplicate of"… */
export function linkKindLabel(kind: PlanningLinkKind): string {
  return t(`tasks:taskLinks.kinds.${kind}`)
}

/** The order the drawer lists roles in. */
export const LINK_ROLE_ORDER: readonly PlanningLinkRole[] = [
  'duplicate-of',
  'duplicated-by',
  'relates',
  'copied-from',
  'copied-to'
]
