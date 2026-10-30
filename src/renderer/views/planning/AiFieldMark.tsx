import type {
  PlanningFieldDefinition,
  PlanningFieldFill,
  PlanningWorkItem
} from '@shared/ostler-api'
import { isAiField, isAiFillOutOfDate, isAiFilled } from '@shared/planning/ai-fields'
import { Sparkles } from '../../ui/icons'
import { Tooltip } from '../../ui'
import { t } from '@shared/i18n'
import './AiFieldMark.css'

/**
 * The small sparkle beside an AI field's name (N8.4), wherever the field
 * appears. Nothing for an ordinary field.
 */
export function AiFieldSparkle({
  field
}: {
  field: Pick<PlanningFieldDefinition, 'type' | 'aiInstruction'>
}) {
  if (!isAiField(field)) return null
  return (
    <Sparkles
      className="ai-field-mark"
      size={12}
      role="img"
      aria-label={t('tasks:aiFields.aiField')}
    />
  )
}

/** What a value's mark says (N8.4): who filled it and whether it may be out of date. */
export function aiValueDescription(
  fill: PlanningFieldFill | undefined,
  item: Pick<PlanningWorkItem, 'title' | 'description' | 'acceptanceCriteria'>
): string | null {
  if (!isAiFilled(fill)) return null
  return isAiFillOutOfDate(fill, item)
    ? `${t('tasks:aiFields.filledByAi')}. ${t('tasks:aiFields.mayBeOutOfDate')}`
    : t('tasks:aiFields.filledByAi')
}

/**
 * The sparkle beside a value Ostler AI filled, with "Filled by Ostler AI" (and
 * "May be out of date") in its tooltip and accessible name. Nothing for a
 * value the person entered.
 */
export function AiValueMark({
  fill,
  item,
  focusable = true
}: {
  fill: PlanningFieldFill | undefined
  item: Pick<PlanningWorkItem, 'title' | 'description' | 'acceptanceCriteria'>
  /**
   * Off inside a grid cell (the List), which keeps one tab stop per cell:
   * the mark still has its accessible name, and the cell its hover title.
   */
  focusable?: boolean
}) {
  const description = aiValueDescription(fill, item)
  if (!description) return null
  const stale = isAiFillOutOfDate(fill, item)
  const mark = (
    <span
      className={stale ? 'ai-field-mark is-stale' : 'ai-field-mark'}
      role="img"
      aria-label={description}
      tabIndex={focusable ? 0 : undefined}
      title={focusable ? undefined : description}
    >
      <Sparkles size={12} aria-hidden="true" />
    </span>
  )
  if (!focusable) return mark
  return (
    <Tooltip content={description} describe={false}>
      {mark}
    </Tooltip>
  )
}
