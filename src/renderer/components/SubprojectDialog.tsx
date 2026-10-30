import { useEffect, useState } from 'react'
import type { PlanningSubproject, RendererProject } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Button, Checkbox, Dialog, InlineAlert, TextArea, TextField } from '../ui'
import { usePeople } from '../context/PeopleContext'
import { AssigneeField } from '../views/planning/AssigneeField'
import { ProjectColorPicker } from './ProjectColorPicker'

/** What the dialog is for: a new workstream, a new name, or all of its details. */
export type SubprojectDialogMode = 'new' | 'rename' | 'details'

const MAX_NAME_LENGTH = 120

/**
 * The dialog behind the sidebar's New workstream, Rename and Edit details
 * (a workstream is a sub-project). New asks for a name and a colour, which
 * starts as the project's. It saves through `createSubproject` or
 * `updateSubproject` and hands the saved workstream to `onSaved`.
 */
export function SubprojectDialog({
  project,
  subproject,
  mode,
  onClose,
  onSaved
}: {
  project: RendererProject
  /** The workstream being edited; null for a new one. */
  subproject: PlanningSubproject | null
  mode: SubprojectDialogMode
  onClose: () => void
  onSaved: (subproject: PlanningSubproject, created: boolean) => void
}) {
  const people = usePeople()
  const [name, setName] = useState(subproject?.name ?? '')
  const [color, setColor] = useState(subproject?.color ?? project.color)
  const [description, setDescription] = useState(subproject?.description ?? '')
  const [leadId, setLeadId] = useState<string | null>(subproject?.leadId ?? null)
  const [memberIds, setMemberIds] = useState<string[]>(subproject?.memberIds ?? [])
  const [palette, setPalette] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (mode === 'rename') return
    void window.ostlerAPI.getNewProjectDefaults().then((result) => {
      if (result.ok) setPalette(result.value.colors)
    })
  }, [mode])

  const colors = palette.includes(color) || palette.length === 0 ? palette : [color, ...palette]
  const title =
    mode === 'new'
      ? t('projects:subprojects.newWorkstream')
      : mode === 'rename'
        ? t('projects:subprojects.renameWorkstream', { name: subproject?.name ?? '' })
        : t('projects:subprojects.editDetailsOf', { name: subproject?.name ?? '' })

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    const result = subproject
      ? await window.ostlerAPI.updateSubproject(
          subproject.id,
          mode === 'rename'
            ? { name: trimmed }
            : { name: trimmed, color, description: description.trim(), leadId, memberIds }
        )
      : await window.ostlerAPI.createSubproject(project.id, {
          name: trimmed,
          ...(color !== project.color ? { color } : {})
        })
    setBusy(false)
    if (result.ok) {
      onSaved(result.value, subproject === null)
      onClose()
    } else {
      setError(result.error)
    }
  }

  const offered = people.offered(project.id)

  return (
    <Dialog
      open
      size="sm"
      title={title}
      onClose={onClose}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('projects:subprojects.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim()}
            onClick={() => void submit()}
          >
            {subproject ? t('projects:subprojects.save') : t('projects:subprojects.create')}
          </Button>
        </>
      }
    >
      <form
        className="subproject-dialog"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <TextField
          label={t('projects:subprojects.name')}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          data-autofocus
        />
        {mode !== 'rename' && colors.length > 0 && (
          <ProjectColorPicker
            colors={colors}
            value={color}
            onChange={setColor}
            name={`subproject-colour-${subproject?.id ?? 'new'}`}
          />
        )}
        {mode === 'details' && (
          <>
            <TextArea
              label={t('projects:subprojects.description')}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <AssigneeField
              projectId={project.id}
              value={leadId}
              onChange={setLeadId}
              label={t('projects:subprojects.lead')}
            />
            {offered.length > 0 && (
              <fieldset className="subproject-dialog-members">
                <legend>{t('projects:subprojects.members')}</legend>
                {offered.map((person) => (
                  <Checkbox
                    key={person.id}
                    label={person.name}
                    checked={memberIds.includes(person.id)}
                    onChange={(event) =>
                      setMemberIds((current) =>
                        event.target.checked
                          ? [...current, person.id]
                          : current.filter((id) => id !== person.id)
                      )
                    }
                  />
                ))}
              </fieldset>
            )}
          </>
        )}
      </form>
    </Dialog>
  )
}
