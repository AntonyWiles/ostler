import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type {
  HomeChecklistItem,
  HomeDay,
  HomeTask,
  MyDayLeftOver,
  NeedsYouEntry,
  PlanningWorkItemStatus
} from '@shared/ostler-api'
import { withoutMyDay } from '@shared/planning/my-day'
import { daysFromToday, formatIsoDate, formatIsoDateShort } from '@shared/dates'
import { taskStatusLabel } from '@shared/task-labels'
import { visibleStatuses } from '@shared/board-columns'
import { useAllProjectColumns } from '../../context/ColumnsContext'
import { useOstler } from '../../context/OstlerContext'
import { usePeople } from '../../context/PeopleContext'
import { PERF_MARKS } from '@shared/perf-marks'
import { useRenderedMark } from '../../lib/perf-marks'
import { useHomeFeed } from '../../hooks/useHomeFeed'
import { useToday } from '../../hooks/useToday'
import { TodayEvents } from '../../components/calendar-events/TodayEvents'
import { usePrintMyWeek } from '../../hooks/usePrintMyWeek'
import { useRepeatNotice } from '../../hooks/planning/useRepeatNotice'
import {
  homePath,
  myWorkPath,
  projectOpenPath,
  projectPath,
  taskPath,
  timelineOverviewPath,
  goalsPath,
  weeklyReviewPath
} from '../../navigation/paths'
import { relativeTimeText } from '../../ui/date-text'
import { HomeProjects, ProjectsLayoutSwitch, useProjectsLayout } from './HomeProjects'
import { TaskLink, TaskPeekProvider } from '../planning/TaskPeek'
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  IconButton,
  InlineAlert,
  Menu,
  STATUS_ICONS,
  Section,
  Skeleton,
  relativeDateText,
  useToast
} from '../../ui'
import {
  CalendarClock,
  ClipboardCheck,
  AppWindow,
  Ellipsis,
  FileDown,
  FolderKanban,
  History,
  ListPlus,
  Plus,
  Printer,
  Sunrise
} from '../../ui/icons'
import { RescheduleDialog } from '../../components/reschedule/RescheduleDialog'
import { PlanMyDayDialog } from '../../components/my-day/PlanMyDayDialog'
import { useAddToMyDay } from '../../hooks/useMyDay'
import { MyDaySection } from './MyDaySection'
import { useAllSubprojects } from '../../hooks/useAllSubprojects'
import { ChecklistItemRows } from './ChecklistItemRows'
import { HOME_LIST_LIMIT, HomeListMore, shareLimit } from './HomeListMore'
import { listDayName } from './my-day-text'
import { NewProjectWizardLazy as NewProjectWizard } from '../../components/NewProjectWizardLazy'
import { useOpenDemoProject } from '../../hooks/useOpenDemoProject'
import { DemoProjectsOffer } from './DemoProjectsOffer'
import { GettingStartedCard } from './GettingStartedCard'
import { BriefingCard } from './BriefingCard'
import { ProgressCard } from './ProgressCard'
import { HomeCountdowns } from './HomeCountdowns'
import { WaitingForSignOff } from './WaitingForSignOff'
import { useShowProgress } from '../../hooks/useShowProgress'
import { BRIEFING_SPANS, leaveHome, openHome, type BriefingSpan } from './last-looked'
import { NeedsYouList, type NeedsYouItem } from '../../components/NeedsYouList'
import { PlanDialog } from '../planning/PlanDialog'
import { QuickAddForm } from '../../components/quick-add/QuickAddForm'
import { useOpenInNewWindow, usePopOutRoute } from '../../shell/pop-out'
import './HomeView.css'
import { t } from '@shared/i18n'
import { formatDate } from '@shared/format'

/**
 * Home, the start page: a
 * greeting with Me's name and the date, quick add, Today (overdue, due
 * today and in progress), Upcoming (the next seven days, by day), what needs
 * you and the projects, across every project. Main answers each list in one
 * call and pushes `home` when any of it may have changed.
 */
export function HomeView() {
  const { projects, areas, loading, refreshProjects } = useOstler()
  const navigate = useNavigate()
  const openDemoProject = useOpenDemoProject()
  const [creatingProject, setCreatingProject] = useState(false)
  const [rescheduling, setRescheduling] = useState(false)
  const [planning, setPlanning] = useState(false)
  // A plan waiting for approval opens here, in its dialog (N9.3b).
  const [openPlan, setOpenPlan] = useState<{ projectId: string; sessionId: string } | null>(null)
  const [projectsLayout, setProjectsLayout] = useProjectsLayout()
  const people = usePeople()
  const today = useToday()
  const printMyWeek = usePrintMyWeek()
  const popOut = usePopOutRoute() !== null
  const openInNewWindow = useOpenInNewWindow()
  // Show my progress (N3.6): while it is off, Home asks for nothing more.
  const showProgress = useShowProgress()
  const work = useHomeFeed(() => window.ostlerAPI.getMyWork(today), [today], 'home:my-work')
  const needs = useHomeFeed(() => window.ostlerAPI.getNeedsYou(), [], 'home:needs-you')
  // Wrapped, so "not read yet" (null) differs from "no review yet" (record: null).
  const lastReview = useHomeFeed(
    async () => {
      const result = await window.ostlerAPI.getLastWeeklyReview()
      return result.ok ? { ok: true as const, value: { record: result.value } } : result
    },
    [],
    'home:last-review'
  )
  const name = people.me?.name.split(/\s+/)[0]
  const hasOverdueTask = work.value?.today.some((task) => task.reason === 'overdue') ?? false
  const myDay = work.value?.myDay ?? []
  // Dated checklist items (N2.2); overdue ones count as overdue.
  const todayItems = work.value?.todayItems ?? []
  const myDayIds = new Set(myDay.map((task) => task.id))
  const planButton = (
    <Button size="sm" icon={Sunrise} onClick={() => setPlanning(true)}>
      {myDay.length > 0 ? t('views:myDay.replan') : t('views:myDay.plan')}
    </Button>
  )
  // Read once, when Home opens: the span to brief, or none (N1.6).
  const [briefing, setBriefing] = useState<{ since: number; away: boolean } | null>(() => {
    const since = openHome(Date.now())
    return since === null ? null : { since, away: true }
  })
  // Leaving Home counts as having looked, so the next card starts from here.
  useEffect(() => () => leaveHome(Date.now()), [])
  const dismissBriefing = () => {
    leaveHome(Date.now(), true)
    setBriefing(null)
  }
  const showWhatChanged = (hours: BriefingSpan) =>
    setBriefing({ since: Date.now() - hours * 60 * 60 * 1000, away: false })
  const empty = !loading && projects.length === 0
  useRenderedMark(
    PERF_MARKS.homeRendered,
    empty || (work.value !== null && needs.value !== null),
    'home'
  )

  return (
    <TaskPeekProvider>
      <div className="ostler-home">
        <header className="ostler-home-header">
          <div>
            <h1>{name ? `${greeting(new Date())}, ${name}` : greeting(new Date())}</h1>
            <p>
              {formatDate(new Date(), {
                weekday: 'long',
                day: 'numeric',
                month: 'long'
              })}
            </p>
          </div>
          {!empty && (
            <div className="ostler-home-header-actions">
              <span className="ostler-home-last-review">
                {lastReview.value === null
                  ? ''
                  : lastReview.value.record
                    ? t('views:weeklyReview.lastReview', {
                        when: relativeTimeText(lastReview.value.record.finishedAt)
                      })
                    : t('views:weeklyReview.noReviewYet')}
              </span>
              <Button size="sm" icon={ClipboardCheck} onClick={() => navigate(weeklyReviewPath())}>
                {t('views:weeklyReview.start')}
              </Button>
              <Menu
                label={t('views:briefing.menu')}
                renderTrigger={(trigger) => (
                  <IconButton {...trigger} icon={Ellipsis} label={t('views:briefing.menu')} />
                )}
                items={[
                  ...BRIEFING_SPANS.map((hours) => ({
                    label: SPAN_LABELS[hours](),
                    icon: History,
                    onSelect: () => showWhatChanged(hours)
                  })),
                  { type: 'separator' as const },
                  {
                    label: t('views:myWeek.print'),
                    icon: Printer,
                    onSelect: () => void printMyWeek('printer')
                  },
                  {
                    label: t('views:myWeek.savePdf'),
                    icon: FileDown,
                    onSelect: () => void printMyWeek('pdf')
                  },
                  // Open in new window (N5.8a), except in Home's own pop-out.
                  ...(popOut
                    ? []
                    : [
                        { type: 'separator' as const },
                        {
                          label: t('navigation:popOut.openInNewWindow'),
                          icon: AppWindow,
                          onSelect: () => void openInNewWindow(homePath())
                        }
                      ])
                ]}
              />
            </div>
          )}
        </header>

        {!empty && briefing && (
          <BriefingCard since={briefing.since} away={briefing.away} onDismiss={dismissBriefing} />
        )}

        {empty ? (
          <EmptyState
            icon={FolderKanban}
            title={t('views:homeView.addProjectBegin')}
            description={t('views:homeView.projectHoldsTasksMilestones')}
            action={
              <Button variant="primary" icon={Plus} onClick={() => setCreatingProject(true)}>
                {t('views:homeView.newProject')}
              </Button>
            }
            secondaryAction={
              <Button onClick={() => void openDemoProject()}>
                {t('views:homeView.openSampleProject')}
              </Button>
            }
          />
        ) : (
          <>
            <GettingStartedCard />
            <DemoProjectsOffer />
            <HomeCountdowns today={today} />
            <QuickAddForm />

            {work.value?.leftOver && (
              <LeftOverNotice
                leftOver={work.value.leftOver}
                today={today}
                onChanged={() => void work.reload()}
              />
            )}

            <WaitingForSignOff />

            {myDay.length > 0 && (
              <Section
                title={t('views:myDay.title')}
                description={t('views:myDay.description')}
                actions={planButton}
              >
                <MyDaySection tasks={myDay} today={today} onChanged={() => void work.reload()} />
              </Section>
            )}

            <div className="ostler-home-columns">
              <Section
                title={t('views:homeView.today')}
                actions={
                  <>
                    {myDay.length === 0 && planButton}
                    {hasOverdueTask && (
                      <Button size="sm" icon={CalendarClock} onClick={() => setRescheduling(true)}>
                        {t('views:reschedule.open')}
                      </Button>
                    )}
                    <Link to={myWorkPath()}>{t('views:homeView.seeAllMyWork')}</Link>
                  </>
                }
              >
                <TodayEvents today={today} />
                {work.value === null ? (
                  <Skeleton lines={3} />
                ) : work.value.today.length === 0 && todayItems.length === 0 ? (
                  <p className="ostler-home-quiet">{t('views:homeView.nothingDueTodayTasks')}</p>
                ) : (
                  <TodayRows
                    tasks={withoutMyDay(work.value.today, myDay)}
                    items={todayItems}
                    myDayIds={myDayIds}
                    onChanged={() => void work.reload()}
                  />
                )}
              </Section>

              <Section
                title={t('views:homeView.upcoming')}
                description={t('views:homeView.dueNext7Days')}
              >
                {work.value === null ? (
                  <Skeleton lines={3} />
                ) : work.value.upcoming.length === 0 ? (
                  <p className="ostler-home-quiet">{t('views:homeView.nothingDueNext7')}</p>
                ) : (
                  <UpcomingDays
                    days={work.value.upcoming}
                    myDayIds={myDayIds}
                    onChanged={() => void work.reload()}
                  />
                )}
              </Section>
            </div>

            {showProgress && <ProgressCard today={today} />}

            <Section title={t('views:homeView.needs')}>
              {needs.value === null ? (
                <Skeleton lines={3} />
              ) : needs.value.length === 0 ? (
                <p className="ostler-home-quiet">{t('views:homeView.nothingWaiting')}</p>
              ) : (
                <NeedsYouRows entries={needs.value} projects={projects} onOpenPlan={setOpenPlan} />
              )}
            </Section>

            <Section
              title={t('views:homeView.projects')}
              actions={
                <>
                  <ProjectsLayoutSwitch value={projectsLayout} onChange={setProjectsLayout} />
                  <Link to={timelineOverviewPath()}>{t('views:timelineOverview.open')}</Link>
                  <Link to={goalsPath()}>{t('views:goals.open')}</Link>
                </>
              }
            >
              <HomeProjects projects={projects} areas={areas} layout={projectsLayout} />
            </Section>
          </>
        )}
        <PlanMyDayDialog
          open={planning}
          onClose={() => setPlanning(false)}
          today={today}
          onChanged={() => void work.reload()}
        />
        <RescheduleDialog
          open={rescheduling}
          onClose={() => setRescheduling(false)}
          onChanged={() => void work.reload()}
        />
        {openPlan && (
          <PlanDialog
            projectId={openPlan.projectId}
            sessionId={openPlan.sessionId}
            onClose={() => setOpenPlan(null)}
            onDecided={() => void needs.reload()}
          />
        )}
        {creatingProject && (
          <NewProjectWizard
            onClose={() => setCreatingProject(false)}
            onCreated={() => void refreshProjects()}
            onOpen={(project) => {
              setCreatingProject(false)
              navigate(projectOpenPath(project.id, project.stage))
            }}
          />
        )}
      </div>
    </TaskPeekProvider>
  )
}

const SPAN_LABELS: Record<BriefingSpan, () => string> = {
  24: () => t('views:briefing.showLast24Hours'),
  72: () => t('views:briefing.showLast3Days'),
  168: () => t('views:briefing.showLast7Days')
}

/** "Good morning" and so on, by the hour. */
export function greeting(now: Date): string {
  const hour = now.getHours()
  if (hour < 12) return t('views:homeView.goodMorning')
  if (hour < 18) return t('views:homeView.goodAfternoon')
  return t('views:homeView.goodEvening')
}

/** "Tomorrow", or "Friday 9 October". */
function dayName(date: string): string {
  if (daysFromToday(date) === 1) return t('common:date.tomorrow')
  return formatIsoDate(date, { weekday: 'long', day: 'numeric', month: 'long' })
}

function needsYouItem(
  entry: NeedsYouEntry,
  projects: ReturnType<typeof useOstler>['projects'],
  openPlan: (plan: { projectId: string; sessionId: string }) => void
): NeedsYouItem {
  const project = projects.find((candidate) => candidate.id === entry.projectId)
  const sessionId = entry.sessionId
  if (entry.kind === 'plan' && sessionId) {
    return {
      id: entry.key,
      kind: entry.kind,
      title: entry.title,
      context: project?.name,
      color: project?.color,
      onOpen: () => openPlan({ projectId: entry.projectId, sessionId })
    }
  }
  // A reviewed session says where its reviewer got to (N9.5b).
  const reviewer = entry.reviewer ? REVIEWER_TEXT[entry.reviewer] : null
  return {
    id: entry.key,
    kind: entry.kind,
    title: entry.title,
    context: reviewer ? [project?.name, reviewer].filter(Boolean).join(' · ') : project?.name,
    color: project?.color,
    to:
      entry.kind === 'blocked' && entry.taskId
        ? taskPath(entry.projectId, entry.taskId)
        : projectPath(entry.projectId, 'agents')
  }
}

/** Today's tasks, then its dated checklist items: the first `HOME_LIST_LIMIT` of them. */
function TodayRows({
  tasks,
  items,
  myDayIds,
  onChanged
}: {
  tasks: HomeTask[]
  items: HomeChecklistItem[]
  myDayIds: ReadonlySet<string>
  onChanged: () => void
}) {
  const [all, setAll] = useState(false)
  const [taskCount, itemCount] = shareLimit([tasks.length, items.length], HOME_LIST_LIMIT, all)
  return (
    <>
      <TaskRows tasks={tasks.slice(0, taskCount)} myDayIds={myDayIds} onChanged={onChanged} />
      <ChecklistItemRows items={items.slice(0, itemCount)} onChanged={onChanged} />
      <HomeListMore
        total={tasks.length + items.length}
        expanded={all}
        onToggle={() => setAll(!all)}
      />
    </>
  )
}

/** The next seven days, by day: the first `HOME_LIST_LIMIT` rows across them. */
function UpcomingDays({
  days,
  myDayIds,
  onChanged
}: {
  days: HomeDay[]
  myDayIds: ReadonlySet<string>
  onChanged: () => void
}) {
  const [all, setAll] = useState(false)
  const counts = shareLimit(
    days.flatMap((day) => [day.tasks.length, (day.items ?? []).length]),
    HOME_LIST_LIMIT,
    all
  )
  const total = days.reduce((sum, day) => sum + day.tasks.length + (day.items ?? []).length, 0)
  return (
    <>
      {days.map((day, index) => {
        const taskCount = counts[index * 2]
        const itemCount = counts[index * 2 + 1]
        if (taskCount + itemCount === 0) return null
        return (
          <section key={day.date} className="ostler-home-day" aria-label={dayName(day.date)}>
            <h3>{dayName(day.date)}</h3>
            <TaskRows
              tasks={day.tasks.slice(0, taskCount)}
              myDayIds={myDayIds}
              onChanged={onChanged}
            />
            <ChecklistItemRows
              items={(day.items ?? []).slice(0, itemCount)}
              showDue={false}
              onChanged={onChanged}
            />
          </section>
        )
      })}
      <HomeListMore total={total} expanded={all} onToggle={() => setAll(!all)} />
    </>
  )
}

/** What needs you: the first `HOME_LIST_LIMIT`, each made into a row only when shown. */
function NeedsYouRows({
  entries,
  projects,
  onOpenPlan
}: {
  entries: NeedsYouEntry[]
  projects: ReturnType<typeof useOstler>['projects']
  onOpenPlan: (plan: { projectId: string; sessionId: string }) => void
}) {
  const [all, setAll] = useState(false)
  const [count] = shareLimit([entries.length], HOME_LIST_LIMIT, all)
  return (
    <>
      <NeedsYouList
        items={entries.slice(0, count).map((entry) => needsYouItem(entry, projects, onOpenPlan))}
      />
      <HomeListMore total={entries.length} expanded={all} onToggle={() => setAll(!all)} />
    </>
  )
}

const REVIEWER_TEXT: Record<NonNullable<NeedsYouEntry['reviewer']>, string> = {
  get running() {
    return t('views:homeView.reviewerOverdue')
  },
  get overdue() {
    return t('views:homeView.reviewerOverdue')
  },
  get reported() {
    return t('views:homeView.reviewerReported')
  },
  get failed() {
    return t('views:homeView.reviewerFailed')
  }
}

const REASON_TEXT: Record<NonNullable<HomeTask['reason']>, string> = {
  get overdue() {
    return t('views:homeView.overdue')
  },
  get today() {
    return t('views:homeView.dueToday')
  },
  get 'new-today'() {
    return t('views:homeView.newToday')
  },
  get 'in-progress'() {
    return t('views:homeView.progress')
  }
}

/** Task rows: status (changed in place), title, project, due and assignee. */
function TaskRows({
  tasks,
  myDayIds,
  onChanged
}: {
  tasks: HomeTask[]
  myDayIds: ReadonlySet<string>
  onChanged: () => void
}) {
  const addToMyDay = useAddToMyDay(onChanged)
  const people = usePeople()
  const { byProject } = useAllProjectColumns()
  const { labelFor } = useAllSubprojects([...new Set(tasks.map((task) => task.projectId))])
  const { toast } = useToast()
  // The list is read again below, so the notice needs no reload of its own.
  const noticeRepeat = useRepeatNotice(async () => {})

  const setStatus = async (task: HomeTask, status: PlanningWorkItemStatus) => {
    const result = await window.ostlerAPI.updatePlanningWorkItem(task.id, { status })
    if (!result.ok) {
      toast({
        title: t('views:homeView.couldntChange', { taskTitle: task.title }),
        body: result.error,
        tone: 'danger'
      })
      return
    }
    noticeRepeat(result.value)
    onChanged()
  }

  return (
    <ul className="ostler-home-tasks" aria-label={t('views:homeView.tasks')}>
      {tasks.map((task) => {
        const assignee = task.assigneeId ? people.byId.get(task.assigneeId) : undefined
        const columns = byProject[task.projectId]
        const label = (status: PlanningWorkItemStatus) => taskStatusLabel(status, columns)
        const due = task.targetDate
          ? relativeDateText(task.targetDate) || formatIsoDateShort(task.targetDate)
          : null
        return (
          <li key={task.id} className="ostler-home-task">
            <Menu
              label={t('views:homeView.status')}
              renderTrigger={(trigger) => (
                <IconButton
                  {...trigger}
                  size="sm"
                  className={`ostler-home-task__status ui-status-badge--${task.status}`}
                  icon={STATUS_ICONS[task.status]}
                  disabled={task.linked}
                  label={
                    task.linked
                      ? t('views:homeView.queuedAgentStatusFollows', {
                          taskStatusLabel: label(task.status)
                        })
                      : t('views:homeView.changeStatus', {
                          taskStatusLabel: label(task.status)
                        })
                  }
                />
              )}
              items={visibleStatuses(columns, task.status).map((status) => ({
                label: label(status),
                icon: STATUS_ICONS[status],
                disabled: status === task.status,
                onSelect: () => void setStatus(task, status)
              }))}
            />
            <TaskLink
              className="ostler-home-task__title"
              projectId={task.projectId}
              taskId={task.id}
            >
              {task.title}
            </TaskLink>
            <span className="ostler-home-task__meta">
              <span className="ostler-home-task__project">
                <span
                  className="ostler-home-task__dot"
                  style={{ background: task.projectColor }}
                  aria-hidden="true"
                />
                {labelFor(task.projectName, task.subprojectId)}
              </span>
              {task.reason === 'new-today' && (
                <Badge tone="accent">{REASON_TEXT['new-today']}</Badge>
              )}
              {(task.reason === 'in-progress' || task.reason === 'new-today') &&
              !due &&
              task.status === 'active' ? (
                <span>{REASON_TEXT['in-progress']}</span>
              ) : due ? (
                <span className={task.reason === 'overdue' ? 'is-overdue' : undefined}>{due}</span>
              ) : null}
              {assignee ? (
                <Avatar
                  size="sm"
                  name={assignee.name}
                  initials={assignee.initials}
                  color={assignee.color}
                />
              ) : (
                <span className="ostler-home-task__nobody">{t('views:homeView.unassigned')}</span>
              )}
              {!myDayIds.has(task.id) && (
                <IconButton
                  size="sm"
                  icon={ListPlus}
                  label={t('views:myDay.add')}
                  onClick={() => void addToMyDay(task)}
                />
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The next morning (N1.4): the unfinished tasks of the last day that had a
 * list, offered again. Nothing moves until the person chooses.
 */
function LeftOverNotice({
  leftOver,
  today,
  onChanged
}: {
  leftOver: MyDayLeftOver
  today: string
  onChanged: () => void
}) {
  const { toast, toastUndo } = useToast()
  const [busy, setBusy] = useState(false)
  const count = leftOver.tasks.length

  const addToToday = async () => {
    setBusy(true)
    const added: string[] = []
    for (const task of leftOver.tasks) {
      const result = await window.ostlerAPI.addToMyDay(task.id, { date: today })
      if (result.ok && !result.value.already) added.push(task.id)
    }
    setBusy(false)
    onChanged()
    toastUndo(t('views:myDay.addedToToday', { count: added.length }), async () => {
      for (const id of added) await window.ostlerAPI.removeFromMyDay(id, today)
      onChanged()
    })
  }

  const letGo = async () => {
    setBusy(true)
    const result = await window.ostlerAPI.letGoMyDay(
      leftOver.date,
      leftOver.tasks.map((task) => task.id)
    )
    setBusy(false)
    if (!result.ok) {
      toast({ title: t('views:myDay.couldntChange'), body: result.error, tone: 'danger' })
      return
    }
    onChanged()
    toast({ title: t('views:myDay.letGoDone', { count }) })
  }

  return (
    <InlineAlert
      tone="info"
      title={t('views:myDay.leftOver', { count, day: listDayName(leftOver.date, today) })}
    >
      <div className="ostler-my-day-left">
        <span>{t('views:myDay.leftOverHint')}</span>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void addToToday()}>
          {t('views:myDay.addToToday')}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void letGo()}>
          {t('views:myDay.letGo')}
        </Button>
      </div>
    </InlineAlert>
  )
}
