import type { PlanningChangeField } from '../ostler-api/activity-types'

/**
 * How long a pause may be before typing starts a new sitting (D30). Edits to
 * a text field made within this gap of the field's last save are one sitting:
 * one activity row in the history and one step of the drawer's undo. The main
 * process and the drawer both ask this one rule.
 */
export const TEXT_SITTING_GAP_MS = 5 * 60 * 1000

/** The fields a person types into, whose edits are grouped into sittings. */
const TEXT_SITTING_FIELDS: readonly PlanningChangeField[] = ['title', 'description', 'checklist']

export function isTextSittingField(field: PlanningChangeField): boolean {
  return TEXT_SITTING_FIELDS.includes(field)
}

/** True when a save at `at` continues the sitting whose last save was at `previousAt`. */
export function continuesSitting(previousAt: number, at: number): boolean {
  return at >= previousAt && at - previousAt <= TEXT_SITTING_GAP_MS
}
