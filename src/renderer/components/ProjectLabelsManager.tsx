import { useCallback, useEffect, useState } from 'react'
import type { PlanningLabel } from '@shared/ostler-api'
import { PROJECT_COLORS } from '@shared/project-colors'
import { Button, IconButton, TextField, useToast } from '../ui'
import { Pencil, Trash2 } from '../ui/icons'
import { ProjectColorPicker } from './ProjectColorPicker'
import './ProjectLabelsManager.css'
import { t } from '@shared/i18n'

/**
 * A project's labels (P5.1): every label its tasks use, with its colour.
 * Rename and recolour in place; delete takes the label off every task at
 * once and offers undo, which puts it back where it was.
 */
export function ProjectLabelsManager({
  projectId,
  onError,
  onSaved
}: {
  projectId: string
  onError: (error: string | null) => void
  onSaved: () => void
}) {
  const { toastUndo } = useToast()
  const [labels, setLabels] = useState<PlanningLabel[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getPlanningLabels(projectId)
    if (result.ok) setLabels(result.value)
    else onError(result.error)
  }, [projectId, onError])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (label: PlanningLabel) => {
    const result = await window.ostlerAPI.deletePlanningLabel(projectId, label.name)
    if (!result.ok) return onError(result.error)
    await load()
    onSaved()
    const deletion = result.value
    toastUndo(
      t('tasks:projectLabelsManager.deletedLabelTasks', {
        count: deletion.workItemIds.length,
        labelName: label.name
      }),
      async () => {
        const restored = await window.ostlerAPI.restorePlanningLabel(projectId, deletion)
        if (restored.ok) setLabels(restored.value)
        else onError(restored.error)
      }
    )
  }

  if (labels === null) return null
  if (labels.length === 0) {
    return (
      <p className="ostler-project-settings-muted">
        {t('tasks:projectLabelsManager.noLabelsYetAdd')}
      </p>
    )
  }

  return (
    <ul className="project-labels" aria-label={t('tasks:projectLabelsManager.labels')}>
      {labels.map((label) =>
        editing === label.name ? (
          <li key={label.name} className="project-labels__row is-editing">
            <LabelEditor
              label={label}
              onCancel={() => setEditing(null)}
              onSave={async (name, color) => {
                if (color !== label.color || !label.hasColor) {
                  const recoloured = await window.ostlerAPI.setPlanningLabelColor(
                    projectId,
                    label.name,
                    color
                  )
                  if (!recoloured.ok) return onError(recoloured.error)
                }
                if (name !== label.name) {
                  const renamed = await window.ostlerAPI.renamePlanningLabel(
                    projectId,
                    label.name,
                    name
                  )
                  if (!renamed.ok) return onError(renamed.error)
                }
                onError(null)
                setEditing(null)
                await load()
                onSaved()
              }}
            />
          </li>
        ) : (
          <li key={label.name} className="project-labels__row">
            <span
              className="project-labels__dot"
              style={{ background: label.color }}
              aria-hidden="true"
            />
            <span className="project-labels__name">{label.name}</span>
            <span className="project-labels__count">
              {t('common:count.task', { count: label.taskCount })}
            </span>
            <IconButton
              size="sm"
              icon={Pencil}
              label={t('tasks:projectLabelsManager.editLabel', { labelName: label.name })}
              onClick={() => setEditing(label.name)}
            />
            <IconButton
              size="sm"
              icon={Trash2}
              label={t('tasks:projectLabelsManager.deleteLabel', { labelName: label.name })}
              onClick={() => void remove(label)}
            />
          </li>
        )
      )}
    </ul>
  )
}

function LabelEditor({
  label,
  onCancel,
  onSave
}: {
  label: PlanningLabel
  onCancel: () => void
  onSave: (name: string, color: string) => Promise<void>
}) {
  const [name, setName] = useState(label.name)
  const [color, setColor] = useState(label.color)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await onSave(name.trim(), color)
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
        label={t('tasks:projectLabelsManager.labelName')}
        value={name}
        maxLength={80}
        autoFocus
        hint={t('tasks:projectLabelsManager.renamingChangesEveryTask')}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }}
      />
      <ProjectColorPicker
        colors={[...PROJECT_COLORS]}
        value={color}
        onChange={setColor}
        name={`label-colour-${label.name}`}
      />
      <div className="project-labels__editor-actions">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t('tasks:projectLabelsManager.cancel')}
        </Button>
        <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!name.trim()}>
          {t('tasks:projectLabelsManager.saveLabel')}
        </Button>
      </div>
    </form>
  )
}
