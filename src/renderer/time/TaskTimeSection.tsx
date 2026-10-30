import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PlanningWorkItem, TimeEntry } from '@shared/ostler-api'
import { formatDate, formatTime } from '@shared/format'
import { formatHours, formatTimerClock } from '@shared/time/duration'
import { timeAgainstEstimate } from '@shared/time/estimate'
import { entrySeconds } from '@shared/time/timesheet'
import { useProjectEstimateUnit } from '../context/OstlerContext'
import { usePeople } from '../context/PeopleContext'
import { timesheetPath } from '../navigation/paths'
import { Button, Checkbox, IconButton, useToast } from '../ui'
import { CalendarDays, Pencil, Play, Plus, Square, Target, Trash2 } from '../ui/icons'
import { TaskDrawerSection } from '../views/planning/TaskDrawerSection'
import { TimeEntryEditor } from './TimeEntryEditor'
import { useNow, useTimer } from './TimerProvider'
import { useFocus } from './FocusProvider'
import './time.css'
import '../billing/billing.css'
import { t } from '@shared/i18n'

/**
 * The drawer's Time section (R2.3): start or stop the timer on this task, the
 * time logged (against the estimate in an hours project), and the task's
 * entries, each editable, billable or not (N6.4), and deletable with Undo. Entries are their own
 * records, so they save at once, like reminders.
 */
export function TaskTimeSection({ item }: { item: PlanningWorkItem }) {
  const people = usePeople()
  const timer = useTimer()
  const focus = useFocus()
  const navigate = useNavigate()
  const { toast, toastUndo } = useToast()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [editing, setEditing] = useState<TimeEntry | 'new' | null>(null)
  const runningHere = timer.running?.workItemId === item.id
  const now = useNow(runningHere, 1000)
  const unit = useProjectEstimateUnit(item.projectId)

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getTaskTimeEntries(item.projectId, item.id)
    if (result.ok) setEntries(result.value)
  }, [item.projectId, item.id])

  useEffect(() => {
    void load()
    return window.ostlerAPI.onTimeChange((change) => {
      if (change.projectId === item.projectId) void load()
    })
  }, [load, item.projectId])

  const remove = async (entry: TimeEntry) => {
    const result = await window.ostlerAPI.deleteTimeEntry(item.projectId, entry.id)
    if (!result.ok) {
      toast({ title: t('tasks:time.couldNotDelete'), body: result.error, tone: 'danger' })
      return
    }
    void load()
    toastUndo(t('tasks:time.deletedEntry'), () =>
      window.ostlerAPI.restoreTimeEntry(item.projectId, result.value).then(() => load())
    )
  }

  const setBillable = async (entry: TimeEntry, billable: boolean) => {
    const result = await window.ostlerAPI.updateTimeEntry(item.projectId, entry.id, { billable })
    if (!result.ok)
      toast({ title: t('tasks:time.couldNotChange'), body: result.error, tone: 'danger' })
    void load()
  }

  const total = entries.reduce((sum, entry) => sum + entrySeconds(entry, now), 0)
  const summary = timeAgainstEstimate(total, item.estimate, unit)
  const closed = Boolean(item.archivedAt) || Boolean(item.deletedAt)

  return (
    <TaskDrawerSection
      title={t('tasks:time.time')}
      className="task-time"
      part={{ id: 'time', inUse: entries.length > 0 || runningHere }}
      actions={
        <>
          {runningHere ? (
            <Button size="sm" variant="secondary" icon={Square} onClick={() => void timer.stop()}>
              {t('tasks:time.stopTimer')}
            </Button>
          ) : (
            !closed && (
              <Button
                size="sm"
                variant="ghost"
                icon={Play}
                onClick={() => void timer.start(item.projectId, item.id)}
              >
                {t('tasks:time.startTimer')}
              </Button>
            )
          )}
          {!closed && (
            <Button
              size="sm"
              variant="ghost"
              icon={Target}
              onClick={() =>
                focus.ask({ projectId: item.projectId, workItemId: item.id, title: item.title })
              }
            >
              {t('tasks:focus.focus')}
            </Button>
          )}
          {!closed && (
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setEditing('new')}>
              {t('tasks:time.addTime')}
            </Button>
          )}
          <IconButton
            size="sm"
            icon={CalendarDays}
            label={t('tasks:time.openTimesheet')}
            onClick={() => navigate(timesheetPath())}
          />
        </>
      }
    >
      <p
        className={
          summary?.over ? 'task-time__summary task-time__summary--over' : 'task-time__summary'
        }
      >
        {summary ? summary.text : t('tasks:time.noTimeLogged')}
        {summary?.over && <span className="task-time__over"> {t('tasks:time.overEstimate')}</span>}
      </p>
      {entries.length > 0 && (
        <ul className="task-time__entries" aria-label={t('tasks:time.entries')}>
          {entries.map((entry) => {
            const person = entry.personId ? people.byId.get(entry.personId) : undefined
            const length =
              entry.durationSeconds === null
                ? formatTimerClock(now - entry.startedAt)
                : formatHours(entry.durationSeconds)
            return (
              <li key={entry.id} className="task-time__entry">
                <span className="task-time__when">
                  {formatDate(entry.startedAt, { day: 'numeric', month: 'short' })}{' '}
                  {formatTime(entry.startedAt)}
                </span>
                <span className="task-time__length">
                  {entry.durationSeconds === null
                    ? t('tasks:time.runningFor', { time: length })
                    : length}
                </span>
                <span className="task-time__note">
                  {[entry.note, person?.name].filter(Boolean).join(' · ')}
                </span>
                <span className="task-time__actions">
                  {entry.billingId ? (
                    <span className="time-billed">{t('tasks:time.billed')}</span>
                  ) : (
                    <Checkbox
                      label={t('tasks:time.billable')}
                      aria-label={t('tasks:time.billableEntry', {
                        time: length,
                        when: formatDate(entry.startedAt, { day: 'numeric', month: 'short' })
                      })}
                      checked={entry.billable}
                      onChange={(event) => void setBillable(entry, event.target.checked)}
                    />
                  )}
                  <IconButton
                    size="sm"
                    icon={Pencil}
                    label={t('tasks:time.editEntry', { time: length })}
                    onClick={() => setEditing(entry)}
                  />
                  <IconButton
                    size="sm"
                    icon={Trash2}
                    label={t('tasks:time.deleteEntry', { time: length })}
                    onClick={() => void remove(entry)}
                  />
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {editing && (
        <TimeEntryEditor
          entry={editing === 'new' ? undefined : editing}
          task={{ projectId: item.projectId, id: item.id, title: item.title }}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}
    </TaskDrawerSection>
  )
}
