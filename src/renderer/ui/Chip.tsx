import { t } from '@shared/i18n'
import type { ReactNode } from 'react'
import { Icon, X } from './icons'
import { cx } from './cx'
import './Chip.css'

export interface ChipProps {
  children: ReactNode
  /** A colour dot before the text: any CSS colour (a project or label colour). */
  color?: string
  /** Shows a remove button named "Remove <removeLabel>". */
  onRemove?: () => void
  /** The text the remove button names. Defaults to the children when they are a string. */
  removeLabel?: string
  /** The remove button's whole name, when "Remove <removeLabel>" does not fit: "Remove label urgent". */
  removeText?: string
  selected?: boolean
  className?: string
}

/** A label or tag, with an optional colour dot and remove button. */
export function Chip({
  children,
  color,
  onRemove,
  removeLabel,
  removeText,
  selected,
  className
}: ChipProps) {
  const name = removeLabel ?? (typeof children === 'string' ? children : t('common:chip.item'))
  const removeName = removeText ?? t('common:chip.remove', { name })
  return (
    <span className={cx('ui-chip', selected && 'is-selected', className)}>
      {color && <span className="ui-chip__dot" style={{ background: color }} aria-hidden="true" />}
      <span className="ui-chip__text">{children}</span>
      {onRemove && (
        <button
          type="button"
          className="ui-chip__remove"
          aria-label={removeName}
          title={removeName}
          onClick={onRemove}
        >
          <Icon icon={X} />
        </button>
      )}
    </span>
  )
}
