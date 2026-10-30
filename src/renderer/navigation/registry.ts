import { createElement, lazy, useState, type ComponentType } from 'react'
import {
  Archive,
  Lightbulb,
  Inbox as TriageIcon,
  BookOpen,
  Bot,
  CalendarDays,
  ChartGantt,
  ClipboardCheck,
  ClipboardList,
  FolderCode,
  Grid2x2,
  History,
  House,
  Inbox,
  LayoutDashboard,
  Library,
  List,
  ListTodo,
  Milestone,
  Scale,
  Search,
  Timer,
  UsersRound,
  BookUser,
  Settings,
  SquareKanban,
  Trash2,
  Wallet,
  ShoppingCart,
  Hourglass,
  Target,
  type LucideIcon
} from '../ui/icons'
import { keywordList, t } from '@shared/i18n'
import type { ProjectUsageFact } from '@shared/ostler-api'
import type { ProjectViewProps } from './view-props'
import type { TabPrefs } from './tab-prefs'

export * from './settings-registry'

/**
 * The single list of views (one registry). The sidebar, the project tabs and More menu, the command
 * palette, the Ctrl+1–9 shortcuts, the paths and the "last view" memory all
 * read it. Nothing else may hold a list of views or settings sections. The settings
 * sections and groups live in `settings-registry.ts` and are re-exported from here.
 */

/** What a view's availability may depend on, and nothing else (`useFeatures`). */
export interface ViewContext {
  /** The project has a linked folder (D4). Always false for global views. */
  hasFolder: boolean
  /** "Use AI agents" is on: `config.harness.enabled` (D10). */
  agents: boolean
  /** Ostler AI is set up: a model plus a key, or a keyless local provider. */
  ai: boolean
  /**
   * Inside a project: its To triage can hold something, because Triage new
   * captures is on or a task waits there. Absent: yes (global views, tests).
   */
  triage?: boolean
  /**
   * Inside a project: what it holds that its views care about
   * (`getProjectUsage`), which earns a view in More its tab. Absent: not known
   * yet, and every such view stays in More.
   */
  uses?: readonly ProjectUsageFact[]
  /** The viewer's pinned and unpinned tabs (`tab-prefs.ts`); absent: the registry's own placement. */
  tabPrefs?: TabPrefs | null
  /** Inside a project: its stage is Planning, which makes Plan a tab. Absent: no. */
  planning?: boolean
}

export interface ViewDefinition<Props = object> {
  /** Stable: used in paths and saved state. */
  id: string
  scope: 'global' | 'project'
  /** The glossary word. */
  label: string
  icon: LucideIcon
  order: number
  /**
   * Project views: 'tab' for the everyday views every project shows; 'more'
   * for the rest, in the More views menu until the project uses them
   * (`isInUse`). Global views: 'tab' is the sidebar.
   */
  placement: 'tab' | 'more'
  /**
   * A view in More earns its tab while the project holds what it shows: a
   * Decisions tab once there is a decision. The same rule everywhere a view's
   * place is read (the tabs, Ctrl+1–9, the command palette, the menu bar).
   */
  isInUse?(uses: readonly ProjectUsageFact[]): boolean
  /**
   * A view in More that is a tab in this context whatever the project holds:
   * Plan while the project is in Planning. The viewer's pinned and unpinned
   * views still win.
   */
  isTabWhen?(ctx: ViewContext): boolean
  /** A shortcut id from `shortcuts.ts`. Project tabs get Ctrl+1–9 by position. */
  shortcut?: string
  /** Extra words the command palette matches. */
  keywords?: string[]
  /**
   * A project view that can show one sub-project (a workstream) alone, from `?sub=`. Views
   * without it show the whole project, and drop `?sub` when opened.
   */
  subprojectScoped?: boolean
  isAvailable(ctx: ViewContext): boolean
  /**
   * Whether an available view is offered (tabs, the More menu, the command
   * palette, the menu bar) when it has nothing to show. Absent: always. An
   * unoffered view still opens from its path.
   */
  isOffered?(ctx: ViewContext): boolean
  /** Lazy, so Files (and Monaco) load only when opened. Absent: no page of its own. */
  element?: ComponentType<Props>
  /** Loads the view's code without rendering it (P9.1: warmed after the first screen). */
  preload?: () => Promise<unknown>
}

const always = () => true

/**
 * A named export as a view that loads its code on first use, with `preload`
 * beside it (P9.1). Once the code is in (warmed after the first screen, or
 * opened before), the view renders straight away: a lazy component suspends
 * on its first render even when its module is already loaded, and React then
 * holds the spinner for about 300 ms. Each mount picks one of the two and
 * keeps it, so a view never remounts because its code arrived.
 */
function lazyView<Props extends object>(
  load: () => Promise<Record<string, ComponentType<Props>>>,
  name: string
): {
  element: ComponentType<Props>
  preload: () => Promise<unknown>
} {
  let loaded: ComponentType<Props> | null = null
  const preload = () =>
    load().then((module) => {
      loaded = module[name]
      return module
    })
  const Lazy = lazy(() => preload().then((module) => ({ default: module[name] })))
  function View(props: Props) {
    const [Component] = useState<ComponentType<Props>>(() => loaded ?? Lazy)
    return createElement(Component, props)
  }
  View.displayName = `View(${name})`
  return { element: View, preload }
}

/**
 * Sidebar entries with an order below this sit above the Projects list; the
 * rest sit below it.
 */
export const SIDEBAR_PROJECTS_ORDER = 50

export const GLOBAL_VIEWS = [
  {
    id: 'home',
    scope: 'global',
    get label() {
      return t('navigation:globalViews.home.label')
    },
    icon: House,
    order: 10,
    placement: 'tab',
    shortcut: 'go-home',
    get keywords() {
      return keywordList('navigation:globalViews.home.keywords')
    },
    isAvailable: always
  },
  {
    id: 'inbox',
    scope: 'global',
    get label() {
      return t('navigation:globalViews.inbox.label')
    },
    icon: Inbox,
    order: 20,
    placement: 'tab',
    shortcut: 'go-inbox',
    get keywords() {
      return keywordList('navigation:globalViews.inbox.keywords')
    },
    isAvailable: always
  },
  {
    // Every task assigned to a person, across projects (R3.1, D35).
    id: 'my-work',
    scope: 'global',
    get label() {
      return t('navigation:globalViews.myWork.label')
    },
    icon: ListTodo,
    order: 25,
    placement: 'tab',
    shortcut: 'go-my-work',
    get keywords() {
      return keywordList('navigation:globalViews.myWork.keywords')
    },
    isAvailable: always,
    ...lazyView(() => import('../views/my-work/MyWorkView'), 'MyWorkView')
  },
  {
    // Reached from the command palette ("See all results") and Ctrl+K's
    // "Go to"; the sidebar's search box opens the palette instead.
    id: 'search',
    scope: 'global',
    get label() {
      return t('navigation:globalViews.search.label')
    },
    icon: Search,
    order: 30,
    placement: 'more',
    get keywords() {
      return keywordList('navigation:globalViews.search.keywords')
    },
    isAvailable: always
  },
  {
    // The Timesheet (R2.3, D35): no sidebar row. Reached from the command
    // palette, the status bar's timer and a task's Time section.
    id: 'timesheet',
    scope: 'global',
    get label() {
      return t('navigation:globalViews.timesheet.label')
    },
    icon: Timer,
    order: 40,
    placement: 'more',
    get keywords() {
      return keywordList('navigation:globalViews.timesheet.keywords')
    },
    isAvailable: always
  },
  {
    // Workload (R3.2, D35): no sidebar row. Reached from the command
    // palette, Settings › People and My work's header.
    id: 'workload',
    scope: 'global',
    get label() {
      return t('navigation:globalViews.workload.label')
    },
    icon: UsersRound,
    order: 42,
    placement: 'more',
    get keywords() {
      return keywordList('navigation:globalViews.workload.keywords')
    },
    isAvailable: always,
    ...lazyView(() => import('../views/workload/WorkloadView'), 'WorkloadView')
  },
  {
    // Team (team-leaders plan, D4): no sidebar row. Reached from the command
    // palette and Workload's header.
    id: 'team',
    scope: 'global',
    get label() {
      return t('navigation:globalViews.team.label')
    },
    icon: UsersRound,
    order: 43,
    placement: 'more',
    get keywords() {
      return keywordList('navigation:globalViews.team.keywords')
    },
    isAvailable: always,
    ...lazyView(() => import('../views/team/TeamView'), 'TeamView')
  },
  {
    // Contacts (N6.5, N48): no sidebar row. Reached from the command
    // palette, a task's Contacts section and search.
    id: 'contacts',
    scope: 'global',
    get label() {
      return t('navigation:globalViews.contacts.label')
    },
    icon: BookUser,
    order: 43,
    placement: 'more',
    get keywords() {
      return keywordList('navigation:globalViews.contacts.keywords')
    },
    isAvailable: always,
    ...lazyView(() => import('../views/contacts/ContactsView'), 'ContactsView')
  },
  {
    // Weekly review (N1.5, N13): no sidebar row. Reached from Home, the
    // command palette, and its reminder's notification and Inbox entry.
    id: 'weekly-review',
    scope: 'global',
    get label() {
      return t('navigation:globalViews.weeklyReview.label')
    },
    icon: ClipboardCheck,
    order: 44,
    placement: 'more',
    get keywords() {
      return keywordList('navigation:globalViews.weeklyReview.keywords')
    },
    isAvailable: always,
    ...lazyView(() => import('../views/weekly-review/WeeklyReviewView'), 'WeeklyReviewView')
  },
  {
    // Goals of one's own (N5.6b, N41): no sidebar row. Reached from the
    // command palette, Home's Projects section and a pinned goal (D35).
    id: 'goals',
    scope: 'global',
    get label() {
      return t('navigation:globalViews.goals.label')
    },
    icon: Target,
    order: 45,
    placement: 'more',
    get keywords() {
      return keywordList('navigation:globalViews.goals.keywords')
    },
    isAvailable: always,
    ...lazyView(() => import('../views/goals/GoalsView'), 'GoalsView')
  },
  {
    // The undo history: no sidebar row. Reached from the title bar's History
    // button, the Edit menu, G then U and the command palette.
    id: 'undo-history',
    scope: 'global',
    get label() {
      return t('navigation:globalViews.undoHistory.label')
    },
    icon: History,
    order: 46,
    placement: 'more',
    shortcut: 'undo-history',
    get keywords() {
      return keywordList('navigation:globalViews.undoHistory.keywords')
    },
    isAvailable: always,
    ...lazyView(() => import('../views/undo-history/UndoHistoryView'), 'UndoHistoryView')
  },
  {
    // The Timeline across projects (N5.4, N39): a sidebar row of its own
    // (MOP-32), as well as the command palette and Home's Projects section.
    id: 'timeline-overview',
    scope: 'global',
    get label() {
      return t('navigation:globalViews.timelineOverview.label')
    },
    icon: ChartGantt,
    order: 27,
    placement: 'tab',
    get keywords() {
      return keywordList('navigation:globalViews.timelineOverview.keywords')
    },
    isAvailable: always,
    ...lazyView(
      () => import('../views/timeline-overview/TimelineOverviewView'),
      'TimelineOverviewView'
    )
  },
  {
    // A sidebar entry that opens a project's Agents view; it has no page of
    // its own.
    id: 'agents',
    scope: 'global',
    get label() {
      return t('navigation:globalViews.agents.label')
    },
    icon: Bot,
    order: 80,
    placement: 'tab',
    get keywords() {
      return keywordList('navigation:globalViews.agents.keywords')
    },
    isAvailable: (ctx: ViewContext) => ctx.agents
  },
  {
    // The user guide (P8.1), opened from the sidebar's Help menu and the
    // command palette; it has no sidebar entry of its own.
    id: 'help',
    scope: 'global',
    get label() {
      return t('navigation:globalViews.help.label')
    },
    icon: BookOpen,
    order: 85,
    placement: 'more',
    get keywords() {
      return keywordList('navigation:globalViews.help.keywords')
    },
    isAvailable: always
  },
  {
    id: 'settings',
    scope: 'global',
    get label() {
      return t('navigation:globalViews.settings.label')
    },
    icon: Settings,
    order: 90,
    placement: 'tab',
    shortcut: 'settings',
    get keywords() {
      return keywordList('navigation:globalViews.settings.keywords')
    },
    isAvailable: always
  }
] as const satisfies readonly ViewDefinition[]

export const PROJECT_VIEWS = [
  {
    id: 'overview',
    scope: 'project',
    subprojectScoped: true,
    get label() {
      return t('navigation:views.overview.label')
    },
    icon: LayoutDashboard,
    order: 1,
    placement: 'tab',
    get keywords() {
      return keywordList('navigation:views.overview.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/OverviewTab'), 'OverviewTab')
  },
  {
    id: 'plan',
    scope: 'project',
    subprojectScoped: true,
    get label() {
      return t('navigation:views.plan.label')
    },
    icon: ClipboardList,
    order: 1.5,
    placement: 'more',
    isTabWhen: (ctx: ViewContext) => ctx.planning === true,
    get keywords() {
      return keywordList('navigation:views.plan.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/PlanTab'), 'PlanTab')
  },
  {
    id: 'board',
    scope: 'project',
    subprojectScoped: true,
    get label() {
      return t('navigation:views.board.label')
    },
    icon: SquareKanban,
    order: 2,
    placement: 'tab',
    get keywords() {
      return keywordList('navigation:views.board.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/BoardTab'), 'BoardTab')
  },
  {
    id: 'list',
    scope: 'project',
    subprojectScoped: true,
    get label() {
      return t('navigation:views.list.label')
    },
    icon: List,
    order: 3,
    placement: 'tab',
    get keywords() {
      return keywordList('navigation:views.list.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/ListTab'), 'ListTab')
  },
  {
    id: 'calendar',
    scope: 'project',
    subprojectScoped: true,
    get label() {
      return t('navigation:views.calendar.label')
    },
    icon: CalendarDays,
    order: 4,
    placement: 'tab',
    get keywords() {
      return keywordList('navigation:views.calendar.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/CalendarTab'), 'CalendarTab')
  },
  {
    id: 'timeline',
    scope: 'project',
    subprojectScoped: true,
    get label() {
      return t('navigation:views.timeline.label')
    },
    icon: ChartGantt,
    order: 5,
    placement: 'more',
    isInUse: (uses) => uses.includes('scheduled'),
    get keywords() {
      return keywordList('navigation:views.timeline.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/TimelineTab'), 'TimelineTab')
  },
  {
    id: 'milestones',
    scope: 'project',
    subprojectScoped: true,
    get label() {
      return t('navigation:views.milestones.label')
    },
    icon: Milestone,
    order: 6,
    placement: 'more',
    isInUse: (uses) => uses.includes('milestones'),
    get keywords() {
      return keywordList('navigation:views.milestones.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/MilestonesTab'), 'MilestonesTab')
  },
  {
    id: 'library',
    scope: 'project',
    get label() {
      return t('navigation:views.library.label')
    },
    icon: Library,
    order: 7,
    placement: 'tab',
    get keywords() {
      return keywordList('navigation:views.library.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/LibraryTab'), 'LibraryTab')
  },
  {
    id: 'decisions',
    scope: 'project',
    get label() {
      return t('navigation:views.decisions.label')
    },
    icon: Scale,
    order: 8,
    placement: 'more',
    isInUse: (uses) => uses.includes('decisions'),
    get keywords() {
      return keywordList('navigation:views.decisions.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/DecisionsTab'), 'DecisionsTab')
  },
  {
    id: 'files',
    scope: 'project',
    get label() {
      return t('navigation:views.files.label')
    },
    icon: FolderCode,
    order: 9,
    placement: 'tab',
    get keywords() {
      return keywordList('navigation:views.files.keywords')
    },
    isAvailable: (ctx: ViewContext) => ctx.hasFolder,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/FilesTab'), 'FilesTab')
  },
  {
    id: 'history',
    scope: 'project',
    get label() {
      return t('navigation:views.history.label')
    },
    icon: History,
    order: 9.5,
    placement: 'tab',
    get keywords() {
      return keywordList('navigation:views.history.keywords')
    },
    isAvailable: (ctx: ViewContext) => ctx.hasFolder,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/HistoryTab'), 'HistoryTab')
  },
  {
    id: 'agents',
    scope: 'project',
    get label() {
      return t('navigation:views.agents.label')
    },
    icon: Bot,
    order: 10,
    placement: 'tab',
    get keywords() {
      return keywordList('navigation:views.agents.keywords')
    },
    isAvailable: (ctx: ViewContext) => ctx.agents && ctx.hasFolder,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/AgentsTab'), 'AgentsTab')
  },
  {
    id: 'matrix',
    scope: 'project',
    subprojectScoped: true,
    get label() {
      return t('navigation:views.matrix.label')
    },
    icon: Grid2x2,
    order: 18,
    placement: 'more',
    isInUse: (uses) => uses.includes('scores'),
    get keywords() {
      return keywordList('navigation:views.matrix.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/MatrixTab'), 'MatrixTab')
  },
  {
    id: 'triage',
    scope: 'project',
    subprojectScoped: true,
    get label() {
      return t('navigation:views.triage.label')
    },
    icon: TriageIcon,
    order: 18.5,
    placement: 'more',
    isInUse: (uses) => uses.includes('triage'),
    get keywords() {
      return keywordList('navigation:views.triage.keywords')
    },
    isAvailable: always,
    // Offered only when it can hold something: the setting is on or a task waits.
    isOffered: (ctx: ViewContext) => ctx.triage !== false,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/TriageTab'), 'TriageTab')
  },
  {
    id: 'someday',
    scope: 'project',
    subprojectScoped: true,
    get label() {
      return t('navigation:views.someday.label')
    },
    icon: Lightbulb,
    order: 19,
    placement: 'more',
    isInUse: (uses) => uses.includes('someday'),
    get keywords() {
      return keywordList('navigation:views.someday.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/SomedayTab'), 'SomedayTab')
  },
  {
    id: 'costs',
    scope: 'project',
    get label() {
      return t('navigation:views.costs.label')
    },
    icon: Wallet,
    order: 19.5,
    placement: 'more',
    isInUse: (uses) => uses.includes('costs'),
    get keywords() {
      return keywordList('navigation:views.costs.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(() => import('../views/costs/CostsView'), 'CostsView')
  },
  {
    id: 'shopping',
    scope: 'project',
    get label() {
      return t('navigation:views.shopping.label')
    },
    icon: ShoppingCart,
    order: 19.6,
    placement: 'more',
    isInUse: (uses) => uses.includes('shopping'),
    get keywords() {
      return keywordList('navigation:views.shopping.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(() => import('../views/shopping/ShoppingView'), 'ShoppingView')
  },
  {
    id: 'time-report',
    scope: 'project',
    get label() {
      return t('navigation:views.timeReport.label')
    },
    icon: Hourglass,
    order: 19.6,
    placement: 'more',
    isInUse: (uses) => uses.includes('time'),
    get keywords() {
      return keywordList('navigation:views.timeReport.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(
      () => import('../views/time-report/TimeReportView'),
      'TimeReportView'
    )
  },
  {
    id: 'archive',
    scope: 'project',
    subprojectScoped: true,
    get label() {
      return t('navigation:views.archive.label')
    },
    icon: Archive,
    order: 20,
    placement: 'more',
    get keywords() {
      return keywordList('navigation:views.archive.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/ArchiveTab'), 'ArchiveTab')
  },
  {
    id: 'bin',
    scope: 'project',
    get label() {
      return t('navigation:views.bin.label')
    },
    icon: Trash2,
    order: 21,
    placement: 'more',
    get keywords() {
      return keywordList('navigation:views.bin.keywords')
    },
    isAvailable: always,
    ...lazyView<ProjectViewProps>(() => import('../views/workspace/ArchiveTab'), 'RecycleBinTab')
  }
] as const satisfies readonly ViewDefinition<ProjectViewProps>[]

export type GlobalViewId = (typeof GLOBAL_VIEWS)[number]['id']
export type ProjectViewId = (typeof PROJECT_VIEWS)[number]['id']
export type ProjectViewDefinition = (typeof PROJECT_VIEWS)[number]

/** What a project view is for, in a line: the More views menu says it. */
export function projectViewDescription(id: ProjectViewId): string {
  const key = id.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
  return t(`navigation:views.${key}.description`)
}

/** The first view of a project, and where an unavailable view falls back to. */
export const DEFAULT_PROJECT_VIEW: ProjectViewId = 'overview'

function byOrder<T extends { order: number }>(views: readonly T[]): T[] {
  return [...views].sort((a, b) => a.order - b.order)
}

/** Whether an available view is offered in `ctx` (`isOffered`). */
function isOffered(
  view: Pick<ViewDefinition, 'isAvailable' | 'isOffered'>,
  ctx: ViewContext
): boolean {
  return view.isOffered ? view.isOffered(ctx) : true
}

/** Whether a view in More has earned its tab in `ctx` (`isInUse`). */
function earnsTab(view: ProjectViewDefinition, ctx: ViewContext): boolean {
  const inUse = 'isInUse' in view ? view.isInUse : undefined
  return ctx.uses !== undefined && inUse !== undefined && inUse(ctx.uses)
}

/** Whether a view in More is a tab in `ctx` by its own rule (`isTabWhen`). */
function tabWhen(view: ProjectViewDefinition, ctx: ViewContext): boolean {
  const when = 'isTabWhen' in view ? view.isTabWhen : undefined
  return when !== undefined && when(ctx)
}

/**
 * Whether a project view is a tab in `ctx`: the viewer's unpinned views never
 * are, their pinned ones always are, and the rest follow their placement or
 * the tab they have earned.
 */
function isTab(view: ProjectViewDefinition, ctx: ViewContext): boolean {
  if (ctx.tabPrefs?.unpinned.includes(view.id)) return false
  if (ctx.tabPrefs?.pinned.includes(view.id)) return true
  return view.placement === 'tab' || earnsTab(view, ctx) || tabWhen(view, ctx)
}

/**
 * The project views available and offered in `ctx`, in order: 'tab', the tab
 * row (the everyday views and those the project uses); 'more', the rest, in
 * the More views menu.
 */
export function projectViews(
  ctx: ViewContext,
  placement: 'tab' | 'more' = 'tab'
): ProjectViewDefinition[] {
  return byOrder(PROJECT_VIEWS).filter((view) => {
    if (!view.isAvailable(ctx) || !isOffered(view, ctx)) return false
    const tab = isTab(view, ctx)
    return placement === 'tab' ? tab : !tab
  })
}

/**
 * The tab row with the view on show: a view opened from More that has no tab
 * of its own gets one at the end while it is open, so the row says where you
 * are. It takes no Ctrl+number: those follow `projectViews(ctx, 'tab')`.
 */
export function projectTabs(ctx: ViewContext, current: ProjectViewId): ProjectViewDefinition[] {
  const tabs = projectViews(ctx, 'tab')
  if (tabs.some((view) => view.id === current)) return tabs
  const open = findProjectView(current)
  return open && open.isAvailable(ctx) ? [...tabs, open] : tabs
}

/** Every project view that opens in `ctx` from its path, offered or not, in order. */
export function openableProjectViews(ctx: ViewContext): ProjectViewDefinition[] {
  return byOrder(PROJECT_VIEWS).filter((view) => view.isAvailable(ctx))
}

/** Every available and offered project view, tabs first. */
export function allProjectViews(ctx: ViewContext): ProjectViewDefinition[] {
  return [...projectViews(ctx, 'tab'), ...projectViews(ctx, 'more')]
}

/** Global views: the sidebar's ('tab', the default), or every one ('all'). */
export function globalViews(
  ctx: ViewContext,
  placement: 'tab' | 'all' = 'tab'
): (typeof GLOBAL_VIEWS)[number][] {
  return byOrder(GLOBAL_VIEWS).filter(
    (view) => (placement === 'all' || view.placement === placement) && view.isAvailable(ctx)
  )
}

/** Whether project view `view` can be scoped to one sub-project (`?sub=`). */
export function isSubprojectScoped(view: ProjectViewId): boolean {
  return (findProjectView(view) as ViewDefinition | undefined)?.subprojectScoped === true
}

export function findProjectView(id: string | null | undefined): ProjectViewDefinition | undefined {
  return PROJECT_VIEWS.find((view) => view.id === id)
}

export function isProjectViewId(id: string | null | undefined): id is ProjectViewId {
  return findProjectView(id) !== undefined
}

/** `id` if it is a project view available in `ctx`, else the default view. */
export function availableProjectView(
  id: string | null | undefined,
  ctx: ViewContext
): ProjectViewId {
  const view = findProjectView(id)
  return view && view.isAvailable(ctx) ? view.id : DEFAULT_PROJECT_VIEW
}

/**
 * The view a project opens on: the one in the path if it is available, else
 * the view used last if it is still offered, else Overview.
 */
export function projectViewToOpen(
  routeView: string | null | undefined,
  lastView: string | null | undefined,
  ctx: ViewContext
): ProjectViewId {
  if (routeView) return availableProjectView(routeView, ctx)
  const last = findProjectView(lastView)
  return last && last.isAvailable(ctx) && isOffered(last, ctx) ? last.id : DEFAULT_PROJECT_VIEW
}
