import { useEffect, useRef } from 'react'
import type { PlanningChecklistDetail, PlanningChecklistDetailInput } from '@shared/ostler-api'
import { Button, Checkbox, IconButton, ProgressBar, TextField } from '../../ui'
import { ChevronDown, ChevronUp, Plus, Trash2 } from '../../ui/icons'
import { ChecklistItemDetails } from './ChecklistItemDetails'
import { t } from '@shared/i18n'

/** "3 of 5 done": the checklist's progress, counted over the saved items. */
export function checklistProgressText(done: number, total: number): string {
  return t('tasks:taskChecklistEditor.done', { done, total })
}

/**
 * The checklist (stored as a task's acceptance criteria, D21) as a list of
 * rows: tick, add, reorder and delete, rather than one line per entry in a
 * textarea. Enter in a row adds the next one. Blank rows are dropped when
 * the task is saved.
 *
 * Ticks apply at once (`onCheck`) and only to saved items: a row typed since
 * the last save is ticked once the task is saved. Typing a row's text saves
 * after a pause (`onChange` with `typed`); adding, moving or deleting a row
 * saves at once (D30).
 *
 * A saved item can have a due date and a person (N2.2, `onDetails`), set from
 * the button beside it and shown as chips. Items are keyed by their text, so
 * a row typed the same as another says it will be one item.
 */
export function TaskChecklistEditor({
  items,
  onChange,
  saved = [],
  checked = [],
  onCheck,
  onTextFocus,
  onTextBlur,
  details = [],
  onDetails,
  projectId
}: {
  items: string[]
  /** `typed` is true when the change is a row's text being typed. */
  onChange: (items: string[], typed?: boolean) => void
  /** The checklist as last saved: only these can be ticked. */
  saved?: string[]
  /** The saved items that are ticked. */
  checked?: string[]
  onCheck?: (text: string, checked: boolean) => void
  /** A row's text gained or lost focus: leaving it saves what was typed. */
  onTextFocus?: () => void
  onTextBlur?: () => void
  /** Saved items' due dates and people (N2.2). */
  details?: PlanningChecklistDetail[]
  /** Sets one saved item's date or person; without it, no controls show. */
  onDetails?: (text: string, input: PlanningChecklistDetailInput) => void
  /** The task's project, for the people its items' details offer. */
  projectId?: string | null
}) {
  const inputs = useRef<Array<HTMLInputElement | null>>([])
  const focusNext = useRef<number | null>(null)
  const checkedSet = new Set(checked)
  const doneCount = saved.filter((text) => checkedSet.has(text)).length
  const detailOf = new Map(details.map((detail) => [detail.text, detail]))
  const trimmed = items.map((entry) => entry.trim())

  useEffect(() => {
    if (focusNext.current === null) return
    inputs.current[focusNext.current]?.focus()
    focusNext.current = null
  })

  const insertAt = (index: number) => {
    focusNext.current = index
    onChange([...items.slice(0, index), '', ...items.slice(index)])
  }
  const move = (from: number, to: number) => {
    const next = [...items]
    const [entry] = next.splice(from, 1)
    next.splice(to, 0, entry)
    focusNext.current = to
    onChange(next)
  }
  const remove = (index: number) => {
    focusNext.current = Math.min(index, items.length - 2)
    onChange(items.filter((_, position) => position !== index))
  }

  return (
    <div className="task-checklist">
      {/* Shown from the first row, not from the first save: appearing while
          the first item was typed pushed the whole drawer down (MOP-13). */}
      {onCheck && (saved.length > 0 || items.length > 0) && (
        <div className="task-checklist__progress">
          <ProgressBar
            label={t('tasks:taskChecklistEditor.checklistProgress')}
            value={doneCount}
            max={Math.max(saved.length, 1)}
            valueText={checklistProgressText(doneCount, saved.length)}
            tone={saved.length > 0 && doneCount === saved.length ? 'success' : 'accent'}
          />
          <span className="task-checklist__progress-text" aria-hidden="true">
            {checklistProgressText(doneCount, saved.length)}
          </span>
        </div>
      )}
      {items.length > 0 && (
        <ol className="task-checklist__rows">
          {items.map((entry, index) => {
            const text = entry.trim()
            const tickable = onCheck !== undefined && text !== '' && saved.includes(text)
            const isChecked = tickable && checkedSet.has(text)
            const duplicate = text !== '' && trimmed.indexOf(text) < index
            const detail = detailOf.get(text)
            const detailed =
              onDetails !== undefined && text !== '' && !duplicate && saved.includes(text)
            return (
              <li
                key={index}
                className={['task-checklist__row', isChecked && 'is-checked']
                  .filter(Boolean)
                  .join(' ')}
              >
                {onCheck && (
                  <Checkbox
                    label={null}
                    aria-label={
                      text
                        ? t('tasks:taskChecklistEditor.doneItem', { text })
                        : t('tasks:taskChecklistEditor.doneItemNumber', { number: index + 1 })
                    }
                    className="task-checklist__check"
                    checked={isChecked}
                    disabled={!tickable}
                    title={tickable ? undefined : t('tasks:taskChecklistEditor.saveTaskTickItem')}
                    onChange={(event) => onCheck(text, event.target.checked)}
                  />
                )}
                <TextField
                  ref={(node) => {
                    inputs.current[index] = node
                  }}
                  label={t('tasks:taskChecklistEditor.itemNumber', { number: index + 1 })}
                  hideLabel
                  value={entry}
                  placeholder={t('tasks:taskChecklistEditor.somethingCheck')}
                  hint={duplicate ? t('tasks:taskChecklistEditor.sameAsAnother') : undefined}
                  onFocus={onTextFocus}
                  onBlur={onTextBlur}
                  onChange={(event) =>
                    onChange(
                      items.map((current, position) =>
                        position === index ? event.target.value : current
                      ),
                      true
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      insertAt(index + 1)
                    }
                  }}
                />
                {detailed && (
                  <ChecklistItemDetails
                    projectId={projectId ?? null}
                    text={text}
                    number={index + 1}
                    detail={detail}
                    onChange={(input) => onDetails(text, input)}
                  />
                )}
                <IconButton
                  size="sm"
                  icon={ChevronUp}
                  label={t('tasks:taskChecklistEditor.moveUp', { number: index + 1 })}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                />
                <IconButton
                  size="sm"
                  icon={ChevronDown}
                  label={t('tasks:taskChecklistEditor.moveDown', { number: index + 1 })}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, index + 1)}
                />
                <IconButton
                  size="sm"
                  icon={Trash2}
                  label={t('tasks:taskChecklistEditor.deleteItem', { number: index + 1 })}
                  onClick={() => remove(index)}
                />
              </li>
            )
          })}
        </ol>
      )}
      <Button size="sm" variant="ghost" icon={Plus} onClick={() => insertAt(items.length)}>
        {t('tasks:taskChecklistEditor.addItem')}
      </Button>
    </div>
  )
}
