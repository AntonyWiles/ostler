import { useRef, useState } from 'react'
import type { PlanningChecklistDetail, PlanningChecklistDetailInput } from '@shared/ostler-api'
import { checklistDateLabel } from '@shared/planning/checklist-details'
import { Button, DateField, IconButton, Popover } from '../../ui'
import { CalendarDays } from '../../ui/icons'
import { usePeople } from '../../context/PeopleContext'
import { AssigneeField } from './AssigneeField'
import { t } from '@shared/i18n'

/**
 * One checklist item's due date and person (N2.2): chips when set ("Fri",
 * "Sam"), and a button shown on hover and focus when not. Either opens a
 * small panel with a date and a person; each change saves at once.
 */
export function ChecklistItemDetails({
  projectId,
  text,
  number,
  detail,
  onChange
}: {
  /** The task's project: its own people are offered with the address book. */
  projectId: string | null
  text: string
  number: number
  detail: PlanningChecklistDetail | undefined
  onChange: (input: PlanningChecklistDetailInput) => void
}) {
  const people = usePeople()
  const anchor = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const person = detail?.assigneeId ? people.byId.get(detail.assigneeId) : undefined
  const chips = [
    detail?.dueDate ? checklistDateLabel(detail.dueDate) : null,
    person ? person.name : null
  ].filter((chip): chip is string => chip !== null)
  const name = t('tasks:checklistItemDetails.open', { text })

  return (
    <>
      {chips.length > 0 ? (
        <button
          ref={anchor}
          type="button"
          className="task-checklist__chips"
          aria-label={t('tasks:checklistItemDetails.openSet', { text, details: chips.join(', ') })}
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          {chips.map((chip) => (
            <span key={chip} className="task-checklist__chip">
              {chip}
            </span>
          ))}
        </button>
      ) : (
        <IconButton
          ref={anchor}
          size="sm"
          icon={CalendarDays}
          label={name}
          className="task-checklist__details"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        />
      )}
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        label={t('tasks:checklistItemDetails.panel', { number })}
        placement="bottom-end"
        className="task-checklist__panel"
      >
        <DateField
          label={t('tasks:checklistItemDetails.dueDate')}
          value={detail?.dueDate ?? ''}
          onChange={(value) => onChange({ dueDate: value || null })}
        />
        <AssigneeField
          label={t('tasks:checklistItemDetails.person')}
          projectId={projectId}
          value={detail?.assigneeId ?? null}
          onChange={(assigneeId) => onChange({ assigneeId })}
        />
        {chips.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onChange({ dueDate: null, assigneeId: null })
              setOpen(false)
            }}
          >
            {t('tasks:checklistItemDetails.clear')}
          </Button>
        )}
      </Popover>
    </>
  )
}
