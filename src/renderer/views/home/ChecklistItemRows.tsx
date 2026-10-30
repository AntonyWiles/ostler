import type { HomeChecklistItem } from '@shared/ostler-api'
import { formatIsoDateShort, relativeDateText } from '@shared/dates'
import { usePeople } from '../../context/PeopleContext'
import { Avatar, Checkbox, useToast } from '../../ui'
import { t } from '@shared/i18n'
import './HomeView.css'
import { TaskLink } from '../planning/TaskPeek'

/**
 * Dated checklist items (N2.2) as Home and My work list them: "item, in
 * Task", with a tick that ticks the item on its task. A ticked item leaves
 * the list when it is read again (`onChanged`).
 */
export function ChecklistItemRows({
  items,
  onChanged,
  showDue = true
}: {
  items: HomeChecklistItem[]
  onChanged: () => void
  /** Upcoming groups by day, so its rows leave the date out. */
  showDue?: boolean
}) {
  const people = usePeople()
  const { toast } = useToast()

  const tick = async (item: HomeChecklistItem) => {
    const result = await window.ostlerAPI.setPlanningChecklistItemChecked(
      item.workItemId,
      item.text,
      true
    )
    if (!result.ok) {
      toast({
        title: t('views:checklistItemRows.couldntTick', { text: item.text }),
        body: result.error,
        tone: 'danger'
      })
      return
    }
    onChanged()
  }

  if (items.length === 0) return null
  return (
    <ul className="ostler-home-tasks" aria-label={t('views:checklistItemRows.items')}>
      {items.map((item) => {
        const person = item.assigneeId ? people.byId.get(item.assigneeId) : undefined
        const due = relativeDateText(item.dueDate) || formatIsoDateShort(item.dueDate)
        return (
          <li
            key={`${item.workItemId}:${item.text}`}
            className="ostler-home-task ostler-home-task--item"
          >
            <Checkbox
              label={null}
              aria-label={t('views:checklistItemRows.done', {
                text: item.text,
                taskTitle: item.taskTitle
              })}
              className="ostler-home-task__check"
              checked={false}
              onChange={() => void tick(item)}
            />
            <TaskLink
              className="ostler-home-task__title"
              projectId={item.projectId}
              taskId={item.workItemId}
            >
              {t('views:checklistItemRows.itemInTask', {
                text: item.text,
                taskTitle: item.taskTitle
              })}
            </TaskLink>
            <span className="ostler-home-task__meta">
              <span className="ostler-home-task__project">
                <span
                  className="ostler-home-task__dot"
                  style={{ background: item.projectColor }}
                  aria-hidden="true"
                />
                {item.projectName}
              </span>
              {showDue && <span className={item.overdue ? 'is-overdue' : undefined}>{due}</span>}
              {person ? (
                <Avatar
                  size="sm"
                  name={person.name}
                  initials={person.initials}
                  color={person.color}
                />
              ) : (
                <span className="ostler-home-task__nobody">{t('views:homeView.unassigned')}</span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
