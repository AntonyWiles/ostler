import { Fragment, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { AssignedTask, Person, TeamOverviewRow } from '@shared/ostler-api'
import { formatIsoDate, shiftIsoDate } from '@shared/dates'
import { formatNumber, formatRelativeTime } from '@shared/format'
import { t } from '@shared/i18n'
import { useOstler } from '../../context/OstlerContext'
import { usePeople } from '../../context/PeopleContext'
import { useHomeFeed } from '../../hooks/useHomeFeed'
import { useTeams } from '../../hooks/useTeams'
import { useToday } from '../../hooks/useToday'
import { projectSelectOptions } from '../../components/areas/project-options'
import { settingsPath, taskPath, workloadPath } from '../../navigation/paths'
import { Button, EmptyState, InlineAlert, PageHeader, Select, Skeleton } from '../../ui'
import { ChevronDown, ChevronRight, UsersRound } from '../../ui/icons'
import { PersonAvatar } from '../planning/AssigneeField'
import './TeamView.css'

type SortKey =
  | 'name'
  | 'open'
  | 'overdue'
  | 'dueThisWeek'
  | 'blocked'
  | 'waitingForSignOff'
  | 'stalled'
  | 'hours'
  | 'away'
  | 'lastActive'

interface Line {
  row: TeamOverviewRow
  person: Person | null
  name: string
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'open', label: 'views:team.open' },
  { key: 'overdue', label: 'views:team.overdue' },
  { key: 'dueThisWeek', label: 'views:team.dueThisWeek' },
  { key: 'blocked', label: 'views:team.blocked' },
  { key: 'waitingForSignOff', label: 'views:team.signOff' },
  { key: 'stalled', label: 'views:team.stalled' },
  { key: 'hours', label: 'views:team.hours' },
  { key: 'away', label: 'views:team.away' },
  { key: 'lastActive', label: 'views:team.lastActive' }
]

function number(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 1 })
}

/** The value a column sorts by; people without one (no away dates, never active) sort last. */
function sortValue(line: Line, key: SortKey): string | number | null {
  const { row } = line
  switch (key) {
    case 'name':
      return line.name
    case 'open':
      return row.open
    case 'overdue':
      return row.overdue
    case 'dueThisWeek':
      return row.dueThisWeek
    case 'blocked':
      return row.blocked
    case 'waitingForSignOff':
      return row.waitingForSignOff
    case 'stalled':
      return row.stalled
    case 'hours':
      return row.capacityThisWeek ? row.hoursThisWeek / row.capacityThisWeek : row.hoursThisWeek
    case 'away':
      return row.awayDays[0]?.firstDate ?? null
    case 'lastActive':
      return row.lastActiveAt
  }
}

/**
 * The Team view (team-leaders plan, D4): one row per person with what needs attention across
 * projects, filterable by team and project. A row opens to that person's open tasks. A global
 * view with no sidebar row: reached from the command palette and Workload's header.
 */
export function TeamView() {
  const navigate = useNavigate()
  const people = usePeople()
  const teams = useTeams()
  const { projects, areas } = useOstler()
  const [params, setParams] = useSearchParams()
  const today = useToday()
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'name',
    direction: 'asc'
  })
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const enabledProjects = useMemo(
    () =>
      projects.filter((project) => project.enabled).sort((a, b) => a.name.localeCompare(b.name)),
    [projects]
  )
  const chosenProject = params.get('project') ?? ''
  const projectId = enabledProjects.some((project) => project.id === chosenProject)
    ? chosenProject
    : ''
  const chosenTeam = params.get('team') ?? ''
  const team = teams.active.find((entry) => entry.id === chosenTeam) ?? null

  const choose = (next: { team?: string; project?: string }) => {
    const merged = { team: team?.id ?? '', project: projectId, ...next }
    setParams(
      {
        ...(merged.team ? { team: merged.team } : {}),
        ...(merged.project ? { project: merged.project } : {})
      },
      { replace: true }
    )
  }

  const askedKey = JSON.stringify({
    today,
    ...(team ? { teamId: team.id } : {}),
    ...(projectId ? { projectIds: [projectId] } : {})
  })
  const overview = useHomeFeed<TeamOverviewRow[]>(
    () => window.ostlerAPI.getTeamOverview(JSON.parse(askedKey)),
    [askedKey]
  )

  // Tasks are read once a row is opened: every unfinished task, filtered to the person here.
  const anyOpen = expanded.size > 0
  const tasksKey = JSON.stringify({ projectId, anyOpen, today })
  const work = useHomeFeed<AssignedTask[]>(
    () =>
      anyOpen
        ? window.ostlerAPI.getWorkloadTasks({
            projectIds: projectId ? [projectId] : null,
            through: shiftIsoDate(today, 3650)
          })
        : Promise.resolve({ ok: true as const, value: [] }),
    [tasksKey]
  )

  const lines: Line[] = useMemo(() => {
    const list = (overview.value ?? []).map((row) => {
      const person = people.byId.get(row.personId) ?? null
      return { row, person, name: person?.name ?? t('views:team.unknownPerson') }
    })
    const factor = sort.direction === 'asc' ? 1 : -1
    return list.sort((a, b) => {
      const left = sortValue(a, sort.key)
      const right = sortValue(b, sort.key)
      if (left === null && right === null) return a.name.localeCompare(b.name)
      if (left === null) return 1
      if (right === null) return -1
      const order =
        typeof left === 'string' || typeof right === 'string'
          ? String(left).localeCompare(String(right))
          : left - right
      return order * factor || a.name.localeCompare(b.name)
    })
  }, [overview.value, people.byId, sort])

  const sortBy = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'name' || key === 'away' ? 'asc' : 'desc' }
    )
  const ariaSort = (key: SortKey) =>
    sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'

  const toggle = (personId: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(personId)) next.add(personId)
      return next
    })

  const awayText = (row: TeamOverviewRow): string | null => {
    const span = row.awayDays[0]
    if (!span) return null
    const first = formatIsoDate(span.firstDate, { day: 'numeric', month: 'short' })
    if (span.firstDate === span.lastDate) return t('views:team.awayOn', { date: first })
    const sameMonth = span.firstDate.slice(0, 7) === span.lastDate.slice(0, 7)
    const last = formatIsoDate(span.lastDate, { day: 'numeric', month: 'short' })
    return t('views:team.awayRange', {
      first: sameMonth ? formatIsoDate(span.firstDate, { day: 'numeric' }) : first,
      last
    })
  }

  const renderTasks = (personId: string, name: string) => {
    if (work.value === null) return <Skeleton lines={2} />
    const mine = work.value.filter((task) => task.assigneeId === personId)
    if (mine.length === 0) return <p className="team__minor">{t('views:team.noTasks')}</p>
    const byProject = new Map<string, AssignedTask[]>()
    for (const task of mine)
      byProject.set(task.projectId, [...(byProject.get(task.projectId) ?? []), task])
    return (
      <div className="team__projects">
        {[...byProject.values()].map((group) => (
          <section key={group[0].projectId} aria-label={group[0].projectName}>
            <h3 className="team__project">
              <span
                className="team__dot"
                style={{ background: group[0].projectColor }}
                aria-hidden="true"
              />
              {group[0].projectName}
            </h3>
            <ul className="team__tasks" aria-label={t('views:team.tasksOf', { name })}>
              {group.map((task) => (
                <li key={task.id}>
                  <Link
                    className="team__task"
                    to={taskPath(task.projectId, task.id)}
                    aria-label={t('views:team.openTask', { title: task.title })}
                  >
                    {task.title}
                  </Link>
                  {task.targetDate && (
                    <span
                      className={
                        task.targetDate < today ? 'team__task-date is-late' : 'team__task-date'
                      }
                    >
                      {formatIsoDate(task.targetDate, { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    )
  }

  let body
  if (overview.value === null) {
    body = (
      <div aria-busy="true" aria-label={t('views:team.loading')}>
        <Skeleton lines={8} />
      </div>
    )
  } else if (lines.length === 0) {
    body = (
      <EmptyState
        icon={UsersRound}
        title={t('views:team.emptyTitle')}
        description={t('views:team.emptyBody')}
        action={
          <Button onClick={() => navigate(settingsPath('people'))}>
            {t('views:team.peopleSettings')}
          </Button>
        }
      />
    )
  } else {
    body = (
      <div className="team__scroll">
        <table className="team__grid" aria-label={t('views:team.gridLabel')}>
          <thead>
            <tr>
              <th scope="col" aria-sort={ariaSort('name')}>
                <button type="button" className="team__sort" onClick={() => sortBy('name')}>
                  {t('views:team.person')}
                </button>
              </th>
              {COLUMNS.map((column) => (
                <th key={column.key} scope="col" aria-sort={ariaSort(column.key)}>
                  <button type="button" className="team__sort" onClick={() => sortBy(column.key)}>
                    {t(column.label)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map(({ row, person, name }) => {
              const open = expanded.has(row.personId)
              const away = awayText(row)
              const fill =
                row.capacityThisWeek === null
                  ? null
                  : row.capacityThisWeek === 0
                    ? row.hoursThisWeek > 0
                      ? 100
                      : 0
                    : Math.min(100, (row.hoursThisWeek / row.capacityThisWeek) * 100)
              return (
                <Fragment key={row.personId}>
                  <tr>
                    <th scope="row" className="team__person">
                      <button
                        type="button"
                        className="team__expand"
                        aria-expanded={open}
                        aria-label={t('views:team.showTasks', { name })}
                        onClick={() => toggle(row.personId)}
                      >
                        {open ? (
                          <ChevronDown size={14} aria-hidden="true" />
                        ) : (
                          <ChevronRight size={14} aria-hidden="true" />
                        )}
                        {person ? <PersonAvatar person={person} /> : null}
                        <span className="team__name">{name}</span>
                      </button>
                    </th>
                    <td className="tabular-nums">{row.open}</td>
                    <td
                      className={row.overdue > 0 ? 'tabular-nums team__danger' : 'tabular-nums'}
                      data-tone={row.overdue > 0 ? 'danger' : undefined}
                    >
                      {row.overdue}
                    </td>
                    <td className="tabular-nums">{row.dueThisWeek}</td>
                    <td
                      className={row.blocked > 0 ? 'tabular-nums team__warning' : 'tabular-nums'}
                      data-tone={row.blocked > 0 ? 'warning' : undefined}
                    >
                      {row.blocked}
                    </td>
                    <td className="tabular-nums">{row.waitingForSignOff}</td>
                    <td className="tabular-nums">{row.stalled}</td>
                    <td>
                      <span className="tabular-nums">
                        {row.capacityThisWeek === null
                          ? t('views:team.hoursOnly', { hours: number(row.hoursThisWeek) })
                          : t('views:team.hoursOf', {
                              hours: number(row.hoursThisWeek),
                              capacity: number(row.capacityThisWeek)
                            })}
                      </span>
                      {fill !== null && (
                        <span className="team__bar" aria-hidden="true">
                          <span className="team__bar-fill" style={{ width: `${fill}%` }} />
                        </span>
                      )}
                    </td>
                    <td>{away ?? <span className="team__minor">{t('views:team.none')}</span>}</td>
                    <td>
                      {row.lastActiveAt === null ? (
                        <span className="team__minor">{t('views:team.never')}</span>
                      ) : (
                        formatRelativeTime(row.lastActiveAt)
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className="team__detail">
                      <td colSpan={COLUMNS.length + 1}>{renderTasks(row.personId, name)}</td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="team">
      <PageHeader
        title={t('views:team.title')}
        subtitle={t('views:team.subtitle')}
        actions={
          <Link
            className="team__link"
            to={workloadPath(undefined, { team: team?.id, project: projectId || undefined })}
          >
            {t('views:team.workloadLink')}
          </Link>
        }
      />
      <div className="team__content">
        <div className="team__filters">
          <Select
            label={t('views:team.team')}
            size="sm"
            value={team?.id ?? ''}
            onChange={(event) => choose({ team: event.target.value })}
            options={[
              { value: '', label: t('views:team.allPeople') },
              ...teams.active.map((entry) => ({ value: entry.id, label: entry.name }))
            ]}
          />
          <Select
            label={t('views:team.project')}
            size="sm"
            value={projectId}
            onChange={(event) => choose({ project: event.target.value })}
            options={[
              { value: '', label: t('views:team.allProjects') },
              ...projectSelectOptions(enabledProjects, areas)
            ]}
          />
        </div>
        {overview.error && (
          <InlineAlert tone="danger">
            {t('views:team.couldntLoad', { error: overview.error })}
          </InlineAlert>
        )}
        {work.error && (
          <InlineAlert tone="danger">
            {t('views:team.couldntLoad', { error: work.error })}
          </InlineAlert>
        )}
        {body}
      </div>
    </div>
  )
}
