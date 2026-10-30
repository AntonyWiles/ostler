import { useState } from 'react'
import type { Person } from '@shared/ostler-api'
import { formatList } from '@shared/format'
import { nextInRotation } from '@shared/recurrence'
import { Combobox, IconButton, Switch } from '../../ui'
import { ChevronDown, ChevronUp, GripVertical, Icon, X } from '../../ui/icons'
import { usePeople, type PeopleState } from '../../context/PeopleContext'
import { PersonAvatar } from './AssigneeField'
import { t } from '@shared/i18n'

/**
 * "Take turns: Sam, Alex, Jo. Next: Alex" (N2.3), and who is passed over.
 * The same `nextInRotation` the service runs decides "Next", so the drawer
 * and the next occurrence agree. Null when the repeat does not take turns.
 */
export function takeTurnsSummary(
  rotation: readonly string[] | null,
  nextIndex: number,
  people: Pick<PeopleState, 'byId'>
): string | null {
  if (!rotation || rotation.length === 0) return null
  const person = (id: string): Person | undefined => people.byId.get(id)
  const name = (id: string) => person(id)?.name ?? t('tasks:takeTurns.unknownPerson')
  const archived = (id: string) => {
    const found = person(id)
    return !found || found.archivedAt !== null
  }
  const names = formatList(rotation.map(name))
  const turn = nextInRotation(rotation, nextIndex, archived)
  if (!turn) return t('tasks:takeTurns.summaryEveryoneArchived', { names })
  const summary = t('tasks:takeTurns.summary', { names, next: name(turn.personId) })
  if (turn.passedOver.length === 0) return summary
  return t('tasks:takeTurns.summaryPassedOver', {
    summary,
    passed: formatList(turn.passedOver.map(name)),
    count: turn.passedOver.length
  })
}

/**
 * The Repeat dialog's Take turns (N2.3): a switch, then the people in order.
 * Add from the people pickers offer (never an archived person), remove, and
 * reorder by dragging a row or with its Move up and Move down buttons (or
 * Alt+Up and Alt+Down on the row).
 */
export function TakeTurnsEditor({
  projectId,
  rotation,
  onChange
}: {
  /** The task's project: its own people are offered with the address book. */
  projectId: string
  rotation: string[] | null
  onChange: (next: string[] | null) => void
}) {
  const people = usePeople()
  const [dragging, setDragging] = useState<number | null>(null)
  const list = rotation ?? []
  const on = rotation !== null

  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length || from === to) return
    const next = [...list]
    const [id] = next.splice(from, 1)
    next.splice(to, 0, id)
    onChange(next)
  }

  const offered = people.offered(projectId).filter((person) => !list.includes(person.id))
  const name = (id: string) => people.byId.get(id)?.name ?? t('tasks:takeTurns.unknownPerson')

  return (
    <div className="task-turns">
      <Switch
        label={t('tasks:takeTurns.takeTurns')}
        hint={t('tasks:takeTurns.hint')}
        checked={on}
        onChange={(event) => onChange(event.target.checked ? [] : null)}
      />
      {on && (
        <>
          {list.length > 0 && (
            <ol className="task-turns__rows" aria-label={t('tasks:takeTurns.order')}>
              {list.map((id, index) => {
                const person = people.byId.get(id)
                const archived = !person || person.archivedAt !== null
                return (
                  <li
                    key={id}
                    className={['task-turns__row', dragging === index && 'is-dragging']
                      .filter(Boolean)
                      .join(' ')}
                    draggable
                    onDragStart={(event) => {
                      setDragging(index)
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(event) => {
                      if (dragging !== null) event.preventDefault()
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (dragging !== null) move(dragging, index)
                      setDragging(null)
                    }}
                    onDragEnd={() => setDragging(null)}
                    onKeyDown={(event) => {
                      if (!event.altKey) return
                      if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        move(index, index - 1)
                      } else if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        move(index, index + 1)
                      }
                    }}
                  >
                    <Icon icon={GripVertical} className="task-turns__grip" />
                    {person && <PersonAvatar person={person} />}
                    <span className="task-turns__name">{name(id)}</span>
                    {archived && (
                      <span className="task-drawer__muted">
                        {t('tasks:takeTurns.archivedPassedOver')}
                      </span>
                    )}
                    <IconButton
                      size="sm"
                      icon={ChevronUp}
                      label={t('tasks:takeTurns.moveUp', { name: name(id) })}
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    />
                    <IconButton
                      size="sm"
                      icon={ChevronDown}
                      label={t('tasks:takeTurns.moveDown', { name: name(id) })}
                      disabled={index === list.length - 1}
                      onClick={() => move(index, index + 1)}
                    />
                    <IconButton
                      size="sm"
                      icon={X}
                      label={t('tasks:takeTurns.remove', { name: name(id) })}
                      onClick={() => onChange(list.filter((entry) => entry !== id))}
                    />
                  </li>
                )
              })}
            </ol>
          )}
          <Combobox
            label={t('tasks:takeTurns.addPerson')}
            options={offered.map((person) => ({
              value: person.id,
              label: person.name,
              prefix: <PersonAvatar person={person} />
            }))}
            value={null}
            onChange={(id) => {
              if (id) onChange([...list, id])
            }}
            placeholder={t('tasks:takeTurns.choosePerson')}
            emptyText={t('tasks:takeTurns.noOneElse')}
          />
        </>
      )}
    </div>
  )
}
