import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent
} from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { PlanningSubproject, RendererProject } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { projectFolder } from '@shared/project-folder'
import { useOstler } from '../context/OstlerContext'
import { useFeatures, viewContext } from '../navigation/features'
import {
  globalViews,
  isSubprojectScoped,
  SIDEBAR_PROJECTS_ORDER,
  type GlobalViewId,
  type ProjectViewId
} from '../navigation/registry'
import {
  homePath,
  inboxPath,
  myWorkPath,
  parseAppPath,
  projectPath,
  helpPath,
  searchPath,
  timesheetPath,
  teamPath,
  workloadPath,
  weeklyReviewPath,
  timelineOverviewPath,
  contactsPath,
  goalsPath,
  settingsPath,
  subprojectPath,
  SUBPROJECT_PARAM
} from '../navigation/paths'
import { shortcut } from '../navigation/shortcuts'
import { useAgentActivity } from '../shell/AgentActivity'
import { useHomeFeed } from '../hooks/useHomeFeed'
import { useProjectActions } from './ProjectActions'
import { HelpMenu } from './help/HelpMenu'
import { dropProject, moveProject } from './sidebar-order'
import { ProjectMark } from './ProjectMark'
import { isStageInPlay, normalizeProjectStage } from '@shared/project-stages'
import { projectStageName } from './project-stage-name'
import { useProjectStageNames } from '../hooks/useProjectStageNames'
import { PinnedSection } from '../pins/PinnedSection'
import { useAreaActions } from './areas/useAreaActions'
import { useSidebarSubprojects } from './useSidebarSubprojects'
import { SubprojectDialog, type SubprojectDialogMode } from './SubprojectDialog'
import { groupProjectsByArea, type ProjectArea, type ProjectAreaGroup } from '@shared/project-areas'
import {
  Collapse,
  useReorderMotion,
  ContextMenu,
  IconButton,
  Kbd,
  Menu,
  Tooltip,
  useConfirm,
  VisuallyHidden,
  useToast,
  type MenuEntry
} from '../ui'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  chevronClass,
  ChevronRight,
  CircleCheck,
  Hexagon,
  Icon,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  type LucideIcon
} from '../ui/icons'
import './Sidebar.css'
import { t } from '@shared/i18n'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpenPalette: () => void
  onNewProject: () => void
}

/**
 * The app's sidebar: Home
 * and Inbox, the Pinned section (N5.2a) when something is pinned, the Projects list, then Agents and Settings, all from the view
 * registry. Projects reorder by dragging or Alt+↑/↓, saved as the order of
 * `config.projects`; right-click (or Shift+F10) opens their actions. With
 * areas (N5.1) the projects group under headings that fold, in the one
 * grouping (`groupProjectsByArea`); a project drags between areas, and an
 * area's heading drags, or moves with Alt+↑/↓, to reorder the areas.
 */
/** The open sidebar's width, remembered across launches. */
const WIDTH_KEY = 'ostler.sidebar-width'
const MIN_WIDTH = 200
const MAX_WIDTH = 480
const KEYBOARD_STEP = 16

function clampWidth(width: number): number {
  return Math.round(Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH))
}

function readWidth(): number | null {
  try {
    const stored = Number(window.localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(stored) && stored > 0 ? clampWidth(stored) : null
  } catch {
    return null
  }
}

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  onOpenPalette,
  onNewProject
}: SidebarProps) {
  const location = useLocation()
  const { projects, areas, refreshProjects } = useOstler()
  const features = useFeatures()
  const activity = useAgentActivity()
  const views = globalViews(viewContext(features, null))
  const inbox = useHomeFeed(() => window.ostlerAPI.getInbox())
  const unread = inbox.value?.unreadCount ?? 0
  const here = parseAppPath(location.pathname)
  const currentProjectId = here && 'projectId' in here ? here.projectId : null
  // The workstream open now, and the view to keep when opening another one.
  const currentSubprojectId =
    here?.kind === 'project' ? new URLSearchParams(location.search).get(SUBPROJECT_PARAM) : null
  const currentView = here?.kind === 'project' ? here.view : null
  const asideRef = useRef<HTMLElement>(null)
  // null: the stylesheet's 240 px, until the person drags the edge.
  const [width, setWidthState] = useState<number | null>(readWidth)

  const setWidth = useCallback((next: number) => {
    const clamped = clampWidth(next)
    setWidthState(clamped)
    try {
      window.localStorage.setItem(WIDTH_KEY, String(clamped))
    } catch {
      // Not remembered; still applies for now.
    }
  }, [])

  const currentWidth = () => width ?? asideRef.current?.getBoundingClientRect().width ?? MIN_WIDTH

  const onResizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // The handle is on the right edge: Right widens, Left narrows.
    const delta = { ArrowRight: KEYBOARD_STEP, ArrowLeft: -KEYBOARD_STEP }[event.key]
    if (delta !== undefined) {
      event.preventDefault()
      setWidth(currentWidth() + delta)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setWidth(MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      setWidth(MAX_WIDTH)
    }
  }

  const onResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    const left = asideRef.current?.getBoundingClientRect().left ?? 0
    handle.setPointerCapture?.(event.pointerId)
    document.body.classList.add('ostler-sidebar-resizing')
    const move = (moveEvent: globalThis.PointerEvent) => setWidth(moveEvent.clientX - left)
    const stop = () => {
      document.body.classList.remove('ostler-sidebar-resizing')
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  const destination = (id: GlobalViewId): string => {
    if (id === 'home') return homePath()
    if (id === 'inbox') return inboxPath()
    if (id === 'my-work') return myWorkPath()
    if (id === 'settings') return settingsPath()
    if (id === 'search') return searchPath()
    if (id === 'timesheet') return timesheetPath()
    if (id === 'workload') return workloadPath()
    if (id === 'team') return teamPath()
    if (id === 'weekly-review') return weeklyReviewPath()
    if (id === 'timeline-overview') return timelineOverviewPath()
    if (id === 'contacts') return contactsPath()
    if (id === 'goals') return goalsPath()
    if (id === 'help') return helpPath()
    return agentsDestination(projects, currentProjectId, activity.byProject)
  }
  const isActive = (id: GlobalViewId): boolean =>
    (id === 'home' && here?.kind === 'home') ||
    (id === 'inbox' && here?.kind === 'inbox') ||
    (id === 'my-work' && here?.kind === 'my-work') ||
    (id === 'timeline-overview' && here?.kind === 'timeline-overview') ||
    (id === 'settings' && here?.kind === 'settings') ||
    (id === 'agents' && here?.kind === 'project' && here.view === 'agents')

  const renderViewLink = (view: (typeof views)[number]) => (
    <SidebarLink
      key={view.id}
      to={destination(view.id)}
      label={view.label}
      icon={view.icon}
      active={isActive(view.id)}
      collapsed={collapsed}
      count={
        view.id === 'agents' && activity.running > 0
          ? activity.running
          : view.id === 'inbox' && unread > 0
            ? unread
            : undefined
      }
      countLabel={
        view.id === 'inbox'
          ? t('navigation:sidebar.unread', { unread })
          : t('navigation:sidebar.running', { running: activity.running })
      }
    />
  )

  return (
    <>
      <aside
        ref={asideRef}
        className={`ostler-sidebar${collapsed ? ' collapsed' : ''}`}
        style={!collapsed && width !== null ? { width } : undefined}
        aria-label={t('navigation:sidebar.sidebar')}
      >
        <div className="ostler-sidebar-header">
          <div className="ostler-sidebar-logo">
            <Icon icon={Hexagon} size="lg" className="logo-icon" />
            {!collapsed && <span>{BRAND.name}</span>}
          </div>
          <IconButton
            label={
              collapsed
                ? t('navigation:sidebar.expandSidebar')
                : t('navigation:sidebar.collapseSidebar')
            }
            shortcut={shortcut('sidebar').keys}
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            size="sm"
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
          />
        </div>

        <div className="ostler-sidebar-search">
          <Tooltip
            content={collapsed ? t('navigation:sidebar.search') : null}
            shortcut={collapsed ? shortcut('palette').keys : undefined}
          >
            <button
              type="button"
              className="ostler-sidebar-link ostler-sidebar-search-button"
              data-tour="search"
              onClick={onOpenPalette}
              aria-label={collapsed ? t('navigation:sidebar.search') : undefined}
              aria-keyshortcuts="Control+K"
            >
              <Icon icon={Search} />
              {!collapsed && (
                <>
                  <span className="ostler-sidebar-label">{t('navigation:sidebar.search2')}</span>
                  <Kbd shortcut={shortcut('palette').keys} />
                </>
              )}
            </button>
          </Tooltip>
        </div>

        <nav className="ostler-sidebar-nav" aria-label={t('navigation:sidebar.main')}>
          {views.filter((view) => view.order < SIDEBAR_PROJECTS_ORDER).map(renderViewLink)}
        </nav>

        <PinnedSection projects={projects} collapsed={collapsed} />

        <ProjectList
          projects={projects}
          areas={areas ?? []}
          collapsed={collapsed}
          currentProjectId={currentProjectId}
          currentSubprojectId={currentSubprojectId}
          currentView={currentView}
          onNewProject={onNewProject}
          onReordered={() => void refreshProjects()}
        />

        <nav
          className="ostler-sidebar-nav ostler-sidebar-nav--end"
          aria-label={t('navigation:sidebar.more')}
        >
          {views.filter((view) => view.order >= SIDEBAR_PROJECTS_ORDER).map(renderViewLink)}
          <HelpMenu collapsed={collapsed} />
        </nav>
      </aside>
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('common:drawer.resizePanel')}
          aria-valuenow={Math.round(currentWidth())}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          tabIndex={0}
          className="ostler-sidebar-resize"
          onKeyDown={onResizeKey}
          onPointerDown={onResizeStart}
        />
      )}
    </>
  )
}

/**
 * Where the sidebar's Agents entry goes: the current project's Agents view,
 * else a project with agents running, else the first project with a folder.
 * Agents work in a folder, so with none linked it opens Settings › Projects.
 */
export function agentsDestination(
  projects: RendererProject[],
  currentProjectId: string | null,
  running: Record<string, number>
): string {
  const withFolder = projects.filter((project) => projectFolder(project) !== null)
  const target =
    withFolder.find((project) => project.id === currentProjectId) ??
    withFolder.find((project) => (running[project.id] ?? 0) > 0) ??
    withFolder[0]
  return target ? projectPath(target.id, 'agents') : settingsPath('projects')
}

function SidebarLink({
  to,
  label,
  icon,
  active,
  collapsed,
  count,
  countLabel
}: {
  to: string
  label: string
  icon: LucideIcon
  active: boolean
  collapsed: boolean
  count?: number
  countLabel?: string
}) {
  return (
    <Tooltip content={collapsed ? label : null} placement="right-start">
      <Link
        to={to}
        className={`ostler-sidebar-link${active ? ' active' : ''}`}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? label : undefined}
      >
        <Icon icon={icon} />
        {!collapsed && <span className="ostler-sidebar-label">{label}</span>}
        {count !== undefined && (
          <span className="ostler-sidebar-count" aria-label={countLabel}>
            {count}
          </span>
        )}
      </Link>
    </Tooltip>
  )
}

/** Where the sidebar remembers which areas are folded: a viewer convenience, not config (N5.1). */
export const FOLDED_AREAS_KEY = 'ostler.sidebar.foldedAreas'
/** The fold key of "No area". */
const NO_AREA_KEY = ':none'

function readFolded(): Set<string> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(FOLDED_AREAS_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Where the sidebar remembers which projects show their workstreams: a viewer convenience (D12). */
export const OPEN_PROJECTS_KEY = 'ostler.sidebar.openProjects'

function readOpenProjects(): Set<string> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(OPEN_PROJECTS_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function ProjectList({
  projects,
  areas,
  collapsed,
  currentProjectId,
  currentSubprojectId,
  currentView,
  onNewProject,
  onReordered
}: {
  projects: RendererProject[]
  areas: ProjectArea[]
  collapsed: boolean
  currentProjectId: string | null
  currentSubprojectId: string | null
  currentView: ProjectViewId | null
  onNewProject: () => void
  onReordered: () => void
}) {
  const { toast } = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const actions = useProjectActions()
  const areaActions = useAreaActions(areas)
  const stageNames = useProjectStageNames()
  // Shown at once while the save is in flight; dropped when the pushed
  // project list arrives (or the save fails).
  const [pending, setPending] = useState<{
    order: string[]
    areaOf: Record<string, string | null>
  } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [draggingArea, setDraggingArea] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [folded, setFolded] = useState<Set<string>>(readFolded)
  const [openProjects, setOpenProjects] = useState<Set<string>>(readOpenProjects)
  const [subDialog, setSubDialog] = useState<{
    project: RendererProject
    subproject: PlanningSubproject | null
    mode: SubprojectDialogMode
  } | null>(null)
  const linkRefs = useRef(new Map<string, HTMLAnchorElement>())
  const listRef = useRef<HTMLElement | null>(null)
  useReorderMotion(listRef)
  const subprojects = useSidebarSubprojects(projects.map((project) => project.id))

  const savedIds = projects.map((project) => project.id)
  const savedKey = projects.map((project) => `${project.id}:${project.areaId ?? ''}`).join('\n')
  useEffect(() => setPending(null), [savedKey])
  const byId = new Map(projects.map((project) => [project.id, project]))
  const shown = (pending?.order ?? savedIds)
    .map((id) => byId.get(id))
    .filter((p): p is RendererProject => Boolean(p))
    .map((project) =>
      pending && project.id in pending.areaOf
        ? { ...project, areaId: pending.areaOf[project.id] }
        : project
    )
  // "No area" with nothing in it shows only while a project is dragged, as a place to drop it.
  const groups = groupProjectsByArea(shown, areas).filter(
    (group) => group.area !== null || group.projects.length > 0 || dragging !== null
  )
  const ids = groups.flatMap((group) => group.projects.map((project) => project.id))
  const areaOf = new Map(shown.map((project) => [project.id, project.areaId ?? null]))
  const groupOf = (id: string) =>
    groups.find((group) => group.projects.some((project) => project.id === id))!

  useEffect(() => {
    if (!focusId) return
    linkRefs.current.get(focusId)?.focus()
    setFocusId(null)
  }, [focusId, ids.join('\n')])

  const save = async (
    order: string[],
    keepFocusOn?: string,
    moved: Record<string, string | null> = {}
  ) => {
    const changes = Object.entries(moved).filter(([id, areaId]) => areaOf.get(id) !== areaId)
    if (order.join('\n') === ids.join('\n') && changes.length === 0) return
    setPending({ order, areaOf: Object.fromEntries(changes) })
    if (keepFocusOn) setFocusId(keepFocusOn)
    for (const [id, areaId] of changes) {
      const moveResult = await window.ostlerAPI.updateProject(id, { areaId })
      if (!moveResult.ok) {
        setPending(null)
        toast({ title: t('projects:areas.couldntMove'), body: moveResult.error, tone: 'danger' })
        return
      }
    }
    const result =
      order.join('\n') === savedIds.join('\n')
        ? ({ ok: true } as const)
        : await window.ostlerAPI.reorderProjects(order)
    if (!result.ok) {
      setPending(null)
      toast({
        title: t('navigation:sidebar.couldnTSaveProject'),
        body: result.error,
        tone: 'danger'
      })
      return
    }
    onReordered()
  }

  /** The order with `id` moved within its own area. */
  const movedWithinArea = (id: string, delta: number): string[] =>
    groups.flatMap((group) => {
      const groupIds = group.projects.map((project) => project.id)
      return groupIds.includes(id) ? moveProject(groupIds, id, delta) : groupIds
    })

  /** The order with `id` at the end of `areaId`'s group. */
  const movedToArea = (id: string, areaId: string | null): string[] =>
    groups.flatMap((group) => {
      const groupIds = group.projects.map((project) => project.id).filter((entry) => entry !== id)
      return (group.area?.id ?? null) === areaId ? [...groupIds, id] : groupIds
    })

  const toArea = (id: string, areaId: string | null) =>
    void save(movedToArea(id, areaId), id, { [id]: areaId })

  const onKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, id: string) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    void save(movedWithinArea(id, event.key === 'ArrowUp' ? -1 : 1), id)
  }

  // The pointer's way to reorder without dragging (P9.2, WCAG 2.5.7), as
  // Alt+Up and Alt+Down are the keyboard's.
  const orderItems = (id: string): MenuEntry[] => {
    const groupIds = groupOf(id).projects.map((project) => project.id)
    const index = groupIds.indexOf(id)
    const current = areaOf.get(id) ?? null
    return [
      { type: 'separator' },
      {
        label: t('navigation:sidebar.moveUp'),
        icon: ArrowUp,
        disabled: index <= 0,
        onSelect: () => void save(movedWithinArea(id, -1), id)
      },
      {
        label: t('navigation:sidebar.moveDown'),
        icon: ArrowDown,
        disabled: index === -1 || index >= groupIds.length - 1,
        onSelect: () => void save(movedWithinArea(id, 1), id)
      },
      ...(areas.length > 0
        ? ([
            {
              type: 'group',
              label: t('projects:areas.moveToArea'),
              items: [
                ...areas.map((area) => ({
                  label: area.name,
                  icon: Layers,
                  disabled: current === area.id,
                  onSelect: () => toArea(id, area.id)
                })),
                {
                  label: t('projects:areas.noArea'),
                  disabled: current === null,
                  onSelect: () => toArea(id, null)
                }
              ]
            }
          ] satisfies MenuEntry[])
        : []),
      { type: 'separator' },
      {
        label: t('projects:areas.newArea'),
        icon: Plus,
        onSelect: areaActions.newArea
      }
    ]
  }

  const onDrop = (event: DragEvent, targetId: string) => {
    event.preventDefault()
    event.stopPropagation()
    const draggedId = event.dataTransfer.getData('text/x-ostler-project') || dragging
    setDragging(null)
    if (!draggedId || !byId.has(draggedId)) return
    const targetArea = areaOf.get(targetId) ?? null
    void save(dropProject(ids, draggedId, targetId), undefined, { [draggedId]: targetArea })
  }

  const onDropOnArea = (event: DragEvent, area: ProjectArea | null) => {
    event.preventDefault()
    const draggedArea = event.dataTransfer.getData('text/x-ostler-area') || draggingArea
    const draggedId = event.dataTransfer.getData('text/x-ostler-project') || dragging
    setDragging(null)
    setDraggingArea(null)
    if (draggedArea) {
      if (!area || area.id === draggedArea) return
      const from = areas.findIndex((entry) => entry.id === draggedArea)
      const to = areas.findIndex((entry) => entry.id === area.id)
      const moving = areas[from]
      if (moving) void areaActions.move(moving, to - from)
      return
    }
    if (draggedId && byId.has(draggedId)) toArea(draggedId, area?.id ?? null)
  }

  const toggleFold = (key: string) => {
    setFolded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try {
        window.localStorage.setItem(FOLDED_AREAS_KEY, JSON.stringify([...next]))
      } catch {
        // Storage full or off: folding still works for this session.
      }
      return next
    })
  }

  const toggleOpen = (projectId: string) => {
    setOpenProjects((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      try {
        window.localStorage.setItem(OPEN_PROJECTS_KEY, JSON.stringify([...next]))
      } catch {
        // Storage full or off: it still opens for this session.
      }
      return next
    })
  }

  /** Where a workstream opens: the view in use if a workstream can scope it, else the project's own. */
  const subprojectTo = (sub: PlanningSubproject) =>
    subprojectPath(
      sub.projectId,
      sub.id,
      currentView && isSubprojectScoped(currentView) ? currentView : undefined
    )

  const subFailed = (title: string, error: string) => toast({ title, body: error, tone: 'danger' })

  const markSubproject = async (sub: PlanningSubproject, status: PlanningSubproject['status']) => {
    const result = await window.ostlerAPI.updateSubproject(sub.id, { status })
    if (!result.ok) subFailed(t('projects:subprojects.couldntSave'), result.error)
  }

  const removeSubproject = async (sub: PlanningSubproject) => {
    const result = await window.ostlerAPI.deleteSubproject(sub.id)
    if (!result.ok) subFailed(t('projects:subprojects.couldntDelete'), result.error)
    else if (currentSubprojectId === sub.id) navigate(projectPath(sub.projectId))
  }

  /** A project's menu entries for its workstreams: New workstream, and in the icon-only sidebar the list to open. */
  const projectSubprojectItems = (
    project: RendererProject,
    subs: PlanningSubproject[]
  ): MenuEntry[] => [
    { type: 'separator' },
    {
      label: t('projects:subprojects.newWorkstream'),
      icon: Plus,
      onSelect: () => setSubDialog({ project, subproject: null, mode: 'new' })
    },
    ...(collapsed && subs.length > 0
      ? ([
          {
            type: 'group',
            label: t('projects:subprojects.openWorkstream'),
            items: subs.map((sub) => ({
              label: sub.name,
              onSelect: () => navigate(subprojectTo(sub))
            }))
          }
        ] satisfies MenuEntry[])
      : [])
  ]

  const subprojectItems = (sub: PlanningSubproject, list: PlanningSubproject[]): MenuEntry[] => {
    const index = list.findIndex((entry) => entry.id === sub.id)
    const project = byId.get(sub.projectId)
    const move = async (direction: -1 | 1) => {
      const result = await window.ostlerAPI.moveSubproject(sub.id, direction)
      if (!result.ok) subFailed(t('projects:subprojects.couldntMove'), result.error)
    }
    const edit = (mode: SubprojectDialogMode) => () => {
      if (project) setSubDialog({ project, subproject: sub, mode })
    }
    return [
      { label: t('projects:subprojects.rename'), icon: Pencil, onSelect: edit('rename') },
      { label: t('projects:subprojects.editDetails'), icon: Pencil, onSelect: edit('details') },
      { type: 'separator' },
      {
        label: t('navigation:sidebar.moveUp'),
        icon: ArrowUp,
        disabled: index <= 0,
        onSelect: () => void move(-1)
      },
      {
        label: t('navigation:sidebar.moveDown'),
        icon: ArrowDown,
        disabled: index === -1 || index >= list.length - 1,
        onSelect: () => void move(1)
      },
      { type: 'separator' },
      ...(sub.status === 'active'
        ? ([
            {
              label: t('projects:subprojects.markOnHold'),
              icon: Pause,
              onSelect: () => void markSubproject(sub, 'on_hold')
            }
          ] satisfies MenuEntry[])
        : ([
            {
              label: t('projects:subprojects.markActive'),
              icon: Play,
              onSelect: () => void markSubproject(sub, 'active')
            }
          ] satisfies MenuEntry[])),
      ...(sub.status !== 'done'
        ? ([
            {
              label: t('projects:subprojects.markDone'),
              icon: CircleCheck,
              onSelect: () => void markSubproject(sub, 'done')
            }
          ] satisfies MenuEntry[])
        : []),
      { type: 'separator' },
      {
        label: t('projects:subprojects.archive'),
        icon: Archive,
        onSelect: () =>
          void window.ostlerAPI.archiveSubproject(sub.id, true).then((result) => {
            if (!result.ok) subFailed(t('projects:subprojects.couldntArchive'), result.error)
          })
      },
      {
        label: t('projects:subprojects.delete'),
        icon: Trash2,
        tone: 'danger',
        onSelect: () =>
          void confirm({
            title: t('projects:subprojects.deleteTitle', { name: sub.name }),
            body: t('projects:subprojects.deleteBody'),
            confirmLabel: t('projects:subprojects.deleteConfirm'),
            tone: 'danger'
          })
            .then((yes) => (yes ? removeSubproject(sub) : undefined))
            .catch(() => undefined)
      }
    ]
  }

  const renderSubproject = (sub: PlanningSubproject, list: PlanningSubproject[]) => {
    const active = sub.projectId === currentProjectId && sub.id === currentSubprojectId
    const resting = sub.status !== 'active'
    const statusWord = resting
      ? sub.status === 'done'
        ? t('projects:subprojects.statusDone')
        : t('projects:subprojects.statusOnHold')
      : null
    return (
      <li key={sub.id} className="subproject-item" data-motion-key={`sub:${sub.id}`}>
        <ContextMenu
          label={t('projects:subprojects.actionsFor', { name: sub.name })}
          items={() => subprojectItems(sub, list)}
        >
          <Link
            to={subprojectTo(sub)}
            className={`ostler-sidebar-link subproject-link${active ? ' active' : ''}${resting ? ' is-resting' : ''}`}
            aria-current={active ? 'page' : undefined}
            title={sub.name}
          >
            <ProjectMark project={sub} className="project-color" />
            <span className="project-name">{sub.name}</span>
            {statusWord && <span className="project-stage-mark">{statusWord}</span>}
          </Link>
        </ContextMenu>
      </li>
    )
  }

  const areaItems = (area: ProjectArea): MenuEntry[] => {
    const index = areas.findIndex((entry) => entry.id === area.id)
    return [
      {
        label: t('projects:areas.rename'),
        icon: Pencil,
        onSelect: () => areaActions.rename(area)
      },
      {
        label: t('navigation:sidebar.moveUp'),
        icon: ArrowUp,
        disabled: index <= 0,
        onSelect: () => void areaActions.move(area, -1)
      },
      {
        label: t('navigation:sidebar.moveDown'),
        icon: ArrowDown,
        disabled: index >= areas.length - 1,
        onSelect: () => void areaActions.move(area, 1)
      },
      { type: 'separator' },
      {
        label: t('projects:areas.newArea'),
        icon: Plus,
        onSelect: areaActions.newArea
      },
      {
        label: t('projects:areas.remove'),
        icon: Trash2,
        tone: 'danger',
        onSelect: () => void areaActions.remove(area)
      }
    ]
  }

  const renderProject = (project: RendererProject) => {
    const subs = subprojects.byProject.get(project.id) ?? []
    const hasSubs = !collapsed && subs.length > 0
    // The project of the workstream open now always shows its workstreams.
    const holdsCurrent = subs.some(
      (sub) => project.id === currentProjectId && sub.id === currentSubprojectId
    )
    const expanded = hasSubs && (openProjects.has(project.id) || holdsCurrent)
    const active = project.id === currentProjectId && !holdsCurrent
    // On hold and Done (N5.3) are marked quietly; the order stays the person's.
    const resting = !isStageInPlay(project.stage)
    const stageWord = resting
      ? projectStageName(normalizeProjectStage(project.stage), stageNames.names)
      : null
    const label = stageWord
      ? t('projects:projectStages.sidebarLabel', { projectName: project.name, stage: stageWord })
      : project.name
    return (
      <li
        key={project.id}
        data-motion-key={`project:${project.id}`}
        className={dragging === project.id ? 'is-dragging' : undefined}
        onDragOver={(event) => {
          if (dragging) event.preventDefault()
        }}
        onDrop={(event) => onDrop(event, project.id)}
      >
        <div className={hasSubs ? 'project-row project-row--disclosable' : undefined}>
          {hasSubs && (
            <button
              type="button"
              className="project-disclosure"
              aria-expanded={expanded}
              aria-label={t(
                expanded
                  ? 'projects:subprojects.hideWorkstreamsOf'
                  : 'projects:subprojects.showWorkstreamsOf',
                { projectName: project.name }
              )}
              onClick={() => toggleOpen(project.id)}
            >
              <Icon icon={ChevronRight} className={chevronClass(expanded)} />
            </button>
          )}
          <ContextMenu
            label={t('navigation:sidebar.actions', { projectName: project.name })}
            items={() => [
              ...actions.items(project),
              ...projectSubprojectItems(project, subs),
              ...orderItems(project.id)
            ]}
          >
            <Link
              ref={(node) => {
                if (node) linkRefs.current.set(project.id, node)
                else linkRefs.current.delete(project.id)
              }}
              to={projectPath(project.id)}
              className={`ostler-sidebar-link project-link${active ? ' active' : ''}${resting ? ' is-resting' : ''}`}
              aria-current={active ? 'page' : undefined}
              aria-label={collapsed ? label : undefined}
              // The whole name on hover, since a long one is cut off in the sidebar.
              title={label}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('text/x-ostler-project', project.id)
                event.dataTransfer.effectAllowed = 'move'
                setDragging(project.id)
              }}
              onDragEnd={() => setDragging(null)}
              onKeyDown={(event) => {
                // Right opens a project's workstreams and Left closes them.
                if (hasSubs && !event.altKey && !event.ctrlKey && !event.metaKey) {
                  if (event.key === 'ArrowRight' && !expanded) {
                    event.preventDefault()
                    toggleOpen(project.id)
                    return
                  }
                  if (event.key === 'ArrowLeft' && expanded && !holdsCurrent) {
                    event.preventDefault()
                    toggleOpen(project.id)
                    return
                  }
                }
                onKeyDown(event, project.id)
              }}
            >
              <ProjectMark project={project} className="project-color" />
              {!collapsed && <span className="project-name">{project.name}</span>}
              {!collapsed && stageWord && <span className="project-stage-mark">{stageWord}</span>}
            </Link>
          </ContextMenu>
        </div>
        {expanded && (
          <ul
            className="subprojects-list"
            role="group"
            aria-label={t('projects:subprojects.workstreamsOf', { projectName: project.name })}
          >
            {subs.map((sub) => renderSubproject(sub, subs))}
          </ul>
        )}
      </li>
    )
  }

  const renderGroup = (group: ProjectAreaGroup<RendererProject>, index: number) => {
    const { area } = group
    const key = area?.id ?? NO_AREA_KEY
    const name = area?.name ?? t('projects:areas.noArea')
    const isFolded = !collapsed && folded.has(key)
    const headingId = `ostler-sidebar-area-${index}`
    if (collapsed) {
      return (
        <li key={key} className="projects-area projects-area--collapsed">
          <VisuallyHidden>
            <h3 id={headingId}>{name}</h3>
          </VisuallyHidden>
          <ul className="projects-list" aria-labelledby={headingId}>
            {group.projects.map(renderProject)}
          </ul>
        </li>
      )
    }
    const heading = (
      <button
        type="button"
        className={`projects-area-heading${draggingArea === area?.id ? ' is-dragging' : ''}`}
        aria-expanded={!isFolded}
        aria-keyshortcuts={area ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
        draggable={Boolean(area)}
        onClick={() => toggleFold(key)}
        onKeyDown={(event) => {
          if (!area || !event.altKey) return
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          void areaActions.move(area, event.key === 'ArrowUp' ? -1 : 1)
        }}
        onDragStart={(event) => {
          if (!area) return
          event.dataTransfer.setData('text/x-ostler-area', area.id)
          event.dataTransfer.effectAllowed = 'move'
          setDraggingArea(area.id)
        }}
        onDragEnd={() => setDraggingArea(null)}
        onDragOver={(event) => {
          if (dragging || (draggingArea && area)) event.preventDefault()
        }}
        onDrop={(event) => onDropOnArea(event, area)}
      >
        <Icon icon={ChevronRight} className={chevronClass(!isFolded)} />
        <span id={headingId} className="projects-area-name">
          {name}
        </span>
        {isFolded && (
          <span className="projects-area-count">
            {t('projects:areas.projectCount', { count: group.projects.length })}
          </span>
        )}
      </button>
    )
    return (
      <li key={key} className="projects-area" data-motion-key={`area:${key}`}>
        <h3 className="projects-area-title">
          {area ? (
            <ContextMenu label={t('projects:areas.actions', { name })} items={areaItems(area)}>
              {heading}
            </ContextMenu>
          ) : (
            heading
          )}
        </h3>
        <Collapse open={!isFolded}>
          <ul className="projects-list" aria-labelledby={headingId}>
            {group.projects.map(renderProject)}
          </ul>
        </Collapse>
      </li>
    )
  }

  return (
    <section
      ref={listRef}
      className="ostler-sidebar-projects"
      aria-labelledby="ostler-sidebar-projects-title"
    >
      <div className="ostler-sidebar-projects-header">
        {collapsed ? (
          <VisuallyHidden>
            <h2 id="ostler-sidebar-projects-title">{t('navigation:sidebar.projects')}</h2>
          </VisuallyHidden>
        ) : (
          <h2 id="ostler-sidebar-projects-title" className="projects-title">
            {t('navigation:sidebar.projects')}
          </h2>
        )}
        <div className="ostler-sidebar-projects-actions">
          {!collapsed && (
            <Menu
              label={t('projects:areas.listActions')}
              items={[
                { label: t('navigation:sidebar.newProject'), icon: Plus, onSelect: onNewProject },
                { label: t('projects:areas.newArea'), icon: Layers, onSelect: areaActions.newArea }
              ]}
            />
          )}
          <IconButton
            label={t('navigation:sidebar.newProject')}
            icon={Plus}
            size="sm"
            onClick={onNewProject}
          />
        </div>
      </div>
      {areas.length === 0 ? (
        <ul className="projects-list">{(groups[0]?.projects ?? []).map(renderProject)}</ul>
      ) : (
        <ul className="projects-areas">{groups.map(renderGroup)}</ul>
      )}
      {actions.dialogs}
      {areaActions.dialogs}
      {subDialog && (
        <SubprojectDialog
          project={subDialog.project}
          subproject={subDialog.subproject}
          mode={subDialog.mode}
          onClose={() => setSubDialog(null)}
          onSaved={(saved, created) => {
            void subprojects.reload(saved.projectId)
            // The project of the workstream open now shows its workstreams, so it is found at once.
            if (created) navigate(subprojectTo(saved))
          }}
        />
      )}
    </section>
  )
}
