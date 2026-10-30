import type {
  PlanningFieldDefinition,
  PlanningFieldType,
  PlanningFieldValue,
  PlanningFieldValues
} from '../ostler-api'
import { MAX_FIELD_OPTION_LENGTH, MAX_FIELD_TEXT_LENGTH } from '../ostler-api'
import { isIsoDate } from '../dates'
import { Refusal } from '../refusal'
import { t } from '../i18n'

/**
 * Custom field values (R2.2, D32): the one rule for what a field accepts, how
 * a value reads as text and how two values sort. The planning service
 * validates every write with `normalizeFieldValue`, so the drawer, New task,
 * the plan grid, the List, CSV import, the project file and the automation API
 * refuse the same values with the same words.
 */

/** Whether a field type has options. */
export function hasOptions(type: PlanningFieldType): boolean {
  return type === 'choice' || type === 'choices'
}

/** The type's name, for the Fields section and the filter menu. */
export function fieldTypeLabel(type: PlanningFieldType): string {
  return t(`tasks:customFields.type.${type}`)
}

/**
 * The stored form of `raw` for `field`, or null when it is empty (and so is
 * not stored). Throws a Refusal naming the field when the value does not fit
 * the type: text for a number, an option the field does not have.
 */
export function normalizeFieldValue(
  field: Pick<PlanningFieldDefinition, 'name' | 'type' | 'options'>,
  raw: unknown
): PlanningFieldValue | null {
  if (raw === null || raw === undefined) return null
  const refuse = (key: string): never => {
    throw new Refusal(t(`errors:customFields.${key}`, { name: field.name }))
  }
  switch (field.type) {
    case 'text': {
      if (typeof raw !== 'string') return refuse('needsText')
      const text = raw.trim()
      if (text.length > MAX_FIELD_TEXT_LENGTH)
        throw new Refusal(
          t('errors:customFields.textTooLong', { name: field.name, max: MAX_FIELD_TEXT_LENGTH })
        )
      return text === '' ? null : text
    }
    case 'number': {
      if (typeof raw === 'string' && raw.trim() === '') return null
      const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
      if (!Number.isFinite(value)) return refuse('needsNumber')
      return value
    }
    case 'date': {
      if (raw === '') return null
      if (!isIsoDate(raw)) return refuse('needsDate')
      return raw
    }
    case 'checkbox': {
      if (typeof raw !== 'boolean') return refuse('needsBoolean')
      return raw ? true : null
    }
    case 'choice': {
      if (raw === '') return null
      if (typeof raw !== 'string') return refuse('needsOption')
      if (!field.options.some((option) => option.id === raw)) return refuse('unknownOption')
      return raw
    }
    case 'choices': {
      if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string'))
        return refuse('needsOptions')
      const chosen = new Set(raw as string[])
      for (const id of chosen)
        if (!field.options.some((option) => option.id === id)) return refuse('unknownOption')
      // In the field's own order, so two tasks with the same options compare equal.
      const ids = field.options.filter((option) => chosen.has(option.id)).map((option) => option.id)
      return ids.length === 0 ? null : ids
    }
  }
}

/** Whether a task has a value for the field. */
export function hasFieldValue(values: PlanningFieldValues | undefined, fieldId: string): boolean {
  return values !== undefined && Object.prototype.hasOwnProperty.call(values, fieldId)
}

/** An option's name, or null for an id the field no longer has. */
export function optionName(field: PlanningFieldDefinition, id: string): string | null {
  return field.options.find((option) => option.id === id)?.name ?? null
}

/**
 * A value as plain text: what CSV export writes and the cards show. Choices
 * join with "; ", a checkbox reads "Yes", a number as it is.
 */
export function fieldValueText(
  field: PlanningFieldDefinition,
  value: PlanningFieldValue | undefined
): string {
  if (value === undefined) return ''
  switch (field.type) {
    case 'checkbox':
      return value === true ? t('tasks:customFields.yes') : ''
    case 'choice':
      return optionName(field, String(value)) ?? ''
    case 'choices':
      return (Array.isArray(value) ? value : [])
        .map((id) => optionName(field, id))
        .filter((name): name is string => name !== null)
        .join('; ')
    default:
      return String(value)
  }
}

/** The words CSV import reads as a ticked checkbox, in any case. */
const TRUE_WORDS = ['yes', 'true', 'y', '1', 'x', '✓']
const FALSE_WORDS = ['no', 'false', 'n', '0', '']

/**
 * `text` (a CSV cell) as a value for `field`: option names (any case) become
 * ids, Choices split on ";" or ",". A word that fits nothing throws the same
 * refusal a wrong value from anywhere else does.
 */
export function parseFieldValueText(
  field: PlanningFieldDefinition,
  text: string
): PlanningFieldValue | null {
  const value = text.trim()
  if (value === '') return null
  switch (field.type) {
    case 'number':
      return normalizeFieldValue(field, value.replace(/,/g, ''))
    case 'checkbox': {
      const word = value.toLowerCase()
      if (TRUE_WORDS.includes(word)) return true
      if (FALSE_WORDS.includes(word)) return null
      return normalizeFieldValue(field, value)
    }
    case 'choice':
      return normalizeFieldValue(field, optionIdByName(field, value) ?? `\u0000${value}`)
    case 'choices':
      return normalizeFieldValue(
        field,
        value
          .split(/[;,]/)
          .map((part) => part.trim())
          .filter(Boolean)
          .map((name) => optionIdByName(field, name) ?? `\u0000${name}`)
      )
    default:
      return normalizeFieldValue(field, value)
  }
}

/**
 * The option name a piece of text stands for: trimmed and cut to the longest
 * an option name can be. A new field's options are named this way, and text
 * is matched to an option this way, so a long value finds its option.
 */
export function fieldOptionName(text: string): string {
  return text.trim().slice(0, MAX_FIELD_OPTION_LENGTH).trim()
}

function optionIdByName(field: PlanningFieldDefinition, name: string): string | undefined {
  const wanted = fieldOptionName(name).toLowerCase()
  return field.options.find((option) => option.name.toLowerCase() === wanted)?.id
}

/**
 * Sorts two values of one field, ascending, empty last. Choices sort by the
 * option's place in the field (the order the person gave them), not by name.
 */
export function compareFieldValues(
  field: PlanningFieldDefinition,
  a: PlanningFieldValue | undefined,
  b: PlanningFieldValue | undefined
): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1
  switch (field.type) {
    case 'number':
      return Number(a) - Number(b)
    case 'checkbox':
      return 0
    case 'choice':
    case 'choices': {
      const rank = (value: PlanningFieldValue) => {
        const first = Array.isArray(value) ? value[0] : String(value)
        const index = field.options.findIndex((option) => option.id === first)
        return index === -1 ? field.options.length : index
      }
      return rank(a) - rank(b)
    }
    default:
      return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
  }
}
