import type { LinkSourceKind, LinkTargetKind } from '../item-links'
import type { PlanningWorkItemStatus } from './planning-types'

export type { ItemLinkRef, LinkSourceKind, LinkTargetKind } from '../item-links'
export { LINK_SOURCE_KINDS, LINK_TARGET_KINDS } from '../item-links'

// ─── Links and backlinks (N4.4a, N34) ───────────────────────────────────────

/** A linked item as a link shows it: its current title, or gone. */
export interface ItemLinkInfo {
  kind: LinkTargetKind
  projectId: string
  id: string
  /** False when the item no longer exists (deleted for good, or binned). */
  exists: boolean
  /** The current title; null when the item is gone. */
  title: string | null
  /** A task's status, so a link to it shows whether it is done. */
  status?: PlanningWorkItemStatus
}

/** One text that links to an item: "Comment on 'Fix the header'", "Decision: Use the new supplier". */
export interface LinkedFromEntry {
  sourceKind: LinkSourceKind
  sourceId: string
  projectId: string
  /** The source's title; for a comment, its task's title. */
  title: string
  /** The task a task or comment belongs to, so it opens in the task's drawer. */
  workItemId: string | null
}
