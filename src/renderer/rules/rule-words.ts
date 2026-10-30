import type {
  PlanningColumnSettings,
  PlanningFieldDefinition,
  PlanningFieldValue,
  PlanningRule,
  PlanningRuleAction,
  PlanningRuleCondition,
  PlanningRuleEffect,
  PlanningRuleTrigger
} from '@shared/ostler-api'
import { taskColumnLabel, taskPriorityLabel, taskStatusLabel } from '@shared/task-labels'
import { currentLanguage, t } from '@shared/i18n'

/** The names a rule's ids are read with, and the choices its editor offers. */
export interface RuleNames {
  people: { id: string; name: string }[]
  milestones: { id: string; name: string }[]
  labels: string[]
  fields: PlanningFieldDefinition[]
  columns: PlanningColumnSettings | null
}

export const EMPTY_RULE_NAMES: RuleNames = {
  people: [],
  milestones: [],
  labels: [],
  fields: [],
  columns: null
}

function nameOf(list: { id: string; name: string }[], id: string): string {
  return list.find((entry) => entry.id === id)?.name ?? t('projects:rules.missing')
}

function quoted(text: string): string {
  return `“${text}”`
}

/** "a, b and c", in the app's language. */
export function listWords(items: string[]): string {
  return new Intl.ListFormat(currentLanguage(), { type: 'conjunction' }).format(items)
}

/** "When a task moves from In review to Done". */
export function triggerWords(trigger: PlanningRuleTrigger, names: RuleNames): string {
  if (trigger.kind !== 'statusChanged') return t(`projects:rules.when.${trigger.kind}`)
  const to = taskColumnLabel({ status: trigger.to, columnId: trigger.toColumnId }, names.columns)
  return trigger.from
    ? t('projects:rules.when.statusChangedFrom', {
        from: taskStatusLabel(trigger.from, names.columns),
        to
      })
    : t('projects:rules.when.statusChanged', { to })
}

/** A custom field's value in words: an option's name, "ticked", the text or number. */
export function fieldValueWords(
  field: PlanningFieldDefinition | undefined,
  value: PlanningFieldValue
): string {
  if (typeof value === 'boolean')
    return value ? t('projects:rules.ticked') : t('projects:rules.notTicked')
  const option = field?.options.find((entry) => entry.id === value)
  return quoted(option ? option.name : String(value))
}

/** "it has the label “urgent”", "its priority isn't High". */
export function conditionWords(condition: PlanningRuleCondition, names: RuleNames): string {
  const op = condition.op
  switch (condition.kind) {
    case 'label':
      return t(`projects:rules.if.label.${op}`, { label: quoted(condition.label) })
    case 'priority':
      return t(`projects:rules.if.priority.${op}`, {
        priority: taskPriorityLabel(condition.priority)
      })
    case 'status':
      return t(`projects:rules.if.status.${op}`, {
        status: taskColumnLabel(condition, names.columns)
      })
    case 'assignee':
      return condition.personId === null
        ? t(`projects:rules.if.unassigned.${op}`)
        : t(`projects:rules.if.assignee.${op}`, {
            person: nameOf(names.people, condition.personId)
          })
    case 'milestone':
      return condition.milestoneId === null
        ? t(`projects:rules.if.noMilestone.${op}`)
        : t(`projects:rules.if.milestone.${op}`, {
            milestone: quoted(nameOf(names.milestones, condition.milestoneId))
          })
    case 'field': {
      const field = names.fields.find((entry) => entry.id === condition.fieldId)
      return t(`projects:rules.if.field.${op}`, {
        field: field ? field.name : t('projects:rules.missing'),
        value: fieldValueWords(field, condition.value)
      })
    }
  }
}

/** "set the priority to Critical", "notify me". */
export function actionWords(action: PlanningRuleAction, names: RuleNames): string {
  switch (action.kind) {
    case 'setStatus':
      return t('projects:rules.then.setStatus', {
        status: taskColumnLabel(action, names.columns)
      })
    case 'setPriority':
      return t('projects:rules.then.setPriority', { priority: taskPriorityLabel(action.priority) })
    case 'setAssignee':
      return action.personId === null
        ? t('projects:rules.then.unassign')
        : t('projects:rules.then.setAssignee', { person: nameOf(names.people, action.personId) })
    case 'setMilestone':
      return action.milestoneId === null
        ? t('projects:rules.then.clearMilestone')
        : t('projects:rules.then.setMilestone', {
            milestone: quoted(nameOf(names.milestones, action.milestoneId))
          })
    case 'addLabel':
      return t('projects:rules.then.addLabel', { label: quoted(action.label) })
    case 'removeLabel':
      return t('projects:rules.then.removeLabel', { label: quoted(action.label) })
    case 'addChecklistItems':
      return t('projects:rules.then.addChecklistItems', { count: action.items.length })
    case 'addComment':
      return t('projects:rules.then.addComment')
    case 'notifyMe':
      return t('projects:rules.then.notifyMe')
    case 'archive':
      return t('projects:rules.then.archive')
  }
}

/** The whole rule as one sentence: "When …, if … and …, then … and …." */
export function ruleSentence(
  rule: Pick<PlanningRule, 'trigger' | 'conditions' | 'actions'>,
  names: RuleNames
): string {
  const when = triggerWords(rule.trigger, names)
  const then = rule.actions.length
    ? listWords(rule.actions.map((action) => actionWords(action, names)))
    : t('projects:rules.then.nothing')
  return rule.conditions.length
    ? t('projects:rules.sentenceWithConditions', {
        when,
        conditions: listWords(rule.conditions.map((condition) => conditionWords(condition, names))),
        then
      })
    : t('projects:rules.sentence', { when, then })
}

/** What one action would do to the task a rule is tried on. */
export function effectWords(effect: PlanningRuleEffect, names: RuleNames): string {
  const action = actionWords(effect.action, names)
  return t(`projects:rules.effect.${effect.outcome}`, { action })
}
