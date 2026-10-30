import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { TimeEntry, TimeEntryQuery } from '@shared/ostler-api'
import { addDays, formatIsoDate, isIsoDate, parseIsoDate, toIsoDate } from '@shared/dates'
import { formatTime } from '@shared/format'
import { formatHours, formatTimerClock } from '@shared/time/duration'
import {
  dayRange,
  entriesByDay,
  timesheetTotals,
  weekDays,
  weekStart
} from '@shared/time/timesheet'
import { useOstler } from '../../context/OstlerContext'
import { usePeople } from '../../context/PeopleContext'
import { taskPath } from '../../navigation/paths'
import {
  Button,
  DateField,
  Dialog,
  EmptyState,
  InlineAlert,
  PageHeader,
  Select,
  useToast
} from '../../ui'
import { ChevronLeft, ChevronRight, FileDown, Timer } from '../../ui/icons'
import { TimeEntryEditor } from '../../time/TimeEntryEditor'
import { useNow, useTimer } from '../../time/TimerProvider'
import './TimesheetView.css'
import '../../billing/billing.css'
import { t } from '@shared/i18n'
import { projectSelectOptions } from '../../components/areas/project-options'

const EVERYONE = ''
const NOBODY = 'nobody'
type BillableFilter = 'all' | 'billable' | 'not'

/**
 * The Timesheet (R2.3, D33, D35): one week at a time, every project's
 * entries by local day, with totals per day, project and task, filtered by
 * person and project. An entry opens the same editor as the drawer's; Export
 * CSV writes any date range. A global view with no sidebar row: reached from
 * the command palette, the status bar's timer and a task's Time section.
 */
export function TimesheetView() {
  const navigate = useNavigate()
  const { projects, areas } = useOstler()
  const people = usePeople()
  const timer = useTimer()
  const [params, setParams] = useSearchParams()
  const weekParam = params.get('week')
  const week = weekParam && isIsoDate(weekParam) ? weekParam : weekStart(new Date())
  const days = weekDays(week)
  const [projectId, setProjectId] = useState('')
  const [person, setPerson] = useState(EVERYONE)
  const [billable, setBillable] = useState<BillableFilter>('all')
  const [entries, setEntries] = useState<TimeEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<TimeEntry | null>(null)
  const [exporting, setExporting] = useState(false)
  const now = useNow(timer.running !== null)

  const query = useMemo<TimeEntryQuery>(() => {
    const range = dayRange(days[0], days[6])
    return {
      ...range,
      ...(projectId ? { projectIds: [projectId] } : {}),
      ...(person === EVERYONE ? {} : { personId: person === NOBODY ? null : person })
    }
  }, [days[0], projectId, person])

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.listTimeEntries(query)
    if (result.ok) {
      setEntries(
        billable === 'all'
          ? result.value
          : result.value.filter((entry) => entry.billable === (billable === 'billable'))
      )
      setError(null)
    } else setError(result.error)
  }, [query, billable])

  useEffect(() => {
    void load()
    return window.ostlerAPI.onTimeChange(() => void load())
  }, [load])

  const goToWeek = (start: string) => setParams({ week: start }, { replace: true })
  const shift = (weeks: number) =>
    goToWeek(toIsoDate(addDays(parseIsoDate(week) ?? new Date(), weeks * 7)))

  const totals = timesheetTotals(entries ?? [], now)
  const byDay = entriesByDay(entries ?? [])
  const projectName = (id: string) => projects.find((project) => project.id === id)?.name ?? ''
  const taskTitles = new Map((entries ?? []).map((entry) => [entry.workItemId, entry]))
  const length = (entry: TimeEntry) =>
    entry.durationSeconds === null
      ? formatTimerClock(now - entry.startedAt)
      : formatHours(entry.durationSeconds)

  return (
    <div className="ostler-timesheet">
      <PageHeader
        title={t('views:timesheet.title')}
        subtitle={t('views:timesheet.weekOf', {
          first: formatIsoDate(days[0]),
          last: formatIsoDate(days[6]),
          total: formatHours(totals.total)
        })}
        actions={
          <>
            <Button
              variant="ghost"
              icon={ChevronLeft}
              onClick={() => shift(-1)}
              aria-label={t('views:timesheet.previousWeek')}
            >
              {t('views:timesheet.previous')}
            </Button>
            <Button variant="secondary" onClick={() => setParams({}, { replace: true })}>
              {t('views:timesheet.thisWeek')}
            </Button>
            <Button
              variant="ghost"
              icon={ChevronRight}
              onClick={() => shift(1)}
              aria-label={t('views:timesheet.nextWeek')}
            >
              {t('views:timesheet.next')}
            </Button>
            <Button variant="secondary" icon={FileDown} onClick={() => setExporting(true)}>
              {t('views:timesheet.exportCsv')}
            </Button>
          </>
        }
      />
      <div className="ostler-timesheet__content">
        <div className="ostler-timesheet__filters">
          <Select
            label={t('views:timesheet.project')}
            size="sm"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            options={[
              { value: '', label: t('views:timesheet.allProjects') },
              ...projectSelectOptions(projects, areas)
            ]}
          />
          <Select
            label={t('views:timesheet.person')}
            size="sm"
            value={person}
            onChange={(event) => setPerson(event.target.value)}
            options={[
              { value: EVERYONE, label: t('views:timesheet.everyone') },
              ...people.all.map((entry) => ({ value: entry.id, label: entry.name })),
              { value: NOBODY, label: t('views:timesheet.nobody') }
            ]}
          />
          <Select
            label={t('views:timesheet.billableFilter')}
            size="sm"
            value={billable}
            onChange={(event) => setBillable(event.target.value as BillableFilter)}
            options={[
              { value: 'all', label: t('views:timesheet.allTime') },
              { value: 'billable', label: t('views:timesheet.billableOnly') },
              { value: 'not', label: t('views:timesheet.notBillable') }
            ]}
          />
        </div>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        {entries !== null && entries.length === 0 && !error && (
          <EmptyState
            icon={Timer}
            title={t('views:timesheet.noTimeThisWeek')}
            description={t('views:timesheet.noTimeDescription')}
          />
        )}
        {entries !== null && entries.length > 0 && (
          <div className="ostler-timesheet__layout">
            <div className="ostler-timesheet__days">
              {days.map((day) => {
                const dayEntries = byDay.get(day) ?? []
                return (
                  <section
                    key={day}
                    className="ostler-timesheet__day"
                    aria-label={formatIsoDate(day)}
                  >
                    <h2 className="ostler-timesheet__day-title">
                      <span>
                        {formatIsoDate(day, { weekday: 'long', day: 'numeric', month: 'short' })}
                      </span>
                      <span className="ostler-timesheet__day-total">
                        {formatHours(totals.byDay[day] ?? 0)}
                      </span>
                    </h2>
                    {dayEntries.length === 0 ? (
                      <p className="ostler-timesheet__none">{t('views:timesheet.noEntries')}</p>
                    ) : (
                      <ul className="ostler-timesheet__entries">
                        {dayEntries.map((entry) => (
                          <li key={entry.id}>
                            <button
                              type="button"
                              className="ostler-timesheet__entry"
                              onClick={() => setEditing(entry)}
                              aria-label={t('views:timesheet.editEntry', {
                                task: entry.workItemTitle,
                                time: length(entry)
                              })}
                            >
                              <span className="ostler-timesheet__when">
                                {formatTime(entry.startedAt)}
                              </span>
                              <span className="ostler-timesheet__task">
                                {entry.workItemTitle}
                                <span className="ostler-timesheet__project">
                                  {projectName(entry.projectId)}
                                </span>
                              </span>
                              <span className="ostler-timesheet__note">
                                {[
                                  entry.note,
                                  entry.personId ? people.byId.get(entry.personId)?.name : ''
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                                {entry.billable && (
                                  <span className="time-billed">
                                    {' '}
                                    {entry.billingId
                                      ? t('views:timesheet.billed')
                                      : t('views:timesheet.billable')}
                                  </span>
                                )}
                              </span>
                              <span className="ostler-timesheet__length">
                                {entry.durationSeconds === null
                                  ? t('tasks:time.runningFor', { time: length(entry) })
                                  : length(entry)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )
              })}
            </div>
            <aside className="ostler-timesheet__totals" aria-label={t('views:timesheet.totals')}>
              <h2 className="ostler-timesheet__totals-title">{t('views:timesheet.byProject')}</h2>
              <ul className="ostler-timesheet__total-list">
                {Object.entries(totals.byProject)
                  .sort((a, b) => b[1] - a[1])
                  .map(([id, seconds]) => (
                    <li key={id}>
                      <span>{projectName(id)}</span>
                      <span className="ostler-timesheet__length">{formatHours(seconds)}</span>
                    </li>
                  ))}
              </ul>
              <h2 className="ostler-timesheet__totals-title">{t('views:timesheet.byTask')}</h2>
              <ul className="ostler-timesheet__total-list">
                {Object.entries(totals.byTask)
                  .sort((a, b) => b[1] - a[1])
                  .map(([id, seconds]) => {
                    const entry = taskTitles.get(id)!
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          className="ostler-timesheet__link"
                          onClick={() => navigate(taskPath(entry.projectId, id))}
                        >
                          {entry.workItemTitle}
                        </button>
                        <span className="ostler-timesheet__length">{formatHours(seconds)}</span>
                      </li>
                    )
                  })}
              </ul>
            </aside>
          </div>
        )}
      </div>
      {editing && (
        <TimeEntryEditor
          entry={editing}
          task={{
            projectId: editing.projectId,
            id: editing.workItemId,
            title: editing.workItemTitle
          }}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}
      {exporting && (
        <ExportTimeDialog
          from={days[0]}
          to={days[6]}
          base={query}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  )
}

/** Export CSV for any date range, with the Timesheet's project and person filters. */
function ExportTimeDialog({
  from: initialFrom,
  to: initialTo,
  base,
  onClose
}: {
  from: string
  to: string
  base: TimeEntryQuery
  onClose: () => void
}) {
  const { toast } = useToast()
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!isIsoDate(from) || !isIsoDate(to) || to < from) {
      setError(t('views:timesheet.chooseRange'))
      return
    }
    setBusy(true)
    const result = await window.ostlerAPI.exportTimeCsv({ ...base, ...dayRange(from, to) })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (result.value)
      toast({ title: t('views:timesheet.exported'), body: result.value, tone: 'success' })
    onClose()
  }

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={t('views:timesheet.exportTitle')}
      description={t('views:timesheet.exportDescription')}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('tasks:time.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={busy} onClick={() => void run()}>
            {t('views:timesheet.exportCsv')}
          </Button>
        </>
      }
    >
      <div className="time-entry-editor">
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <DateField label={t('views:timesheet.from')} value={from} onChange={setFrom} due={false} />
        <DateField label={t('views:timesheet.to')} value={to} onChange={setTo} due={false} />
      </div>
    </Dialog>
  )
}
