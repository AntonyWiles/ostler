import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTeams } from '../../hooks/useTeams'
import type {
  AssignedTask,
  Person,
  SharedAwaySpan,
  TimeEntry,
  UpdatePlanningWorkItemInput
} from '@shared/ostler-api'
import { formatIsoDate, isIsoDate, shiftIsoDate } from '@shared/dates'
import { formatList, formatNumber } from '@shared/format'
import { dayRange } from '@shared/time/timesheet'
import {
  UNASSIGNED,
  computeWorkload,
  weekCapacityHours,
  weeksOverCapacity,
  loggedHoursByWeek,
  workloadWeekStart,
  workloadWeeks,
  type WorkloadCell,
  type WorkloadRow
} from '@shared/planning/workload'
import { PERF_MARKS } from '@shared/perf-marks'
import { t } from '@shared/i18n'
import { useOstler } from '../../context/OstlerContext'
import { usePeople } from '../../context/PeopleContext'
import { useDaysOff } from '../../context/DaysOffContext'
import { useHomeFeed } from '../../hooks/useHomeFeed'
import { useToday } from '../../hooks/useToday'
import { useRenderedMark } from '../../lib/perf-marks'
import { settingsPath, taskPath, teamPath, workloadPath } from '../../navigation/paths'
import {
  Button,
  DateField,
  Dialog,
  EmptyState,
  InlineAlert,
  PageHeader,
  Select,
  Skeleton,
  useToast
} from '../../ui'
import { ChevronLeft, ChevronRight, UsersRound } from '../../ui/icons'
import { AssigneeField, PersonAvatar } from '../planning/AssigneeField'
import './WorkloadView.css'
import { projectSelectOptions } from '../../components/areas/project-options'

/** This week and the next five (R3.2). */
const WEEK_COUNT = 6
const UNSCHEDULED = 'unscheduled'

interface SummaryLine {
  text: string
  kind: 'main' | 'over' | 'minor'
}

interface OpenCell {
  personId: string
  /** A week's Monday, or `UNSCHEDULED`. */
  week: string
}

function hoursText(hours: number): string {
  return t('views:workload.hours', { hours: formatNumber(hours, { maximumFractionDigits: 1 }) })
}

function number(hours: number): string {
  return formatNumber(hours, { maximumFractionDigits: 1 })
}

/**
 * Workload (R3.2, D35, D36): for each active person (and Unassigned), the
 * hours planned in this week and the next five against their weekly
 * capacity, counted by the one D36 rule (`computeWorkload`). Every unfinished
 * task comes from one query; past weeks also show hours logged. A cell opens
 * the tasks behind it, where each can be opened, given to someone else or
 * have its dates changed. "Over" is always said in words, never by colour
 * alone. A global view with no sidebar row: reached from the command
 * palette, Settings › People and My work's header.
 */
export function WorkloadView() {
  const navigate = useNavigate()
  const people = usePeople()
  const { daysOff: ownDaysOff } = useDaysOff()
  const { projects, areas } = useOstler()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const today = useToday()
  const currentWeek = workloadWeekStart(today)
  const weekParam = params.get('week')
  const first = weekParam && isIsoDate(weekParam) ? workloadWeekStart(weekParam) : currentWeek
  const weeks = useMemo(() => workloadWeeks(first, WEEK_COUNT), [first])
  const last = shiftIsoDate(weeks[weeks.length - 1], 6)
  const [chosenProjectId, setProjectId] = useState(() => params.get('project') ?? '')
  const teams = useTeams()
  const chosenTeamId = params.get('team') ?? ''
  const [openCell, setOpenCell] = useState<OpenCell | null>(null)
  const [logged, setLogged] = useState<TimeEntry[]>([])
  const [sharedAway, setSharedAway] = useState<SharedAwaySpan[]>([])

  const enabledProjects = useMemo(
    () =>
      projects.filter((project) => project.enabled).sort((a, b) => a.name.localeCompare(b.name)),
    [projects]
  )
  // A project from the link (`workloadPath`) counts only while it is one listed here.
  const projectId = enabledProjects.some((project) => project.id === chosenProjectId)
    ? chosenProjectId
    : ''
  const projectIds = projectId ? [projectId] : null
  const askedKey = JSON.stringify({ projectIds, through: last })
  const work = useHomeFeed<AssignedTask[]>(
    () => window.ostlerAPI.getWorkloadTasks(JSON.parse(askedKey)),
    [askedKey]
  )
  const tasks = work.value
  useRenderedMark(PERF_MARKS.workloadRendered, tasks !== null, askedKey, {
    count: tasks?.length ?? 0
  })

  // Past weeks show hours logged beside hours planned (R2.3).
  const pastWeeks = weeks.filter((week) => week < currentWeek)
  const pastKey = pastWeeks.length
    ? JSON.stringify({
        ...dayRange(pastWeeks[0], shiftIsoDate(pastWeeks[pastWeeks.length - 1], 6)),
        ...(projectIds ? { projectIds } : {})
      })
    : null
  useEffect(() => {
    if (!pastKey) {
      setLogged([])
      return
    }
    let live = true
    const load = () =>
      void window.ostlerAPI.listTimeEntries(JSON.parse(pastKey)).then((result) => {
        if (live && result.ok) setLogged(result.value)
      })
    load()
    const stop = window.ostlerAPI.onTimeChange(load)
    return () => {
      live = false
      stop()
    }
  }, [pastKey])

  // Other people's away dates, shared with the projects here (D6): only dates, so they are all "Away".
  useEffect(() => {
    let live = true
    void Promise.resolve(window.ostlerAPI.getSharedAway?.({ from: weeks[0], through: last })).then(
      (result) => {
        if (live && result?.ok) setSharedAway(result.value)
      }
    )
    return () => {
      live = false
    }
  }, [weeks, last, ownDaysOff])
  const daysOff = useMemo(
    () => [
      ...ownDaysOff,
      ...sharedAway.map((span) => ({
        personId: span.personId,
        firstDate: span.firstDate,
        lastDate: span.lastDate,
        name: t('views:workload.away')
      }))
    ],
    [ownDaysOff, sharedAway]
  )

  const rows = useMemo(
    () =>
      computeWorkload(tasks ?? [], {
        weeks,
        today,
        workingDays: (personId) => people.byId.get(personId)?.workingDays,
        daysOff
      }),
    [tasks, weeks, today, people.byId, daysOff]
  )
  const loggedRows = useMemo(
    () => loggedHoursByWeek(logged, pastWeeks, Date.now()),
    [logged, pastWeeks.join()]
  )
  const tasksById = useMemo(() => new Map((tasks ?? []).map((task) => [task.id, task])), [tasks])

  // Active people, then anyone archived who still has work here, then Unassigned.
  // With a team chosen, only its members are listed.
  const team = teams.active.find((entry) => entry.id === chosenTeamId) ?? null
  const inTeam = (person: Person) => !team || team.memberIds.includes(person.id)
  const listed: (Person | null)[] = [
    ...people.active.filter(inTeam),
    ...people.all.filter(
      (person) => person.archivedAt !== null && rows.has(person.id) && inTeam(person)
    ),
    ...(team ? [] : [null])
  ]
  const overByCell = new Map(
    weeksOverCapacity({
      rows,
      people: listed.filter((person): person is Person => person !== null),
      weeks,
      daysOff
    }).map((entry) => [`${entry.personId} ${entry.week}`, entry.over])
  )
  /** Hours over capacity in a cell, by the one rule; 0 for Unassigned and Unscheduled. */
  const overIn = (person: Person | null, week: string) =>
    person && week !== UNSCHEDULED ? (overByCell.get(`${person.id} ${week}`) ?? 0) : 0
  const emptyRow: WorkloadRow = {
    weeks: Object.fromEntries(
      weeks.map((week) => [week, { hours: 0, taskCount: 0, pointsTaskCount: 0, tasks: [] }])
    ),
    unscheduled: { hours: 0, taskCount: 0, pointsTaskCount: 0, tasks: [] }
  }
  const rowOf = (personId: string) => rows.get(personId) ?? emptyRow
  const nameOf = (person: Person | null) => person?.name ?? t('views:workload.unassigned')
  const weekName = (week: string) =>
    week === UNSCHEDULED
      ? t('views:workload.unscheduled')
      : t('views:workload.weekOf', {
          date: formatIsoDate(week, { day: 'numeric', month: 'short' })
        })

  const shift = (count: number) =>
    setParams(
      { week: shiftIsoDate(first, count * 7), ...(team ? { team: team.id } : {}) },
      { replace: true }
    )
  const chooseTeam = (teamId: string) =>
    setParams(
      {
        ...(weekParam ? { week: weekParam } : {}),
        ...(teamId ? { team: teamId } : {})
      },
      { replace: true }
    )

  /** A person's capacity in a week, less their days off (N3.2); null without one. */
  const capacityIn = (person: Person | null, week: string) =>
    week === UNSCHEDULED || !person
      ? null
      : weekCapacityHours(person.weeklyCapacityHours, week, person.id, person.workingDays, daysOff)

  /** What a cell says, in words: the same text is its accessible name. */
  const summary = (person: Person | null, week: string, cell: WorkloadCell) => {
    const weekCapacity = capacityIn(person, week)
    const capacity = weekCapacity?.hours ?? null
    const lines: SummaryLine[] = []
    const push = (text: string, kind: SummaryLine['kind'] = 'minor') => lines.push({ text, kind })
    const loggedHours = week !== UNSCHEDULED ? loggedRows.get(person?.id ?? UNASSIGNED)?.[week] : 0
    if (week !== UNSCHEDULED && week < currentWeek) {
      push(t('views:workload.planned', { hours: number(cell.hours) }), 'main')
      push(t('views:workload.logged', { hours: number(loggedHours ?? 0) }))
    } else if (week === UNSCHEDULED || capacity === null) {
      push(hoursText(cell.hours), 'main')
    } else {
      push(
        t('views:workload.hoursOf', { hours: number(cell.hours), capacity: number(capacity) }),
        'main'
      )
      const over = overIn(person, week)
      if (over > 0) push(t('views:workload.overBy', { hours: number(over) }), 'over')
      if (weekCapacity && weekCapacity.daysOff.length > 0 && person?.weeklyCapacityHours != null)
        push(
          t('views:workload.capacityAfterDaysOff', {
            hours: number(capacity),
            capacity: number(person.weeklyCapacityHours),
            daysOff: formatList([...new Set(weekCapacity.daysOff.map((day) => day.name))])
          })
        )
    }
    if (cell.taskCount > 0) {
      push(
        cell.pointsTaskCount > 0
          ? `${t('views:workload.tasks', { count: cell.taskCount })} (${t('views:workload.inPoints', { count: cell.pointsTaskCount })})`
          : t('views:workload.tasks', { count: cell.taskCount })
      )
    }
    return lines
  }

  const renderCell = (person: Person | null, week: string, cell: WorkloadCell) => {
    const capacity = capacityIn(person, week)?.hours ?? null
    const past = week !== UNSCHEDULED && week < currentWeek
    const over = past ? 0 : overIn(person, week)
    const lines = summary(person, week, cell)
    const fill =
      capacity === null || past
        ? null
        : capacity === 0
          ? cell.hours > 0
            ? 100
            : 0
          : Math.min(100, (cell.hours / capacity) * 100)
    return (
      <button
        type="button"
        className={['workload__cell', over > 0 ? 'is-over' : '', past ? 'is-past' : '']
          .filter(Boolean)
          .join(' ')}
        aria-label={t('views:workload.openCell', {
          person: nameOf(person),
          week: weekName(week),
          summary: lines.map((line) => line.text).join(', ')
        })}
        onClick={() => setOpenCell({ personId: person?.id ?? UNASSIGNED, week })}
      >
        {fill !== null && (
          <span className="workload__bar" aria-hidden="true">
            <span className="workload__bar-fill" style={{ width: `${fill}%` }} />
          </span>
        )}
        {lines.map((line, index) => (
          <span key={index} className={`workload__${line.kind}`}>
            {line.text}
          </span>
        ))}
      </button>
    )
  }

  const save = async (task: AssignedTask, patch: UpdatePlanningWorkItemInput) => {
    work.setValue((current) =>
      (current ?? []).map((row) => (row.id === task.id ? { ...row, ...patch } : row))
    )
    const result = await window.ostlerAPI.updatePlanningWorkItem(task.id, patch)
    if (!result.ok)
      toast({
        title: t('views:workload.couldntChange', { title: task.title }),
        body: result.error,
        tone: 'danger'
      })
    void work.reload()
  }

  const openPerson = openCell
    ? openCell.personId === UNASSIGNED
      ? null
      : (people.byId.get(openCell.personId) ?? null)
    : null
  const openRow = openCell ? rowOf(openCell.personId) : null
  const openCellData = openCell
    ? openCell.week === UNSCHEDULED
      ? openRow!.unscheduled
      : openRow!.weeks[openCell.week]
    : null

  let body
  if (tasks === null) {
    body = (
      <div aria-busy="true" aria-label={t('views:workload.loading')}>
        <Skeleton lines={8} />
      </div>
    )
  } else if (people.loaded && people.active.length === 0 && tasks.length === 0) {
    body = (
      <EmptyState
        icon={UsersRound}
        title={t('views:workload.noPeopleTitle')}
        description={t('views:workload.noPeopleBody')}
        action={
          <Button onClick={() => navigate(settingsPath('people'))}>
            {t('views:workload.peopleSettings')}
          </Button>
        }
      />
    )
  } else {
    body = (
      <div className="workload__scroll">
        <table className="workload__grid" aria-label={t('views:workload.gridLabel')}>
          <thead>
            <tr>
              <th scope="col" className="workload__person-head">
                {t('views:workload.person')}
              </th>
              {weeks.map((week) => (
                <th
                  key={week}
                  scope="col"
                  className={week === currentWeek ? 'is-current' : undefined}
                >
                  <span className="workload__week">
                    {formatIsoDate(week, { day: 'numeric', month: 'short' })}
                  </span>
                  {week === currentWeek && (
                    <span className="workload__week-note">{t('views:workload.current')}</span>
                  )}
                </th>
              ))}
              <th scope="col">
                <span className="workload__week">{t('views:workload.unscheduled')}</span>
                <span className="workload__week-note">{t('views:workload.unscheduledHint')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {listed.map((person) => {
              const row = rowOf(person?.id ?? UNASSIGNED)
              return (
                <tr key={person?.id ?? UNASSIGNED}>
                  <th scope="row" className="workload__person">
                    {person ? <PersonAvatar person={person} /> : null}
                    <span className="workload__person-text">
                      <span className="workload__person-name">{nameOf(person)}</span>
                      {person?.weeklyCapacityHours != null && (
                        <span className="workload__minor">
                          {t('views:workload.capacityLine', {
                            hours: number(person.weeklyCapacityHours)
                          })}
                        </span>
                      )}
                      {person && person.weeklyCapacityHours == null && (
                        <span className="workload__minor">{t('views:workload.noCapacity')}</span>
                      )}
                    </span>
                  </th>
                  {weeks.map((week) => (
                    <td key={week} className={week === currentWeek ? 'is-current' : undefined}>
                      {renderCell(person, week, row.weeks[week])}
                    </td>
                  ))}
                  <td>{renderCell(person, UNSCHEDULED, row.unscheduled)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="workload">
      <PageHeader
        title={t('views:workload.title')}
        subtitle={
          <>
            {t('views:workload.subtitle')}{' '}
            {t('views:workload.weeks', { first: formatIsoDate(first), last: formatIsoDate(last) })}
          </>
        }
        actions={
          <>
            <Link
              className="workload__team-link"
              to={teamPath({ team: team?.id, project: projectId || undefined })}
            >
              {t('views:workload.teamLink')}
            </Link>
            <Button
              variant="ghost"
              icon={ChevronLeft}
              onClick={() => shift(-1)}
              aria-label={t('views:workload.previousWeeks')}
            >
              {t('views:workload.previous')}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                navigate(workloadPath(undefined, { team: team?.id }), { replace: true })
              }
            >
              {t('views:workload.thisWeek')}
            </Button>
            <Button
              variant="ghost"
              icon={ChevronRight}
              onClick={() => shift(1)}
              aria-label={t('views:workload.nextWeeks')}
            >
              {t('views:workload.next')}
            </Button>
          </>
        }
      />
      <div className="workload__content">
        <div className="workload__filters">
          <Select
            label={t('views:workload.project')}
            size="sm"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            options={[
              { value: '', label: t('views:workload.allProjects') },
              ...projectSelectOptions(enabledProjects, areas)
            ]}
          />
          {teams.active.length > 0 && (
            <Select
              label={t('views:workload.team')}
              size="sm"
              value={team?.id ?? ''}
              onChange={(event) => chooseTeam(event.target.value)}
              options={[
                { value: '', label: t('views:workload.allPeople') },
                ...teams.active.map((entry) => ({ value: entry.id, label: entry.name }))
              ]}
            />
          )}
        </div>
        {work.error && (
          <InlineAlert tone="danger">
            {t('views:workload.couldntLoad', { error: work.error })}
          </InlineAlert>
        )}
        {body}
      </div>
      <Dialog
        open={openCell !== null}
        onClose={() => setOpenCell(null)}
        size="lg"
        title={
          openCell
            ? t('views:workload.cellTitle', {
                person: nameOf(openPerson),
                week: weekName(openCell.week)
              })
            : ''
        }
        description={
          openCell && openCellData
            ? `${summary(openPerson, openCell.week, openCellData)
                .map((line) => line.text)
                .join(', ')}. ${t('views:workload.cellDescription')}`
            : undefined
        }
        footer={<Button onClick={() => setOpenCell(null)}>{t('views:workload.close')}</Button>}
      >
        {openCellData && openCellData.tasks.length === 0 && (
          <p className="workload__minor">{t('views:workload.noTasks')}</p>
        )}
        {openCellData && openCellData.tasks.length > 0 && (
          <ul className="workload__tasks">
            {openCellData.tasks.map((share) => {
              const task = tasksById.get(share.taskId)
              if (!task) return null
              return (
                <li key={task.id} className="workload__task" aria-label={task.title}>
                  <div className="workload__task-head">
                    <Link
                      className="workload__task-title"
                      to={taskPath(task.projectId, task.id)}
                      aria-label={t('views:workload.openTask', { title: task.title })}
                    >
                      {task.title}
                    </Link>
                    <span className="workload__task-project">
                      <span
                        className="workload__dot"
                        style={{ background: task.projectColor }}
                        aria-hidden="true"
                      />
                      {task.projectName}
                    </span>
                    <span className="workload__task-share tabular-nums">
                      {share.inPoints
                        ? t('views:workload.shareInPoints')
                        : share.hours > 0
                          ? t('views:workload.share', { hours: number(share.hours) })
                          : t('views:workload.shareNone')}
                    </span>
                  </div>
                  <div className="workload__task-fields">
                    <AssigneeField
                      projectId={task.projectId}
                      value={task.assigneeId}
                      onChange={(assigneeId) => {
                        if (assigneeId !== task.assigneeId) void save(task, { assigneeId })
                      }}
                    />
                    <DateField
                      label={t('views:workload.start')}
                      value={task.startDate ?? ''}
                      onChange={(value) => {
                        const startDate = value || null
                        if (startDate !== task.startDate) void save(task, { startDate })
                      }}
                    />
                    <DateField
                      label={t('views:workload.due')}
                      due
                      value={task.targetDate ?? ''}
                      onChange={(value) => {
                        const targetDate = value || null
                        if (targetDate !== task.targetDate) void save(task, { targetDate })
                      }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Dialog>
    </div>
  )
}
