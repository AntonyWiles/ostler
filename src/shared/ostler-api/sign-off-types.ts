/**
 * Sign-offs (team-leaders plan, D9): a named person is asked to sign a task, decision or
 * milestone off. Only that person can approve it or send it back, whatever their role.
 */

export type SignOffKind = 'task' | 'decision' | 'milestone'

export type SignOffState = 'waiting' | 'approved' | 'changes'

/** The thing a sign-off is asked of. */
export interface SignOffItem {
  kind: SignOffKind
  id: string
}

export interface SignOff {
  id: string
  projectId: string
  itemKind: SignOffKind
  itemId: string
  approverPersonId: string
  requestedByPersonId: string | null
  state: SignOffState
  /** What the approver said when sending it back (or approving); empty until then. */
  note: string
  requestedAt: number
  answeredAt: number | null
  updatedAt: number
}

export interface RequestSignOffInput {
  item: SignOffItem
  approverPersonId: string
}
