import { useId } from 'react'
import { paletteColorFor } from '@shared/project-colors'
import { FREQUENT_LABEL_COUNT } from '@shared/planning/frequent-labels'
import { Chip, Combobox } from '../../ui'
import { Check, Icon, Plus } from '../../ui/icons'
import './TaskLabelsField.css'
import { t } from '@shared/i18n'

/**
 * A task's labels. The project's most used ones (`frequent`) wait in a row
 * of their own, each a click to add and a click to take off again, so the
 * usual labels never need typing. The task's other labels show as chips with
 * a remove button, and the picker finds any of the project's labels or
 * creates a new one. When few labels are in use yet, the row is topped up
 * with the project's other labels, so a project whose labels are set up but
 * not used still shows them without typing (MOP-44).
 */
export function TaskLabelsField({
  labels,
  known,
  frequent = [],
  onChange,
  colorOf = paletteColorFor,
  openPicker = false
}: {
  labels: string[]
  /** Every label used in the project, for the picker. */
  known: string[]
  /** The project's most used labels, most first (`frequentLabels`): one click each. */
  frequent?: string[]
  onChange: (labels: string[]) => void
  /** A label's colour: the project's chosen one, or its stable default. */
  colorOf?: (label: string) => string
  /** Open the picker's list of every label straight away, without typing. */
  openPicker?: boolean
}) {
  const headingId = useId()
  const add = (label: string) => {
    const text = label.trim()
    if (text && !labels.includes(text)) onChange([...labels, text])
  }
  const remove = (label: string) => onChange(labels.filter((other) => other !== label))
  const quick = [...frequent, ...known.filter((label) => !frequent.includes(label))].slice(
    0,
    Math.max(frequent.length, FREQUENT_LABEL_COUNT)
  )
  const others = labels.filter((label) => !quick.includes(label))
  return (
    <div className="task-labels" role="group" aria-labelledby={headingId}>
      <span id={headingId} className="ui-field__label">
        {t('tasks:taskLabelsField.labels')}
      </span>
      {quick.length > 0 && (
        <div className="task-labels__chips">
          {quick.map((label) => {
            const on = labels.includes(label)
            return (
              <button
                key={label}
                type="button"
                className={`ui-chip task-labels__toggle${on ? ' is-selected' : ''}`}
                aria-pressed={on}
                title={
                  on
                    ? t('tasks:taskLabelsField.removeLabel', { label })
                    : t('tasks:taskLabelsField.addThisLabel', { label })
                }
                onClick={() => (on ? remove(label) : add(label))}
              >
                <span
                  className="ui-chip__dot"
                  style={{ background: colorOf(label) }}
                  aria-hidden="true"
                />
                <span className="ui-chip__text">{label}</span>
                <Icon icon={on ? Check : Plus} />
              </button>
            )
          })}
        </div>
      )}
      {others.length > 0 && (
        <div className="task-labels__chips">
          {others.map((label) => (
            <Chip
              key={label}
              color={colorOf(label)}
              removeText={t('tasks:taskLabelsField.removeLabel', { label })}
              onRemove={() => remove(label)}
            >
              {label}
            </Chip>
          ))}
        </div>
      )}
      <Combobox
        label={t('tasks:taskLabelsField.addLabel')}
        hideLabel
        placeholder={t('tasks:taskLabelsField.addLabel')}
        options={known
          .filter((label) => !labels.includes(label))
          .map((label) => ({
            value: label,
            label,
            prefix: (
              <span
                className="ui-chip__dot"
                style={{ background: colorOf(label) }}
                aria-hidden="true"
              />
            )
          }))}
        value={null}
        onChange={(label) => {
          if (label) add(label)
        }}
        onCreate={add}
        openOnMount={openPicker}
        emptyText={t('tasks:taskLabelsField.typeCreateLabel')}
      />
    </div>
  )
}
