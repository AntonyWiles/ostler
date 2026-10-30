import { isIsoDate } from '@shared/dates'
import { dayOffOn } from '@shared/planning/working-days'
import { t } from '@shared/i18n'
import { useDaysOff } from '../context/DaysOffContext'
import { usePeople } from '../context/PeopleContext'

/**
 * What a date field says when its date falls on a day off (N3.2) for
 * everyone or for the task's assignee: "Christmas Day: a day off". Undefined
 * on a working day. It never blocks the date.
 */
export function useDayOffNote(
  date: string,
  assigneeId: string | null | undefined
): string | undefined {
  const { daysOff } = useDaysOff()
  const people = usePeople()
  if (!date || !isIsoDate(date)) return undefined
  const dayOff = dayOffOn(date, assigneeId ?? null, daysOff)
  if (!dayOff) return undefined
  if (dayOff.personId === null) return t('common:daysOff.note', { name: dayOff.name })
  return t('common:daysOff.notePerson', {
    name: dayOff.name,
    person: people.byId.get(dayOff.personId)?.name ?? ''
  })
}
