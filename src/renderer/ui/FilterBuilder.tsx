import { useRef, useState } from 'react'
import type { PlanningFieldDefinition } from '@shared/ostler-api'
import {
  CHECKLIST_VALUES,
  CUSTOM_FIELD_OPS,
  FIELD_SPECS,
  RELATIVE_DATE_LABELS,
  defaultCondition,
  defaultCustomCondition,
  defaultValueOfKind,
  describeCondition,
  describeValue,
  fieldSpec,
  opSpec,
  type FilterFieldSpec,
  type FilterNames,
  type RelativeDate,
  type TaskFilter,
  type TaskFilterCondition,
  type TaskFilterField,
  type TaskFilterOp
} from '@shared/task-filter'
import { TASK_PRIORITIES } from '@shared/task-labels'
import { visibleColumnPlaces } from '@shared/board-columns'
import { ITERATION_CURRENT } from '@shared/planning/iterations'
import { Button } from './Button'
import { Checkbox } from './Checkbox'
import { DateField } from './DateField'
import { NumberField } from './NumberField'
import { Popover } from './Popover'
import { Select } from './Select'
import { TextField } from './TextField'
import { SearchField } from './SearchField'
import { Icon, ListFilter, Plus, X } from './icons'
import './FilterBuilder.css'
import { t } from '@shared/i18n'

export interface FilterChoice {
  value: string
  label: string
}

/** The records a condition's list can pick from. */
export interface FilterChoices {
  people: FilterChoice[]
  milestones: FilterChoice[]
  goals: FilterChoice[]
  labels: FilterChoice[]
  /** The project's iterations (R6.1); without any, Iteration is not offered. */
  iterations?: FilterChoice[]
  /** The project's task types (N2.7a); without any, Type is not offered. */
  types?: FilterChoice[]
  /** The project's workstreams (sub-projects); without any, Workstream is not offered. */
  subprojects?: FilterChoice[]
  /**
   * The contacts the project's tasks name (N6.5), each alone (any role) and
   * with each role it is named in; without any, Contact is not offered.
   */
  contacts?: FilterChoice[]
}

export interface FilterBuilderProps {
  value: TaskFilter
  onChange: (next: TaskFilter) => void
  choices: FilterChoices
  /** Names for ids in the chips' words. */
  names?: FilterNames
  /** Fields not to offer (a view that has no use for one). */
  hiddenFields?: readonly TaskFilterField[]
  /** The project's custom fields (R2.2), offered under their own heading. */
  customFields?: readonly PlanningFieldDefinition[]
  /**
   * Offer the Resolution field (N1.2). Only archived tasks have one, so views
   * of live tasks leave it out; the Archive has its own Show choice.
   */
  offerResolution?: boolean
  className?: string
}

/** With more custom fields than this, "Add filter" offers a box to find one by name. */
const FIELD_SEARCH_FROM = 6

/** A condition's field as the editor needs it: built-in, or a custom field by its type. */
function specFor(
  condition: TaskFilterCondition,
  customFields: readonly PlanningFieldDefinition[]
): { spec: FilterFieldSpec | null; custom: PlanningFieldDefinition | null } {
  if (condition.field !== 'custom')
    return { spec: fieldSpec(condition.field) ?? null, custom: null }
  const custom = customFields.find((field) => field.id === condition.fieldId) ?? null
  return {
    spec: custom
      ? { field: 'custom', label: custom.name, ops: CUSTOM_FIELD_OPS[custom.type] }
      : null,
    custom
  }
}

/**
 * The task filter as editable chips (P5.7): each condition reads as words
 * ("Due is this week") and opens its editor when clicked, with a remove
 * button; "Add filter" picks a field; all or any; Clear. Every view's
 * toolbar uses it, over the one `TaskFilter` model.
 */
export function FilterBuilder({
  value,
  onChange,
  choices,
  names = {},
  hiddenFields = [],
  customFields = [],
  offerResolution = false,
  className
}: FilterBuilderProps) {
  const addRef = useRef<HTMLButtonElement | null>(null)
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [fieldQuery, setFieldQuery] = useState('')
  const fields = FIELD_SPECS.filter(
    (spec) =>
      !hiddenFields.includes(spec.field) &&
      (spec.field !== 'resolution' || offerResolution) &&
      // A project without iterations is not offered the field (R6.1).
      (spec.field !== 'iteration' || (choices.iterations?.length ?? 0) > 0) &&
      // Nor one without task types (N2.7a).
      (spec.field !== 'type' || (choices.types?.length ?? 0) > 0) &&
      // Nor a project without workstreams.
      (spec.field !== 'subproject' || (choices.subprojects?.length ?? 0) > 0) &&
      // Nor one whose tasks name no contacts (N6.5).
      (spec.field !== 'contact' || (choices.contacts?.length ?? 0) > 0)
  )
  const query = fieldQuery.trim().toLowerCase()
  const shownCustom = customFields.filter((field) => field.name.toLowerCase().includes(query))
  const allNames: FilterNames = {
    customField: (id) => customFields.find((field) => field.id === id),
    ...names
  }

  const setConditions = (conditions: TaskFilterCondition[]) => onChange({ ...value, conditions })
  const replaceAt = (index: number, condition: TaskFilterCondition) =>
    setConditions(value.conditions.map((entry, at) => (at === index ? condition : entry)))
  const removeAt = (index: number) => {
    setEditing(null)
    setConditions(value.conditions.filter((_, at) => at !== index))
    addRef.current?.focus()
  }
  const addCondition = (condition: TaskFilterCondition) => {
    setAdding(false)
    setFieldQuery('')
    setConditions([...value.conditions, condition])
    // Open the new chip's editor once it is rendered.
    setEditing(value.conditions.length)
  }
  const add = (field: TaskFilterField) => addCondition(defaultCondition(field))

  const editingRef = {
    get current() {
      return editing === null ? null : (chipRefs.current[editing] ?? null)
    }
  }

  return (
    <div
      role="group"
      aria-label={t('common:filterBuilder.filters')}
      className={['ui-filter-builder', className].filter(Boolean).join(' ')}
    >
      {value.conditions.length > 1 && (
        <Select
          label={t('common:filterBuilder.match')}
          hideLabel
          size="sm"
          value={value.match}
          onChange={(event) =>
            onChange({ ...value, match: event.target.value === 'any' ? 'any' : 'all' })
          }
          options={[
            { value: 'all', label: t('common:filterBuilder.allFilters') },
            { value: 'any', label: t('common:filterBuilder.anyFilter') }
          ]}
        />
      )}
      {value.conditions.map((condition, index) => {
        const words = describeCondition(condition, allNames)
        return (
          <span key={index} className="ui-chip ui-filter-chip">
            <button
              type="button"
              ref={(element) => {
                chipRefs.current[index] = element
              }}
              className="ui-filter-chip__edit"
              aria-haspopup="dialog"
              aria-expanded={editing === index}
              aria-label={t('common:filterBuilder.editFilter', { words })}
              onClick={() => setEditing(editing === index ? null : index)}
            >
              {words}
            </button>
            <button
              type="button"
              className="ui-chip__remove"
              aria-label={t('common:filterBuilder.removeFilter', { words })}
              title={t('common:filterBuilder.removeFilter2')}
              onClick={() => removeAt(index)}
            >
              <Icon icon={X} />
            </button>
          </span>
        )
      })}
      <Button
        ref={addRef}
        size="sm"
        variant="ghost"
        icon={value.conditions.length === 0 ? ListFilter : Plus}
        aria-haspopup="dialog"
        aria-expanded={adding}
        onClick={() => setAdding((open) => !open)}
      >
        {t('common:filterBuilder.addFilter')}
      </Button>
      {value.conditions.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          icon={X}
          onClick={() => {
            setEditing(null)
            onChange({ match: 'all', conditions: [] })
          }}
        >
          {t('common:filterBuilder.clear')}
        </Button>
      )}

      <Popover
        open={adding}
        onClose={() => setAdding(false)}
        anchorRef={addRef}
        label={t('common:filterBuilder.addFilter')}
        className="ui-filter-builder__fields"
      >
        <ul className="ui-filter-builder__field-list">
          {fields.map((spec) => (
            <li key={spec.field}>
              <button
                type="button"
                className="ui-filter-builder__field"
                onClick={() => add(spec.field)}
              >
                {spec.label}
              </button>
            </li>
          ))}
        </ul>
        {customFields.length > 0 && (
          <section
            className="ui-filter-builder__custom"
            aria-label={t('common:filterBuilder.customFields')}
          >
            <h3 className="ui-filter-builder__heading">{t('common:filterBuilder.customFields')}</h3>
            {customFields.length >= FIELD_SEARCH_FROM && (
              <SearchField
                label={t('common:filterBuilder.findField')}
                placeholder={t('common:filterBuilder.findField')}
                value={fieldQuery}
                onChange={(event) => setFieldQuery(event.target.value)}
                onClear={() => setFieldQuery('')}
              />
            )}
            <ul className="ui-filter-builder__field-list">
              {shownCustom.map((field) => (
                <li key={field.id}>
                  <button
                    type="button"
                    className="ui-filter-builder__field"
                    onClick={() => addCondition(defaultCustomCondition(field))}
                  >
                    {field.name}
                  </button>
                </li>
              ))}
            </ul>
            {shownCustom.length === 0 && (
              <p className="ui-filter-builder__label">{t('common:filterBuilder.noFieldMatches')}</p>
            )}
          </section>
        )}
      </Popover>

      {editing !== null && value.conditions[editing] && (
        <Popover
          open
          onClose={() => setEditing(null)}
          anchorRef={editingRef}
          label={t('common:filterBuilder.editFilterField', {
            field: specFor(value.conditions[editing], customFields).spec?.label ?? ''
          })}
          className="ui-filter-builder__editor"
        >
          <ConditionEditor
            condition={value.conditions[editing]}
            choices={choices}
            names={allNames}
            customFields={customFields}
            onChange={(next) => replaceAt(editing, next)}
          />
          <div className="ui-filter-builder__editor-actions">
            <Button size="sm" variant="ghost" onClick={() => removeAt(editing)}>
              {t('common:filterBuilder.remove')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
              {t('common:filterBuilder.done')}
            </Button>
          </div>
        </Popover>
      )}
    </div>
  )
}

function ConditionEditor({
  condition,
  choices,
  names,
  customFields,
  onChange
}: {
  condition: TaskFilterCondition
  choices: FilterChoices
  names: FilterNames
  customFields: readonly PlanningFieldDefinition[]
  onChange: (next: TaskFilterCondition) => void
}) {
  const { spec, custom } = specFor(condition, customFields)
  if (!spec)
    return <p className="ui-filter-builder__label">{t('common:filterBuilder.fieldDeleted')}</p>
  const operator =
    (custom
      ? spec.ops.find((candidate) => candidate.op === condition.op)
      : opSpec(condition.field, condition.op)) ?? spec.ops[0]

  const changeOp = (op: TaskFilterOp) => {
    const next = spec.ops.find((candidate) => candidate.op === op)!
    // Keep the value while it still fits the new operator's kind.
    const value =
      next.kind === operator.kind
        ? condition.value
        : custom
          ? defaultValueOfKind(next)
          : defaultValueFor(condition.field, op)
    onChange({ ...condition, op, value })
  }

  const listChoices = (): FilterChoice[] => {
    switch (operator.kind) {
      case 'statuses':
        // A project's hidden columns are not offered (R2.4); its own are (MOP-26).
        return visibleColumnPlaces(names.columns).map((place) => ({
          value: place.key,
          label: place.label
        }))
      case 'priorities':
        return [...TASK_PRIORITIES].reverse().map((priority) => ({
          value: priority,
          label: describeValue(condition, priority)
        }))
      case 'people':
        return [
          { value: 'me', label: t('common:filterBuilder.me') },
          { value: 'nobody', label: t('common:filterBuilder.nobody') },
          ...choices.people
        ]
      case 'labels':
        return choices.labels
      case 'milestones':
        return [
          { value: 'none', label: t('common:filterBuilder.noMilestone') },
          ...choices.milestones
        ]
      case 'goals':
        return [{ value: 'none', label: t('common:filterBuilder.noGoal') }, ...choices.goals]
      case 'iterations':
        return [
          { value: ITERATION_CURRENT, label: t('common:filterBuilder.currentIteration') },
          { value: 'none', label: t('common:filterBuilder.noIteration') },
          ...(choices.iterations ?? [])
        ]
      case 'types':
        return [
          { value: 'none', label: t('common:filterBuilder.noType') },
          ...(choices.types ?? [])
        ]
      case 'subprojects':
        return [
          { value: 'none', label: t('common:filterBuilder.noSubproject') },
          ...(choices.subprojects ?? [])
        ]
      case 'options':
        return (custom?.options ?? []).map((option) => ({ value: option.id, label: option.name }))
      case 'contacts':
        return choices.contacts ?? []
      default:
        return []
    }
  }

  const list = Array.isArray(condition.value) ? (condition.value as unknown[]).map(String) : []
  const options = listChoices()
  // A value no longer offered (a removed person) stays listed so it can be unticked.
  if (operator.kind !== 'numberRange')
    for (const entry of list)
      if (!options.some((option) => option.value === entry))
        options.push({
          value: entry,
          label: custom
            ? t('tasks:taskFilter.deletedOption')
            : describeValue(condition, entry, names)
        })
  const range =
    operator.kind === 'numberRange' && Array.isArray(condition.value)
      ? (condition.value as unknown[]).map(Number)
      : [0, 0]

  return (
    <div className="ui-filter-builder__condition">
      {spec.ops.length > 1 ? (
        <Select
          label={spec.label}
          size="sm"
          value={operator.op}
          onChange={(event) => changeOp(event.target.value as TaskFilterOp)}
          options={spec.ops.map((candidate) => ({ value: candidate.op, label: candidate.label }))}
        />
      ) : (
        <p className="ui-filter-builder__label">
          {spec.label} {operator.label}
        </p>
      )}
      {operator.kind === 'text' && (
        <TextField
          label={t('common:filterBuilder.words')}
          hideLabel
          data-autofocus
          maxLength={200}
          value={String(condition.value)}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
        />
      )}
      {options.length > 0 && (
        <fieldset className="ui-filter-builder__options">
          <legend className="ui-visually-hidden">{spec.label}</legend>
          {options.map((option) => (
            <Checkbox
              key={option.value}
              label={option.label}
              checked={list.includes(option.value)}
              onChange={(event) =>
                onChange({
                  ...condition,
                  value: event.target.checked
                    ? [...list, option.value]
                    : list.filter((entry) => entry !== option.value)
                })
              }
            />
          ))}
        </fieldset>
      )}
      {['labels', 'options'].includes(operator.kind) && options.length === 0 && (
        <p className="ui-filter-builder__label">{t('common:filterBuilder.noTaskProjectHas')}</p>
      )}
      {operator.kind === 'relativeDate' && (
        <Select
          label={t('common:filterBuilder.when')}
          hideLabel
          size="sm"
          value={String(condition.value)}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
          options={(operator.relative ?? []).map((relative: RelativeDate) => ({
            value: relative,
            label: RELATIVE_DATE_LABELS[relative]
          }))}
        />
      )}
      {operator.kind === 'date' && (
        <DateField
          label={t('common:filterBuilder.date')}
          hideLabel
          value={String(condition.value)}
          onChange={(date) => onChange({ ...condition, value: date })}
        />
      )}
      {operator.kind === 'number' && (
        <NumberField
          label={custom ? spec.label : t('common:filterBuilder.estimate')}
          hideLabel
          min={custom ? undefined : 0}
          max={custom ? undefined : 1000}
          value={typeof condition.value === 'number' ? condition.value : null}
          onChange={(number) => onChange({ ...condition, value: number ?? 0 })}
        />
      )}
      {operator.kind === 'numberRange' && (
        <div className="ui-filter-builder__range">
          <NumberField
            label={t('common:filterBuilder.from')}
            value={range[0]}
            onChange={(number) => onChange({ ...condition, value: [number ?? 0, range[1]] })}
          />
          <NumberField
            label={t('common:filterBuilder.to')}
            value={range[1]}
            onChange={(number) => onChange({ ...condition, value: [range[0], number ?? 0] })}
          />
        </div>
      )}
      {operator.kind === 'presence' && (
        <Select
          label={spec.label}
          hideLabel
          size="sm"
          value={String(condition.value)}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
          options={[
            { value: 'empty', label: t('common:filterBuilder.isEmpty') },
            { value: 'set', label: t('common:filterBuilder.isSet') }
          ]}
        />
      )}
      {operator.kind === 'estimatePresence' && (
        <Select
          label={t('common:filterBuilder.estimate')}
          hideLabel
          size="sm"
          value={String(condition.value)}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
          options={[
            { value: 'set', label: 'set' },
            { value: 'empty', label: 'empty' }
          ]}
        />
      )}
      {operator.kind === 'checklist' && (
        <Select
          label={t('common:filterBuilder.checklist')}
          hideLabel
          size="sm"
          value={String(condition.value)}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
          options={CHECKLIST_VALUES.map((entry) => ({ value: entry, label: entry }))}
        />
      )}
      {operator.kind === 'resolution' && (
        <Select
          label={spec.label}
          hideLabel
          size="sm"
          value={String(condition.value)}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
          options={[{ value: 'wont-do', label: t('tasks:taskFilter.wontDo') }]}
        />
      )}
      {operator.kind === 'boolean' && (
        <Select
          label={spec.label}
          hideLabel
          size="sm"
          value={condition.value ? 'yes' : 'no'}
          onChange={(event) => onChange({ ...condition, value: event.target.value === 'yes' })}
          options={[
            { value: 'yes', label: 'yes' },
            { value: 'no', label: 'no' }
          ]}
        />
      )}
    </div>
  )
}

function defaultValueFor(field: TaskFilterField, op: TaskFilterOp): TaskFilterCondition['value'] {
  const spec = opSpec(field, op)
  if (!spec) return ''
  if (spec.kind === 'date' || spec.kind === 'text') return ''
  if (spec.kind === 'number') return 1
  if (spec.kind === 'estimatePresence') return 'set'
  if (spec.kind === 'relativeDate') return spec.relative![0]
  return defaultCondition(field).value
}
