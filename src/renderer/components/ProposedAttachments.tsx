import { useEffect, useState } from 'react'
import type { LibraryItem } from '@shared/ostler-api'
import { KIND_LABEL } from '../views/project-detail/library/libraryUi'
import { Checkbox } from '../ui'
import './ProposedAttachments.css'
import { t } from '@shared/i18n'

// One library listing per project for every toggle on screen: a task-split
// review can show sixty of them. Cleared when the library changes.
const itemsByProject = new Map<string, Promise<LibraryItem[]>>()

function libraryItems(projectId: string): Promise<LibraryItem[]> {
  let pending = itemsByProject.get(projectId)
  if (!pending) {
    pending = window.ostlerAPI
      .listLibraryItems(projectId, {})
      .then((result) => (result.ok ? result.value : []))
    itemsByProject.set(projectId, pending)
  }
  return pending
}

function useLibraryItems(projectId: string): LibraryItem[] {
  const [items, setItems] = useState<LibraryItem[]>([])
  useEffect(() => {
    let live = true
    const load = () =>
      void libraryItems(projectId).then((value) => {
        if (live) setItems(value)
      })
    load()
    const unsubscribe = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.projectId !== projectId || update.field !== 'library') return
      itemsByProject.delete(projectId)
      load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [projectId])
  return items
}

/**
 * Ostler AI's proposed attachments for one drafted task, shown as pre-ticked
 * "Attach for agent" toggles. Unticking drops one; the main process records
 * the ticked ones on approval as `ostler-ai`, and only ever ids the draft
 * itself proposed.
 */
export function ProposedAttachments({
  projectId,
  proposed,
  selected,
  onChange,
  disabled
}: {
  projectId: string
  proposed: string[] | undefined
  selected: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  const items = useLibraryItems(projectId)
  if (!proposed || proposed.length === 0) return null
  return (
    <fieldset className="proposed-attachments">
      <legend>{t('ai:proposedAttachments.attachAgent')}</legend>
      {proposed.map((id) => {
        const item = items.find((candidate) => candidate.id === id)
        return (
          <Checkbox
            key={id}
            label={
              item
                ? t('ai:proposedAttachments.kindTitle', {
                    kind: KIND_LABEL[item.kind],
                    title: item.title
                  })
                : t('ai:proposedAttachments.libraryItem')
            }
            hint={
              item ? t('ai:proposedAttachments.revision', { revision: item.revision }) : undefined
            }
            checked={selected.includes(id)}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? proposed.filter((candidate) => candidate === id || selected.includes(candidate))
                  : selected.filter((candidate) => candidate !== id)
              )
            }
          />
        )
      })}
    </fieldset>
  )
}
