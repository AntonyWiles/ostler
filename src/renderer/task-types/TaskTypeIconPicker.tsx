import { useState } from 'react'
import { TASK_TYPE_ICONS } from '@shared/task-types'
import { t } from '@shared/i18n'
import { SearchField } from '../ui'
import { Icon } from '../ui/icons'
import { TASK_TYPE_GLYPHS, taskTypeIconName } from './task-type-icons'
import '../components/ProjectIconPicker.css'

/**
 * A task type's icon (N2.7a): the curated icons, searchable by name. Native
 * radios with names, like the project icon picker whose look it shares, so
 * arrow keys move between them and each is announced.
 */
export function TaskTypeIconPicker({
  value,
  onChange,
  name,
  color
}: {
  value: string
  onChange: (icon: string) => void
  /** Groups the radios; unique per form. */
  name: string
  color?: string
}) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = TASK_TYPE_ICONS.filter(
    (icon) =>
      !needle || icon.includes(needle) || taskTypeIconName(icon).toLowerCase().includes(needle)
  )
  return (
    <fieldset className="project-icon-picker">
      <legend>{t('tasks:taskTypes.icon')}</legend>
      <SearchField
        label={t('tasks:taskTypes.searchIcons')}
        hideLabel
        placeholder={t('tasks:taskTypes.searchIcons')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="project-icon-picker__grid" style={{ color: color || undefined }}>
        {shown.map((icon) => (
          <label key={icon} className="project-icon-picker__choice" title={taskTypeIconName(icon)}>
            <input
              type="radio"
              name={name}
              checked={value === icon}
              onChange={() => onChange(icon)}
              aria-label={taskTypeIconName(icon)}
            />
            <span aria-hidden="true">
              <Icon icon={TASK_TYPE_GLYPHS[icon]} />
            </span>
          </label>
        ))}
      </div>
      {shown.length === 0 && (
        <p className="project-icon-picker__hint">{t('tasks:taskTypes.noIconMatches')}</p>
      )}
    </fieldset>
  )
}
