import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import { isoDaysBetween, shiftIsoDate, todayIsoDate } from '@shared/dates'
import {
  dependencyConflicts,
  scheduleTaskOn,
  taskTimelineBar,
  type DependencyConflict,
  type TimelineEdit
} from '@shared/planning/timeline'
import { criticalPath, type CriticalPathTask } from '@shared/planning/critical-path'
import { dependencyLinksOf } from '@shared/planning/dependency-links'
import type { PlanningWorkspace } from '../../../hooks/usePlanningWorkspace'
import type { ViewOutput } from '../../../navigation/view-props'
import { applyTaskFilters, useTaskView } from '../../../hooks/useTaskFilters'
import { shortcut, useShortcuts } from '../../../navigation/shortcuts'
import { usePeople } from '../../../context/PeopleContext'
import { useDaysOff } from '../../../context/DaysOffContext'
import { everyonesDayOffOn } from '@shared/planning/working-days'
import {
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  Icon,
  InlineAlert,
  SegmentedControl,
  Select,
  Skeleton,
  StatusBadge,
  TimelineGrid,
  Toolbar,
  timelineRange,
  type DataTableColumn,
  type DataTableEntry,
  type TimelineArrowSpec,
  type TimelineGridHandle,
  type TimelineZoom,
  Tooltip,
  linkTypeForEnds,
  useToast
} from '../../../ui'
import {
  Camera,
  ChartGantt,
  chevronClass,
  ChevronRight,
  Plus,
  RefreshCw,
  Table2,
  TriangleAlert
} from '../../../ui/icons'
import { TaskFilterFields } from '../TaskFilterFields'
import { CriticalPathPanel } from './CriticalPathPanel'
import { LinkPopover, useTimelineLinks, type LinkPopoverState } from './TimelineLinks'
import { timelineLinkWords } from '../dependency-link-words'
import {
  conflictText,
  keyboardBarEdit,
  longDate,
  milestoneBarLabel,
  MilestoneDiamond,
  rescheduleOnTimeline,
  TaskBar,
  taskBarLabel,
  timelineEntryBars,
  type TimelineEntryBar
} from './timeline-drawing'
import { buildTimelineRows, UNSCHEDULED_GROUP, type TimelineRow } from './timeline-rows'
import {
  TIMELINE_VIEW_SPEC,
  type TimelineGroupBy,
  type TimelineViewSettings
} from './timeline-settings'
export { conflictText } from './timeline-drawing'
import { compareBaseline, planItemDates } from '@shared/planning/baselines'
import { useBaseline, useBaselines } from '../baselines/useBaselines'
import {
  baselineSummaryWords,
  milestoneBaselineWords,
  taskBaselineWords
} from '../baselines/baseline-words'
import {
  BaselineMark,
  baselineBarFor,
  baselineChanges,
  type BaselineBar
} from '../baselines/timeline-baseline'
import { SaveBaselineDialog } from '../baselines/BaselineDialogs'
import '../TaskToolbar.css'
import './TimelineView.css'
import { t } from '@shared/i18n'

const ZOOMS = [
  {
    value: 'week',
    get label() {
      return t('views:timelineView.week')
    }
  },
  {
    value: 'month',
    get label() {
      return t('views:timelineView.month')
    }
  },
  {
    value: 'quarter',
    get label() {
      return t('views:timelineView.quarter')
    }
  }
] as const

/** What the Timeline's grid draws: tasks, milestones, and a baseline's marks (N7.4). */
type TimelineBar = TimelineEntryBar | BaselineBar

const GROUPINGS = [
  {
    value: 'milestone',
    get label() {
      return t('views:timelineView.groupMilestone')
    }
  },
  {
    value: 'assignee',
    get label() {
      return t('views:timelineView.groupAssignee')
    }
  },
  {
    value: 'none',
    get label() {
      return t('views:timelineView.noGrouping')
    }
  }
]

/**
 * What Show critical path says about a task, in words: "Critical", how far
 * it can slip, or how late it is against the end. Colour is never the only sign.
 */
export function criticalPathWords(entry: CriticalPathTask): string[] {
  if (entry.slackDays > 0) return [t('views:timelineView.canSlip', { count: entry.slackDays })]
  const words = [t('views:timelineView.critical')]
  if (entry.slackDays < 0) words.push(t('views:timelineView.lateBy', { count: -entry.slackDays }))
  return words
}

/**
 * The Timeline view (P5.5): a project's tasks as bars from start to due,
 * grouped by milestone (with the milestone's diamond on its group row),
 * assignee or none, with dependency arrows and the ones out of order in the
 * warning colour. Drag a bar, or its ends, to change its dates, or use Alt
 * with the arrow keys on a focused bar; drag an unscheduled task onto the
 * timeline to give it a day. Every change is the normal update, with undo.
 * "Show as table" shows the same rows as a table. Zoom, grouping and the
 * collapsed groups are remembered per project.
 */
export function TimelineView({
  ws,
  toolbarEnd,
  onViewOutput
}: {
  ws: PlanningWorkspace
  toolbarEnd?: ReactNode
  /** What the Timeline shows, for Print (P6.1). */
  onViewOutput?: (output: ViewOutput | null) => void
}) {
  const people = usePeople()
  const filters = useTaskView(ws.projectId, 'timeline', TIMELINE_VIEW_SPEC)
  const settings = filters.options
  const [showDone, setShowDone] = useState(false)
  const [showTable, setShowTable] = useState(false)
  const [refocusId, setRefocusId] = useState<string | null>(null)
  const [savingBaseline, setSavingBaseline] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<TimelineGridHandle | null>(null)
  const today = todayIsoDate()
  const { toast } = useToast()
  const links = useTimelineLinks(ws)
  const [linkPopover, setLinkPopover] = useState<LinkPopoverState | null>(null)

  const update = (next: Partial<TimelineViewSettings>) => filters.setOptions(next)
  const toggleGroup = (key: string) =>
    update({
      collapsed: settings.collapsed.includes(key)
        ? settings.collapsed.filter((other) => other !== key)
        : [...settings.collapsed, key]
    })

  const goToday = () => gridRef.current?.scrollToDate(today)

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
  const collapsed = useMemo(() => new Set(settings.collapsed), [settings.collapsed])
  const rows = buildTimelineRows(filtered, {
    groupBy: settings.groupBy,
    collapsed,
    milestones: ws.milestones,
    people: people.byId
  })

  const byId = useMemo(() => new Map(ws.workItems.map((item) => [item.id, item])), [ws.workItems])
  // Conflicts are judged on every task, so a filter never hides why one is flagged.
  const conflicts = useMemo(() => {
    const map = new Map<string, DependencyConflict[]>()
    for (const conflict of dependencyConflicts(ws.workItems))
      map.set(conflict.taskId, [...(map.get(conflict.taskId) ?? []), conflict])
    return map
  }, [ws.workItems])
  const conflictWords = (item: PlanningWorkItem): string[] =>
    (conflicts.get(item.id) ?? []).map((conflict) =>
      conflictText(
        byId.get(conflict.dependencyId)?.title ?? t('views:timelineView.dependency'),
        conflict
      )
    )

  // Show critical path (N7.3): judged on every task, like conflicts, and
  // worked out again whenever the tasks the Timeline holds change.
  const criticalMilestone = settings.criticalFor
    ? (ws.milestones.find((milestone) => milestone.id === settings.criticalFor) ?? null)
    : null
  const critical = useMemo(() => {
    if (!settings.criticalPath) return null
    const tasks = ws.workItems.map((item) => ({ ...item, status: ws.projectedStatus(item) }))
    return criticalPath(tasks, criticalMilestone)
  }, [settings.criticalPath, ws.workItems, ws.projectedStatus, criticalMilestone])
  const slackById = useMemo(
    () => new Map((critical?.tasks ?? []).map((entry) => [entry.taskId, entry])),
    [critical]
  )
  const slackWords = (item: PlanningWorkItem): string[] => {
    const entry = slackById.get(item.id)
    return entry ? criticalPathWords(entry) : []
  }

  // Compare with (N7.4): the chosen baseline against the live plan, by the one rule.
  const { baselines, reload: reloadBaselines } = useBaselines(ws.projectId)
  const chosenBaseline = baselines.find((entry) => entry.id === settings.compareWith) ?? null
  const baselineRecord = useBaseline(ws.projectId, chosenBaseline?.id ?? null)
  const comparison = useMemo(() => {
    if (!baselineRecord || !chosenBaseline) return null
    return compareBaseline(
      { ...baselineRecord, name: chosenBaseline.name },
      planItemDates(
        ws.workItems.filter((item) => !item.archivedAt && !item.deletedAt),
        ws.milestones.filter((milestone) => milestone.status !== 'archived')
      )
    )
  }, [baselineRecord, chosenBaseline, ws.workItems, ws.milestones])
  const changes = useMemo(() => baselineChanges(comparison), [comparison])
  const baselineWords = (item: PlanningWorkItem): string[] =>
    comparison ? [taskBaselineWords(changes.get(`task:${item.id}`), comparison.name)] : []

  const barsByRow = useMemo(() => {
    const map = timelineEntryBars(rows)
    if (!comparison) return map as Map<string, TimelineBar[]>
    const withBaseline = new Map<string, TimelineBar[]>()
    for (const row of rows) {
      const mark = baselineBarFor(row, changes)
      const bars: TimelineBar[] = map.get(row.id) ?? []
      // The baseline's mark first, so today's bar is drawn over it.
      if (mark || bars.length > 0) withBaseline.set(row.id, mark ? [mark, ...bars] : bars)
    }
    return withBaseline
  }, [rows, comparison, changes])
  const barsFor = useMemo(() => {
    const empty: TimelineBar[] = []
    return (row: TimelineRow) => barsByRow.get(row.id) ?? empty
  }, [barsByRow])

  // Arrows between tasks on show; one into or out of a collapsed group is hidden.
  const arrows = useMemo<TimelineArrowSpec[]>(() => {
    const shown = new Set(
      rows.flatMap((row) => (row.kind === 'task' && row.bar ? [row.item.id] : []))
    )
    return rows.flatMap((row) => {
      if (row.kind !== 'task' || !row.bar) return []
      const mine = conflicts.get(row.item.id) ?? []
      // Each link from its true ends, with its lag (N7.2b); conflicts by N7.2a's rule.
      return dependencyLinksOf(row.item)
        .filter((link) => shown.has(link.id) && link.id !== row.item.id)
        .map((link) => {
          const dependencyId = link.id
          const conflict = mine.find((candidate) => candidate.dependencyId === dependencyId)
          const dependency = byId.get(dependencyId)!
          return {
            id: `${dependencyId}->${row.item.id}`,
            from: dependencyId,
            to: row.item.id,
            type: link.type,
            lagDays: link.lagDays,
            tone: conflict ? ('warning' as const) : ('default' as const),
            strong:
              slackById.get(dependencyId)?.critical === true &&
              slackById.get(row.item.id)?.critical === true,
            title: conflict
              ? `${row.item.title}: ${conflictText(dependency.title, conflict)}`
              : timelineLinkWords(link, row.item.title, dependency.title)
          }
        })
    })
  }, [rows, conflicts, byId, slackById])

  const range = useMemo(() => {
    const dates: string[] = []
    for (const bars of barsByRow.values()) for (const bar of bars) dates.push(bar.start, bar.end)
    return timelineRange(dates, today, settings.zoom)
  }, [barsByRow, today, settings.zoom])

  // Everyone's days off on screen (N3.2), by the one rule, shaded at Week zoom.
  const { daysOff } = useDaysOff()
  const offDays = useMemo(() => {
    const map = new Map<string, string>()
    if (daysOff.length === 0 || settings.zoom !== 'week') return map
    for (let at = range.start; at <= range.end; at = shiftIsoDate(at, 1)) {
      const off = everyonesDayOffOn(at, daysOff)
      if (off) map.set(at, off.name)
    }
    return map
  }, [daysOff, range, settings.zoom])

  const outputKey = JSON.stringify({
    config: {
      filter: filters.filter,
      query: filters.query,
      options: { ...settings, hideDone: !showDone }
    },
    // For Export to PowerPoint slide (N7.6): the tasks it holds and the range it draws.
    taskIds: filtered.map((item) => item.id),
    range
  })
  const reportRef = useRef(onViewOutput)
  reportRef.current = onViewOutput
  useEffect(() => {
    reportRef.current?.(JSON.parse(outputKey) as ViewOutput)
  }, [outputKey])
  useEffect(() => () => reportRef.current?.(null), [])
  // After a keyboard edit, focus goes back to the task's bar.
  useEffect(() => {
    if (!refocusId) return
    const bar = rootRef.current?.querySelector<SVGGElement>(
      `[data-bar-id="${CSS.escape(refocusId)}"]`
    )
    if (bar) {
      if (document.activeElement !== bar) bar.focus()
      setRefocusId(null)
    }
  }, [refocusId, rows])

  const edit = (item: PlanningWorkItem, kind: TimelineEdit, days: number) =>
    void rescheduleOnTimeline(ws.rescheduleWorkItem, item, kind, days)

  const onBarKeyDown = (event: KeyboardEvent<SVGGElement>, bar: TimelineBar) => {
    if (bar.kind !== 'task') return
    const keyEdit = keyboardBarEdit(event)
    if (!keyEdit) return
    event.preventDefault()
    event.stopPropagation()
    setRefocusId(bar.item.id)
    edit(bar.item, keyEdit.kind, keyEdit.days)
  }

  // Links drawn on the Timeline (N7.2b): the ends give the type; a popover confirms it.
  const onLinkDraw = (
    from: TimelineBar,
    fromEnd: 'start' | 'end',
    to: TimelineBar,
    toEnd: 'start' | 'end',
    element: Element
  ) => {
    if (from.kind !== 'task' || to.kind !== 'task') return
    const type = linkTypeForEnds(fromEnd, toEnd)
    if (!type) {
      toast({ title: t('views:timelineView.startToFinishRefused'), tone: 'info' })
      return
    }
    if (to.item.dependencyIds.includes(from.item.id)) {
      toast({
        title: t('views:timelineView.alreadyLinked', {
          itemTitle: to.item.title,
          title: from.item.title
        }),
        tone: 'info'
      })
      return
    }
    setLinkPopover({ kind: 'new', anchor: element, dependency: from.item, item: to.item, type })
  }

  const onArrowActivate = (arrow: TimelineArrowSpec, element: Element) => {
    const item = byId.get(arrow.to)
    const dependency = byId.get(arrow.from)
    const link = item && dependencyLinksOf(item).find((candidate) => candidate.id === arrow.from)
    if (!item || !dependency || !link) return
    setLinkPopover({ kind: 'edit', anchor: element, dependency, item, link })
  }

  const barMenu = (bar: TimelineBar) =>
    bar.kind !== 'task'
      ? []
      : [
          {
            label: t('views:timelineView.linkTo'),
            onSelect: () => {
              const anchor = rootRef.current?.querySelector(
                `[data-bar-id="${CSS.escape(bar.item.id)}"]`
              )
              if (!anchor) return
              setLinkPopover({
                kind: 'new',
                anchor,
                dependency: bar.item,
                item: null,
                type: 'finish-to-start'
              })
            }
          }
        ]

  const barLabel = (bar: TimelineBar): string => {
    if (bar.kind === 'baseline') return ''
    if (bar.kind === 'milestone') {
      const label = milestoneBarLabel(bar.name, bar.start)
      const words =
        comparison &&
        milestoneBaselineWords(changes.get(`milestone:${bar.milestoneId}`), comparison.name)
      return words ? `${label}, ${words}` : label
    }
    const status = ws.projectedStatus(bar.item)
    return taskBarLabel(bar.item, ws.statusWords.label(status), status, [
      ...slackWords(bar.item),
      ...conflictWords(bar.item),
      ...baselineWords(bar.item)
    ])
  }

  const renderBar = (bar: TimelineBar, box: { width: number; height: number }) => {
    if (bar.kind === 'baseline') return <BaselineMark bar={bar} box={box} />
    if (bar.kind === 'milestone') return <MilestoneDiamond box={box} label={barLabel(bar)} />
    // With Show critical path or Compare with on, the tooltip says how far the task can slip or has moved.
    const tooltip = ((critical && slackById.has(bar.item.id)) || comparison) && (
      <title>{barLabel(bar)}</title>
    )
    return (
      <TaskBar
        bar={bar}
        box={box}
        status={ws.projectedStatus(bar.item)}
        conflict={conflicts.has(bar.item.id)}
        critical={slackById.get(bar.item.id)?.critical === true}
        active={ws.selectedWorkItemId === bar.item.id}
        tooltip={tooltip || undefined}
      />
    )
  }

  const renderLabel = (row: TimelineRow): ReactNode => {
    if (row.kind === 'group') {
      return (
        <div className="timeline-group">
          <button
            type="button"
            className="timeline-group__toggle"
            aria-expanded={!row.collapsed}
            aria-label={
              row.collapsed
                ? t('views:timelineView.expandGroup', { count: row.count, group: row.label })
                : t('views:timelineView.collapseGroup', { count: row.count, group: row.label })
            }
            onClick={() => toggleGroup(row.key)}
          >
            <Icon icon={ChevronRight} className={chevronClass(!row.collapsed)} />
            <span className="timeline-group__name">{row.label}</span>
            <span className="timeline-group__count">{row.count}</span>
          </button>
          {row.milestone?.targetDate && (
            <span className="timeline-group__date">{longDate(row.milestone.targetDate)}</span>
          )}
        </div>
      )
    }
    const item = row.item
    const status = ws.projectedStatus(item)
    const words = conflictWords(item)
    return (
      <div
        className={`timeline-task${row.bar ? '' : ' is-unscheduled'}`}
        draggable={!row.bar}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', item.id)
        }}
      >
        <button
          type="button"
          className={`timeline-task__open${status === 'done' ? ' is-done' : ''}`}
          title={item.title}
          onClick={() => ws.openWorkItem(item)}
        >
          <StatusBadge status={status} iconOnly className="timeline-task__status" />
          <span className="timeline-task__title">{item.title}</span>
        </button>
        {words.length > 0 && (
          <span
            className="timeline-task__conflict"
            role="img"
            aria-label={words.join('; ')}
            title={words.join('; ')}
          >
            <Icon icon={TriangleAlert} />
          </span>
        )}
      </div>
    )
  }

  const tableColumns: DataTableColumn<PlanningWorkItem>[] = [
    {
      id: 'title',
      header: t('views:timelineView.title'),
      width: 220,
      cell: (item) => item.title
    },
    {
      id: 'start',
      header: t('views:timelineView.start'),
      width: 140,
      cell: (item) => {
        const bar = taskTimelineBar(item)
        return bar && (bar.kind === 'start' || bar.hasStart) ? longDate(bar.start) : '—'
      }
    },
    {
      id: 'due',
      header: t('views:timelineView.due2'),
      width: 140,
      cell: (item) => (item.targetDate ? longDate(item.targetDate) : '—')
    },
    {
      id: 'duration',
      header: t('views:timelineView.duration'),
      width: 100,
      align: 'end',
      cell: (item) => {
        const bar = taskTimelineBar(item)
        if (!bar || bar.kind === 'start') return '—'
        const days = isoDaysBetween(bar.start, bar.end) + 1
        return `${days} ${days === 1 ? 'day' : 'days'}`
      }
    },
    {
      id: 'dependencies',
      header: t('views:timelineView.dependencies'),
      width: 220,
      cell: (item) =>
        item.dependencyIds
          .map((id) => byId.get(id)?.title)
          .filter(Boolean)
          .join(', ') || '—'
    },
    {
      id: 'conflicts',
      header: t('views:timelineView.conflicts'),
      width: 320,
      cell: (item) => conflictWords(item).join('; ') || '—'
    },
    ...(critical
      ? [
          {
            id: 'slack',
            header: t('views:timelineView.slackColumn'),
            width: 260,
            cell: (item: PlanningWorkItem) => slackWords(item).join(', ') || '—'
          }
        ]
      : [])
  ]
  const tableEntries: DataTableEntry<PlanningWorkItem>[] = rows.map((row) =>
    row.kind === 'group'
      ? {
          kind: 'group',
          id: row.id,
          label: row.milestone?.targetDate
            ? `${row.label} (${longDate(row.milestone.targetDate)})`
            : row.label,
          count: row.count,
          collapsed: row.collapsed
        }
      : { kind: 'row', id: row.id, row: row.item, label: row.item.title }
  )

  const toolbar = (
    <Toolbar
      label={t('views:timelineView.timelineFilters')}
      className="task-toolbar"
      end={
        <>
          <Checkbox
            label={t('views:timelineView.showDone')}
            checked={showDone}
            onChange={(event) => setShowDone(event.target.checked)}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={showTable ? ChartGantt : Table2}
            aria-pressed={showTable}
            onClick={() => setShowTable((value) => !value)}
          >
            {t('views:timelineView.showTable')}
          </Button>
          <Button size="sm" variant="ghost" icon={Camera} onClick={() => setSavingBaseline(true)}>
            {t('views:baselines.save')}
          </Button>
          {toolbarEnd}
        </>
      }
    >
      <TaskFilterFields filters={filters} ws={ws} workItems={ws.workItems} />
    </Toolbar>
  )

  const nav = (
    <div className="timeline-view__nav">
      <Tooltip
        content={t('views:calendarView.goToToday')}
        shortcut={shortcut('calendar-today').keys}
      >
        <Button size="sm" onClick={goToday} disabled={showTable}>
          {t('views:timelineView.today')}
        </Button>
      </Tooltip>
      <SegmentedControl
        label={t('views:timelineView.timelineZoom')}
        size="sm"
        options={ZOOMS}
        value={settings.zoom}
        onChange={(zoom: TimelineZoom) => update({ zoom })}
      />
      <Select
        label={t('views:timelineView.group')}
        hideLabel
        size="sm"
        className="timeline-view__group-by"
        options={GROUPINGS}
        value={settings.groupBy}
        onChange={(event) => update({ groupBy: event.target.value as TimelineGroupBy })}
      />
      <Checkbox
        className="timeline-view__critical-path"
        label={t('views:timelineView.showCriticalPath')}
        checked={settings.criticalPath}
        onChange={(event) => update({ criticalPath: event.target.checked })}
      />
      {settings.criticalPath && (
        <Select
          label={t('views:timelineView.criticalFor')}
          size="sm"
          className="timeline-view__critical-for"
          options={[
            { value: '', label: t('views:timelineView.projectEnd') },
            ...ws.milestones.map((milestone) => ({ value: milestone.id, label: milestone.name }))
          ]}
          value={criticalMilestone?.id ?? ''}
          onChange={(event) => update({ criticalFor: event.target.value || null })}
        />
      )}
      {baselines.length > 0 && (
        <Select
          label={t('views:baselines.compareWith')}
          size="sm"
          className="timeline-view__compare-with"
          options={[
            { value: '', label: t('views:baselines.compareNone') },
            ...baselines.map((entry) => ({ value: entry.id, label: entry.name }))
          ]}
          value={chosenBaseline?.id ?? ''}
          onChange={(event) => update({ compareWith: event.target.value || null })}
        />
      )}
    </div>
  )

  const baselineSummary = comparison && (
    <p className="timeline-view__baseline-summary" role="status">
      {baselineSummaryWords(comparison)}
    </p>
  )

  const criticalPanel = critical && !showTable && (
    <CriticalPathPanel
      result={critical}
      milestoneName={criticalMilestone?.name ?? null}
      byId={byId}
      onOpen={(item) => ws.openWorkItem(item)}
    />
  )

  const datedCount = rows.filter((row) => row.kind === 'task' && row.bar).length
  const unscheduledCount = filtered.filter((item) => taskTimelineBar(item) === null).length

  let body: ReactNode
  if (ws.loading && ws.workItems.length === 0) {
    body = (
      <div
        className="timeline-view__loading"
        aria-busy="true"
        aria-label={t('views:timelineView.loadingTasks')}
      >
        <Skeleton lines={8} />
      </div>
    )
  } else if (ws.error && ws.workItems.length === 0) {
    body = (
      <EmptyState
        icon={ChartGantt}
        title={t('views:timelineView.couldntLoadTimeline')}
        description={t('views:timelineView.ostlerCouldntReadProjects')}
        action={
          <Button icon={RefreshCw} onClick={() => void ws.loadPlanning()}>
            {t('views:timelineView.tryAgain')}
          </Button>
        }
      />
    )
  } else if (ws.workItems.length === 0) {
    body = (
      <EmptyState
        icon={ChartGantt}
        title={t('views:timelineView.noTasksYet')}
        description={t('views:timelineView.timelineShowsEachTask')}
        action={
          <Button variant="primary" icon={Plus} onClick={() => ws.openWorkItemCreate()}>
            {t('views:timelineView.newTask')}
          </Button>
        }
      />
    )
  } else if (showTable) {
    body = (
      <DataTable
        label={t('views:timelineView.timelineTable')}
        className="timeline-view__table"
        columns={tableColumns}
        entries={tableEntries}
        onToggleGroup={(groupId) => toggleGroup(groupId.replace(/^group:/, ''))}
        onRowActivate={(item) => ws.openWorkItem(item)}
        activeRowId={ws.selectedWorkItemId}
      />
    )
  } else {
    body = (
      <>
        {datedCount === 0 && (
          <InlineAlert tone="info" title={t('views:timelineView.noDatedTasksHere')}>
            {unscheduledCount > 0
              ? t('views:timelineView.dragTaskUnscheduledOnto')
              : t('views:timelineView.tasksShowHereOnce')}
          </InlineAlert>
        )}
        <div className="timeline-view__body">
          <TimelineGrid<TimelineRow, TimelineBar>
            ref={gridRef}
            label={t('views:timelineView.timeline')}
            className="timeline-view__grid"
            labelHeader={t('views:timelineView.taskHeader')}
            rows={rows}
            getRowId={(row) => row.id}
            rowClassName={(row) =>
              row.kind === 'group'
                ? `timeline-row--group${row.key === UNSCHEDULED_GROUP ? ' timeline-row--unscheduled' : ''}`
                : undefined
            }
            renderLabel={renderLabel}
            barsFor={barsFor}
            renderBar={renderBar}
            barLabel={barLabel}
            arrows={arrows}
            onArrowActivate={onArrowActivate}
            selectedArrowId={
              linkPopover?.kind === 'edit'
                ? `${linkPopover.dependency.id}->${linkPopover.item.id}`
                : null
            }
            canLink={(bar) => bar.kind === 'task'}
            onLinkDraw={onLinkDraw}
            barMenu={barMenu}
            range={range}
            daysOff={offDays}
            today={today}
            zoom={settings.zoom}
            onZoomChange={(zoom) => update({ zoom })}
            onBarEdit={(bar, kind, days) => {
              if (bar.kind === 'task') edit(bar.item, kind === 'end' ? 'due' : kind, days)
            }}
            onBarActivate={(bar) => {
              if (bar.kind === 'task') ws.openWorkItem(bar.item)
            }}
            onBarKeyDown={onBarKeyDown}
            onExternalDrop={(date, id) => {
              const item = byId.get(id)
              if (item && taskTimelineBar(item) === null)
                void ws.rescheduleWorkItem(item, scheduleTaskOn(date))
            }}
          />
          {criticalPanel}
        </div>
        {linkPopover && (
          <LinkPopover
            key={`${linkPopover.kind}:${linkPopover.dependency.id}:${linkPopover.item?.id ?? ''}`}
            state={linkPopover}
            items={ws.workItems}
            links={links}
            onClose={() => setLinkPopover(null)}
          />
        )}
      </>
    )
  }

  return (
    <div ref={rootRef} className="timeline-view" aria-busy={ws.loading}>
      {nav}
      {toolbar}
      {baselineSummary}
      {body}
      {savingBaseline && (
        <SaveBaselineDialog
          projectId={ws.projectId}
          onClose={() => setSavingBaseline(false)}
          onSaved={(saved) => {
            update({ compareWith: saved.id })
            void reloadBaselines()
          }}
        />
      )}
    </div>
  )
}
