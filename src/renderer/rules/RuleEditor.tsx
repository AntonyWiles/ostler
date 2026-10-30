import { useState } from 'react'
import {
  MAX_RULE_ACTIONS,
  MAX_RULE_CONDITIONS,
  MAX_RULE_NAME_LENGTH,
  PLANNING_RULE_ACTION_KINDS,
  PLANNING_RULE_CONDITION_KINDS,
  PLANNING_RULE_TRIGGER_KINDS,
  type CreatePlanningRuleInput,
  type PlanningRuleAction,
  type PlanningRuleActionKind,
  type PlanningRuleCondition,
  type PlanningRuleConditionKind,
  type PlanningRuleTrigger,
  type PlanningRuleTriggerKind,
  type PlanningWorkItemStatus
} from '@shared/ostler-api'
import { RULE_PRIORITIES, RULE_STATUSES } from '@shared/planning/rules'
import { taskColumnLabel, taskPriorityLabel, taskStatusLabel } from '@shared/task-labels'
import { columnKey, orderedColumns, placeOfKey } from '@shared/board-columns'
import { Button, IconButton, Select, SuggestField, TextArea, TextField } from '../ui'
import { Plus, X } from '../ui/icons'
import { ruleSentence, type RuleNames } from './rule-words'
import { RuleTryOut } from './RuleTryOut'
import { t } from '@shared/i18n'

export type RuleDraft = Required<Omit<CreatePlanningRuleInput, 'enabled'>>

const NOBODY = ''

/** A new condition of a kind, filled with the first sensible value. */
function newCondition(kind: PlanningRuleConditionKind, names: RuleNames): PlanningRuleCondition {
  switch (kind) {
    case 'label':
      return { kind, op: 'is', label: names.labels[0] ?? '' }
    case 'priority':
      return { kind, op: 'is', priority: 'high' }
    case 'assignee':
      return { kind, op: 'is', personId: names.people[0]?.id ?? null }
    case 'milestone':
      return { kind, op: 'is', milestoneId: names.milestones[0]?.id ?? null }
    case 'status':
      return { kind, op: 'is', status: 'blocked' }
    case 'field': {
      const field = names.fields[0]
      const value =
        field?.type === 'checkbox'
          ? true
          : field?.type === 'number'
            ? 0
            : (field?.options[0]?.id ?? '')
      return { kind, op: 'is', fieldId: field?.id ?? '', value }
    }
  }
}

/** A new action of a kind, filled with the first sensible value. */
function newAction(kind: PlanningRuleActionKind, names: RuleNames): PlanningRuleAction {
  switch (kind) {
    case 'setStatus':
      return { kind, status: 'done' }
    case 'setPriority':
      return { kind, priority: 'high' }
    case 'setAssignee':
      return { kind, personId: names.people[0]?.id ?? null }
    case 'setMilestone':
      return { kind, milestoneId: names.milestones[0]?.id ?? null }
    case 'addLabel':
    case 'removeLabel':
      return { kind, label: names.labels[0] ?? '' }
    case 'addChecklistItems':
      return { kind, items: [] }
    case 'addComment':
      return { kind, text: '' }
    case 'notifyMe':
      return { kind, message: '' }
    case 'archive':
      return { kind }
  }
}

export function newRuleDraft(): RuleDraft {
  return {
    name: '',
    trigger: { kind: 'statusChanged', to: 'done' },
    conditions: [],
    actions: [{ kind: 'notifyMe', message: '' }]
  }
}

/** What is sent: blank checklist lines left out. */
function cleaned(draft: RuleDraft): RuleDraft {
  return {
    ...draft,
    name: draft.name.trim(),
    actions: draft.actions.map((action) =>
      action.kind === 'addChecklistItems'
        ? { ...action, items: action.items.map((item) => item.trim()).filter(Boolean) }
        : action
    )
  }
}

/**
 * New rule and Edit rule (R6.2): the rule built as a sentence, "When …, if …,
 * then …", every part a labelled control. The sentence it reads as is shown
 * as it is built; Try it on a task… shows what it would do to one task.
 */
export function RuleEditor({
  projectId,
  initial,
  names,
  onCancel,
  onSave
}: {
  projectId: string
  initial: RuleDraft
  names: RuleNames
  onCancel: () => void
  onSave: (draft: RuleDraft) => Promise<void>
}) {
  const [draft, setDraft] = useState<RuleDraft>(initial)
  const [busy, setBusy] = useState(false)
  const statusOptions = RULE_STATUSES.map((value) => ({
    value,
    label: taskStatusLabel(value, names.columns)
  }))
  // Every column, the project's own too (MOP-26): a status's key, or `custom:<id>`.
  const columnOptions = orderedColumns(names.columns).map(({ status, custom }) => ({
    value: columnKey(status, custom?.id),
    label: taskColumnLabel({ status, columnId: custom?.id ?? null }, names.columns)
  }))
  /** A column's status, and `columnId` for one of the project's own (left out otherwise). */
  const columnOf = (key: string) => {
    const place = placeOfKey(key, names.columns)
    return {
      status: place?.status ?? (key as PlanningWorkItemStatus),
      columnId: place?.columnId ?? undefined
    }
  }
  const withColumn = <T extends { status: PlanningWorkItemStatus; columnId?: string }>(
    item: T,
    key: string
  ): T => {
    const { columnId: _old, ...rest } = item
    const { status, columnId } = columnOf(key)
    return { ...rest, status, ...(columnId ? { columnId } : {}) } as T
  }
  const priorityOptions = RULE_PRIORITIES.map((value) => ({
    value,
    label: taskPriorityLabel(value)
  }))
  const personOptions = [
    { value: NOBODY, label: t('projects:rules.nobody') },
    ...names.people.map((person) => ({ value: person.id, label: person.name }))
  ]
  const milestoneOptions = [
    { value: NOBODY, label: t('projects:rules.noMilestone') },
    ...names.milestones.map((milestone) => ({ value: milestone.id, label: milestone.name }))
  ]
  const opOptions = [
    { value: 'is', label: t('projects:rules.op.is') },
    { value: 'isNot', label: t('projects:rules.op.isNot') }
  ]

  const setTrigger = (trigger: PlanningRuleTrigger) => setDraft({ ...draft, trigger })
  const setCondition = (index: number, condition: PlanningRuleCondition) =>
    setDraft({
      ...draft,
      conditions: draft.conditions.map((entry, at) => (at === index ? condition : entry))
    })
  const setAction = (index: number, action: PlanningRuleAction) =>
    setDraft({
      ...draft,
      actions: draft.actions.map((entry, at) => (at === index ? action : entry))
    })

  const save = async () => {
    setBusy(true)
    try {
      await onSave(cleaned(draft))
    } finally {
      setBusy(false)
    }
  }

  const conditionValue = (condition: PlanningRuleCondition, index: number) => {
    const n = index + 1
    switch (condition.kind) {
      case 'label':
        return (
          <SuggestField
            label={t('projects:rules.labelName', { n })}
            hideLabel
            value={condition.label}
            maxLength={80}
            suggestions={names.labels}
            onChange={(label) => setCondition(index, { ...condition, label })}
          />
        )
      case 'priority':
        return (
          <Select
            label={t('projects:rules.priorityValue', { n })}
            hideLabel
            size="sm"
            value={condition.priority}
            options={priorityOptions}
            onChange={(event) =>
              setCondition(index, {
                ...condition,
                priority: event.target.value as (typeof RULE_PRIORITIES)[number]
              })
            }
          />
        )
      case 'status':
        return (
          <Select
            label={t('projects:rules.statusValue', { n })}
            hideLabel
            size="sm"
            value={columnKey(condition.status, condition.columnId)}
            options={columnOptions}
            onChange={(event) => setCondition(index, withColumn(condition, event.target.value))}
          />
        )
      case 'assignee':
        return (
          <Select
            label={t('projects:rules.personValue', { n })}
            hideLabel
            size="sm"
            value={condition.personId ?? NOBODY}
            options={personOptions}
            onChange={(event) =>
              setCondition(index, { ...condition, personId: event.target.value || null })
            }
          />
        )
      case 'milestone':
        return (
          <Select
            label={t('projects:rules.milestoneValue', { n })}
            hideLabel
            size="sm"
            value={condition.milestoneId ?? NOBODY}
            options={milestoneOptions}
            onChange={(event) =>
              setCondition(index, { ...condition, milestoneId: event.target.value || null })
            }
          />
        )
      case 'field': {
        const field = names.fields.find((entry) => entry.id === condition.fieldId)
        return (
          <>
            <Select
              label={t('projects:rules.fieldName', { n })}
              hideLabel
              size="sm"
              value={condition.fieldId}
              options={names.fields.map((entry) => ({ value: entry.id, label: entry.name }))}
              onChange={(event) => {
                const next = newCondition('field', {
                  ...names,
                  fields: names.fields.filter((entry) => entry.id === event.target.value)
                })
                setCondition(index, { ...next, op: condition.op })
              }}
            />
            {field && (field.type === 'choice' || field.type === 'choices') ? (
              <Select
                label={t('projects:rules.fieldValue', { n })}
                hideLabel
                size="sm"
                value={String(condition.value)}
                options={field.options.map((option) => ({ value: option.id, label: option.name }))}
                onChange={(event) =>
                  setCondition(index, { ...condition, value: event.target.value })
                }
              />
            ) : field?.type === 'checkbox' ? (
              <Select
                label={t('projects:rules.fieldValue', { n })}
                hideLabel
                size="sm"
                value={condition.value === true ? 'true' : 'false'}
                options={[
                  { value: 'true', label: t('projects:rules.ticked') },
                  { value: 'false', label: t('projects:rules.notTicked') }
                ]}
                onChange={(event) =>
                  setCondition(index, { ...condition, value: event.target.value === 'true' })
                }
              />
            ) : (
              <TextField
                label={t('projects:rules.fieldValue', { n })}
                hideLabel
                type={
                  field?.type === 'number' ? 'number' : field?.type === 'date' ? 'date' : 'text'
                }
                value={String(condition.value)}
                onChange={(event) =>
                  setCondition(index, {
                    ...condition,
                    value:
                      field?.type === 'number' && event.target.value !== ''
                        ? Number(event.target.value)
                        : event.target.value
                  })
                }
              />
            )}
          </>
        )
      }
    }
  }

  const actionValue = (action: PlanningRuleAction, index: number) => {
    const n = index + 1
    switch (action.kind) {
      case 'setStatus':
        return (
          <Select
            label={t('projects:rules.statusValue', { n })}
            hideLabel
            size="sm"
            value={columnKey(action.status, action.columnId)}
            options={columnOptions}
            onChange={(event) => setAction(index, withColumn(action, event.target.value))}
          />
        )
      case 'setPriority':
        return (
          <Select
            label={t('projects:rules.priorityValue', { n })}
            hideLabel
            size="sm"
            value={action.priority}
            options={priorityOptions}
            onChange={(event) =>
              setAction(index, {
                ...action,
                priority: event.target.value as (typeof RULE_PRIORITIES)[number]
              })
            }
          />
        )
      case 'setAssignee':
        return (
          <Select
            label={t('projects:rules.personValue', { n })}
            hideLabel
            size="sm"
            value={action.personId ?? NOBODY}
            options={personOptions}
            onChange={(event) =>
              setAction(index, { ...action, personId: event.target.value || null })
            }
          />
        )
      case 'setMilestone':
        return (
          <Select
            label={t('projects:rules.milestoneValue', { n })}
            hideLabel
            size="sm"
            value={action.milestoneId ?? NOBODY}
            options={milestoneOptions}
            onChange={(event) =>
              setAction(index, { ...action, milestoneId: event.target.value || null })
            }
          />
        )
      case 'addLabel':
      case 'removeLabel':
        return (
          <SuggestField
            label={t('projects:rules.labelName', { n })}
            hideLabel
            value={action.label}
            maxLength={80}
            suggestions={names.labels}
            onChange={(label) => setAction(index, { ...action, label })}
          />
        )
      case 'addChecklistItems':
        return (
          <TextArea
            label={t('projects:rules.checklistItems', { n })}
            hint={t('projects:rules.checklistItemsHint')}
            rows={2}
            value={action.items.join('\n')}
            onChange={(event) =>
              setAction(index, { ...action, items: event.target.value.split('\n') })
            }
          />
        )
      case 'addComment':
        return (
          <TextArea
            label={t('projects:rules.commentText', { n })}
            rows={2}
            value={action.text}
            onChange={(event) => setAction(index, { ...action, text: event.target.value })}
          />
        )
      case 'notifyMe':
        return (
          <TextField
            label={t('projects:rules.message', { n })}
            hint={t('projects:rules.messageHint')}
            value={action.message}
            maxLength={200}
            onChange={(event) => setAction(index, { ...action, message: event.target.value })}
          />
        )
      case 'archive':
        return null
    }
  }

  const conditionKinds = PLANNING_RULE_CONDITION_KINDS.filter(
    (kind) => kind !== 'field' || names.fields.length > 0
  )

  return (
    <form
      className="project-rules__editor"
      aria-label={
        initial.name
          ? t('projects:rules.editRule', { name: initial.name })
          : t('projects:rules.newRule')
      }
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      <TextField
        label={t('projects:rules.name')}
        value={draft.name}
        maxLength={MAX_RULE_NAME_LENGTH}
        autoFocus
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
      />

      <fieldset className="project-rules__part">
        <legend>{t('projects:rules.whenLegend')}</legend>
        <div className="project-rules__line">
          <Select
            label={t('projects:rules.trigger')}
            hideLabel
            size="sm"
            value={draft.trigger.kind}
            options={PLANNING_RULE_TRIGGER_KINDS.map((kind) => ({
              value: kind,
              label: t(`projects:rules.triggerKind.${kind}`)
            }))}
            onChange={(event) => {
              const kind = event.target.value as PlanningRuleTriggerKind
              setTrigger(
                kind === 'statusChanged' ? { kind, to: 'done' } : ({ kind } as PlanningRuleTrigger)
              )
            }}
          />
          {draft.trigger.kind === 'statusChanged' && (
            <>
              <Select
                label={t('projects:rules.fromStatus')}
                size="sm"
                value={draft.trigger.from ?? NOBODY}
                options={[
                  { value: NOBODY, label: t('projects:rules.anyStatus') },
                  ...statusOptions
                ]}
                onChange={(event) =>
                  draft.trigger.kind === 'statusChanged' &&
                  setTrigger({
                    ...draft.trigger,
                    from: (event.target.value || null) as PlanningWorkItemStatus | null
                  })
                }
              />
              <Select
                label={t('projects:rules.toStatus')}
                size="sm"
                value={columnKey(draft.trigger.to, draft.trigger.toColumnId)}
                options={columnOptions}
                onChange={(event) => {
                  if (draft.trigger.kind !== 'statusChanged') return
                  const { toColumnId: _old, ...trigger } = draft.trigger
                  const { status, columnId } = columnOf(event.target.value)
                  setTrigger({
                    ...trigger,
                    to: status,
                    // From and to can't be the same status.
                    from: trigger.from === status ? null : trigger.from,
                    ...(columnId ? { toColumnId: columnId } : {})
                  })
                }}
              />
            </>
          )}
        </div>
      </fieldset>

      <fieldset className="project-rules__part">
        <legend>{t('projects:rules.ifLegend')}</legend>
        {draft.conditions.length === 0 && (
          <p className="ostler-project-settings-muted">{t('projects:rules.noConditions')}</p>
        )}
        <ol className="project-rules__list">
          {draft.conditions.map((condition, index) => (
            <li key={index} className="project-rules__line">
              <Select
                label={t('projects:rules.conditionKind', { n: index + 1 })}
                hideLabel
                size="sm"
                value={condition.kind}
                options={conditionKinds.map((kind) => ({
                  value: kind,
                  label: t(`projects:rules.conditionKindName.${kind}`)
                }))}
                onChange={(event) =>
                  setCondition(
                    index,
                    newCondition(event.target.value as PlanningRuleConditionKind, names)
                  )
                }
              />
              <Select
                label={t('projects:rules.conditionOp', { n: index + 1 })}
                hideLabel
                size="sm"
                value={condition.op}
                options={opOptions}
                onChange={(event) =>
                  setCondition(index, {
                    ...condition,
                    op: event.target.value as PlanningRuleCondition['op']
                  })
                }
              />
              {conditionValue(condition, index)}
              <IconButton
                size="sm"
                icon={X}
                label={t('projects:rules.removeCondition', { n: index + 1 })}
                onClick={() =>
                  setDraft({
                    ...draft,
                    conditions: draft.conditions.filter((_, at) => at !== index)
                  })
                }
              />
            </li>
          ))}
        </ol>
        <div>
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            disabled={draft.conditions.length >= MAX_RULE_CONDITIONS}
            onClick={() =>
              setDraft({
                ...draft,
                conditions: [...draft.conditions, newCondition('label', names)]
              })
            }
          >
            {t('projects:rules.addCondition')}
          </Button>
        </div>
      </fieldset>

      <fieldset className="project-rules__part">
        <legend>{t('projects:rules.thenLegend')}</legend>
        <ol className="project-rules__list">
          {draft.actions.map((action, index) => (
            <li key={index} className="project-rules__line">
              <Select
                label={t('projects:rules.actionKind', { n: index + 1 })}
                hideLabel
                size="sm"
                value={action.kind}
                options={PLANNING_RULE_ACTION_KINDS.map((kind) => ({
                  value: kind,
                  label: t(`projects:rules.actionKindName.${kind}`)
                }))}
                onChange={(event) =>
                  setAction(index, newAction(event.target.value as PlanningRuleActionKind, names))
                }
              />
              {actionValue(action, index)}
              <IconButton
                size="sm"
                icon={X}
                label={t('projects:rules.removeAction', { n: index + 1 })}
                disabled={draft.actions.length === 1}
                onClick={() =>
                  setDraft({ ...draft, actions: draft.actions.filter((_, at) => at !== index) })
                }
              />
            </li>
          ))}
        </ol>
        <div>
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            disabled={draft.actions.length >= MAX_RULE_ACTIONS}
            onClick={() =>
              setDraft({ ...draft, actions: [...draft.actions, newAction('setPriority', names)] })
            }
          >
            {t('projects:rules.addAction')}
          </Button>
        </div>
      </fieldset>

      <p className="project-rules__sentence" aria-live="polite">
        {ruleSentence(draft, names)}
      </p>

      <RuleTryOut projectId={projectId} draft={cleaned(draft)} names={names} />

      <div className="project-labels__editor-actions">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t('projects:rules.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          loading={busy}
          disabled={!draft.name.trim()}
        >
          {t('projects:rules.save')}
        </Button>
      </div>
    </form>
  )
}
