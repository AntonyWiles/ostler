import { useCallback, useEffect, useState } from 'react'
import type {
  PlanningFieldDefinition,
  PlanningTaskType,
  TaskTemplate,
  UpdatePlanningTaskTypeInput
} from '@shared/ostler-api'
import { PROJECT_COLORS, paletteColorFor } from '@shared/project-colors'
import { MAX_TASK_TYPES, MAX_TASK_TYPE_NAME_LENGTH } from '@shared/task-types'
import { Button, Checkbox, IconButton, Select, TextField, useToast } from '../ui'
import { ArrowDown, ArrowUp, Pencil, Trash2 } from '../ui/icons'
import { ProjectColorPicker } from '../components/ProjectColorPicker'
import { TaskTypeIcon } from './TaskTypeIcon'
import { TaskTypeIconPicker } from './TaskTypeIconPicker'
import '../components/ProjectLabelsManager.css'
import './ProjectTaskTypesManager.css'
import { t } from '@shared/i18n'

/**
 * A project's task types (N2.7a) in Project settings: add, rename, choose an
 * icon and a colour, move up and down, and delete. Deleting clears the type
 * from its tasks at once and offers undo, which puts both back.
 *
 * N2.7b: each type chooses its Fields (the custom fields its tasks show) and
 * the task template its new tasks start from.
 */
export function ProjectTaskTypesManager({
  projectId,
  onError,
  onSaved
}: {
  projectId: string
  onError: (error: string | null) => void
  onSaved: () => void
}) {
  const { toastUndo } = useToast()
  const [types, setTypes] = useState<PlanningTaskType[] | null>(null)
  const [fields, setFields] = useState<PlanningFieldDefinition[]>([])
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const [result, fieldResult, templateResult] = await Promise.all([
      window.ostlerAPI.getPlanningTaskTypes(projectId),
      window.ostlerAPI.getPlanningFields(projectId),
      window.ostlerAPI.getTaskTemplates(projectId)
    ])
    if (fieldResult.ok) setFields(fieldResult.value)
    if (templateResult.ok) setTemplates(templateResult.value)
    if (result.ok) setTypes(result.value)
    else onError(result.error)
  }, [projectId, onError])

  useEffect(() => {
    void load()
  }, [load])

  const saved = async () => {
    onError(null)
    await load()
    onSaved()
  }

  const add = async () => {
    const name = newName.trim()
    if (!name) return
    setAdding(true)
    try {
      const result = await window.ostlerAPI.createPlanningTaskType(projectId, { name })
      if (!result.ok) return onError(result.error)
      setNewName('')
      await saved()
    } finally {
      setAdding(false)
    }
  }

  const move = async (index: number, by: -1 | 1) => {
    if (!types) return
    const order = types.map((type) => type.id)
    const [moved] = order.splice(index, 1)
    order.splice(index + by, 0, moved)
    const result = await window.ostlerAPI.reorderPlanningTaskTypes(projectId, order)
    if (!result.ok) return onError(result.error)
    setTypes(result.value)
    onSaved()
  }

  const remove = async (type: PlanningTaskType) => {
    const result = await window.ostlerAPI.deletePlanningTaskType(type.id)
    if (!result.ok) return onError(result.error)
    await saved()
    const deletion = result.value
    toastUndo(
      t('tasks:taskTypes.deleted', { count: deletion.taskIds.length, name: type.name }),
      async () => {
        const restored = await window.ostlerAPI.restorePlanningTaskType(deletion)
        if (!restored.ok) return onError(restored.error)
        await saved()
      }
    )
  }

  if (types === null) return null

  return (
    <div className="project-task-types">
      {types.length === 0 ? (
        <p className="ostler-project-settings-muted">{t('tasks:taskTypes.none')}</p>
      ) : (
        <ul className="project-labels" aria-label={t('tasks:taskTypes.title')}>
          {types.map((type, index) =>
            editing === type.id ? (
              <li key={type.id} className="project-labels__row is-editing">
                <TaskTypeEditor
                  type={type}
                  fields={fields}
                  templates={templates}
                  onCancel={() => setEditing(null)}
                  onSave={async (updates) => {
                    const result = await window.ostlerAPI.updatePlanningTaskType(type.id, updates)
                    if (!result.ok) return onError(result.error)
                    setEditing(null)
                    await saved()
                  }}
                />
              </li>
            ) : (
              <li key={type.id} className="project-labels__row">
                <TaskTypeIcon type={type} />
                <span className="project-labels__name">{type.name}</span>
                <span className="project-task-types__summary">
                  {typeSummary(type, fields, templates)}
                </span>
                <IconButton
                  size="sm"
                  icon={ArrowUp}
                  label={t('tasks:taskTypes.moveUp', { name: type.name })}
                  disabled={index === 0}
                  onClick={() => void move(index, -1)}
                />
                <IconButton
                  size="sm"
                  icon={ArrowDown}
                  label={t('tasks:taskTypes.moveDown', { name: type.name })}
                  disabled={index === types.length - 1}
                  onClick={() => void move(index, 1)}
                />
                <IconButton
                  size="sm"
                  icon={Pencil}
                  label={t('tasks:taskTypes.edit', { name: type.name })}
                  onClick={() => setEditing(type.id)}
                />
                <IconButton
                  size="sm"
                  icon={Trash2}
                  label={t('tasks:taskTypes.delete', { name: type.name })}
                  onClick={() => void remove(type)}
                />
              </li>
            )
          )}
        </ul>
      )}
      {types.length < MAX_TASK_TYPES ? (
        <form
          className="project-task-types__add"
          onSubmit={(event) => {
            event.preventDefault()
            void add()
          }}
        >
          <TextField
            label={t('tasks:taskTypes.newName')}
            value={newName}
            maxLength={MAX_TASK_TYPE_NAME_LENGTH}
            placeholder={t('tasks:taskTypes.newPlaceholder')}
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            type="submit"
            loading={adding}
            disabled={!newName.trim()}
          >
            {t('tasks:taskTypes.add')}
          </Button>
        </form>
      ) : (
        <p className="ostler-project-settings-muted">
          {t('tasks:taskTypes.atMost', { max: MAX_TASK_TYPES })}
        </p>
      )}
    </div>
  )
}

/** "3 fields · Starts from Bug report", or nothing for every field and no template. */
function typeSummary(
  type: PlanningTaskType,
  fields: readonly PlanningFieldDefinition[],
  templates: readonly TaskTemplate[]
): string {
  const parts: string[] = []
  if (type.fieldIds && fields.length > 0)
    parts.push(t('tasks:taskTypes.fieldsSummary', { count: type.fieldIds.length }))
  const template = templates.find((entry) => entry.id === type.templateId)
  if (template) parts.push(t('tasks:taskTypes.templateSummary', { name: template.name }))
  return parts.join(' · ')
}

function TaskTypeEditor({
  type,
  fields,
  templates,
  onCancel,
  onSave
}: {
  type: PlanningTaskType
  fields: readonly PlanningFieldDefinition[]
  templates: readonly TaskTemplate[]
  onCancel: () => void
  onSave: (updates: UpdatePlanningTaskTypeInput) => Promise<void>
}) {
  const [name, setName] = useState(type.name)
  const [icon, setIcon] = useState(type.icon)
  const [color, setColor] = useState(type.color)
  /** Null: every field (N2.7b). */
  const [fieldIds, setFieldIds] = useState<string[] | null>(type.fieldIds ?? null)
  const [templateId, setTemplateId] = useState(type.templateId ?? '')
  const [busy, setBusy] = useState(false)
  const toggleField = (fieldId: string, on: boolean) =>
    setFieldIds((current) => {
      const ticked = new Set(current ?? fields.map((field) => field.id))
      if (on) ticked.add(fieldId)
      else ticked.delete(fieldId)
      return fields.map((field) => field.id).filter((id) => ticked.has(id))
    })
  // A colour from before the palette changed stays offered, so it can be kept.
  const colors = PROJECT_COLORS.includes(color) ? [...PROJECT_COLORS] : [color, ...PROJECT_COLORS]
  const save = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await onSave({
        name: name.trim(),
        icon,
        color: color || paletteColorFor(name),
        fieldIds,
        templateId: templateId || null
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="project-labels__editor"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <TextField
        label={t('tasks:taskTypes.name')}
        value={name}
        maxLength={MAX_TASK_TYPE_NAME_LENGTH}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }}
      />
      <TaskTypeIconPicker
        value={icon}
        onChange={setIcon}
        color={color}
        name={`task-type-icon-${type.id}`}
      />
      <ProjectColorPicker
        colors={colors}
        value={color}
        onChange={setColor}
        name={`task-type-colour-${type.id}`}
      />
      <fieldset className="project-task-types__fields">
        <legend>{t('tasks:taskTypes.fields')}</legend>
        {fields.length === 0 ? (
          <p className="ostler-project-settings-muted">{t('tasks:taskTypes.noFieldsYet')}</p>
        ) : (
          <>
            <p className="ostler-project-settings-muted">{t('tasks:taskTypes.fieldsHint')}</p>
            <Checkbox
              label={t('tasks:taskTypes.allFields')}
              checked={fieldIds === null}
              onChange={(event) =>
                setFieldIds(event.target.checked ? null : fields.map((field) => field.id))
              }
            />
            {fieldIds !== null && (
              <ul className="project-task-types__field-list">
                {fields.map((field) => (
                  <li key={field.id}>
                    <Checkbox
                      label={field.name}
                      checked={fieldIds.includes(field.id)}
                      onChange={(event) => toggleField(field.id, event.target.checked)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </fieldset>
      <Select
        label={t('tasks:taskTypes.template')}
        hint={t('tasks:taskTypes.templateHint')}
        size="sm"
        value={templateId}
        onChange={(event) => setTemplateId(event.target.value)}
        options={[
          { value: '', label: t('tasks:taskTypes.noTemplate') },
          ...templates.map((template) => ({ value: template.id, label: template.name }))
        ]}
      />
      <div className="project-labels__editor-actions">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t('tasks:taskTypes.cancel')}
        </Button>
        <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!name.trim()}>
          {t('tasks:taskTypes.save')}
        </Button>
      </div>
    </form>
  )
}
