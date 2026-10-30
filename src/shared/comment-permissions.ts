import type { PlanningComment, ShareRole } from './ostler-api'
import { capabilitiesOf } from './share-roles'

/** What a person may do with one comment. */
export interface CommentPermissions {
  quote: boolean
  pin: boolean
  edit: boolean
  delete: boolean
}

/**
 * The one rule for comments, by the person's role in a shared project (`null` for a project that
 * is not shared, where the person is its only member). The comment feed shows it and main checks
 * it (`PlanningService`), so both say the same. Everyone may quote, a Viewer too: they may write
 * comments of their own (D1, as the sync guard allows). Owners and Editors may pin any comment;
 * a Viewer pins none. A comment is edited by its author alone, and deleted by its author or an
 * Owner. A comment by the automation API or a rule has no person: an Owner or an unshared
 * project's person may delete it; nobody edits it.
 */
export function commentPermissions(
  role: ShareRole | null,
  comment: Pick<PlanningComment, 'authorKind' | 'authorPersonId'>,
  myPersonId: string | null
): CommentPermissions {
  const sharing = role !== null
  const mine =
    comment.authorKind === 'human' &&
    (!sharing || (myPersonId !== null && comment.authorPersonId === myPersonId))
  const rights = capabilitiesOf(role)
  return {
    quote: true,
    pin: rights.pinComments,
    edit: mine,
    delete: mine || rights.deleteAnyComment
  }
}
