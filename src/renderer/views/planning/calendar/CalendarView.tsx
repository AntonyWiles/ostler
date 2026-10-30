import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import type {
  CalendarOccurrence,
  FillDayPiece,
  PlanningMilestone,
  PlanningWorkItem,
  TimeBlock
} from '@shared/ostler-api'
import { clockTime, workingMinutes } from '@shared/planning/time-blocks'
import { dayOffOn } from '@shared/planning/working-days'
import { useConfig } from '../../../hooks/useConfig'
import { blockPassedState, useTimeBlockActions, useTimeBlocks } from '../../../hooks/useTimeBlocks'
import { BlockCard } from '../../../components/time-blocks/BlockCard'
import { FillDayButton, useBlockMoveActions } from '../../../components/time-blocks/BlockMoves'
import { WeekHours } from './WeekHours'
import {
  compareIsoDates,
  formatIsoDate,
  parseIsoDate,
  shiftIsoDate,
  todayIsoDate
} from '@shared/dates'
import { dropTaskOnDate, shiftTaskDates, taskCalendarRange } from '@shared/planning/calendar'
import type { PlanningWorkspace } from '../../../hooks/usePlanningWorkspace'
import { applyTaskFilters, useTaskView } from '../../../hooks/useTaskFilters'
import { shortcut, useShortcuts } from '../../../navigation/shortcuts'
import { usePeople } from '../../../context/PeopleContext'
import { useDaysOff } from '../../../context/DaysOffContext'
import { everyonesDayOffOn, peopleOffOn } from '@shared/planning/working-days'
import { usePrintMyWeek } from '../../../hooks/usePrintMyWeek'
import { useCalendars } from '../../../context/CalendarsContext'
import { useCalendarEvents } from '../../../hooks/useCalendarEvents'
import { EventCard, eventLabel } from '../../../components/calendar-events/EventCard'
import { StaleCalendarNote } from '../../../components/calendar-events/StaleCalendarNote'
import {
  Button,
  CalendarGrid,
  calendarWeeks,
  Checkbox,
  Chip,
  EmptyState,
  Icon,
  IconButton,
  InlineAlert,
  Menu,
  Popover,
  PriorityIcon,
  SegmentedControl,
  Skeleton,
  StatusBadge,
  Switch,
  TextField,
  Toolbar,
  localeWeekStart,
  shiftPeriod,
  startOfWeek,
  type CalendarDayOff,
  type CalendarItemPlace,
  type CalendarMode,
  Tooltip,
  useToast
} from '../../../ui'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileDown,
  Flag,
  PanelRightOpen,
  Plus,
  Printer,
  RefreshCw
} from '../../../ui/icons'
import { PersonAvatar } from '../AssigneeField'
import { TaskFilterFields } from '../TaskFilterFields'
import { CalendarAgenda, spanText } from './CalendarAgenda'
import { CalendarYear } from './CalendarYear'
import { CALENDAR_VIEW_SPEC, type CalendarViewSettings } from './calendar-settings'
import '../TaskToolbar.css'
import './CalendarView.css'
import { t } from '@shared/i18n'
import { formatDate } from '@shared/format'

/** What the grid holds: a task over its days, or a milestone on its target date. */
type CalendarEntry =
  | { kind: 'task'; id: string; start: string; end: string; item: PlanningWorkItem }
  | { kind: 'milestone'; id: string; start: string; end: string; milestone: PlanningMilestone }
  | { kind: 'event'; id: string; start: string; end: string; occurrence: CalendarOccurrence }
  | { kind: 'block'; id: string; start: string; end: string; block: TimeBlock }

const MODES = [
  {
    value: 'month',
    get label() {
      return t('views:calendarView.month')
    }
  },
  {
    value: 'week',
    get label() {
      return t('views:calendarView.week')
    }
  },
  {
    value: 'year',
    get label() {
      return t('views:calendarView.year')
    }
  },
  {
    value: 'agenda',
    get label() {
      return t('views:calendarView.agenda')
    }
  }
] as const

const isMilestoneEntry = (entry: CalendarEntry) => entry.kind === 'milestone'

/** The days a mode shows, for asking only that range's events (N3.3a). */
function visibleRange(focused: string, mode: CalendarMode): { from: string; to: string } {
  if (mode === 'month' || mode === 'week') {
    const weeks = calendarWeeks(focused, mode, localeWeekStart())
    return { from: weeks[0][0], to: weeks[weeks.length - 1][6] }
  }
  const first = `${focused.slice(0, 7)}-01`
  return { from: first, to: shiftIsoDate(shiftPeriod(first, 'month', 1), -1) }
}

/** Previous and Next, named for the period they move by. */
function stepLabel(mode: CalendarMode, step: -1 | 1): string {
  if (mode === 'week')
    return step < 0 ? t('views:calendarView.previousWeek') : t('views:calendarView.nextWeek')
  if (mode === 'year')
    return step < 0 ? t('views:calendarView.previousYear') : t('views:calendarView.nextYear')
  return step < 0 ? t('views:calendarView.previousMonth') : t('views:calendarView.nextMonth')
}

function longDate(date: string): string {
  return formatIsoDate(date, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
}

/** "October 2026" (Month and Agenda), "2026" (Year), or "5 – 11 October 2026" for a week. */
function periodTitle(focused: string, mode: CalendarMode): string {
  const date = parseIsoDate(focused)
  if (!date) return focused
  if (mode === 'year') return formatDate(date, { year: 'numeric' })
  if (mode !== 'week') return formatDate(date, { month: 'long', year: 'numeric' })
  const first = parseIsoDate(startOfWeek(focused, localeWeekStart()))!
  const last = parseIsoDate(shiftIsoDate(startOfWeek(focused, localeWeekStart()), 6))!
  const format = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
  return format.formatRange(first, last)
}

/** Alt with an arrow key: how many days it moves a task. */
const KEY_MOVES: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7
}

/**
 * The Calendar view (P5.4): a project's tasks on their due dates, spanning
 * from the start date when they have one, and its milestones as flags on
 * their target dates. Drag a task to another day, or press Alt with an arrow
 * key on it, to move its dates; drag one from the Unscheduled panel to give
 * it a due date. Every move is the normal update, with undo. Month, Week,
 * Year or Agenda (N3.1a) and the panel are kept in the project's saved views.
 */
export function CalendarView({
  ws,
  toolbarEnd
}: {
  ws: PlanningWorkspace
  toolbarEnd?: ReactNode
}) {
  const people = usePeople()
  const { daysOff } = useDaysOff()
  const printMyWeek = usePrintMyWeek()
  const calendars = useCalendars()
  const { toast } = useToast()
  const filters = useTaskView(ws.projectId, 'calendar', CALENDAR_VIEW_SPEC)
  const settings = filters.options
  const today = todayIsoDate()
  const [focusedDate, setFocusedDate] = useState(today)
  const [showDone, setShowDone] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [refocusId, setRefocusId] = useState<string | null>(null)
  const [openEvent, setOpenEvent] = useState<{
    occurrence: CalendarOccurrence
    anchor: HTMLElement
  } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const addRefs = useRef(new Map<string, HTMLElement | null>())

  const update = (next: Partial<CalendarViewSettings>) => filters.setOptions(next)

  const goToday = () => {
    setFocusedDate(today)
    requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLElement>(`[data-date="${today}"]`)?.focus()
    )
  }
  useShortcuts({ 'calendar-today': goToday })

  const filtered = applyTaskFilters(
    ws.workItems,
    { ...filters, hideDone: !showDone },
    {
      projectedStatus: ws.projectedStatus,
      goalIdForItem: ws.goalIdForItem,
      commentCounts: ws.commentCounts,
      taskContacts: ws.taskContacts,
      meId: people.me?.id ?? null,
      currentIterationId: ws.currentIterationId,
      subprojectId: ws.subprojectScope?.id ?? null
    }
  )
  const unscheduled = filtered.filter((item) => taskCalendarRange(item) === null)
  // Outside calendars' events (N3.3a): the range on screen only, never in Year.
  const showEvents = settings.showCalendars && settings.mode !== 'year'
  const range = visibleRange(focusedDate, settings.mode)
  const occurrences = useCalendarEvents(range.from, range.to, showEvents)
  const dated = filtered.filter((item) => taskCalendarRange(item) !== null)
  // Time blocks (N3.4a): the hours in Week; times beside their tasks in Month and Agenda.
  const week = settings.mode === 'week'
  const { config } = useConfig()
  const hours = workingMinutes(config?.ui.workingHours)
  const timeBlocks = useTimeBlocks(range.from, range.to, {
    projectId: ws.projectId,
    enabled: settings.mode !== 'year'
  })
  const blockActions = useTimeBlockActions(timeBlocks.reload)
  // Blocks that move (N3.4b): Fill my day's preview drawn on the hours.
  const moveActions = useBlockMoveActions(timeBlocks.reload)
  const [ghosts, setGhosts] = useState<readonly FillDayPiece[]>([])
  const [openBlock, setOpenBlock] = useState<{ block: TimeBlock; anchor: HTMLElement } | null>(null)
  /** The block to focus after a keyboard move or resize, and the day it is going to. */
  const [refocusBlock, setRefocusBlock] = useState<{ id: string; date: string } | null>(null)
  const shownIds = useMemo(() => new Set(filtered.map((item) => item.id)), [filtered])
  const blocks = useMemo(
    () => timeBlocks.blocks.filter((block) => shownIds.has(block.workItemId)),
    [timeBlocks.blocks, shownIds]
  )

  const entries = useMemo<CalendarEntry[]>(() => {
    const flags: CalendarEntry[] = ws.milestones
      .filter((milestone) => milestone.targetDate && parseIsoDate(milestone.targetDate))
      .map((milestone) => ({
        kind: 'milestone',
        id: `milestone:${milestone.id}`,
        start: milestone.targetDate!,
        end: milestone.targetDate!,
        milestone
      }))
    const tasks: CalendarEntry[] = dated
      .map((item) => ({ kind: 'task' as const, id: item.id, ...taskCalendarRange(item)!, item }))
      .sort(
        (a, b) =>
          compareIsoDates(a.start, b.start) ||
          compareIsoDates(a.end, b.end) ||
          a.item.title.localeCompare(b.item.title)
      )
    // In Week, timed events and blocks are in the hours; the all-day row keeps the rest.
    const events: CalendarEntry[] = occurrences
      .filter((occurrence) => !week || occurrence.startTime === null)
      .map((occurrence) => ({
        kind: 'event',
        id: `event:${occurrence.id}`,
        start: occurrence.startDate,
        end: occurrence.endDate,
        occurrence
      }))
    const times: CalendarEntry[] = week
      ? []
      : blocks.map((block) => ({
          kind: 'block',
          id: `block:${block.id}`,
          start: block.date,
          end: block.date,
          block
        }))
    return [...flags, ...events, ...times, ...tasks]
  }, [ws.milestones, dated, occurrences, blocks, week])
  const work = useMemo(
    () => entries.filter((entry) => entry.kind !== 'event' && entry.kind !== 'block'),
    [entries]
  )

  /** A block in Month and Agenda: its time, then its task ("09:00 Write the proposal"). */
  const renderBlockChip = (block: TimeBlock, tabbable: boolean) => {
    const state = blockPassedState(block)
    return (
      <button
        type="button"
        tabIndex={tabbable ? 0 : -1}
        className={state.passed ? 'time-block-chip is-passed' : 'time-block-chip'}
        aria-label={state.label}
        aria-haspopup="dialog"
        title={state.label}
        onClick={(event) => setOpenBlock({ block, anchor: event.currentTarget })}
      >
        <span className="time-block-times">{clockTime(block.startMinute)}</span>
        <span className="time-block-chip__title">{block.title}</span>
      </button>
    )
  }

  /** The note a date field shows for a day off (N3.2), for a block's toast; it never blocks. */
  const dayOffNote = (date: string, item: PlanningWorkItem | undefined): string | undefined => {
    const off = dayOffOn(date, item?.assigneeId ?? null, daysOff)
    if (!off) return undefined
    if (off.personId === null) return t('common:daysOff.note', { name: off.name })
    return t('common:daysOff.notePerson', {
      name: off.name,
      person: people.byId.get(off.personId)?.name ?? ''
    })
  }

  const blockTask = (taskId: string, date: string, startMinute: number) => {
    const item = ws.workItems.find((candidate) => candidate.id === taskId)
    if (!item) return
    void blockActions.create({ workItemId: item.id, date, startMinute }, dayOffNote(date, item))
  }

  const moveBlock = async (block: TimeBlock, date: string, startMinute: number) => {
    if (date !== block.date) setFocusedDate(date)
    setRefocusBlock({ id: block.id, date })
    const moved = await blockActions.update(block, { date, startMinute })
    if (moved && date !== block.date) {
      const note = dayOffNote(
        date,
        ws.workItems.find((item) => item.id === block.workItemId)
      )
      if (note) toast({ title: note })
    }
  }

  // After a keyboard move, focus goes back to the block where it now sits: wait until the
  // block is in its new day's column, not the old button that is about to unmount.
  useEffect(() => {
    if (!refocusBlock) return
    const button = rootRef.current?.querySelector<HTMLElement>(
      `[data-hours-date="${CSS.escape(refocusBlock.date)}"] [data-block-id="${CSS.escape(refocusBlock.id)}"] .time-block`
    )
    if (button && document.activeElement !== button) button.focus()
    if (button) setRefocusBlock(null)
  }, [refocusBlock, timeBlocks.blocks])

  /** An event: outlined, its calendar's colour as a thin mark, the time first. */
  const renderEvent = (occurrence: CalendarOccurrence, tabbable: boolean) => {
    const calendar = calendars.byId.get(occurrence.calendarId)
    return (
      <button
        type="button"
        tabIndex={tabbable ? 0 : -1}
        className="calendar-event"
        style={{ '--event-color': calendar?.color } as CSSProperties}
        aria-label={eventLabel(occurrence, calendar?.name)}
        aria-haspopup="dialog"
        title={occurrence.title}
        onClick={(event) => setOpenEvent({ occurrence, anchor: event.currentTarget })}
      >
        {occurrence.startTime && (
          <span className="calendar-event__time">{occurrence.startTime}</span>
        )}
        <span className="calendar-event__title">{occurrence.title}</span>
      </button>
    )
  }

  // Days off (N3.2), by the one rule: everyone's are named; a person's leave
  // shows only when that person has tasks in this project.
  const dayOff = useMemo(() => {
    const assignees = new Set(
      ws.workItems.map((item) => item.assigneeId).filter((id): id is string => !!id)
    )
    return (date: string): CalendarDayOff | null => {
      const everyone = everyonesDayOffOn(date, daysOff)
      const away = peopleOffOn(date, daysOff)
        .filter((personId) => assignees.has(personId))
        .map((personId) => people.byId.get(personId)?.name)
        .filter((name): name is string => !!name)
      return everyone || away.length > 0 ? { name: everyone?.name ?? null, people: away } : null
    }
  }, [daysOff, ws.workItems, people.byId])

  // After a keyboard move, focus goes back to the task where it now sits.
  useEffect(() => {
    if (!refocusId) return
    const chip = rootRef.current?.querySelector<HTMLElement>(
      `[data-item-id="${CSS.escape(refocusId)}"] .calendar-chip`
    )
    if (chip) {
      chip.focus()
      setRefocusId(null)
    }
  }, [refocusId, entries, focusedDate])

  const moveByKeys = (item: PlanningWorkItem, days: number) => {
    const patch = shiftTaskDates(item, days)
    if (!patch) return
    setFocusedDate(patch.targetDate)
    setRefocusId(item.id)
    void ws.rescheduleWorkItem(item, patch)
  }

  const onDrop = (date: string, drop: { itemId: string; grabbedDate: string | null }) => {
    const item = ws.workItems.find((candidate) => candidate.id === drop.itemId)
    if (!item) return
    const patch = dropTaskOnDate(item, date, drop.grabbedDate)
    if (patch) void ws.rescheduleWorkItem(item, patch)
  }

  const renderEntry = (entry: CalendarEntry, place: CalendarItemPlace<CalendarEntry>) => {
    if (entry.kind === 'event') return renderEvent(entry.occurrence, place.tabbable)
    if (entry.kind === 'block') return renderBlockChip(entry.block, place.tabbable)
    if (entry.kind === 'milestone') {
      const label = t('views:calendarView.milestone', {
        milestoneName: entry.milestone.name,
        longDate: longDate(entry.start)
      })
      return (
        <span className="calendar-flag" role="img" aria-label={label} title={label}>
          <Icon icon={Flag} />
          <span className="calendar-flag__name">{entry.milestone.name}</span>
        </span>
      )
    }
    const item = entry.item
    const status = ws.projectedStatus(item)
    const done = status === 'done'
    const overdue = !done && compareIsoDates(entry.end, today) < 0
    const person = item.assigneeId ? people.byId.get(item.assigneeId) : undefined
    const range =
      entry.start === entry.end
        ? t('views:calendarView.due', { longDate: longDate(entry.end) })
        : t('views:calendarView.to', {
            longDate: longDate(entry.start),
            longDate2: longDate(entry.end)
          })
    const name = [
      item.title,
      ws.statusWords.label(status),
      range,
      overdue ? t('views:calendarView.overdue') : null,
      person ? t('views:calendarView.assigned', { personName: person.name }) : null
    ]
      .filter(Boolean)
      .join(', ')
    return (
      <button
        type="button"
        tabIndex={place.tabbable ? 0 : -1}
        className={[
          'calendar-chip',
          `calendar-chip--${status}`,
          done && 'is-done',
          overdue && 'is-overdue',
          ws.selectedWorkItemId === item.id && 'is-active',
          place.segment?.continuesBefore && 'continues-before',
          place.segment?.continuesAfter && 'continues-after'
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label={name}
        title={name}
        onClick={() => ws.openWorkItem(item)}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          const days = KEY_MOVES[event.key]
          if (event.altKey && !event.ctrlKey && !event.metaKey && days !== undefined) {
            event.preventDefault()
            event.stopPropagation()
            moveByKeys(item, days)
          }
        }}
      >
        <StatusBadge status={status} iconOnly className="calendar-chip__status" />
        <span className="calendar-chip__title">{item.title}</span>
        {overdue && <Icon icon={CircleAlert} className="calendar-chip__overdue" />}
        {person && <PersonAvatar person={person} />}
      </button>
    )
  }

  /** A row in Agenda: a milestone's flag, or a task with its usual row bits. */
  const renderAgendaEntry = (entry: CalendarEntry) => {
    if (entry.kind === 'event') return renderEvent(entry.occurrence, true)
    if (entry.kind === 'block') return renderBlockChip(entry.block, true)
    if (entry.kind === 'milestone')
      return (
        <span className="calendar-agenda__milestone">
          <Icon icon={Flag} />
          {t('views:calendarView.agendaMilestone', { milestoneName: entry.milestone.name })}
        </span>
      )
    const item = entry.item
    const status = ws.projectedStatus(item)
    const done = status === 'done'
    const overdue = !done && compareIsoDates(entry.end, today) < 0
    const person = item.assigneeId ? people.byId.get(item.assigneeId) : undefined
    return (
      <button
        type="button"
        className={[
          'calendar-chip',
          'calendar-agenda__row',
          `calendar-chip--${status}`,
          done && 'is-done',
          ws.selectedWorkItemId === item.id && 'is-active'
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => ws.openWorkItem(item)}
      >
        <StatusBadge status={status} iconOnly className="calendar-chip__status" />
        <span className="calendar-chip__title">{item.title}</span>
        {entry.start !== entry.end && (
          <span className="calendar-agenda__span">{spanText(entry.start, entry.end)}</span>
        )}
        {overdue && (
          <span className="calendar-agenda__span">
            <Icon icon={CircleAlert} className="calendar-chip__overdue" />{' '}
            {t('views:calendarView.overdue')}
          </span>
        )}
        {item.priority !== 'medium' && <PriorityIcon priority={item.priority} />}
        {item.labels.length > 0 && (
          <span className="calendar-agenda__labels">
            {item.labels.map((label) => (
              <Chip key={label} color={ws.labelColor(label)}>
                {label}
              </Chip>
            ))}
          </span>
        )}
        {person && <PersonAvatar person={person} />}
      </button>
    )
  }

  /** A day in Year opens Week there, with focus on that day. */
  const openWeekAt = (date: string) => {
    setFocusedDate(date)
    update({ mode: 'week' })
    requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLElement>(`[role="gridcell"][data-date="${date}"]`)?.focus()
    )
  }

  let period: ReactNode
  if (settings.mode === 'year') {
    period = (
      <CalendarYear<CalendarEntry>
        items={work}
        isMilestone={isMilestoneEntry}
        focusedDate={focusedDate}
        today={today}
        onFocusedDateChange={setFocusedDate}
        onOpenDay={openWeekAt}
        dayOff={dayOff}
      />
    )
  } else if (settings.mode === 'agenda') {
    period = (
      <CalendarAgenda<CalendarEntry>
        items={entries}
        focusedDate={focusedDate}
        today={today}
        renderItem={renderAgendaEntry}
        dayOff={dayOff}
      />
    )
  } else {
    const grid = (
      <CalendarGrid<CalendarEntry>
        label={t('views:calendarView.calendar')}
        className={week ? 'calendar-view__grid is-week-hours' : 'calendar-view__grid'}
        maxLanes={week ? 4 : undefined}
        mode={settings.mode}
        focusedDate={focusedDate}
        onFocusedDateChange={setFocusedDate}
        today={today}
        items={entries}
        renderItem={renderEntry}
        canDrag={(entry) => entry.kind === 'task'}
        onDrop={onDrop}
        dayOff={dayOff}
        onDayActivate={(date) => {
          if (!work.some((entry) => entry.start <= date && entry.end >= date)) setAdding(date)
        }}
        renderDayAction={(date, tabbable) => (
          <IconButton
            ref={(node) => {
              addRefs.current.set(date, node)
            }}
            size="sm"
            icon={Plus}
            tabIndex={tabbable ? 0 : -1}
            label={t('views:calendarView.addTask', { longDate: longDate(date) })}
            className="calendar-view__add"
            onClick={() => setAdding(date)}
          />
        )}
      />
    )
    period = week ? (
      <>
        {grid}
        <WeekHours
          days={calendarWeeks(focusedDate, 'week', localeWeekStart())[0]}
          today={today}
          workingHours={hours}
          blocks={blocks}
          events={occurrences.filter((occurrence) => occurrence.startTime !== null)}
          renderEvent={(occurrence) => renderEvent(occurrence, true)}
          onDropTask={blockTask}
          onMoveBlock={(block, date, startMinute) => void moveBlock(block, date, startMinute)}
          onResizeBlock={(block, lengthMinutes) => {
            setRefocusBlock({ id: block.id, date: block.date })
            void blockActions.update(block, { lengthMinutes })
          }}
          onOpenBlock={(block, anchor) => setOpenBlock({ block, anchor })}
          ghosts={ghosts}
        />
      </>
    ) : (
      grid
    )
  }

  const quickAddAnchor = adding
    ? (addRefs.current.get(adding) ??
      rootRef.current?.querySelector<HTMLElement>(`[data-date="${adding}"]`) ??
      null)
    : null

  const nav = (
    <div className="calendar-view__nav">
      <Tooltip
        content={t('views:calendarView.goToToday')}
        shortcut={shortcut('calendar-today').keys}
      >
        <Button size="sm" onClick={goToday}>
          {t('views:calendarView.today')}
        </Button>
      </Tooltip>
      <IconButton
        size="sm"
        icon={ChevronLeft}
        label={stepLabel(settings.mode, -1)}
        onClick={() => setFocusedDate((date) => shiftPeriod(date, settings.mode, -1))}
      />
      <IconButton
        size="sm"
        icon={ChevronRight}
        label={stepLabel(settings.mode, 1)}
        onClick={() => setFocusedDate((date) => shiftPeriod(date, settings.mode, 1))}
      />
      <h2 className="calendar-view__title" aria-live="polite">
        {periodTitle(focusedDate, settings.mode)}
      </h2>
      <SegmentedControl
        label={t('views:calendarView.calendarPeriod')}
        size="sm"
        options={MODES}
        value={settings.mode}
        onChange={(mode) => update({ mode })}
        className="calendar-view__modes"
      />
    </div>
  )

  const toolbar = (
    <Toolbar
      label={t('views:calendarView.calendarFilters')}
      className="task-toolbar"
      end={
        <>
          {calendars.calendars.length > 0 && settings.mode !== 'year' && (
            <>
              <Switch
                label={t('views:calendarEvents.showMyCalendars')}
                checked={settings.showCalendars}
                onChange={(event) => update({ showCalendars: event.target.checked })}
              />
              {settings.showCalendars && <StaleCalendarNote />}
            </>
          )}
          <Checkbox
            label={t('views:calendarView.showDone')}
            checked={showDone}
            onChange={(event) => setShowDone(event.target.checked)}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={PanelRightOpen}
            aria-pressed={settings.unscheduledOpen}
            onClick={() => update({ unscheduledOpen: !settings.unscheduledOpen })}
          >
            {t('views:calendarView.unscheduled', { unscheduledCount: unscheduled.length })}
          </Button>
          {settings.mode === 'agenda' && (
            <Menu
              label={t('views:myWeek.print')}
              renderTrigger={(trigger) => (
                <IconButton {...trigger} size="sm" icon={Printer} label={t('views:myWeek.print')} />
              )}
              items={[
                {
                  label: t('views:myWeek.print'),
                  icon: Printer,
                  onSelect: () => void printMyWeek('printer')
                },
                {
                  label: t('views:myWeek.savePdf'),
                  icon: FileDown,
                  onSelect: () => void printMyWeek('pdf')
                }
              ]}
            />
          )}
          {week && calendarWeeks(focusedDate, 'week', localeWeekStart())[0].includes(today) && (
            <FillDayButton
              date={today}
              variant="ghost"
              onChanged={timeBlocks.reload}
              onPreview={setGhosts}
            />
          )}
          {toolbarEnd}
        </>
      }
    >
      <TaskFilterFields filters={filters} ws={ws} workItems={ws.workItems} />
    </Toolbar>
  )

  let body: ReactNode
  if (ws.loading && ws.workItems.length === 0) {
    body = (
      <div
        className="calendar-view__loading"
        aria-busy="true"
        aria-label={t('views:calendarView.loadingTasks')}
      >
        <Skeleton lines={8} />
      </div>
    )
  } else if (ws.error && ws.workItems.length === 0) {
    body = (
      <EmptyState
        icon={CalendarDays}
        title={t('views:calendarView.couldntLoadCalendar')}
        description={t('views:calendarView.ostlerCouldntReadProjects')}
        action={
          <Button icon={RefreshCw} onClick={() => void ws.loadPlanning()}>
            {t('views:calendarView.tryAgain')}
          </Button>
        }
      />
    )
  } else {
    body = (
      <div className="calendar-view__main">
        <div className="calendar-view__grid-area">
          {dated.length === 0 && (
            <InlineAlert
              tone="info"
              title={t('views:calendarView.noDatedTasksHere')}
              action={
                settings.unscheduledOpen || unscheduled.length === 0
                  ? undefined
                  : {
                      label: t('views:calendarView.showUnscheduled'),
                      onClick: () => update({ unscheduledOpen: true })
                    }
              }
            >
              {t('views:calendarView.tasksShowTheirDue')}
            </InlineAlert>
          )}
          {period}
        </div>
        {settings.unscheduledOpen && (
          <aside
            className="calendar-unscheduled"
            aria-label={t('views:calendarView.unscheduledTasks')}
          >
            <h3 className="calendar-unscheduled__title">{t('views:calendarView.unscheduled2')}</h3>
            <p className="calendar-unscheduled__hint">
              {t('views:calendarView.tasksWithoutDueDate')}
            </p>
            {unscheduled.length === 0 ? (
              <p className="calendar-unscheduled__empty">
                {t('views:calendarView.everyTaskHereHas')}
              </p>
            ) : (
              <ul className="calendar-unscheduled__list">
                {unscheduled.map((item) => {
                  const status = ws.projectedStatus(item)
                  return (
                    <li
                      key={item.id}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', item.id)
                      }}
                    >
                      <button
                        type="button"
                        className={`calendar-chip calendar-chip--${status}${status === 'done' ? ' is-done' : ''}`}
                        title={item.title}
                        onClick={() => ws.openWorkItem(item)}
                      >
                        <StatusBadge status={status} iconOnly className="calendar-chip__status" />
                        <span className="calendar-chip__title">{item.title}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </aside>
        )}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="calendar-view" aria-busy={ws.loading}>
      {nav}
      {toolbar}
      {body}
      {openEvent && (
        <EventCard
          occurrence={openEvent.occurrence}
          anchor={openEvent.anchor}
          projectId={ws.projectId}
          onClose={() => setOpenEvent(null)}
        />
      )}
      {openBlock && (
        <BlockCard
          block={openBlock.block}
          anchor={openBlock.anchor}
          onClose={() => setOpenBlock(null)}
          onOpenTask={(block) => {
            const item = ws.workItems.find((candidate) => candidate.id === block.workItemId)
            if (item) ws.openWorkItem(item)
          }}
          onRemove={(block) => void blockActions.remove(block)}
          onMoveToFree={(block) => void moveActions.moveOne(block)}
        />
      )}
      {adding && quickAddAnchor && (
        <QuickAddPopover
          date={adding}
          anchor={quickAddAnchor}
          onClose={() => setAdding(null)}
          onAdd={async (title) =>
            (await ws.quickAddWorkItem({ title, targetDate: adding })) !== null
          }
        />
      )}
    </div>
  )
}

/** Quick add on a day: a title, then Enter, makes a task due that day. */
function QuickAddPopover({
  date,
  anchor,
  onClose,
  onAdd
}: {
  date: string
  anchor: HTMLElement
  onClose: () => void
  onAdd: (title: string) => Promise<boolean>
}) {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    const text = title.trim()
    if (!text || saving) return
    setSaving(true)
    const added = await onAdd(text)
    setSaving(false)
    if (added) onClose()
  }
  return (
    <Popover
      open
      onClose={onClose}
      anchorRef={{ current: anchor }}
      label={t('views:calendarView.addTask', { longDate: longDate(date) })}
      className="calendar-quick-add"
    >
      <TextField
        label={t('views:calendarView.newTaskDue', { longDate: longDate(date) })}
        placeholder={t('views:calendarView.taskTitleThenEnter')}
        value={title}
        maxLength={200}
        disabled={saving}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
        }}
      />
      <div className="calendar-quick-add__actions">
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('views:calendarView.cancel')}
        </Button>
        <Button size="sm" variant="primary" loading={saving} onClick={() => void submit()}>
          {t('views:calendarView.addTask2')}
        </Button>
      </div>
    </Popover>
  )
}
