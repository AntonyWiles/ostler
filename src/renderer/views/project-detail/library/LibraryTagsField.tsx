import { useEffect, useMemo, useState } from 'react'
import type { PlanningLabel } from '@shared/ostler-api'
import { Chip, Combobox } from '../../../ui'
import { t } from '@shared/i18n'

interface LibraryTagsFieldProps {
  projectId: string
  tags: string[]
  disabled?: boolean
  /** The item's whole new list of tags. */
  onChange(tags: string[]): void
}

/**
 * A Library item's tags, which are the project's labels: pick one its tasks or other items use,
 * or type a new one, which tasks are then offered too. Each shows in its label colour.
 */
export function LibraryTagsField({ projectId, tags, disabled, onChange }: LibraryTagsFieldProps) {
  const [labels, setLabels] = useState<PlanningLabel[]>([])
  const tagsKey = tags.join('\u0000')

  // Reloaded when this item's tags change and when a label is renamed, recoloured or removed.
  useEffect(() => {
    let live = true
    const load = () =>
      void window.ostlerAPI.getPlanningLabels(projectId).then((result) => {
        if (live && result.ok) setLabels(result.value)
      })
    load()
    const stop = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.projectId === projectId && update.field === 'planning') load()
    })
    return () => {
      live = false
      stop()
    }
  }, [projectId, tagsKey])

  const colorOf = useMemo(() => new Map(labels.map((label) => [label.name, label.color])), [labels])
  const options = useMemo(
    () =>
      labels
        .filter((label) => !tags.includes(label.name))
        .map((label) => ({
          value: label.name,
          label: label.name,
          prefix: (
            <span
              className="ostler-library-tag-dot"
              style={{ background: label.color }}
              aria-hidden="true"
            />
          )
        })),
    [labels, tagsKey]
  )
  const add = (name: string | null) => {
    const tag = name?.trim().replace(/\s+/g, ' ')
    if (tag && !tags.includes(tag)) onChange([...tags, tag])
  }

  return (
    <div className="ostler-library-tags">
      <Combobox
        label={t('library:libraryDetail.tags')}
        hint={t('library:libraryDetail.tagsShared')}
        options={options}
        value={null}
        onChange={add}
        onCreate={add}
        placeholder={t('library:libraryDetail.addTag')}
        maxLength={80}
        disabled={disabled}
      />
      {tags.length > 0 && (
        <div className="ostler-library-chips" aria-label={t('library:libraryDetail.tagsItem')}>
          {tags.map((name) => (
            <Chip
              key={name}
              color={colorOf.get(name)}
              onRemove={disabled ? undefined : () => onChange(tags.filter((tag) => tag !== name))}
            >
              {name}
            </Chip>
          ))}
        </div>
      )}
    </div>
  )
}
