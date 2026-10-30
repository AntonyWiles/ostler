import { useState, type ReactNode } from 'react'
import { MAX_AREA_NAME_LENGTH, moveArea, type ProjectArea } from '@shared/project-areas'
import { t } from '@shared/i18n'
import { Button, Dialog, InlineAlert, TextField, useToast } from '../../ui'

export interface AreaActions {
  /** Opens the name dialog for a new area. */
  newArea: () => void
  rename: (area: ProjectArea) => void
  /** Removes the area at once; its projects go to "No area". The toast offers Undo. */
  remove: (area: ProjectArea) => Promise<void>
  /** Moves an area by `delta` places. */
  move: (area: ProjectArea, delta: number) => Promise<void>
  /** The name dialog; render it once. */
  dialogs: ReactNode
}

/**
 * New area, Rename, Remove (with undo) and reordering (N5.1): the one set of
 * area actions, used by the sidebar and Settings › Projects. Every change
 * saves the whole list through `saveAreas`, and the project push refreshes
 * every screen.
 */
export function useAreaActions(areas: readonly ProjectArea[]): AreaActions {
  const { toast, toastUndo } = useToast()
  const [editing, setEditing] = useState<{ area: ProjectArea | null } | null>(null)

  const failed = (error: string) =>
    toast({ title: t('projects:areas.couldntSave'), body: error, tone: 'danger' })

  const save = async (
    next: Array<{ id?: string; name: string }>,
    assignments?: Record<string, string | null>
  ): Promise<string | null> => {
    const result = await window.ostlerAPI.saveAreas(next, assignments)
    return result.ok ? null : result.error
  }

  const remove = async (area: ProjectArea) => {
    const before = [...areas]
    // Every project in it, disabled ones too, so Undo puts them all back.
    const all = await window.ostlerAPI.getProjects()
    const members = all.ok ? all.value.filter((project) => project.areaId === area.id) : []
    const error = await save(before.filter((entry) => entry.id !== area.id))
    if (error) {
      failed(error)
      return
    }
    toastUndo(
      t('projects:areas.removed', { name: area.name }),
      async () => {
        const undoError = await save(
          before,
          Object.fromEntries(members.map((project) => [project.id, area.id]))
        )
        if (undoError) failed(undoError)
      },
      members.length > 0 ? t('projects:areas.removedBody') : undefined
    )
  }

  const move = async (area: ProjectArea, delta: number) => {
    const next = moveArea(areas, area.id, delta)
    if (next.every((entry, index) => entry.id === areas[index]?.id)) return
    const error = await save(next)
    if (error) failed(error)
  }

  return {
    newArea: () => setEditing({ area: null }),
    rename: (area) => setEditing({ area }),
    remove,
    move,
    dialogs: editing && (
      <AreaNameDialog
        area={editing.area}
        onClose={() => setEditing(null)}
        onSave={(name) =>
          save(
            editing.area
              ? areas.map((entry) => (entry.id === editing.area!.id ? { ...entry, name } : entry))
              : [...areas, { name }]
          )
        }
      />
    )
  }
}

function AreaNameDialog({
  area,
  onClose,
  onSave
}: {
  area: ProjectArea | null
  onClose: () => void
  /** Resolves to an error, or null once saved. */
  onSave: (name: string) => Promise<string | null>
}) {
  const [name, setName] = useState(area?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    const problem = await onSave(name.trim())
    setBusy(false)
    if (problem) setError(problem)
    else onClose()
  }

  return (
    <Dialog
      open
      size="sm"
      title={
        area ? t('projects:areas.renameArea', { name: area.name }) : t('projects:areas.newArea')
      }
      onClose={onClose}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('projects:areas.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim()}
            onClick={() => void submit()}
          >
            {area ? t('projects:areas.save') : t('projects:areas.create')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <TextField
          label={t('projects:areas.areaName')}
          value={name}
          maxLength={MAX_AREA_NAME_LENGTH}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          data-autofocus
        />
      </form>
    </Dialog>
  )
}
