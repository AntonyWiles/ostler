import './NewProjectWizard.css'
import { t } from '@shared/i18n'
import { PROJECT_COLORS } from '@shared/project-colors'

/**
 * Names for the project palette, in `PROJECT_COLORS` order, so a colour
 * swatch has an accessible name. The colours themselves live only there.
 */
const PALETTE_NAMES: ReadonlyArray<() => string> = [
  () => t('projects:projectColorPicker.blue'),
  () => t('projects:projectColorPicker.violet'),
  () => t('projects:projectColorPicker.pink'),
  () => t('projects:projectColorPicker.amber'),
  () => t('projects:projectColorPicker.emerald'),
  () => t('projects:projectColorPicker.red'),
  () => t('projects:projectColorPicker.cyan'),
  () => t('projects:projectColorPicker.orange'),
  () => t('projects:projectColorPicker.lime'),
  () => t('projects:projectColorPicker.indigo')
]

export function projectColorName(color: string): string {
  const name = PALETTE_NAMES[PROJECT_COLORS.indexOf(color.toLowerCase())]
  return name ? name() : color
}

interface ProjectColorPickerProps {
  /** The palette, from main (`PROJECT_COLORS` via getNewProjectDefaults). */
  colors: string[]
  value: string
  onChange: (color: string) => void
  /** Groups the radios; unique per form. */
  name: string
}

/**
 * The project colour swatches: native radios with names, so they are
 * keyboard and screen-reader usable. Used by the new-project wizard and the
 * sidebar's Colour dialog.
 */
export function ProjectColorPicker({ colors, value, onChange, name }: ProjectColorPickerProps) {
  return (
    <fieldset className="ostler-newproject-colors">
      <legend>{t('projects:projectColorPicker.colour')}</legend>
      {colors.map((option) => (
        <label key={option} className="ostler-newproject-color">
          <input
            type="radio"
            name={name}
            checked={value === option}
            onChange={() => onChange(option)}
            aria-label={projectColorName(option)}
          />
          <span style={{ backgroundColor: option }} aria-hidden="true" />
        </label>
      ))}
    </fieldset>
  )
}
