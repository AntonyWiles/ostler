import { useRef, useState, type RefObject } from 'react'
import type { EstimateUnit, PlanningPriority } from '@shared/ostler-api'
import { ESTIMATE_UNIT_SHORT, TASK_PRIORITIES, taskPriorityLabel } from '@shared/task-labels'
import {
  Button,
  DateField,
  NumberField,
  Popover,
  PRIORITY_ICONS,
  TextField,
  type MenuEntry
} from '../../ui'
import { t } from '@shared/i18n'
import './inline-editors.css'

/**
 * A task's fields edited in place, outside the drawer: the List's cells and
 * the Board's cards open the same editors, so a field edits one way wherever
 * it is shown. Each saves through `updateWorkItemInline`, as the drawer saves.
 */

/** The most an estimate may be. */
const MAX_ESTIMATE = 1000

/** The title, typed in place: Enter or leaving saves, Esc puts it back. */
export function TitleEditor({
  initial,
  onSave,
  onCancel,
  className = 'list-cell__title-editor'
}: {
  initial: string
  onSave: (title: string) => void
  onCancel: () => void
  className?: string
}) {
  const [draft, setDraft] = useState(initial)
  const done = useRef(false)
  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    const title = draft.trim()
    if (save && title && title !== initial) onSave(title)
    else onCancel()
  }
  return (
    <TextField
      label={t('views:listCells.title')}
      hideLabel
      autoFocus
      className={className}
      value={draft}
      maxLength={200}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          finish(false)
        }
      }}
    />
  )
}

/** A date picked in a pop-up, saved with its button or Enter; Esc or clicking away keeps it. */
export function DateEditor({
  anchor,
  label,
  initial,
  due,
  onSave,
  onClose
}: {
  anchor: RefObject<HTMLElement | null>
  label: string
  initial: string | null
  due: boolean
  onSave: (value: string | null) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(initial ?? '')
  return (
    <Popover open onClose={onClose} anchorRef={anchor} label={label} className="list-editor">
      <form
        className="list-editor__form"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(draft || null)
        }}
      >
        <DateField label={label} value={draft} onChange={setDraft} due={due} />
        <div className="list-editor__actions">
          <Button size="sm" variant="ghost" onClick={() => onSave(null)} disabled={!initial}>
            {t('views:listCells.clear')}
          </Button>
          <Button size="sm" variant="primary" type="submit">
            {t('views:listCells.save')}
          </Button>
        </div>
      </form>
    </Popover>
  )
}

export function EstimateEditor({
  anchor,
  initial,
  unit,
  onSave,
  onClose
}: {
  anchor: RefObject<HTMLElement | null>
  initial: number | null
  unit: EstimateUnit
  onSave: (value: number | null) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<number | null>(initial)
  return (
    <Popover
      open
      onClose={onClose}
      anchorRef={anchor}
      label={t('views:listCells.estimate')}
      className="list-editor"
    >
      <form
        className="list-editor__form"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(draft)
        }}
      >
        <NumberField
          label={t('views:listCells.estimate')}
          min={0}
          max={MAX_ESTIMATE}
          step={unit === 'hours' ? 0.5 : 1}
          unit={ESTIMATE_UNIT_SHORT[unit]}
          placeholder={t('views:listCells.none')}
          value={draft}
          onChange={setDraft}
        />
        <div className="list-editor__actions">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSave(null)}
            disabled={initial === null}
          >
            {t('views:listCells.clear')}
          </Button>
          <Button size="sm" variant="primary" type="submit">
            {t('views:listCells.save')}
          </Button>
        </div>
      </form>
    </Popover>
  )
}

/** The priorities, highest first, as a menu; picking the current one does nothing. */
export function priorityMenuEntries(
  current: PlanningPriority,
  onPick: (priority: PlanningPriority) => void
): MenuEntry[] {
  return [...TASK_PRIORITIES].reverse().map((priority: PlanningPriority) => ({
    label: taskPriorityLabel(priority),
    icon: PRIORITY_ICONS[priority],
    onSelect: () => {
      if (priority !== current) onPick(priority)
    }
  }))
}
