import type { LibraryItemKind } from './library-types'
import type { PlanningWorkItemStatus } from './planning-types'
import type { SavedViewType } from './search-types'

// ─── Pins and shortcuts (N5.2a, N37) ────────────────────────────────────────

/** Where a pin shows: the sidebar's Pinned section, or its project's Overview. */
export type PinPlace = 'sidebar' | 'overview'

export const PIN_PLACES: readonly PinPlace[] = ['sidebar', 'overview']

/**
 * What a pin points at. A project view's target id is the view's id (`board`, `library`…).
 * A goal of one's own (`personal-goal`, N5.6b) belongs to no project: it pins
 * to the sidebar only, and its pin's `projectId` is `PERSONAL_PIN_PROJECT`.
 */
export type PinKind =
  'task' | 'milestone' | 'decision' | 'library' | 'saved-view' | 'project-view' | 'personal-goal'

export const PIN_KINDS: readonly PinKind[] = [
  'task',
  'milestone',
  'decision',
  'library',
  'saved-view',
  'project-view',
  'personal-goal'
]

/** The `projectId` of a pin of something in no project: a goal of one's own (N5.6b). */
export const PERSONAL_PIN_PROJECT = ''

/** The sidebar holds at most this many pins. */
export const PIN_SIDEBAR_MAX = 20

/** A pin: a pointer to an item, never a copy of it. */
export interface Pin {
  id: string
  place: PinPlace
  /** The target's project: an overview pin shows on this project's Overview. */
  projectId: string
  kind: PinKind
  targetId: string
  /** Manual order within its place (`order-key.ts`); internal, moves send neighbours. */
  orderKey: string
  createdAt: number
  /**
   * The pin shows as a countdown (N5.2b): on Home, in the tray menu and in the
   * jump list. Main always sends it; left out, it is off.
   */
  countdown?: boolean
}

/** A pin as it shows: its target's current title, read when it is listed. */
export interface PinView extends Pin {
  /** False when the target is gone (deleted, binned, or a view that no longer exists). */
  exists: boolean
  /** The target's current title; null when gone, and for a project view (named by the app). */
  title: string | null
  /** The target is archived (a task or Library item). */
  archived: boolean
  /** A task's status. */
  status?: PlanningWorkItemStatus
  /** A Library item's kind, so a link or file asks before it opens. */
  libraryKind?: LibraryItemKind
  /** A Library link's address, shown before it opens. */
  url?: string | null
  /** A saved view's type: the view it opens in. */
  viewType?: SavedViewType
  /**
   * A milestone's target date, a task's due date or a goal of one's own's
   * measure's target date, `YYYY-MM-DD`; null when it has none.
   */
  date?: string | null
  /** The milestone is complete, the task is done, or the goal of one's own is no longer active. */
  done?: boolean
  /** The countdown in words ("12 days to Launch") while it shows as one; null otherwise. */
  countdownText?: string | null
}

/** Turns a pin's countdown on or off (N5.2b). */
export interface SetPinCountdownInput {
  countdown: boolean
  /**
   * When three already count down, the pin whose countdown to turn off in the
   * same change; without it, a fourth is refused.
   */
  replacePinId?: string
}

export interface CreatePinInput {
  place: PinPlace
  kind: PinKind
  targetId: string
  /** Needed for a project view, whose id names no project; ignored otherwise. */
  projectId?: string
}

/** Where to move a pin: before or after another of the same place, or the end with neither. */
export interface MovePinInput {
  beforeId?: string
  afterId?: string
}

/** Which pins to list: the sidebar's, or one project's Overview's. */
export interface ListPinsQuery {
  place: PinPlace
  projectId?: string
}
