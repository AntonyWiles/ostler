import { useState } from 'react'
import type { RendererProject } from '@shared/ostler-api'
import { parseTaskPrefix, TASK_PREFIX_MAX } from '@shared/task-key'
import { Button, InlineAlert, TextField } from '../ui'
import { t } from '@shared/i18n'

/**
 * Project settings › Task IDs (N9.8a): the prefix of the project's task IDs,
 * SHOP in SHOP-12, with Change prefix. Two to five letters A to Z, made
 * capital; main refuses one another project uses. Changing it changes every
 * task's ID at once, which the form says before it is saved.
 */
export function ProjectTaskPrefix({
  project,
  onSaved
}: {
  project: RendererProject
  onSaved: (project: RendererProject) => void
}) {
  const saved = project.taskPrefix ?? ''
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cancel = () => {
    setDraft(null)
    setError(null)
  }

  const save = async () => {
    if (draft === null) return
    const prefix = parseTaskPrefix(draft)
    if (prefix === null) return setError(t('projects:taskPrefix.invalid'))
    if (prefix === saved) return cancel()
    const result = await window.ostlerAPI.updateProject(project.id, { taskPrefix: prefix })
    if (!result.ok) return setError(result.error)
    cancel()
    onSaved(result.value)
  }

  if (draft === null)
    return (
      <div className="ostler-project-settings-folder">
        <span>
          {saved
            ? t('projects:taskPrefix.current', { prefix: saved, example: `${saved}-12` })
            : t('projects:taskPrefix.none')}
        </span>
        <Button size="sm" onClick={() => setDraft(saved)}>
          {t('projects:taskPrefix.change')}
        </Button>
      </div>
    )

  return (
    <>
      <TextField
        label={t('projects:taskPrefix.label')}
        hint={t('projects:taskPrefix.hint')}
        value={draft}
        maxLength={TASK_PREFIX_MAX}
        error={error ?? undefined}
        autoFocus
        onChange={(event) => {
          setDraft(event.target.value.toUpperCase())
          setError(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save()
          if (event.key === 'Escape') {
            event.stopPropagation()
            cancel()
          }
        }}
      />
      <InlineAlert tone="warning">{t('projects:taskPrefix.warning')}</InlineAlert>
      <div className="ostler-project-settings-folder">
        <Button variant="primary" size="sm" onClick={() => void save()}>
          {t('projects:taskPrefix.save')}
        </Button>
        <Button size="sm" onClick={cancel}>
          {t('projects:taskPrefix.cancel')}
        </Button>
      </div>
    </>
  )
}
