import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { CommandPalette } from '../components/CommandPalette'
import { Sidebar } from '../components/Sidebar'
import { StatusBar } from '../components/StatusBar'
import { TimerProvider } from '../time/TimerProvider'
import { FocusProvider } from '../time/FocusProvider'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { NewProjectWizardLazy as NewProjectWizard } from '../components/NewProjectWizardLazy'
import { useOstler } from '../context/OstlerContext'
import {
  homePath,
  inboxPath,
  weeklyReviewPath,
  goalsPath,
  statusUpdatePath,
  itemPath,
  myWorkPath,
  projectOpenPath,
  projectPath,
  settingsPath,
  taskPath,
  undoHistoryPath
} from '../navigation/paths'
import { isProjectViewId } from '../navigation/registry'
import { QuickAddProvider, useQuickAdd } from '../components/quick-add/QuickAddProvider'
import { PinsProvider } from '../pins/PinsProvider'
import { AskOstlerProvider } from '../components/ask-ostler/AskOstlerProvider'
import { useShortcuts } from '../navigation/shortcuts'
import { readLastProject } from '../navigation/last-view'
import { AgentActivityProvider } from './AgentActivity'
import { HelpProvider, useHelp } from '../help/HelpProvider'
import { TipsProvider } from '../tips/TipsProvider'
import { useImportDialog } from '../components/import/useImportDialog'
import { useAppearance } from '../ui/theme/ThemeProvider'
import { TitleBar, useCustomTitleBar } from './TitleBar'
import { useWhereAmI } from './useWhereAmI'
import { MAIN_CONTENT_ID, useRouteFocus } from './route-focus'
import { SkipLink } from './SkipLink'
import { useUpdateToast } from './useUpdateToast'
import { useAppCommandChannel, useAppCommands } from './app-commands'
import { useFlushOnQuitChannel } from './flush-on-quit'
import { ChangeHistoryProvider } from '../history/ChangeHistoryProvider'
import { UndoRedoControls } from '../history/UndoRedoControls'
import './AppShell.css'

/** Below this window width the sidebar collapses to icons by itself. */
export const SIDEBAR_AUTO_COLLAPSE_WIDTH = 1000

const COLLAPSED_KEY = 'ostler.sidebar.collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true'
  } catch {
    return false // localStorage unavailable -- remembering is a convenience only
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed))
  } catch {
    // ignore -- see readCollapsed
  }
}

function useNarrowWindow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH)
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return narrow
}

/**
 * The app shell: sidebar, content and status bar, with the command palette
 * and the app-wide shortcuts. Overlays portal to document.body, so they
 * stack above the status bar by z-index alone.
 */
export function AppShell() {
  return (
    <ShellProviders>
      <TipsProvider>
        <Shell />
      </TipsProvider>
    </ShellProviders>
  )
}

/** What every window's views rely on: the main window's shell and each pop-out's (N5.8a). */
export function ShellProviders({ children }: { children: ReactNode }) {
  return (
    <AgentActivityProvider>
      <QuickAddProvider>
        <AskOstlerProvider>
          <HelpProvider>
            <TimerProvider>
              <FocusProvider>
                <PinsProvider>
                  <ChangeHistoryProvider>{children}</ChangeHistoryProvider>
                </PinsProvider>
              </FocusProvider>
            </TimerProvider>
          </HelpProvider>
        </AskOstlerProvider>
      </QuickAddProvider>
    </AgentActivityProvider>
  )
}

/**
 * "When Ostler starts: the last project" (Settings › General). Only the first
 * landing on Home moves, and only to a project that still exists and is not
 * archived.
 */
function useStartPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const initialPath = useRef(location.pathname)
  const currentPath = useRef(location.pathname)
  currentPath.current = location.pathname
  useEffect(() => {
    if (initialPath.current !== homePath() && initialPath.current !== '/') return
    let cancelled = false
    void (async () => {
      const config = await window.ostlerAPI.getConfig()
      if (cancelled || !config.ok || config.value.ui.startPage !== 'lastProject') return
      // The person has already gone somewhere else.
      if (currentPath.current !== homePath()) return
      const lastId = readLastProject()
      const project = config.value.projects.find((p) => p.id === lastId && p.enabled)
      if (project) navigate(projectPath(project.id), { replace: true })
    })()
    return () => {
      cancelled = true
    }
  }, [])
}

function Shell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { refreshProjects } = useOstler()
  useStartPage()
  useUpdateToast()
  const narrow = useNarrowWindow()
  const [collapsedSetting, setCollapsedSetting] = useState(readCollapsed)
  // In a narrow window the sidebar is collapsed unless the user opens it;
  // that choice lasts until the window is wide again.
  const [openWhileNarrow, setOpenWhileNarrow] = useState(false)
  useEffect(() => {
    if (!narrow) setOpenWhileNarrow(false)
  }, [narrow])
  const collapsed = narrow ? !openWhileNarrow : collapsedSetting
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [joinInviteId, setJoinInviteId] = useState<string | undefined>(undefined)

  const toggleSidebar = () => {
    if (narrow) {
      setOpenWhileNarrow((open) => !open)
      return
    }
    setCollapsedSetting((was) => {
      writeCollapsed(!was)
      return !was
    })
  }

  const quickAdd = useQuickAdd()
  useShortcuts({
    palette: () => setPaletteOpen((open) => !open),
    settings: () => navigate(settingsPath()),
    sidebar: toggleSidebar,
    'go-home': () => navigate(homePath()),
    'go-inbox': () => navigate(inboxPath()),
    'go-my-work': () => navigate(myWorkPath()),
    'undo-history': () => navigate(undoHistoryPath()),
    'quick-add': () => quickAdd.open(),
    // Outside a project; a project workspace handles Ctrl+N itself.
    'new-task': () => quickAdd.open()
  })

  // A clicked notification, a deep link or a jump-list entry: main says what
  // to open (P5.6, P8.2). A view must be one the registry knows.
  useEffect(
    () =>
      window.ostlerAPI.onNavigate((request) => {
        switch (request.kind) {
          case 'task':
            navigate(taskPath(request.projectId, request.taskId))
            return
          case 'project':
            if (isProjectViewId(request.view))
              navigate(projectPath(request.projectId, request.view))
            else console.warn(`Ignored a link to an unknown view: ${request.view}`)
            return
          case 'inbox':
            navigate(inboxPath())
            return
          case 'quick-add':
            quickAdd.open()
            return
          case 'snip':
            quickAdd.open({ snip: request.snip })
            return
          case 'weekly-review':
            navigate(weeklyReviewPath())
            return
          case 'status-update':
            navigate(statusUpdatePath(request.projectId))
            return
          case 'milestone':
          case 'decision':
          case 'library':
            navigate(itemPath(request.kind, request.projectId, request.id))
            return
          case 'personal-goal':
            navigate(goalsPath(request.id))
            return
          // A join link: the Join step opens filled in (prompt 07).
          case 'join-share':
            setJoinInviteId(request.inviteId)
            setCreatingProject(true)
            return
          // A device asking to join (prompt 12): the Devices section shows it and its code.
          case 'devices':
            navigate(settingsPath('devices'))
            return
        }
      }),
    [navigate, quickAdd]
  )

  // A link in a pop-out to somewhere else opens here (N5.8a).
  useEffect(() => window.ostlerAPI.onOpenInMainWindow((path) => navigate(path)), [navigate])

  // A task handed back from its own window opens in its project, whose view takes it.
  useEffect(
    () =>
      window.ostlerAPI.onNewTaskReturned((projectId) => {
        if (!location.pathname.startsWith(`/projects/${projectId}/`))
          navigate(projectPath(projectId))
      }),
    [navigate, location.pathname]
  )

  // The application menu, the title bar's menu button and the tray (P8.2).
  const help = useHelp()
  const { setAppearance } = useAppearance()
  const importer = useImportDialog({ onImported: () => void refreshProjects() })
  useAppCommandChannel()
  useFlushOnQuitChannel()
  useAppCommands({
    'new-project': () => setCreatingProject(true),
    // Outside a project, the import that can make a new project.
    import: () => importer.open({ kind: 'choose' }),
    theme: (command) => void setAppearance({ theme: command.theme }),
    'user-guide': () => help.openGuide(),
    'whats-new': () => help.showWhatsNew(),
    'report-problem': () => void help.reportProblem(),
    'copy-diagnostics': () => void help.copyDiagnostics(),
    about: () => help.openAbout()
  })
  const where = useWhereAmI()
  const customTitleBar = useCustomTitleBar()
  useRouteFocus(where.label ? [where.label, where.project?.name].filter(Boolean).join(', ') : null)

  return (
    <div className="ostler-shell">
      <SkipLink />
      {customTitleBar && <TitleBar where={where} />}
      <div className="ostler-shell-main">
        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={toggleSidebar}
          onOpenPalette={() => setPaletteOpen(true)}
          onNewProject={() => setCreatingProject(true)}
        />
        <main className="ostler-content" id={MAIN_CONTENT_ID} tabIndex={-1}>
          {/* Keyed by route: a crashed page recovers when the user navigates
              away. A project workspace keeps its own boundary per view. */}
          <ErrorBoundary key={location.pathname.split('/').slice(0, 3).join('/')} scope="view">
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <StatusBar leading={customTitleBar ? null : <UndoRedoControls />} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNewProject={() => setCreatingProject(true)}
      />
      {importer.dialog}
      {creatingProject && (
        <NewProjectWizard
          onClose={() => {
            setCreatingProject(false)
            setJoinInviteId(undefined)
          }}
          onCreated={() => void refreshProjects()}
          onOpen={(project) => {
            setCreatingProject(false)
            setJoinInviteId(undefined)
            navigate(projectOpenPath(project.id, project.stage))
          }}
          joinInviteId={joinInviteId}
        />
      )}
    </div>
  )
}
