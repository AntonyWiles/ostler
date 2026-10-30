import { useState } from 'react'
import { PROJECT_ICONS, type ProjectIcon } from '@shared/project-icons'
import { t } from '@shared/i18n'
import { SearchField } from '../ui'
import { Ban, Icon } from '../ui/icons'
import { PROJECT_ICON_GLYPHS } from './project-icon-glyphs'
import './ProjectIconPicker.css'

/** An icon's name for screen readers and search. */
export function projectIconName(icon: ProjectIcon): string {
  return t(`projects:projectIcons.names.${icon}`)
}

interface ProjectIconPickerProps {
  value: ProjectIcon | null
  onChange: (icon: ProjectIcon | null) => void
  /** Groups the radios; unique per form. */
  name: string
  /** The project's colour, so the choices look as they will in the sidebar. */
  color?: string
}

/**
 * The project icon picker (N5.1): None, then the curated icons, searchable by
 * name. Native radios with names, like the colour swatches, so arrow keys
 * move between them and each is announced. Used by Project settings and the
 * New project wizard.
 */
export function ProjectIconPicker({ value, onChange, name, color }: ProjectIconPickerProps) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = PROJECT_ICONS.filter(
    (icon) =>
      !needle || icon.includes(needle) || projectIconName(icon).toLowerCase().includes(needle)
  )
  return (
    <fieldset className="project-icon-picker">
      <legend>{t('projects:projectIcons.icon')}</legend>
      <p className="project-icon-picker__hint">{t('projects:projectIcons.hint')}</p>
      <SearchField
        label={t('projects:projectIcons.search')}
        hideLabel
        placeholder={t('projects:projectIcons.search')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="project-icon-picker__grid" style={{ color: color || undefined }}>
        <label className="project-icon-picker__choice" title={t('projects:projectIcons.none')}>
          <input
            type="radio"
            name={name}
            checked={value === null}
            onChange={() => onChange(null)}
            aria-label={t('projects:projectIcons.none')}
          />
          <span aria-hidden="true">
            <Icon icon={Ban} />
          </span>
        </label>
        {shown.map((icon) => (
          <label key={icon} className="project-icon-picker__choice" title={projectIconName(icon)}>
            <input
              type="radio"
              name={name}
              checked={value === icon}
              onChange={() => onChange(icon)}
              aria-label={projectIconName(icon)}
            />
            <span aria-hidden="true">
              <Icon icon={PROJECT_ICON_GLYPHS[icon]} />
            </span>
          </label>
        ))}
      </div>
      {shown.length === 0 && (
        <p className="project-icon-picker__hint">{t('projects:projectIcons.noMatches')}</p>
      )}
    </fieldset>
  )
}
