import type { ReactNode } from 'react'
import type { PlanningWorkItemStatus } from '@shared/ostler-api'
import { Combobox, IconButton, StatusBadge, type ComboboxOption } from '../../ui'
import { X } from '../../ui/icons'
import { t } from '@shared/i18n'
import './planning-dialogs.css'

/** One task the field waits on, as the list shows it. */
export interface WaitsOnChoice {
  id: string
  /** The task's title, or the text to show when it is no longer there. */
  title: string
  /** Shown as a badge beside the title, when the task has a status. */
  status?: PlanningWorkItemStatus
  /** Opens the task, where there is a drawer to open it in. */
  onOpen?: () => void
  /** A task that no longer exists: shown plainly, and only removable. */
  missing?: boolean
  /** Shown under the row: the drawer's link in words and its editor (N7.2a). */
  detail?: ReactNode
}

/**
 * "Waits on": the tasks a task must wait for, as a list with a picker to add
 * one. The caller decides what may be picked (`options`), and anything
 * already chosen can always be removed. Used by the drawer, the create forms
 * and the plan grid, so they all offer it the same way.
 */
export function WaitsOnField({
  chosen,
  options,
  onAdd,
  onRemove,
  label = t('tasks:taskDependencies.addDependency'),
  heading,
  placeholder,
  emptyText
}: {
  chosen: WaitsOnChoice[]
  options: ComboboxOption[]
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  /** The picker's label, hidden: the list's heading says what it is. */
  label?: string
  /** A visible heading above the list, for a form that has no section title. */
  heading?: string
  placeholder: string
  emptyText: string
}) {
  return (
    <div className="task-dependencies">
      {heading && <p className="task-dependencies__heading">{heading}</p>}
      {chosen.length > 0 && (
        <ul className="task-dependencies__list" aria-label={t('tasks:taskDependencies.waits')}>
          {chosen.map((choice) => (
            <li
              key={choice.id}
              className={
                choice.detail
                  ? 'task-dependencies__row task-dependencies__row--detailed'
                  : 'task-dependencies__row'
              }
            >
              {choice.status && !choice.missing && <StatusBadge status={choice.status} iconOnly />}
              {choice.missing ? (
                <span className="task-dependencies__missing">{choice.title}</span>
              ) : choice.onOpen ? (
                <button
                  type="button"
                  className="task-dependencies__open"
                  title={t('tasks:taskDependencies.openTask')}
                  onClick={choice.onOpen}
                >
                  {choice.title}
                </button>
              ) : (
                <span className="task-dependencies__open">{choice.title}</span>
              )}
              <IconButton
                size="sm"
                icon={X}
                label={t('tasks:taskDependencies.removeDependencies', { title: choice.title })}
                onClick={() => onRemove(choice.id)}
              />
              {choice.detail && <div className="task-dependencies__detail">{choice.detail}</div>}
            </li>
          ))}
        </ul>
      )}
      <Combobox
        label={label}
        hideLabel
        placeholder={placeholder}
        emptyText={emptyText}
        options={options}
        value={null}
        onChange={(id) => {
          if (id) onAdd(id)
        }}
      />
    </div>
  )
}
