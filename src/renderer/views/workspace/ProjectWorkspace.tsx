import { Suspense, useCallback, useEffect, useRef, useState, type ComponentProps } from 'react'
import type { TimelineViewSettings } from '../planning/timeline/timeline-settings'
import type { PrintRequest } from '@shared/ostler-api'
import { isPrintableView } from '@shared/print-route'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useOstler } from '../../context/OstlerContext'
import { ProjectColumnsScope } from '../../context/ColumnsContext'
import { sessionOwnsTask, usePlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { scopedWorkspace } from '../../hooks/scoped-workspace'
import { useTabsThatFit } from '../../hooks/useTabsThatFit'
import { cx } from '../../ui/cx'
import { useAiNextTasks } from '../../hooks/planning/useAiNextTasks'
import {
  canPlanAndSplit,
  ProjectFeaturesProvider,
  useFeatures,
  useViewContext
} from '../../navigation/features'
import {
  allProjectViews,
  isSubprojectScoped,
  openableProjectViews,
  projectTabs,
  projectViewDescription,
  projectViews,
  projectViewToOpen,
  type ProjectViewId
} from '../../navigation/registry'
import {
  clearProjectTabPrefs,
  effectiveTabPrefs,
  readProjectTabPrefs,
  writeTabPrefs
} from '../../navigation/tab-prefs'
import {
  SUBPROJECT_PARAM,
  homePath,
  parseAppPath,
  projectPath,
  subprojectPath
} from '../../navigation/paths'
import { readLastView, writeLastView, writeLastProject } from '../../navigation/last-view'
import { useAppCommands } from '../../shell/app-commands'
import { projectViewKeys, shortcut, useShortcuts } from '../../navigation/shortcuts'
import { recordGettingStarted } from '../../help/record-getting-started'
import { useProjectActions } from '../../components/ProjectActions'
import { useQuickAdd } from '../../components/quick-add/QuickAddProvider'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import {
  Button,
  EmptyState,
  InlineAlert,
  Menu,
  Spinner,
  Tabs,
  useToast,
  type MenuEntry,
  type MenuItem
} from '../../ui'
import {
  AppWindow,
  ChevronDown,
  Icon,
  Bot,
  Camera,
  FileDown,
  FileSpreadsheet,
  FolderKanban,
  Plus,
  Presentation,
  Printer,
  Replace,
  History
} from '../../ui/icons'
import type { ViewOutput } from '../../navigation/view-props'
import { PERF_MARKS } from '@shared/perf-marks'
import { useRenderedMark } from '../../lib/perf-marks'
import { ProjectHeader } from './ProjectHeader'
import { RunModelDialog } from '../planning/RunModelDialog'
import { RunPlaybookDialog, runPlaybookBlocker } from '../../task-templates/RunPlaybookDialog'
import { lazyLayer, lazyNamed, useLatch } from '../../lib/lazy-named'
import { usePeople } from '../../context/PeopleContext'
import { templateFormValues } from '@shared/task-templates'
import { todayIsoDate } from '@shared/dates'
import './ProjectWorkspace.css'
import { useEditInExcel } from '../../components/excel/useEditInExcel'
import { takePendingEventTask } from '../../hooks/event-task'
import { usePins } from '../../pins/PinsProvider'
import { useOpenInNewWindow, usePopOutRoute } from '../../shell/pop-out'
import { useReportTitleWorkstream } from '../../shell/title-workstream'
import { t } from '@shared/i18n'

/**
 * A project's workspace at `/projects/:projectId/:view` (and
 * `/projects/:projectId/tasks/:taskId`): its header, its views as tabs from
 * the registry, and the dialogs every view shares. The route is the one
 * source of truth for which project and which view are current.
 */
export function ProjectWorkspace() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const { projects, loading, refreshProjects } = useOstler()
  const project = projects.find((candidate) => candidate.id === projectId) ?? null

  if (!project) {
    if (loading) {
      return (
        <div className="ostler-workspace-loading">
          <Spinner label={t('navigation:projectWorkspace.loadingProject')} />
        </div>
      )
    }
    return <ProjectNotFound />
  }
  // Keyed by project: switching projects starts a fresh workspace, as the
  // old Planning page did when its drop-down changed.
  return (
    <ProjectFeaturesProvider project={project}>
      <ProjectColumnsScope projectId={project.id}>
        <Workspace key={project.id} project={project} onRenamed={() => void refreshProjects()} />
      </ProjectColumnsScope>
    </ProjectFeaturesProvider>
  )
}

/**
 * Marks the project view as rendered (P9.1). It sits inside the view's
 * Suspense boundary, so it commits only once the view's code has loaded,
 * and waits for the project's tasks.
 */
function ViewRenderedMark({ ready, viewKey }: { ready: boolean; viewKey: string }) {
  useRenderedMark(PERF_MARKS.projectViewRendered, ready, viewKey)
  return null
}

/**
 * Says so when this PC only views a shared project (D9). The database refuses
 * the edits themselves, so no control needs to be hidden for this to hold.
 */
export function ViewerNotice({ projectId }: { projectId: string }) {
  const [role, setRole] = useState<'viewer' | 'contributor' | null>(null)
  useEffect(() => {
    const load = () =>
      void window.ostlerAPI.getShareState(projectId).then((result) => {
        const mine = result.ok ? result.value?.myRole : null
        setRole(mine === 'viewer' || mine === 'contributor' ? mine : null)
      })
    load()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'sharing' && update.projectId === projectId) load()
    })
  }, [projectId])
  if (!role) return null
  return (
    <InlineAlert tone="info">
      {t(
        role === 'contributor'
          ? 'projects:projectSharing.contributorNotice'
          : 'projects:projectSharing.viewerNotice'
      )}
    </InlineAlert>
  )
}

function ProjectNotFound() {
  const navigate = useNavigate()
  return (
    <EmptyState
      icon={FolderKanban}
      title={t('navigation:projectWorkspace.projectNotFound')}
      description={t('navigation:projectWorkspace.mayHaveBeenRemoved')}
      action={
        <Button onClick={() => navigate(homePath())}>
          {t('navigation:projectWorkspace.goHome')}
        </Button>
      }
    />
  )
}

// The dialogs every view shares load the first time they open (P9.1): the
// AI dialogs, the plan wizard and the agent review screens are big, and most
// sessions never open them.
/**
 * Views More opens without giving them a tab (places you visit, not work in),
 * though the Tabs checklist can still give them one.
 */
const UNPINNED_VIEWS: ReadonlySet<ProjectViewId> = new Set<ProjectViewId>(['archive', 'bin'])

const AgentPlanWizard = lazyNamed(() => import('../planning/AgentPlanWizard'), 'AgentPlanWizard')
const AINextTasksModal = lazyNamed(() => import('../planning/AINextTasksModal'), 'AINextTasksModal')
const AiBreakdownDialog = lazyNamed(
  () => import('../planning/AiBreakdownDialog'),
  'AiBreakdownDialog'
)
const AiDecisionDialog = lazyNamed(() => import('../planning/AiDecisionDialog'), 'AiDecisionDialog')
const ExportTimelineSlidesDialog = lazyNamed(
  () => import('../../components/share/ExportTimelineSlidesDialog'),
  'ExportTimelineSlidesDialog'
)
const WontDoDialog = lazyLayer(() => import('../planning/WontDoDialog'), 'WontDoDialog')
const BlockTimeFor = lazyLayer(
  () => import('../../components/time-blocks/BlockTimeDialog'),
  'BlockTimeFor'
)
const MarkDuplicateDialog = lazyLayer(
  () => import('../planning/MarkDuplicateDialog'),
  'MarkDuplicateDialog'
)
const CreateRecordModal = lazyNamed(
  () => import('../planning/CreateRecordModal'),
  'CreateRecordModal'
)
const PlanGridDialog = lazyNamed(() => import('../planning/PlanGridDialog'), 'PlanGridDialog')
const SaveBaselineDialog = lazyNamed(
  () => import('../planning/baselines/BaselineDialogs'),
  'SaveBaselineDialog'
)
const BaselinesDialog = lazyNamed(
  () => import('../planning/baselines/BaselineDialogs'),
  'BaselinesDialog'
)
const LiveTranscriptModal = lazyNamed(
  () => import('../planning/LiveTranscriptModal'),
  'LiveTranscriptModal'
)
const SessionReviewModal = lazyNamed(
  () => import('../planning/SessionReviewModal'),
  'SessionReviewModal'
)
const FindReplaceDialog = lazyNamed(
  () => import('../../components/find-replace/FindReplaceDialog'),
  'FindReplaceDialog'
)
const WorkItemDrawer = lazyNamed(() => import('../planning/WorkItemDrawer'), 'WorkItemDrawer')

function Workspace({
  project,
  onRenamed
}: {
  project: NonNullable<ReturnType<typeof useOstler>['projects'][number]>
  onRenamed: () => void
}) {
  const projectId = project.id
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const features = useFeatures()
  const ctx = useViewContext(project)

  const here = parseAppPath(location.pathname)
  const routeView = here?.kind === 'project' ? here.view : null
  const taskId = here?.kind === 'task' ? here.taskId : null
  // Without a view in the path (a bare project link, a task link): the view
  // used last for this project, or Overview the first time.
  // A view in the path opens even when it is not offered (a link, search or
  // a pin asked for it); the view used last opens only if it is offered.
  const view: ProjectViewId = projectViewToOpen(routeView, readLastView(projectId), ctx)
  // "Try another view" on Home's getting-started checklist (P8.1).
  useEffect(() => {
    if (view === 'list' || view === 'calendar' || view === 'timeline')
      recordGettingStarted('triedView')
  }, [view])

  // The workstream open now stays open from view to view. A view that always shows the whole
  // project (the Library, decisions) keeps it in the address and says so in the header, so going
  // back to the Board finds the workstream still open.
  const scopeParam = searchParams.get(SUBPROJECT_PARAM)
  const setView = useCallback(
    (next: ProjectViewId) =>
      navigate(
        scopeParam ? subprojectPath(projectId, scopeParam, next) : projectPath(projectId, next)
      ),
    [navigate, projectId, scopeParam]
  )
  const ws = usePlanningWorkspace(projectId, navigate, {
    view,
    setView,
    safetyPoll: features.agents
  })
  // The title bar names the open workstream: Project › Workstream › View.
  useReportTitleWorkstream(ws.subprojectScope?.name ?? null)
  const nextTasks = useAiNextTasks(projectId, () => ws.loadPlanning())
  // A New task window handed its task back: it opens here as it was left (main window only).
  const inPopOutWindow = usePopOutRoute() !== null
  const wsHolder = useRef(ws)
  wsHolder.current = ws
  useEffect(() => {
    if (inPopOutWindow) return
    const takeBack = () =>
      void window.ostlerAPI.takeReturnedNewTask(projectId).then((result) => {
        if (result.ok && result.value) wsHolder.current.applyNewTaskDraft(result.value)
      })
    takeBack()
    return window.ostlerAPI.onNewTaskReturned((returned) => {
      if (returned === projectId) takeBack()
    })
  }, [projectId, inPopOutWindow])
  const popOutNewTask = async () => {
    const result = await window.ostlerAPI.openNewTaskWindow(projectId, ws.getNewTaskDraft())
    // Only a draft that moved leaves here; with the project's window already open it stays.
    if (result.ok && result.value.opened) ws.closeCreate()
  }
  const actions = useProjectActions()
  const quickAdd = useQuickAdd()
  const { toast } = useToast()
  // What the List or Timeline shows now, for Print and Export (P6.1).
  const viewOutput = useRef<ViewOutput | null>(null)
  const reportView = useCallback((output: ViewOutput | null) => {
    viewOutput.current = output
  }, [])

  const print = async (output: PrintRequest['output']) => {
    if (!isPrintableView(view)) return
    const result = await window.ostlerAPI.printProjectView(projectId, {
      view,
      config: view === 'overview' || view === 'shopping' ? undefined : viewOutput.current?.config,
      output
    })
    if (!result.ok)
      toast({
        title: t('navigation:projectWorkspace.couldnTPrint'),
        body: result.error,
        tone: 'danger'
      })
    else if (result.value)
      toast({
        title: t('navigation:projectWorkspace.savedPdf'),
        body: result.value,
        tone: 'success'
      })
  }

  // Edit in Excel (N2.8): the List's rows in its columns, or every task.
  const excel = useEditInExcel(projectId, () => ws.loadPlanning())
  const editInExcel = () =>
    void excel.start(
      view === 'list' && viewOutput.current
        ? {
            taskIds: viewOutput.current.taskIds,
            columns: viewOutput.current.columns,
            fileName: t('navigation:projectWorkspace.list', { projectName: project.name })
          }
        : { fileName: t('projects:projectActions.tasks', { projectName: project.name }) }
    )

  const exportView = async () => {
    const result = await window.ostlerAPI.exportTasksCsv(projectId, {
      taskIds: viewOutput.current?.taskIds,
      columns: viewOutput.current?.columns,
      fileName: t('navigation:projectWorkspace.list', { projectName: project.name })
    })
    if (!result.ok)
      toast({
        title: t('navigation:projectWorkspace.couldnTExport'),
        body: result.error,
        tone: 'danger'
      })
    else if (result.value)
      toast({
        title: t('navigation:projectWorkspace.exportedList'),
        body: result.value,
        tone: 'success'
      })
  }

  // Save a baseline and Baselines (N7.4), from the More menu.
  const [baselineDialog, setBaselineDialog] = useState<'save' | 'list' | null>(null)

  // Export to PowerPoint slide (N7.6): the Timeline's range, tasks and grouping as it shows them.
  const [slides, setSlides] = useState<
    ComponentProps<typeof ExportTimelineSlidesDialog>['view'] | null
  >(null)
  const exportSlides = () => {
    const output = viewOutput.current
    const options = (output?.config.options ?? {}) as Partial<TimelineViewSettings>
    const today = todayIsoDate()
    setSlides({
      from: output?.range?.start ?? today,
      to: output?.range?.end ?? today,
      taskIds: output?.taskIds,
      zoom: options.zoom,
      groupBy: options.groupBy,
      collapsed: options.collapsed
    })
  }

  // The tab row: the everyday views and the ones this project uses, each with
  // Ctrl+1–9. The rest are one click away in More views (registry.ts).
  const tabs = projectViews(ctx, 'tab')
  // To triage with nothing in it: still opened by a link, search or the menu bar.
  const openable = openableProjectViews(ctx)
  const current = openable.find((entry) => entry.id === view) ?? tabs[0]
  // Archive or the recycle bin without a tab of its own is only visited: the
  // tab row stays as it was, with More views underlined in place of a tab.
  const visiting = UNPINNED_VIEWS.has(current.id) && !tabs.some((tab) => tab.id === current.id)
  const [lastTabView, setLastTabView] = useState<ProjectViewId | null>(null)
  useEffect(() => {
    if (!visiting) setLastTabView(current.id)
  }, [visiting, current.id])
  const tabView = visiting ? (lastTabView ?? tabs[0].id) : current.id
  const tabRow = projectTabs(ctx, tabView)
  // Tabs that don't fit the window's width go at the top of More views,
  // rather than off the end of a row that scrolls.
  const tabBar = useRef<HTMLDivElement>(null)
  const fits = useTabsThatFit(
    tabBar,
    tabRow.map((entry) => entry.id),
    tabView
  )
  const shownTabs = tabRow.filter((entry) => fits.includes(entry.id))
  const viewItem = (entry: (typeof tabRow)[number]): MenuItem => ({
    label: entry.label,
    icon: entry.icon,
    hint: projectViewDescription(entry.id),
    shortcut: projectViewKeys(tabs.indexOf(entry)),
    onSelect: () => setView(entry.id)
  })
  const overflowItems = tabRow.filter((entry) => !fits.includes(entry.id)).map(viewItem)
  // The Tabs checklist: every offered view, ticked when it has a tab. Ticking
  // gives it a tab and opens it, unticking takes its tab away. Saved for this
  // project only once the project has its own choice, else for all projects.
  // `wasChecked`: whether the view had a tab before this click.
  const setTabChecked = (id: ProjectViewId, wasChecked: boolean) => {
    if (!wasChecked) setView(id)
    const prefs = effectiveTabPrefs(projectId) ?? { pinned: [], unpinned: [] }
    const pinned = prefs.pinned.filter((pinnedId) => pinnedId !== id)
    const unpinned = prefs.unpinned.filter((unpinnedId) => unpinnedId !== id)
    if (wasChecked) unpinned.push(id)
    else pinned.push(id)
    const scope = readProjectTabPrefs(projectId) !== null ? { projectId } : 'global'
    writeTabPrefs(scope, { pinned, unpinned })
  }
  // Archive and the recycle bin open from More without taking a tab, unless
  // given one in the checklist, where they come last.
  const hasTab = (id: ProjectViewId) => tabs.some((tab) => tab.id === id)
  const placeItems = openable
    .filter((entry) => UNPINNED_VIEWS.has(entry.id) && !hasTab(entry.id))
    .map(viewItem)
  const offeredIds = new Set(allProjectViews(ctx).map((entry) => entry.id))
  const offered = openable.filter((entry) => offeredIds.has(entry.id))
  const tabChoices = [
    ...offered.filter((entry) => !UNPINNED_VIEWS.has(entry.id)),
    ...offered.filter((entry) => UNPINNED_VIEWS.has(entry.id))
  ].map((entry): MenuItem => {
    const checked = tabs.some((tab) => tab.id === entry.id)
    return {
      label: entry.label,
      icon: entry.icon,
      checked,
      checkKind: 'checkbox',
      onSelect: () => setTabChecked(entry.id, checked)
    }
  })
  const ownPrefs = readProjectTabPrefs(projectId)
  const moreViewItems: MenuEntry[] = [
    // Tabs that don't fit the row: still tabs, so opening one leaves it be.
    ...overflowItems,
    ...(overflowItems.length > 0 ? [{ type: 'separator' as const }] : []),
    ...placeItems,
    ...(placeItems.length > 0 ? [{ type: 'separator' as const }] : []),
    {
      type: 'group',
      label: t('navigation:projectWorkspace.tabsGroup'),
      items: tabChoices
    },
    { type: 'separator' },
    {
      type: 'group',
      label: t('navigation:projectWorkspace.tabsApplyTo'),
      items: [
        {
          label: t('navigation:projectWorkspace.tabsAllProjects'),
          checked: ownPrefs === null,
          checkKind: 'radio',
          onSelect: () => clearProjectTabPrefs(projectId)
        },
        {
          label: t('navigation:projectWorkspace.tabsThisProject'),
          checked: ownPrefs !== null,
          checkKind: 'radio',
          onSelect: () =>
            writeTabPrefs(
              { projectId },
              effectiveTabPrefs(projectId) ?? { pinned: [], unpinned: [] }
            )
        }
      ]
    }
  ]

  // Remember the view, and put a usable view in the path: a bare project
  // link gets its last view, and a view that is not available here (Files
  // without a folder, Agents with agents off) falls back to Overview. Only
  // once the feature switches are known, so nothing is hidden by mistake.
  useEffect(() => {
    if (here?.kind === 'project' && routeView === view) {
      writeLastView(projectId, view)
      writeLastProject(projectId)
    }
    if (!features.loaded || here?.kind === 'task') return
    if (here?.kind !== 'project' || routeView !== view) {
      const keep = routeView === null ? Object.fromEntries(searchParams) : undefined
      navigate(projectPath(projectId, view, keep), { replace: true })
    }
  }, [features.loaded, here?.kind, routeView, view, projectId])

  // A task link opens that task's drawer once its project's tasks have
  // loaded, then settles on the view underneath it.
  useEffect(() => {
    if (!taskId) return
    const item = ws.workItems.find((candidate) => candidate.id === taskId)
    if (!item) return
    ws.openWorkItem(item)
    navigate(
      scopeParam ? subprojectPath(projectId, scopeParam, view) : projectPath(projectId, view),
      { replace: true }
    )
  }, [taskId, ws.workItems])

  // ?agentPlan=<goalId>&sources=<ids> is how the Library's "Plan work from
  // these" hands its selection on: to the plan wizard in a software project
  // with agents on, otherwise to "Break down with AI", which writes tasks for
  // people. Opened once: the parameters leave the path as it opens.
  const requestedPlanGoalId = searchParams.get('agentPlan')
  const requestedSources = searchParams.get('sources')
  const planAndSplit = canPlanAndSplit(features)
  useEffect(() => {
    if (!requestedPlanGoalId || !features.loaded || features.aiProfile === undefined) return
    const goal = ws.goals.find((candidate) => candidate.id === requestedPlanGoalId)
    if (!goal) return
    const sources = (requestedSources ?? '').split(',').filter(Boolean)
    if (planAndSplit) ws.openAgentPlanWizard(goal, sources)
    else void ws.breakDownGoal(goal, sources)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('agentPlan')
        next.delete('sources')
        return next
      },
      { replace: true }
    )
  }, [requestedPlanGoalId, requestedSources, ws.goals, planAndSplit, features.aiProfile])

  // ?newTask=1 is how the command palette starts a task in this project;
  // with &taskTemplate=<id> (N2.1) the form starts filled from that template.
  const requestedNewTask = searchParams.get('newTask')
  const requestedTemplate = searchParams.get('taskTemplate')
  const people = usePeople()
  useEffect(() => {
    if (!requestedNewTask || here?.kind !== 'project' || routeView === null) return
    ws.openWorkItemCreate()
    // Make a task from a calendar event (N3.3a) hands its values over here.
    const fromEvent = takePendingEventTask()
    if (fromEvent) ws.applyTaskTemplate('', fromEvent)
    if (requestedTemplate && projectId) {
      void window.ostlerAPI.getTaskTemplates(projectId).then((result) => {
        const template = result.ok
          ? result.value.find((entry) => entry.id === requestedTemplate)
          : undefined
        if (!template) return
        ws.applyTaskTemplate(
          template.id,
          templateFormValues(template.body, todayIsoDate(), {
            personIds: new Set(people.all.map((person) => person.id)),
            fields: ws.fields
          })
        )
      })
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('newTask')
        next.delete('taskTemplate')
        return next
      },
      { replace: true }
    )
  }, [requestedNewTask, routeView])

  // ?exportCalendar=1 is how the command palette opens "Export to calendar file…".
  const requestedCalendarFile = searchParams.get('exportCalendar')
  useEffect(() => {
    if (!requestedCalendarFile || here?.kind !== 'project' || routeView === null) return
    actions.items(project, ['exportCalendar'])[0].onSelect?.()
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('exportCalendar')
        return next
      },
      { replace: true }
    )
  }, [requestedCalendarFile, routeView])

  // ?planTasks=1 is how the command palette opens the plan grid in this project.
  const requestedPlanTasks = searchParams.get('planTasks')
  useEffect(() => {
    if (!requestedPlanTasks || here?.kind !== 'project' || routeView === null) return
    ws.setPlanGridOpen(true)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('planTasks')
        return next
      },
      { replace: true }
    )
  }, [requestedPlanTasks, routeView])

  // ?runPlaybook=1 is how the command palette opens Run playbook (N9.6b) in this project.
  const requestedRunPlaybook = searchParams.get('runPlaybook')
  useEffect(() => {
    if (!requestedRunPlaybook || here?.kind !== 'project' || routeView === null) return
    ws.setRunPlaybookOpen(true)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('runPlaybook')
        return next
      },
      { replace: true }
    )
  }, [requestedRunPlaybook, routeView])

  // ?findReplace=1 is how the command palette opens Find and replace in this project.
  const requestedFindReplace = searchParams.get('findReplace')
  useEffect(() => {
    if (!requestedFindReplace || here?.kind !== 'project' || routeView === null) return
    ws.setFindReplaceOpen(true)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('findReplace')
        return next
      },
      { replace: true }
    )
  }, [requestedFindReplace, routeView])

  useShortcuts(
    {
      'find-replace': () => ws.setFindReplaceOpen(true),
      'project-view': (index) => {
        const target = tabs[index]
        if (target) setView(target.id)
      },
      // Ctrl+N: quick add with this project chosen (P5.6). The header's
      // New task button opens the full form.
      'new-task': () => quickAdd.open({ projectId })
    },
    'project'
  )

  // The application menu's File and Go items, for this project (P8.2).
  useAppCommands(
    {
      import: () => actions.items(project, ['import'])[0].onSelect?.(),
      export: () => actions.items(project, ['exportProject'])[0].onSelect?.(),
      print: () => void print('printer'),
      'open-view': (command) => {
        const target = openable.find((entry) => entry.id === command.view)
        if (target) setView(target.id)
      }
    },
    'project'
  )

  const pins = usePins()
  // Open in new window (N5.8a); a pop-out shows this one view, without the tabs.
  const popOut = usePopOutRoute() !== null
  const openInNewWindow = useOpenInNewWindow()
  const onShow = openable.find((entry) => entry.id === view) ?? tabs[0]
  const viewPinItems = pins.available
    ? pins
        .menuItems({
          kind: 'project-view',
          targetId: onShow.id,
          projectId: project.id,
          title: onShow.label
        })
        .filter((entry): entry is MenuItem => entry.type !== 'separator' && entry.type !== 'group')
    : []
  // Import and export, then print: labelled groups, so a long menu reads in parts.
  const transferItems: MenuItem[] = [
    ...actions.items(project, ['import', 'exportProject']),
    ...actions.items(project, ['exportTasks']),
    { label: t('data:editInExcel.menuItem'), icon: FileSpreadsheet, onSelect: editInExcel },
    ...(view === 'calendar' ? actions.items(project, ['exportCalendar']) : []),
    ...(view === 'timeline'
      ? [
          {
            label: t('views:timelineSlides.menuItem'),
            icon: Presentation,
            onSelect: exportSlides
          }
        ]
      : []),
    ...actions.items(project, ['shareReport']),
    ...(view === 'list'
      ? [
          {
            label: t('navigation:projectWorkspace.exportViewCsv'),
            icon: FileSpreadsheet,
            onSelect: () => void exportView()
          }
        ]
      : [])
  ]
  const printItems: MenuItem[] = isPrintableView(view)
    ? [
        {
          label: t('navigation:projectWorkspace.print'),
          icon: Printer,
          onSelect: () => void print('printer')
        },
        {
          label: t('navigation:projectWorkspace.savePdf'),
          icon: FileDown,
          onSelect: () => void print('pdf')
        }
      ]
    : []
  // The project's actions; its views are in More views, beside the tabs.
  const moreItems: MenuEntry[] = [
    ...(popOut
      ? []
      : [
          {
            label: t('navigation:popOut.openInNewWindow'),
            icon: AppWindow,
            onSelect: () => void openInNewWindow(projectPath(projectId, view))
          }
        ]),
    {
      label: t('navigation:projectWorkspace.planTasks'),
      icon: Plus,
      onSelect: () => ws.setPlanGridOpen(true)
    },
    // Run playbook (N9.6b): only while agents are on; the dialog says why it can't run.
    ...(features.agents
      ? [
          {
            label: t('agents:playbooks.run'),
            icon: Bot,
            hint: runPlaybookBlocker(true, project) ?? t('agents:playbooks.runHint'),
            onSelect: () => ws.setRunPlaybookOpen(true)
          }
        ]
      : []),
    {
      label: t('navigation:projectWorkspace.findReplace'),
      icon: Replace,
      shortcut: shortcut('find-replace').keys,
      onSelect: () => ws.setFindReplaceOpen(true)
    },
    {
      label: t('views:baselines.save'),
      icon: Camera,
      onSelect: () => setBaselineDialog('save')
    },
    {
      label: t('views:baselines.list'),
      icon: History,
      onSelect: () => setBaselineDialog('list')
    },
    ...actions.items(project, ['postUpdate']),
    // Pins (N5.2a): the view on show, to the sidebar or this project's Overview.
    ...(viewPinItems.length > 0
      ? [
          {
            type: 'group' as const,
            label: t('common:pins.thisView', { view: onShow.label }),
            items: viewPinItems
          }
        ]
      : []),
    { type: 'separator' as const },
    ...actions.items(project, ['settings', 'customiseBoard']),
    ...actions.items(project, ['template']),
    { type: 'separator' as const },
    {
      type: 'group' as const,
      label: t('navigation:projectWorkspace.importExportGroup'),
      items: transferItems
    },
    ...(printItems.length > 0
      ? [
          {
            type: 'group' as const,
            label: t('navigation:projectWorkspace.printGroup'),
            items: printItems
          }
        ]
      : []),
    { type: 'separator' as const },
    ...actions.items(project, ['remove'])
  ]

  const ViewElement = current.element
  const queueAttention = ws.queueSummary.running + ws.queueSummary.review
  // Loaded on first open, then kept, so it can slide closed and open again.
  const drawerWanted = useLatch(ws.selectedWorkItem !== null)

  return (
    <div className="ostler-workspace">
      <ProjectHeader
        project={project}
        onNewTask={() => ws.openWorkItemCreate()}
        moreItems={moreItems}
        onRenamed={onRenamed}
        workstreams={{
          list: ws.subprojects,
          currentId: scopeParam,
          viewScoped: isSubprojectScoped(view),
          onChoose: (subprojectId) =>
            navigate(
              subprojectId
                ? subprojectPath(projectId, subprojectId, view)
                : projectPath(projectId, view)
            )
        }}
      />
      {!popOut && (
        <Tabs
          ref={tabBar}
          label={t('navigation:projectWorkspace.projectViews')}
          className="ostler-workspace-tabs"
          value={current.id}
          onChange={setView}
          trailing={
            <Menu
              label={t('navigation:projectWorkspace.moreViewsMenu')}
              placement="bottom-end"
              items={moreViewItems}
              renderTrigger={(props) => (
                <button
                  {...props}
                  type="button"
                  className={cx(
                    'ui-tabs__tab ostler-workspace-tabs__more',
                    overflowItems.length > 0 && 'ostler-workspace-tabs__more--holding',
                    visiting && 'ostler-workspace-tabs__more--current'
                  )}
                  aria-current={visiting ? 'page' : undefined}
                >
                  {t('navigation:projectWorkspace.moreViews')}
                  {overflowItems.length > 0 && (
                    <span
                      className="ui-tabs__badge"
                      aria-label={t('navigation:projectWorkspace.tabsInMore', {
                        count: overflowItems.length
                      })}
                    >
                      +{overflowItems.length}
                    </span>
                  )}
                  <Icon icon={ChevronDown} />
                </button>
              )}
            />
          }
          items={shownTabs.map((entry) => ({
            value: entry.id,
            label: entry.label,
            icon: entry.icon,
            badge:
              entry.id === 'agents' && queueAttention > 0 ? (
                <span
                  aria-label={t('navigation:projectWorkspace.runningReview', { queueAttention })}
                >
                  {queueAttention}
                </span>
              ) : undefined,
            // A view opened from More takes no Ctrl+number.
            title: projectViewKeys(tabs.indexOf(entry))
          }))}
        />
      )}

      <ViewerNotice projectId={project.id} />
      {ws.error && <InlineAlert tone="danger">{ws.error}</InlineAlert>}
      {excel.panel}

      <div
        className={`ostler-workspace-view ostler-workspace-view--${current.id}`}
        role="region"
        aria-label={current.label}
      >
        {/* Keyed by view: a crashed view recovers when the user switches. */}
        <ErrorBoundary key={current.id} scope="view">
          {!features.loaded ? (
            <div className="ostler-workspace-loading">
              <Spinner label={t('navigation:projectWorkspace.loading')} />
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="ostler-workspace-loading">
                  <Spinner
                    label={t('navigation:projectWorkspace.loading2', {
                      currentLabel: current.label
                    })}
                  />
                </div>
              }
            >
              <ViewElement
                project={project}
                ws={scopedWorkspace(ws, current.id)}
                features={ctx}
                suggestTasks={{
                  busy: nextTasks.nextTasksBusy,
                  start: () => void nextTasks.generateNextTasks()
                }}
                reportView={reportView}
                editInExcel={editInExcel}
              />
              <ViewRenderedMark ready={ws.loaded} viewKey={`${projectId}/${current.id}`} />
            </Suspense>
          )}
        </ErrorBoundary>
      </div>

      <Suspense fallback={null}>
        {ws.createMode && (
          <CreateRecordModal
            ws={ws}
            selectedProject={project}
            onPopOut={ws.createMode === 'work-item' ? () => void popOutNewTask() : undefined}
          />
        )}
        {ws.planGridOpen && <PlanGridDialog ws={ws} project={project} />}
        {baselineDialog === 'save' && (
          <SaveBaselineDialog projectId={project.id} onClose={() => setBaselineDialog(null)} />
        )}
        {baselineDialog === 'list' && (
          <BaselinesDialog projectId={project.id} onClose={() => setBaselineDialog(null)} />
        )}
        {ws.runPlaybookOpen && (
          <RunPlaybookDialog
            project={project}
            onClose={() => ws.setRunPlaybookOpen(false)}
            onRan={() => void ws.loadPlanning()}
          />
        )}
        {ws.findReplaceOpen && (
          <FindReplaceDialog
            open
            projectId={project.id}
            onClose={() => ws.setFindReplaceOpen(false)}
            onChanged={() => void ws.loadPlanning()}
          />
        )}
        {ws.aiDraft && <AiBreakdownDialog ws={ws} />}
        {ws.aiDecisionDraft && <AiDecisionDialog ws={ws} />}
        {planAndSplit && ws.agentPlanGoal && <AgentPlanWizard ws={ws} />}
      </Suspense>
      {/*
       * The drawer has a boundary of its own: a dialog opened from it that is
       * still loading would otherwise hide the drawer while it loads, and the
       * focus with it, so focus could not go back to the drawer's menu.
       */}
      <Suspense fallback={null}>{drawerWanted && <WorkItemDrawer ws={ws} />}</Suspense>
      <Suspense fallback={null}>
        {ws.wontDoTargets && <WontDoDialog ws={ws} targets={ws.wontDoTargets} />}
        {ws.blockTimeTarget && (
          <BlockTimeFor item={ws.blockTimeTarget} onClose={() => ws.setBlockTimeTarget(null)} />
        )}
        {ws.duplicateTarget && <MarkDuplicateDialog ws={ws} target={ws.duplicateTarget} />}
      </Suspense>
      <Suspense fallback={null}>
        {nextTasks.nextTasksDraft && (
          <AINextTasksModal
            nextTasksDraft={nextTasks.nextTasksDraft}
            nextTaskReviews={nextTasks.nextTaskReviews}
            nextTasksBusy={nextTasks.nextTasksBusy}
            nextTasksError={nextTasks.nextTasksError}
            planningMilestones={ws.milestones}
            updateNextTaskReview={nextTasks.updateNextTaskReview}
            closeNextTasksDraft={nextTasks.closeNextTasksDraft}
            generateNextTasks={() => void nextTasks.generateNextTasks()}
            approveNextTasks={() => void nextTasks.approveNextTasks()}
          />
        )}
        {/* Opened from a board card parked in Review, so the accept/discard
          decision is reachable from the board itself, not only from Agents. */}
        {ws.reviewSessionId &&
          (() => {
            const session = [
              ...(ws.harnessState?.reviewSessions ?? []),
              ...(ws.harnessState?.activeSessions ?? [])
            ].find((candidate) => candidate.id === ws.reviewSessionId)
            if (!session) return null
            return (
              <SessionReviewModal
                id={projectId}
                session={session}
                task={ws.harnessState?.taskQueue.find((task) => sessionOwnsTask(session, task))}
                harnessBusy={ws.busy}
                openCodeWorkspace={(root) =>
                  navigate(
                    projectPath(projectId, 'files', { rootLabel: root.label, rootPath: root.path })
                  )
                }
                runHarnessAction={async (action) => {
                  const result = await action()
                  if (!result.ok) {
                    ws.setError(result.error || t('navigation:projectWorkspace.didnTWorkTry'))
                    return false
                  }
                  await ws.loadPlanning()
                  return true
                }}
                onClose={() => ws.setReviewSessionId(null)}
              />
            )
          })()}
        {ws.transcriptSessionId &&
          (() => {
            // Sessions the Agents view can offer, plus the ones only a card
            // knows about (already finished, or awaiting review).
            const known = [
              ...(ws.harnessState?.activeSessions ?? []),
              ...(ws.harnessState?.reviewSessions ?? [])
            ]
            const session = known.find((candidate) => candidate.id === ws.transcriptSessionId)
            // The session ended and dropped out of state while its transcript was
            // open; closing beats holding an empty window open.
            if (!session) return null
            return (
              <LiveTranscriptModal
                projectId={projectId}
                session={session}
                // Only offer the switcher when this session is one of its own
                // options: a card can open an external or already-reviewed
                // session, which the watch list does not contain.
                sessions={
                  ws.watchableSessions.some((candidate) => candidate.id === session.id)
                    ? ws.watchableSessions
                    : undefined
                }
                onSelectSession={ws.setTranscriptSessionId}
                onClose={() => ws.setTranscriptSessionId(null)}
              />
            )
          })()}
      </Suspense>
      {ws.runModelTarget && (
        <RunModelDialog
          projectId={projectId}
          mode={ws.runModelTarget.kind}
          taskTitle={
            ws.runModelTarget.kind === 'queue'
              ? ws.runModelTarget.item.title
              : ws.runModelTarget.task.title
          }
          initial={
            ws.runModelTarget.kind === 'change'
              ? {
                  model: ws.runModelTarget.task.model ?? '',
                  effort: ws.runModelTarget.task.effort ?? ''
                }
              : { model: '', effort: '' }
          }
          busy={ws.busy}
          onClose={() => ws.setRunModelTarget(null)}
          onSubmit={(choice) => {
            const target = ws.runModelTarget
            if (!target) return
            ws.setRunModelTarget(null)
            if (target.kind === 'queue') void ws.queueWorkItem(target.item, choice)
            else void ws.setTaskRunModel(target.task, choice)
          }}
        />
      )}
      {slides && (
        <Suspense fallback={null}>
          <ExportTimelineSlidesDialog
            project={project}
            view={slides}
            onClose={() => setSlides(null)}
          />
        </Suspense>
      )}
      {actions.dialogs}
    </div>
  )
}
