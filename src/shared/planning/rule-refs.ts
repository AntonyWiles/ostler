import type { PlanningFieldValue } from '../ostler-api/field-types'
import type {
  PlanningRuleAction,
  PlanningRuleCondition,
  PlanningRuleTrigger
} from '../ostler-api/rule-types'

/**
 * How a rule's references are swapped (R6.2): ids for a project file's refs
 * on export, refs for the new project's ids on import. Each returns undefined
 * when the other side has no match.
 */
export interface RuleRefSwaps {
  person: (id: string) => string | undefined
  milestone: (id: string) => string | undefined
  field: (
    fieldId: string,
    value: PlanningFieldValue
  ) => { fieldId: string; value: PlanningFieldValue } | undefined
  /**
   * A column of the project's own (MOP-26). One with no match is left out of
   * the rule, which then names the status the column counted as.
   */
  column?: (id: string) => string | undefined
}

/** A trigger with its column (MOP-26) swapped, or without it when there is no match. */
export function swapTriggerColumn(
  trigger: PlanningRuleTrigger,
  column: (id: string) => string | undefined
): PlanningRuleTrigger {
  if (trigger.kind !== 'statusChanged' || !trigger.toColumnId) return trigger
  const { toColumnId, ...rest } = trigger
  const swapped = column(toColumnId)
  return swapped ? { ...rest, toColumnId: swapped } : rest
}

/** `columnId` swapped, or left out when there is no match. */
function swapColumnOf<T extends { columnId?: string }>(item: T, column: RuleRefSwaps['column']): T {
  if (!item.columnId) return item
  const { columnId, ...rest } = item
  const swapped = column?.(columnId)
  return (swapped ? { ...rest, columnId: swapped } : rest) as T
}

/**
 * A rule's conditions and actions with every reference swapped, or null when
 * one has no match: such a rule is left out rather than changed in meaning.
 * Null references ("nobody", "no milestone") stay null.
 */
export function swapRuleRefs(
  rule: { conditions: PlanningRuleCondition[]; actions: PlanningRuleAction[] },
  swaps: RuleRefSwaps
): { conditions: PlanningRuleCondition[]; actions: PlanningRuleAction[] } | null {
  let missing = false
  const swap = (id: string | null, by: (id: string) => string | undefined): string | null => {
    if (id === null) return null
    const found = by(id)
    if (found === undefined) missing = true
    return found ?? null
  }
  const conditions = rule.conditions.map((condition): PlanningRuleCondition => {
    switch (condition.kind) {
      case 'assignee':
        return { ...condition, personId: swap(condition.personId, swaps.person) }
      case 'milestone':
        return { ...condition, milestoneId: swap(condition.milestoneId, swaps.milestone) }
      case 'status':
        return swapColumnOf(condition, swaps.column)
      case 'field': {
        const swapped = swaps.field(condition.fieldId, condition.value)
        if (!swapped) {
          missing = true
          return condition
        }
        return { ...condition, ...swapped }
      }
      default:
        return condition
    }
  })
  const actions = rule.actions.map((action): PlanningRuleAction => {
    switch (action.kind) {
      case 'setAssignee':
        return { ...action, personId: swap(action.personId, swaps.person) }
      case 'setMilestone':
        return { ...action, milestoneId: swap(action.milestoneId, swaps.milestone) }
      case 'setStatus':
        return swapColumnOf(action, swaps.column)
      default:
        return action
    }
  })
  return missing ? null : { conditions, actions }
}
