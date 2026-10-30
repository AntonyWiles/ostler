import { useEffect, useState } from 'react'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { customDrawerField } from '../../hooks/planning/drawer-saves'
import {
  fieldHoldsValue,
  fieldsForType,
  fieldsHiddenByType,
  hiddenFieldsWithValues,
  taskTypeOf
} from '@shared/task-type-fields'
import { Button } from '../../ui'
import { TaskDrawerSection } from './TaskDrawerSection'
import { CustomFieldInput } from './CustomFieldInput'
import { t } from '@shared/i18n'
import type { PlanningFieldDefinition, PlanningWorkItem } from '@shared/ostler-api'
import { isAiField, isAiFilled, isAiFillOutOfDate } from '@shared/planning/ai-fields'
import { useFeatures } from '../../navigation/features'
import { useAiFieldFill } from '../../hooks/planning/useAiFieldFill'
import { Icon, Sparkles } from '../../ui/icons'
import { HiddenFieldsNote } from '../../components/HiddenFieldsNote'
import { taskTypeGlyph } from '../../task-types/task-type-icons'
import { AiValueMark } from './AiFieldMark'

/**
 * Under an AI field (N8.4): the mark on Ostler AI's value, "May be out of
 * date" when the task's text has changed since, and Fill with AI (Fill again)
 * while Ostler AI is set up. Editing the value makes it the person's.
 */
function AiFieldActions({
  field,
  item,
  canFill,
  busy,
  onFill
}: {
  field: PlanningFieldDefinition
  item: PlanningWorkItem
  canFill: boolean
  busy: boolean
  onFill: () => void
}) {
  const fill = item.fieldFills?.[field.id]
  const filled = isAiFilled(fill) && item.fieldValues?.[field.id] !== undefined
  const stale = filled && isAiFillOutOfDate(fill, item)
  return (
    <div className="task-custom-fields__ai">
      {filled && (
        <span className="task-custom-fields__ai-note">
          <AiValueMark fill={fill} item={item} />
          {stale ? t('tasks:aiFields.mayBeOutOfDate') : t('tasks:aiFields.filledByAi')}
        </span>
      )}
      {canFill && (
        <Button
          size="sm"
          variant="ghost"
          icon={Sparkles}
          loading={busy}
          disabled={busy}
          aria-label={`${filled ? t('tasks:aiFields.fillAgain') : t('tasks:aiFields.fillWithAi')}: ${field.name}`}
          onClick={onFill}
        >
          {filled ? t('tasks:aiFields.fillAgain') : t('tasks:aiFields.fillWithAi')}
        </Button>
      )}
    </div>
  )
}

/**
 * The task drawer's Fields section (R2.2): the project's custom fields, in
 * their order. Each saves the way the drawer saves everything (D30): typed
 * text and numbers after the pause, everything else at once.
 *
 * N2.7b: only the fields the task's type shows. The note under them counts
 * the hidden fields that hold a value ("2 more fields with values are hidden
 * for Bug", Show them); with none, it is a quiet Show all fields. Hidden
 * values are kept, so they come back when the type changes back.
 */
export function TaskCustomFieldsSection({ ws }: { ws: PlanningWorkspace }) {
  const [showHidden, setShowHidden] = useState(false)
  const features = useFeatures()
  const aiFill = useAiFieldFill({
    projectId: ws.projectId,
    taskTypes: ws.taskTypes,
    reload: ws.loadPlanning
  })
  // The saved task: who filled each value, and the text it was filled from (N8.4).
  const item = ws.selectedWorkItem
  const type = taskTypeOf(ws.taskTypes, ws.editTypeId)
  const hidden = fieldsHiddenByType(ws.fields, type)
  // The note counts only hidden fields that hold a value: what the person might miss.
  const withValues = hiddenFieldsWithValues(ws.fields, type, ws.editFieldValues)
  // Another task, or another type, starts with its hidden fields hidden again.
  useEffect(() => setShowHidden(false), [ws.selectedWorkItemId, type?.id])
  if (ws.fields.length === 0) return null
  const shown = showHidden ? ws.fields : fieldsForType(ws.fields, type)
  // A type that names its fields asks for them; otherwise they show once one holds a value.
  const inUse =
    (!!type?.fieldIds && fieldsForType(ws.fields, type).length > 0) ||
    Object.values(ws.editFieldValues).some(fieldHoldsValue)
  return (
    <TaskDrawerSection title={t('tasks:customFields.fields')} part={{ id: 'fields', inUse }}>
      {shown.length > 0 && (
        <div className="task-drawer__fields task-custom-fields">
          {shown.map((field) => {
            const key = customDrawerField(field.id)
            return (
              <div
                key={field.id}
                className={
                  field.type === 'choices' || field.type === 'text'
                    ? 'task-drawer__field-wide'
                    : undefined
                }
              >
                <CustomFieldInput
                  field={field}
                  value={ws.editFieldValues[field.id]}
                  error={ws.saveFailures.find((failure) => failure.field === key)?.message}
                  onFocus={() => ws.beginEdit(key)}
                  onBlur={() => ws.endEdit(key)}
                  onChange={(value, typed) => ws.setEditFieldValue(field.id, value, typed)}
                />
                {item && (isAiField(field) || isAiFilled(item.fieldFills?.[field.id])) && (
                  <AiFieldActions
                    field={field}
                    item={item}
                    canFill={features.ai && isAiField(field)}
                    busy={aiFill.progress !== null}
                    onFill={() => void aiFill.fill(field, [item])}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
      {type && hidden.length > 0 && (
        <HiddenFieldsNote
          icon={
            showHidden || withValues.length > 0 ? (
              <Icon icon={taskTypeGlyph(type.icon)} />
            ) : undefined
          }
          message={
            showHidden
              ? t('tasks:taskTypes.fieldsShownForType', { name: type.name })
              : withValues.length > 0
                ? t('tasks:taskTypes.fieldsWithValuesHiddenForType', {
                    count: withValues.length,
                    name: type.name
                  })
                : undefined
          }
          action={
            showHidden
              ? t('tasks:taskTypes.hideThem')
              : withValues.length > 0
                ? t('tasks:taskTypes.showThem')
                : t('tasks:taskTypes.showAllFields')
          }
          onAction={() => setShowHidden((value) => !value)}
        />
      )}
    </TaskDrawerSection>
  )
}
