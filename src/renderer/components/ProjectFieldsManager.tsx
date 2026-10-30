import { useCallback, useEffect, useState } from 'react'
import {
  MAX_AI_INSTRUCTION_LENGTH,
  MAX_FIELD_NAME_LENGTH,
  MAX_FIELD_OPTION_LENGTH,
  MAX_FIELD_OPTIONS,
  MAX_PROJECT_FIELDS,
  PLANNING_FIELD_TYPES,
  type PlanningFieldDefinition,
  type PlanningFieldOptionInput,
  type PlanningFieldType
} from '@shared/ostler-api'
import { PROJECT_COLORS, paletteColorFor } from '@shared/project-colors'
import { fieldTypeLabel, hasOptions } from '@shared/planning/custom-fields'
import { canHaveAiInstruction } from '@shared/planning/ai-fields'
import { Button, Checkbox, IconButton, Select, TextArea, TextField, useToast } from '../ui'
import { useFeatures } from '../navigation/features'
import { AiFieldSparkle } from '../views/planning/AiFieldMark'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from '../ui/icons'
import { projectColorName } from './ProjectColorPicker'
import './ProjectLabelsManager.css'
import './ProjectFieldsManager.css'
import { t } from '@shared/i18n'

/**
 * A project's custom fields (R2.2, D32), in Project settings: add, rename,
 * reorder and delete fields, and edit a choice field's options. A field's
 * type is fixed once it is made. Deleting a field happens at once and offers
 * undo, which puts back every value it had.
 */
export function ProjectFieldsManager({
  projectId,
  onError,
  onSaved
}: {
  projectId: string
  onError: (error: string | null) => void
  onSaved: () => void
}) {
  const { toastUndo } = useToast()
  const [fields, setFields] = useState<PlanningFieldDefinition[] | null>(null)
  /** The field being edited, `'new'` for the add form, or null. */
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getPlanningFields(projectId)
    if (result.ok) setFields(result.value)
    else onError(result.error)
  }, [projectId, onError])

  useEffect(() => {
    void load()
  }, [load])

  const saved = async () => {
    onError(null)
    setEditing(null)
    await load()
    onSaved()
  }

  const move = async (index: number, by: -1 | 1) => {
    if (!fields) return
    const ids = fields.map((field) => field.id)
    const [id] = ids.splice(index, 1)
    ids.splice(index + by, 0, id)
    const result = await window.ostlerAPI.reorderPlanningFields(projectId, ids)
    if (!result.ok) return onError(result.error)
    setFields(result.value)
    onSaved()
  }

  const remove = async (field: PlanningFieldDefinition) => {
    const result = await window.ostlerAPI.deletePlanningField(projectId, field.id)
    if (!result.ok) return onError(result.error)
    await load()
    onSaved()
    const deletion = result.value
    toastUndo(
      t('tasks:customFields.deletedField', {
        count: deletion.values.length,
        fieldName: field.name
      }),
      async () => {
        const restored = await window.ostlerAPI.restorePlanningField(projectId, deletion)
        if (!restored.ok) return onError(restored.error)
        await load()
        onSaved()
      }
    )
  }

  if (fields === null) return null

  return (
    <div className="project-fields">
      {fields.length === 0 ? (
        <p className="ostler-project-settings-muted">{t('tasks:customFields.noFieldsYet')}</p>
      ) : (
        <ul className="project-labels" aria-label={t('tasks:customFields.fields')}>
          {fields.map((field, index) =>
            editing === field.id ? (
              <li key={field.id} className="project-labels__row is-editing">
                <FieldEditor
                  field={field}
                  onCancel={() => setEditing(null)}
                  onSave={async (input) => {
                    const result = await window.ostlerAPI.updatePlanningField(
                      projectId,
                      field.id,
                      input
                    )
                    if (!result.ok) return onError(result.error)
                    await saved()
                  }}
                />
              </li>
            ) : (
              <li key={field.id} className="project-labels__row">
                <span className="project-labels__name">
                  {field.name}
                  <AiFieldSparkle field={field} />
                </span>
                <span className="project-labels__count">
                  {hasOptions(field.type)
                    ? t('tasks:customFields.typeWithOptions', {
                        type: fieldTypeLabel(field.type),
                        count: field.options.length
                      })
                    : fieldTypeLabel(field.type)}
                </span>
                <IconButton
                  size="sm"
                  icon={ArrowUp}
                  label={t('tasks:customFields.moveFieldUp', { fieldName: field.name })}
                  disabled={index === 0}
                  onClick={() => void move(index, -1)}
                />
                <IconButton
                  size="sm"
                  icon={ArrowDown}
                  label={t('tasks:customFields.moveFieldDown', { fieldName: field.name })}
                  disabled={index === fields.length - 1}
                  onClick={() => void move(index, 1)}
                />
                <IconButton
                  size="sm"
                  icon={Pencil}
                  label={t('tasks:customFields.editField', { fieldName: field.name })}
                  onClick={() => setEditing(field.id)}
                />
                <IconButton
                  size="sm"
                  icon={Trash2}
                  label={t('tasks:customFields.deleteField', { fieldName: field.name })}
                  onClick={() => void remove(field)}
                />
              </li>
            )
          )}
        </ul>
      )}
      {editing === 'new' ? (
        <div className="project-fields__new">
          <FieldEditor
            onCancel={() => setEditing(null)}
            onSave={async (input) => {
              const result = await window.ostlerAPI.createPlanningField(projectId, {
                name: input.name ?? '',
                type: input.type ?? 'text',
                options: input.options,
                ...(input.aiInstruction ? { aiInstruction: input.aiInstruction } : {})
              })
              if (!result.ok) return onError(result.error)
              await saved()
            }}
          />
        </div>
      ) : (
        <div>
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            disabled={fields.length >= MAX_PROJECT_FIELDS}
            onClick={() => setEditing('new')}
          >
            {t('tasks:customFields.addField')}
          </Button>
          {fields.length >= MAX_PROJECT_FIELDS && (
            <p className="ostler-project-settings-muted">
              {t('tasks:customFields.atFieldLimit', { max: MAX_PROJECT_FIELDS })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

interface FieldEditorInput {
  name?: string
  type?: PlanningFieldType
  options?: PlanningFieldOptionInput[]
  /** Left out while Ostler AI is off, so an instruction is kept as it is. */
  aiInstruction?: string | null
}

/** Adds a field (no `field`) or edits one: its name and, for choice fields, its options. */
function FieldEditor({
  field,
  onCancel,
  onSave
}: {
  field?: PlanningFieldDefinition
  onCancel: () => void
  onSave: (input: FieldEditorInput) => Promise<void>
}) {
  const [name, setName] = useState(field?.name ?? '')
  const [type, setType] = useState<PlanningFieldType>(field?.type ?? 'text')
  const [options, setOptions] = useState<PlanningFieldOptionInput[]>(
    field?.options.map((option) => ({ ...option })) ?? []
  )
  const [busy, setBusy] = useState(false)
  const choice = hasOptions(type)
  const features = useFeatures()
  // Fill with AI (N8.4): Text and Choice fields, offered while Ostler AI is set up.
  const aiOffered = features.ai && canHaveAiInstruction(type)
  const [aiOn, setAiOn] = useState(Boolean(field?.aiInstruction))
  const [instruction, setInstruction] = useState(field?.aiInstruction ?? '')

  const setOption = (index: number, change: Partial<PlanningFieldOptionInput>) =>
    setOptions((list) =>
      list.map((option, at) => (at === index ? { ...option, ...change } : option))
    )
  const moveOption = (index: number, by: -1 | 1) =>
    setOptions((list) => {
      const next = [...list]
      const [option] = next.splice(index, 1)
      next.splice(index + by, 0, option)
      return next
    })
  const addOption = () =>
    setOptions((list) => [
      ...list,
      { name: '', color: PROJECT_COLORS[list.length % PROJECT_COLORS.length] }
    ])

  const save = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const kept = options
        .map((option) => ({ ...option, name: option.name.trim() }))
        .filter((option) => option.name !== '')
      await onSave({
        name: name.trim(),
        type: field ? undefined : type,
        options: choice ? kept : undefined,
        ...(aiOffered
          ? { aiInstruction: aiOn && instruction.trim() ? instruction.trim() : null }
          : {})
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="project-labels__editor"
      aria-label={
        field
          ? t('tasks:customFields.editField', { fieldName: field.name })
          : t('tasks:customFields.addField')
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
        label={t('tasks:customFields.fieldName')}
        value={name}
        maxLength={MAX_FIELD_NAME_LENGTH}
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      {field ? (
        <p className="ostler-project-settings-muted">
          {t('tasks:customFields.typeIsFixed', { type: fieldTypeLabel(field.type) })}
        </p>
      ) : (
        <Select
          label={t('tasks:customFields.fieldType')}
          value={type}
          hint={t('tasks:customFields.typeCannotChangeLater')}
          onChange={(event) => setType(event.target.value as PlanningFieldType)}
          options={PLANNING_FIELD_TYPES.map((value) => ({
            value,
            label: fieldTypeLabel(value)
          }))}
        />
      )}
      {choice && (
        <fieldset className="project-fields__options">
          <legend>{t('tasks:customFields.options')}</legend>
          {options.length === 0 && (
            <p className="ostler-project-settings-muted">{t('tasks:customFields.noOptionsYet')}</p>
          )}
          <ol className="project-fields__option-list">
            {options.map((option, index) => {
              const color = option.color ?? paletteColorFor(option.name)
              const label =
                option.name.trim() || t('tasks:customFields.optionNumber', { n: index + 1 })
              return (
                <li key={option.id ?? `new-${index}`} className="project-fields__option">
                  <span
                    className="project-labels__dot"
                    style={{ background: color }}
                    aria-hidden="true"
                  />
                  <TextField
                    label={t('tasks:customFields.optionName', { n: index + 1 })}
                    hideLabel
                    value={option.name}
                    maxLength={MAX_FIELD_OPTION_LENGTH}
                    onChange={(event) => setOption(index, { name: event.target.value })}
                  />
                  <Select
                    label={t('tasks:customFields.optionColour', { option: label })}
                    hideLabel
                    size="sm"
                    value={color}
                    onChange={(event) => setOption(index, { color: event.target.value })}
                    // A colour from outside the palette (set through the API or a file) stays listed.
                    options={[
                      ...(PROJECT_COLORS.includes(color) ? [] : [color]),
                      ...PROJECT_COLORS
                    ].map((value) => ({
                      value,
                      label: projectColorName(value)
                    }))}
                  />
                  <IconButton
                    size="sm"
                    icon={ArrowUp}
                    label={t('tasks:customFields.moveOptionUp', { option: label })}
                    disabled={index === 0}
                    onClick={() => moveOption(index, -1)}
                  />
                  <IconButton
                    size="sm"
                    icon={ArrowDown}
                    label={t('tasks:customFields.moveOptionDown', { option: label })}
                    disabled={index === options.length - 1}
                    onClick={() => moveOption(index, 1)}
                  />
                  <IconButton
                    size="sm"
                    icon={X}
                    label={t('tasks:customFields.removeOption', { option: label })}
                    onClick={() => setOptions((list) => list.filter((_, at) => at !== index))}
                  />
                </li>
              )
            })}
          </ol>
          <div>
            <Button
              size="sm"
              variant="ghost"
              icon={Plus}
              disabled={options.length >= MAX_FIELD_OPTIONS}
              onClick={addOption}
            >
              {t('tasks:customFields.addOption')}
            </Button>
          </div>
          {field && (
            <p className="ostler-project-settings-muted">
              {t('tasks:customFields.removingOptionClears')}
            </p>
          )}
        </fieldset>
      )}
      {aiOffered && (
        <div className="project-fields__ai">
          <Checkbox
            label={t('tasks:aiFields.fillWithAi')}
            hint={t('tasks:aiFields.fillWithAiHint')}
            checked={aiOn}
            onChange={(event) => setAiOn(event.target.checked)}
          />
          {aiOn && (
            <>
              <TextArea
                label={t('tasks:aiFields.instruction')}
                hint={t('tasks:aiFields.instructionHelp')}
                value={instruction}
                maxLength={MAX_AI_INSTRUCTION_LENGTH}
                rows={2}
                onChange={(event) => setInstruction(event.target.value)}
              />
              {type === 'choice' && (
                <p className="ostler-project-settings-muted">{t('tasks:aiFields.choiceNote')}</p>
              )}
              <p className="ostler-project-settings-muted">{t('tasks:aiFields.whatIsSent')}</p>
            </>
          )}
        </div>
      )}
      <div className="project-labels__editor-actions">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t('tasks:customFields.cancel')}
        </Button>
        <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!name.trim()}>
          {field ? t('tasks:customFields.saveField') : t('tasks:customFields.createField')}
        </Button>
      </div>
    </form>
  )
}
