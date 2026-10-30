import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  PlanningWorkItem,
  RendererProject,
  TimelineOverviewMilestone,
  TimelineOverviewProject
} from '@shared/ostler-api'
import { shiftIsoDate } from '@shared/dates'
import { dependencyConflicts, scheduleTaskOn, type TimelineEdit } from '@shared/planning/timeline'
import { everyonesDayOffOn } from '@shared/planning/working-days'
import {
  buildTimelineOverviewRows,
  filterOverviewProjects,
  meetingWeeks,
  openedRowPrefix,
  type OpenedProjectPlan as PlanInput,
  type TimelineOverviewFilter,
  type TimelineOverviewRow
} from '@shared/planning/timeline-overview'
import { PERF_MARKS } from '@shared/perf-marks'
import { t } from '@shared/i18n'
import { useOstler } from '../../context/OstlerContext'
import { usePeople } from '../../context/PeopleContext'
import { useDaysOff } from '../../context/DaysOffContext'
import { useHomeFeed } from '../../hooks/useHomeFeed'
import { useToday } from '../../hooks/useToday'
import { useMoveMilestoneDate } from '../../hooks/useMoveMilestoneDate'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { useRenderedMark } from '../../lib/perf-marks'
import { shortcut, useShortcuts } from '../../navigation/shortcuts'
import { projectPath, taskPath } from '../../navigation/paths'
import { ProjectMark } from '../../components/ProjectMark'
import {
  Button,
  Checkbox,
  EmptyState,
  Icon,
  IconButton,
  InlineAlert,
  localeWeekStart,
  Menu,
  PageHeader,
  Popover,
  SegmentedControl,
  Select,
  Skeleton,
  StatusBadge,
  TimelineGrid,
  timelineRange,
  Tooltip,
  useToast,
  type TimelineAxisMark,
  type TimelineBarSpec,
  type TimelineGridHandle,
  type TimelineZoom
} from '../../ui'
import {
  ChartGantt,
  chevronClass,
  ChevronRight,
  FileDown,
  Printer,
  RefreshCw,
  TriangleAlert
} from '../../ui/icons'
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
} from '../planning/timeline/timeline-drawing'
import { OpenedProjectPlan } from './OpenedProjectPlan'
import { meetingWeekLabel } from './meeting-week'
import {
  loadTimelineOverviewSettings,
  saveTimelineOverviewSettings,
  type TimelineOverviewSettings
} from './timeline-overview-settings'
import '../planning/timeline/TimelineView.css'
import './TimelineOverviewView.css'

type Row = TimelineOverviewRow<RendererProject>

/** A bar on the Timeline across projects. */
type OverviewBar = TimelineBarSpec &
  (
    | { kind: 'span'; projectId: string }
    | { kind: 'project-milestone'; projectId: string; milestone: TimelineOverviewMilestone }
    | ({ projectId: string } & TimelineEntryBar)
  )

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

const ALL = 'all'
const CHOSEN = 'chosen'

function filterValue(filter: TimelineOverviewFilter): string {
  if (filter.kind === 'area') return `area:${filter.areaId}`
  return filter.kind === 'chosen' ? CHOSEN : ALL
}

/**
 * The Timeline across projects (N5.4, N39): one row per enabled project, in
 * its area, with its milestones as diamonds and a thin bar from its first to
 * its last dated task, on one date axis with today, weekends and everyone's
 * days off. A row opens to the project's dated tasks and milestones, drawn
 * and moved by the project Timeline's own code (`timeline-drawing.tsx`), read
 * when opened. Weeks where milestones from two or more projects meet are
 * marked on the axis. A global view with no sidebar row (D35): reached from
 * the command palette and Home's Projects section.
 */
export function TimelineOverviewView() {
  const navigate = useNavigate()
  const { projects, areas } = useOstler()
  const people = usePeople()
  const { daysOff } = useDaysOff()
  const { toast } = useToast()
  const today = useToday()
  const [settings, setSettings] = useState<TimelineOverviewSettings>(loadTimelineOverviewSettings)
  const [opened, setOpened] = useState<string[]>([])
  // Workstreams (sub-projects) folded shut under their project.
  const [foldedSubs, setFoldedSubs] = useState<string[]>([])
  const [, setVersion] = useState(0)
  const workspaces = useRef(new Map<string, PlanningWorkspace>()).current
  const bump = useCallback(() => setVersion((value) => value + 1), [])
  const [meeting, setMeeting] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const markRef = useRef<HTMLElement | null>(null)
  const chooseRef = useRef<HTMLButtonElement | null>(null)
  const gridRef = useRef<TimelineGridHandle | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [refocusId, setRefocusId] = useState<string | null>(null)

  const update = (next: Partial<TimelineOverviewSettings>) =>
    setSettings((current) => {
      const merged = { ...current, ...next }
      saveTimelineOverviewSettings(merged)
      return merged
    })

  const overview = useHomeFeed<TimelineOverviewProject[]>(
    () => window.ostlerAPI.getTimelineOverview(),
    []
  )
  useRenderedMark(PERF_MARKS.timelineOverviewRendered, overview.value !== null, 'overview', {
    count: overview.value?.length ?? 0
  })

  const enabled = useMemo(() => projects.filter((project) => project.enabled), [projects])
  const shown = useMemo(
    () => filterOverviewProjects(enabled, settings.filter),
    [enabled, settings.filter]
  )
  const shownIds = useMemo(() => new Set(shown.map((project) => project.id)), [shown])
  const entries = useMemo(
    () => (overview.value ?? []).filter((entry) => shownIds.has(entry.projectId)),
    [overview.value, shownIds]
  )
  const byProject = useMemo(
    () => new Map(enabled.map((project) => [project.id, project])),
    [enabled]
  )

  // The opened projects' plans, from their workspaces; done tasks left out, as on the project Timeline.
  const plans = new Map<string, PlanInput | null>()
  for (const projectId of opened) {
    if (!shownIds.has(projectId)) continue
    const ws = workspaces.get(projectId)
    plans.set(
      projectId,
      !ws || (ws.loading && ws.workItems.length === 0)
        ? null
        : {
            items: ws.workItems.filter((item) => ws.projectedStatus(item) !== 'done'),
            milestones: ws.milestones,
            subprojects: ws.subprojects
          }
    )
  }
  const rows = buildTimelineOverviewRows({
    projects: shown,
    areas,
    overview: overview.value,
    opened: plans,
    people: people.byId,
    collapsedSubprojects: new Set(foldedSubs)
  })

  const toggle = (projectId: string) =>
    setOpened((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    )

  const toggleSub = (subprojectId: string) =>
    setFoldedSubs((current) =>
      current.includes(subprojectId)
        ? current.filter((id) => id !== subprojectId)
        : [...current, subprojectId]
    )

  // Conflicts in the opened projects, judged on every task, as on the project Timeline.
  const conflicts = new Map<string, string[]>()
  for (const [projectId] of plans) {
    const ws = workspaces.get(projectId)
    if (!ws) continue
    const titles = new Map(ws.workItems.map((item) => [item.id, item.title]))
    for (const conflict of dependencyConflicts(ws.workItems))
      conflicts.set(conflict.taskId, [
        ...(conflicts.get(conflict.taskId) ?? []),
        conflictText(
          titles.get(conflict.dependencyId) ?? t('views:timelineView.dependency'),
          conflict
        )
      ])
  }

  const barsByRow = new Map<string, OverviewBar[]>()
  for (const row of rows) {
    if (row.kind === 'project' && row.entry) {
      const bars: OverviewBar[] = []
      if (row.entry.firstDate && row.entry.lastDate)
        bars.push({
          id: `span:${row.project.id}`,
          start: row.entry.firstDate,
          end: row.entry.lastDate,
          kind: 'span',
          projectId: row.project.id
        })
      for (const milestone of row.entry.milestones)
        bars.push({
          id: `overview-milestone:${milestone.id}`,
          start: milestone.targetDate,
          end: milestone.targetDate,
          shape: 'milestone',
          editable: true,
          kind: 'project-milestone',
          projectId: row.project.id,
          milestone
        })
      barsByRow.set(row.id, bars)
    }
  }
  for (const projectId of plans.keys()) {
    const inner = rows.flatMap((row) =>
      row.kind === 'task' && row.projectId === projectId ? [row.row] : []
    )
    for (const [rowId, bars] of timelineEntryBars(inner, openedRowPrefix(projectId)))
      barsByRow.set(
        rowId,
        bars.map((bar) => ({ ...bar, projectId }))
      )
  }
  const noBars: OverviewBar[] = []
  const barsFor = (row: Row) => barsByRow.get(row.id) ?? noBars

  const allDates = [...barsByRow.values()].flat().flatMap((bar) => [bar.start, bar.end])
  const rangeKey = `${allDates.length ? allDates.reduce((a, b) => (b < a ? b : a)) : today}|${allDates.length ? allDates.reduce((a, b) => (b > a ? b : a)) : today}`
  const range = useMemo(
    () => timelineRange(rangeKey.split('|'), today, settings.zoom),
    [rangeKey, today, settings.zoom]
  )

  // Everyone's days off on screen (N3.2), by the one rule, shaded at Week zoom.
  const offDays = useMemo(() => {
    const map = new Map<string, string>()
    if (daysOff.length === 0 || settings.zoom !== 'week') return map
    for (let at = range.start; at <= range.end; at = shiftIsoDate(at, 1)) {
      const off = everyonesDayOffOn(at, daysOff)
      if (off) map.set(at, off.name)
    }
    return map
  }, [daysOff, range, settings.zoom])

  const weeks = useMemo(() => meetingWeeks(entries, localeWeekStart()), [entries])
  const marks = useMemo<TimelineAxisMark[]>(
    () =>
      weeks.map((week) => ({
        id: week.start,
        start: week.start,
        end: week.end,
        label: meetingWeekLabel(week),
        text: t('views:timelineOverview.milestoneCount', { count: week.milestones.length })
      })),
    [weeks]
  )
  const openWeek = meeting ? (weeks.find((week) => week.start === meeting) ?? null) : null

  const reloadAll = useCallback(() => {
    void overview.reload()
  }, [overview])
  const moveMilestone = useMoveMilestoneDate(() => {
    reloadAll()
    for (const ws of workspaces.values()) void ws.loadPlanning()
  })

  const editTask = (bar: OverviewBar & { kind: 'task' }, kind: TimelineEdit, days: number) => {
    const ws = workspaces.get(bar.projectId)
    if (!ws) return
    void rescheduleOnTimeline(ws.rescheduleWorkItem, bar.item, kind, days).then((saved) => {
      if (saved) reloadAll()
    })
  }

  const onBarEdit = (bar: OverviewBar, kind: 'move' | 'start' | 'end', days: number) => {
    if (bar.kind === 'task') editTask(bar, kind === 'end' ? 'due' : kind, days)
    else if (bar.kind === 'project-milestone' && kind === 'move')
      void moveMilestone(bar.milestone, days)
  }

  const onBarKeyDown = (event: KeyboardEvent<SVGGElement>, bar: OverviewBar) => {
    if (bar.kind !== 'task' && bar.kind !== 'project-milestone') return
    const keyEdit = keyboardBarEdit(event)
    if (!keyEdit) return
    event.preventDefault()
    event.stopPropagation()
    setRefocusId(bar.id)
    if (bar.kind === 'task') editTask(bar, keyEdit.kind, keyEdit.days)
    else if (keyEdit.kind === 'move') void moveMilestone(bar.milestone, keyEdit.days)
  }

  // After a keyboard edit, focus goes back to the bar.
  useEffect(() => {
    if (!refocusId) return
    const bar = rootRef.current?.querySelector<SVGGElement>(
      `[data-bar-id="${CSS.escape(refocusId)}"]`
    )
    if (bar) {
      if (document.activeElement !== bar) bar.focus()
      setRefocusId(null)
    }
  })

  const projectName = (projectId: string) => byProject.get(projectId)?.name ?? ''

  const barLabel = (bar: OverviewBar): string => {
    if (bar.kind === 'span')
      return t('views:timelineOverview.spanLabel', {
        project: projectName(bar.projectId),
        first: longDate(bar.start),
        last: longDate(bar.end)
      })
    if (bar.kind === 'project-milestone')
      return `${projectName(bar.projectId)}: ${milestoneBarLabel(bar.milestone.name, bar.start)}`
    if (bar.kind === 'milestone') return milestoneBarLabel(bar.name, bar.start)
    const ws = workspaces.get(bar.projectId)
    const status = ws ? ws.projectedStatus(bar.item) : bar.item.status
    return taskBarLabel(
      bar.item,
      ws ? ws.statusWords.label(status) : status,
      status,
      conflicts.get(bar.item.id) ?? []
    )
  }

  const renderBar = (bar: OverviewBar, box: { width: number; height: number }) => {
    if (bar.kind === 'span') {
      const project = byProject.get(bar.projectId)
      return (
        <rect
          className="timeline-overview__span"
          x={0}
          y={box.height / 2 - 2}
          width={box.width}
          height={4}
          rx={2}
          style={project?.color ? { fill: project.color } : undefined}
        >
          <title>{barLabel(bar)}</title>
        </rect>
      )
    }
    if (bar.kind === 'project-milestone' || bar.kind === 'milestone')
      return <MilestoneDiamond box={box} label={barLabel(bar)} />
    const ws = workspaces.get(bar.projectId)
    return (
      <TaskBar
        bar={bar}
        box={box}
        status={ws ? ws.projectedStatus(bar.item) : bar.item.status}
        conflict={conflicts.has(bar.item.id)}
      />
    )
  }

  const onActivate = (bar: OverviewBar) => {
    if (bar.kind === 'span') toggle(bar.projectId)
    else if (bar.kind === 'task') navigate(taskPath(bar.projectId, bar.item.id))
    else navigate(projectPath(bar.projectId, 'timeline'))
  }

  // Up and down move between the rows' buttons; right opens a project's row, left closes it.
  const onRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, row: Row) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const buttons = [
        ...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-overview-row]') ?? [])
      ]
      const at = buttons.indexOf(event.currentTarget)
      const next = buttons[at + (event.key === 'ArrowDown' ? 1 : -1)]
      if (next) {
        event.preventDefault()
        next.focus()
      }
      return
    }
    if (row.kind !== 'project' && row.kind !== 'subproject') return
    if ((event.key === 'ArrowRight' && !row.open) || (event.key === 'ArrowLeft' && row.open)) {
      event.preventDefault()
      if (row.kind === 'project') toggle(row.project.id)
      else toggleSub(row.subproject.id)
    }
  }

  const renderLabel = (row: Row): ReactNode => {
    if (row.kind === 'area')
      return (
        <div className="timeline-overview__area">
          {row.area ? row.area.name : t('views:timelineOverview.noArea')}
        </div>
      )
    if (row.kind === 'project') {
      const entry = row.entry
      const undated = entry !== null && entry.milestones.length === 0 && entry.firstDate === null
      return (
        <div className="timeline-overview__project">
          <button
            type="button"
            className="timeline-group__toggle"
            data-overview-row=""
            aria-expanded={row.open}
            aria-label={t(
              row.open
                ? 'views:timelineOverview.closeProject'
                : 'views:timelineOverview.openProject',
              { project: row.project.name }
            )}
            onClick={() => toggle(row.project.id)}
            onKeyDown={(event) => onRowKeyDown(event, row)}
          >
            <Icon icon={ChevronRight} className={chevronClass(row.open)} />
            <ProjectMark project={row.project} className="timeline-overview__mark" />
            <span className="timeline-group__name">{row.project.name}</span>
          </button>
          {undated && (
            <span className="timeline-overview__undated">
              {t('views:timelineOverview.noDatesYet')}
            </span>
          )}
        </div>
      )
    }
    if (row.kind === 'subproject')
      return (
        <div className="timeline-overview__subproject">
          <button
            type="button"
            className="timeline-group__toggle"
            data-overview-row=""
            aria-expanded={row.open}
            aria-label={t(
              row.open
                ? 'views:timelineOverview.closeWorkstream'
                : 'views:timelineOverview.openWorkstream',
              { name: row.subproject.name }
            )}
            onClick={() => toggleSub(row.subproject.id)}
            onKeyDown={(event) => onRowKeyDown(event, row)}
          >
            <Icon icon={ChevronRight} className={chevronClass(row.open)} />
            <span className="timeline-group__name">{row.subproject.name}</span>
          </button>
        </div>
      )
    if (row.kind === 'note')
      return (
        <div className="timeline-overview__note">
          {row.note === 'loading'
            ? t('views:timelineOverview.loadingProject')
            : t('views:timelineOverview.nothingDated')}
        </div>
      )
    const inner = row.row
    if (inner.kind === 'group')
      return (
        <div className="timeline-group timeline-overview__inner">
          <span className="timeline-group__name">{inner.label}</span>
          {inner.milestone?.targetDate && (
            <span className="timeline-group__date">{longDate(inner.milestone.targetDate)}</span>
          )}
        </div>
      )
    const item: PlanningWorkItem = inner.item
    const ws = workspaces.get(row.projectId)
    const status = ws ? ws.projectedStatus(item) : item.status
    const words = conflicts.get(item.id) ?? []
    return (
      <div className="timeline-task timeline-overview__inner">
        <button
          type="button"
          className="timeline-task__open"
          title={item.title}
          data-overview-row=""
          onClick={() => navigate(taskPath(row.projectId, item.id))}
          onKeyDown={(event) => onRowKeyDown(event, row)}
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

  const print = async (output: 'pdf' | 'printer') => {
    const result = await window.ostlerAPI.printTimelineOverview({
      projectIds: settings.filter.kind === 'all' ? null : shown.map((project) => project.id),
      output
    })
    if (!result.ok)
      toast({
        title: t('views:timelineOverview.couldntPrint'),
        body: result.error,
        tone: 'danger'
      })
    else if (result.value)
      toast({ title: t('views:timelineOverview.savedPdf'), body: result.value, tone: 'success' })
  }

  const goToday = () => gridRef.current?.scrollToDate(today)
  useShortcuts({ 'calendar-today': goToday })

  const filterOptions = [
    { value: ALL, label: t('views:timelineOverview.allProjects') },
    ...areas.map((area) => ({
      value: `area:${area.id}`,
      label: area.name,
      group: t('views:timelineOverview.byArea')
    })),
    { value: CHOSEN, label: t('views:timelineOverview.chosenProjects') }
  ]
  const onFilter = (value: string) => {
    if (value === ALL) update({ filter: { kind: 'all' } })
    else if (value === CHOSEN) {
      update({
        filter: {
          kind: 'chosen',
          projectIds:
            settings.filter.kind === 'chosen'
              ? settings.filter.projectIds
              : shown.map((project) => project.id)
        }
      })
      setChoosing(true)
    } else update({ filter: { kind: 'area', areaId: value.slice('area:'.length) } })
  }
  const chosen = settings.filter.kind === 'chosen' ? settings.filter.projectIds : []
  const toggleChosen = (projectId: string, on: boolean) =>
    update({
      filter: {
        kind: 'chosen',
        projectIds: on
          ? [...chosen.filter((id) => id !== projectId), projectId]
          : chosen.filter((id) => id !== projectId)
      }
    })

  const nav = (
    <div className="timeline-view__nav">
      <Tooltip
        content={t('views:calendarView.goToToday')}
        shortcut={shortcut('calendar-today').keys}
      >
        <Button size="sm" onClick={goToday}>
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
        label={t('views:timelineOverview.projects')}
        hideLabel
        size="sm"
        className="timeline-overview__filter"
        options={filterOptions}
        value={filterValue(settings.filter)}
        onChange={(event) => onFilter(event.target.value)}
      />
      {settings.filter.kind === 'chosen' && (
        <>
          <Button
            ref={chooseRef}
            size="sm"
            aria-expanded={choosing}
            onClick={() => setChoosing((value) => !value)}
          >
            {t('views:timelineOverview.chooseProjects', { count: shown.length })}
          </Button>
          <Popover
            open={choosing}
            onClose={() => setChoosing(false)}
            anchorRef={chooseRef}
            label={t('views:timelineOverview.chooseProjectsLabel')}
          >
            <div className="timeline-overview__choose">
              {enabled.map((project) => (
                <Checkbox
                  key={project.id}
                  label={project.name}
                  checked={chosen.includes(project.id)}
                  onChange={(event) => toggleChosen(project.id, event.target.checked)}
                />
              ))}
            </div>
          </Popover>
        </>
      )}
      <Menu
        label={t('views:timelineOverview.print')}
        renderTrigger={(trigger) => (
          <IconButton
            {...trigger}
            size="sm"
            icon={Printer}
            label={t('views:timelineOverview.print')}
          />
        )}
        items={[
          {
            label: t('views:timelineOverview.print'),
            icon: Printer,
            onSelect: () => void print('printer')
          },
          {
            label: t('views:timelineOverview.savePdf'),
            icon: FileDown,
            onSelect: () => void print('pdf')
          }
        ]}
      />
    </div>
  )

  let body: ReactNode
  if (overview.value === null && overview.error) {
    body = (
      <EmptyState
        icon={ChartGantt}
        title={t('views:timelineOverview.couldntLoad')}
        description={overview.error}
        action={
          <Button icon={RefreshCw} onClick={() => void overview.reload()}>
            {t('views:timelineView.tryAgain')}
          </Button>
        }
      />
    )
  } else if (overview.value === null) {
    body = (
      <div aria-busy="true" aria-label={t('views:timelineOverview.loading')}>
        <Skeleton lines={8} />
      </div>
    )
  } else if (enabled.length === 0) {
    body = (
      <EmptyState
        icon={ChartGantt}
        title={t('views:timelineOverview.noProjects')}
        description={t('views:timelineOverview.noProjectsDescription')}
      />
    )
  } else {
    body = (
      <>
        {shown.length === 0 && (
          <InlineAlert tone="info" title={t('views:timelineOverview.noneShown')}>
            {t('views:timelineOverview.noneShownDescription')}
          </InlineAlert>
        )}
        <div className="timeline-view__body">
          <TimelineGrid<Row, OverviewBar>
            ref={gridRef}
            label={t('views:timelineOverview.title')}
            className="timeline-view__grid"
            labelHeader={t('views:timelineOverview.projectHeader')}
            rows={rows}
            getRowId={(row) => row.id}
            rowClassName={(row) =>
              row.kind === 'area'
                ? 'timeline-row--group timeline-overview__area-row'
                : row.kind === 'project'
                  ? 'timeline-overview__project-row'
                  : row.kind === 'subproject'
                    ? 'timeline-row--group timeline-overview__subproject-row'
                    : row.kind === 'task' && row.row.kind === 'group'
                      ? 'timeline-row--group'
                      : undefined
            }
            renderLabel={renderLabel}
            barsFor={barsFor}
            renderBar={renderBar}
            barLabel={barLabel}
            range={range}
            daysOff={offDays}
            today={today}
            zoom={settings.zoom}
            onZoomChange={(zoom) => update({ zoom })}
            onBarEdit={onBarEdit}
            onBarActivate={onActivate}
            onBarKeyDown={onBarKeyDown}
            onExternalDrop={(date, id) => {
              for (const [projectId, ws] of workspaces) {
                const item = ws.workItems.find((candidate) => candidate.id === id)
                if (!item || !shownIds.has(projectId)) continue
                void ws.rescheduleWorkItem(item, scheduleTaskOn(date))
              }
            }}
            axisMarks={marks}
            onAxisMarkActivate={(id, element) => {
              markRef.current = element
              setMeeting(id)
            }}
          />
        </div>
        <Popover
          open={openWeek !== null}
          onClose={() => setMeeting(null)}
          anchorRef={markRef}
          label={openWeek ? meetingWeekLabel(openWeek) : ''}
        >
          {openWeek && (
            <div className="timeline-overview__meeting">
              <p className="timeline-overview__meeting-title">{meetingWeekLabel(openWeek)}</p>
              <ul>
                {openWeek.milestones.map((milestone) => (
                  <li key={milestone.milestoneId}>
                    <button
                      type="button"
                      className="timeline-overview__meeting-item"
                      onClick={() => navigate(projectPath(milestone.projectId, 'timeline'))}
                    >
                      <ProjectMark project={byProject.get(milestone.projectId)} />
                      <span>
                        {t('views:timelineOverview.meetingItem', {
                          name: milestone.name,
                          project: projectName(milestone.projectId),
                          date: longDate(milestone.targetDate)
                        })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Popover>
      </>
    )
  }

  const subtitle =
    weeks.length > 0
      ? t('views:timelineOverview.subtitleMeeting', {
          weeks: t('views:timelineOverview.weekCount', { count: weeks.length })
        })
      : t('views:timelineOverview.subtitle')

  return (
    <div ref={rootRef} className="timeline-view timeline-overview">
      <PageHeader title={t('views:timelineOverview.title')} subtitle={subtitle} />
      {nav}
      {body}
      {opened
        .filter((projectId) => shownIds.has(projectId))
        .map((projectId) => (
          <OpenedProjectPlan
            key={projectId}
            projectId={projectId}
            workspaces={workspaces}
            onChange={bump}
          />
        ))}
    </div>
  )
}
