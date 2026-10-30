import { useEffect, useState } from 'react'
import {
  UPCOMING_DAYS,
  type CalendarOccurrence,
  type HomeTask,
  type MyWork,
  type Person,
  type PlanningMilestone,
  type RendererProject
} from '@shared/ostler-api'
import { formatIsoDate, parseIsoDate, shiftIsoDate } from '@shared/dates'
import { dateTimeFormat, formatDateTime } from '@shared/format'
import { taskPriorityLabel } from '@shared/task-labels'
import type { MyWeekPrintRoute } from '@shared/print-route'
import { occurrenceLine } from '@shared/calendar/expand-events'
import './PrintPage.css'
import './MyWeekPrintPage.css'
import { t } from '@shared/i18n'

interface MyWeekData {
  work: MyWork
  me: Person | null
  /** Milestones due from today to the last day of Upcoming, in enabled projects. */
  milestones: (PlanningMilestone & { projectName: string })[]
  /** Outside calendars' events over the same days (N3.3a), listed above each day's tasks. */
  events: CalendarOccurrence[]
}

async function unwrap<T>(call: Promise<{ ok: true; value: T } | { ok: false; error: string }>) {
  const result = await call
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function markReady(state: '1' | 'error') {
  document.documentElement.dataset.printReady = state
}

const REASON_KEYS: Record<NonNullable<HomeTask['reason']>, string> = {
  overdue: 'views:homeView.overdue',
  today: 'views:homeView.dueToday',
  'new-today': 'views:homeView.newToday',
  'in-progress': 'views:homeView.progress'
}

/** "Thursday 15 October". */
function longDay(date: string): string {
  return formatIsoDate(date, { weekday: 'long', day: 'numeric', month: 'long' })
}

/**
 * Print my week (N3.1b): Home's Today and Upcoming on paper. The lists come
 * from `getMyWork`, the call Home makes, for the renderer's local date in the
 * route, so the sheet matches the screen. Every day of Upcoming has a section,
 * an empty one ruled to write in. Each task has a box to tick by hand, and
 * nothing is said by colour alone.
 */
export function MyWeekPrintPage({ route }: { route: MyWeekPrintRoute }) {
  const [data, setData] = useState<MyWeekData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const api = window.ostlerAPI
        const last = shiftIsoDate(route.today, UPCOMING_DAYS)
        const [work, projects, people, events] = await Promise.all([
          unwrap(api.getMyWork(route.today)),
          unwrap(api.getProjects()),
          unwrap(api.getPeople({ includeArchived: false })),
          // Events are a help, not the sheet: without them the week still prints.
          api
            .getCalendarEvents({ from: route.today, to: last })
            .then((result) => (result.ok ? result.value : []))
            .catch(() => [] as CalendarOccurrence[])
        ])
        const enabled = projects.filter((project: RendererProject) => project.enabled)
        // One call per project, not per task.
        const perProject = await Promise.all(
          enabled.map(async (project) =>
            (await unwrap(api.getPlanningMilestones(project.id)))
              .filter(
                (milestone) =>
                  milestone.targetDate !== null &&
                  milestone.targetDate >= route.today &&
                  milestone.targetDate <= last &&
                  milestone.status !== 'complete' &&
                  milestone.status !== 'archived'
              )
              .map((milestone) => ({ ...milestone, projectName: project.name }))
          )
        )
        setData({
          work,
          events,
          me: people.find((person) => person.isMe) ?? null,
          milestones: perProject
            .flat()
            .sort(
              (a, b) => a.targetDate!.localeCompare(b.targetDate!) || a.name.localeCompare(b.name)
            )
        })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        markReady('error')
      }
    })()
  }, [route])

  useEffect(() => {
    if (!data) return
    const frame = requestAnimationFrame(() => markReady('1'))
    return () => cancelAnimationFrame(frame)
  }, [data])

  if (error) return <p role="alert">{error}</p>
  if (!data) return null

  const days = Array.from({ length: UPCOMING_DAYS }, (_, index) =>
    shiftIsoDate(route.today, index + 1)
  )
  const upcoming = new Map(data.work.upcoming.map((day) => [day.date, day.tasks]))
  const milestonesOn = (date: string) =>
    data.milestones.filter((milestone) => milestone.targetDate === date)
  const eventsOn = (date: string) =>
    data.events.filter((event) => event.startDate <= date && event.endDate >= date)
  const first = parseIsoDate(route.today)!
  const last = parseIsoDate(days[days.length - 1])!

  return (
    <div className="print-page my-week">
      <header className="print-page__header">
        <h1>{t('views:myWeek.title')}</h1>
        <p className="my-week__range">
          {dateTimeFormat({ day: 'numeric', month: 'long', year: 'numeric' }).formatRange(
            first,
            last
          )}
        </p>
        <p>
          {[
            data.me ? t('views:myWeek.forPerson', { name: data.me.name }) : null,
            t('views:myWeek.printedAt', { date: formatDateTime(Date.now()) })
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>
      <DaySection
        heading={t('views:myWeek.today', { date: longDay(route.today) })}
        tasks={data.work.today}
        milestones={milestonesOn(route.today)}
        events={eventsOn(route.today)}
      />
      {days.map((date) => (
        <DaySection
          key={date}
          heading={longDay(date)}
          tasks={upcoming.get(date) ?? []}
          milestones={milestonesOn(date)}
          events={eventsOn(date)}
        />
      ))}
      <footer className="print-page__footer">{t('views:printPage.printed')}</footer>
    </div>
  )
}

/**
 * One day: a table whose heading row repeats when the day runs onto the next
 * page, and whose rows never split.
 */
function DaySection({
  heading,
  tasks,
  milestones,
  events = []
}: {
  heading: string
  tasks: HomeTask[]
  milestones: (PlanningMilestone & { projectName: string })[]
  events?: CalendarOccurrence[]
}) {
  const empty = tasks.length === 0 && milestones.length === 0 && events.length === 0
  return (
    <table className="my-week__day">
      <thead>
        <tr>
          <th colSpan={2} scope="colgroup">
            {heading}
          </th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={`event:${event.id}`} className="my-week__event">
            <td className="my-week__mark" aria-hidden="true">
              ○
            </td>
            <td>
              <span className="my-week__title">
                {t('views:calendarEvents.printEvents')}: {occurrenceLine(event)}
              </span>
              {event.location && <span className="my-week__meta">{event.location}</span>}
            </td>
          </tr>
        ))}
        {milestones.map((milestone) => (
          <tr key={`milestone:${milestone.id}`} className="my-week__milestone">
            <td className="my-week__mark" aria-hidden="true">
              ◆
            </td>
            <td>
              <span className="my-week__title">
                {t('views:myWeek.milestone')}: {milestone.name}
              </span>
              <span className="my-week__meta">{milestone.projectName}</span>
            </td>
          </tr>
        ))}
        {tasks.map((task) => (
          <tr key={task.id} className="my-week__task">
            <td className="my-week__mark">
              <span className="my-week__box" aria-hidden="true" />
            </td>
            <td>
              <span className="my-week__title">{task.title}</span>
              <span className="my-week__meta">{taskMeta(task)}</span>
            </td>
          </tr>
        ))}
        {empty && (
          <tr className="my-week__empty">
            <td colSpan={2}>
              <span className="my-week__nothing">{t('views:myWeek.nothingDue')}</span>
              <span className="my-week__rule" aria-hidden="true" />
              <span className="my-week__rule" aria-hidden="true" />
              <span className="my-week__rule" aria-hidden="true" />
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

/** Project · priority in words · why it is in Today (with the due date when overdue). */
function taskMeta(task: HomeTask): string {
  const parts = [
    task.projectName,
    t('views:myWeek.priority', { priority: taskPriorityLabel(task.priority) })
  ]
  if (task.reason) {
    const reason = t(REASON_KEYS[task.reason])
    parts.push(
      task.reason === 'overdue' && task.targetDate
        ? `${reason}, ${t('views:myWeek.dueOn', { date: formatIsoDate(task.targetDate) })}`
        : reason
    )
  }
  return parts.join(' · ')
}
