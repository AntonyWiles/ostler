import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { parsePopOutRoute, staysInPopOut } from '@shared/pop-out'
import markUrl from '../../../build/icons/mark.svg?url'
import { CommandPalette } from '../components/CommandPalette'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { ProjectMark } from '../components/ProjectMark'
import { useQuickAdd } from '../components/quick-add/QuickAddProvider'
import { useOstler } from '../context/OstlerContext'
import { homePath } from '../navigation/paths'
import { useShortcuts } from '../navigation/shortcuts'
import { IconButton, Menu } from '../ui'
import { AppMenu, AppWindow } from '../ui/icons'
import { ShellProviders } from './AppShell'
import { describePopOutRoute, PopOutRouteProvider } from './pop-out'
import { MAIN_CONTENT_ID, useRouteFocus } from './route-focus'
import { SkipLink } from './SkipLink'
import { useFlushOnQuitChannel } from './flush-on-quit'
import { useReserveTitleBar, WindowControls } from './TitleBar'
import './TitleBar.css'
import './AppShell.css'
import './PopOutShell.css'
import { t } from '@shared/i18n'

/**
 * A pop-out window (N5.8a): one view, Home or a project view, under a slim
 * title bar with the project's name, colour and icon (or "Home") and its
 * menu, without the sidebar or status bar. The view works as it does in the
 * main window; a link to anywhere else opens in the main window, which comes
 * forward, and this window stays on its view.
 */
export function PopOutShell({ route }: { route: string }) {
  return (
    <PopOutRouteProvider value={route}>
      <ShellProviders>
        <PopOutFrame route={route} />
      </ShellProviders>
    </PopOutRouteProvider>
  )
}

function PopOutFrame({ route }: { route: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { projects } = useOstler()
  const quickAdd = useQuickAdd()
  const [paletteOpen, setPaletteOpen] = useState(false)
  useFlushOnQuitChannel()

  // Anywhere else opens in the main window; this one stays on its view.
  useEffect(() => {
    if (staysInPopOut(route, location.pathname)) return
    void window.ostlerAPI.openInMainWindow(`${location.pathname}${location.search}`)
    navigate(route, { replace: true })
  }, [location.pathname])

  // Keys that open things act in the window that has the focus: this one.
  useShortcuts({
    palette: () => setPaletteOpen((open) => !open),
    'quick-add': () => quickAdd.open(),
    'new-task': () => quickAdd.open()
  })

  const title = describePopOutRoute(route, projects)
  useRouteFocus(title)
  useEffect(() => {
    document.title = title
  }, [title])

  return (
    <div className="ostler-shell ostler-popout">
      <SkipLink />
      <PopOutTitleBar route={route} title={title} />
      <main className="ostler-content" id={MAIN_CONTENT_ID} tabIndex={-1}>
        <ErrorBoundary scope="view">
          <Outlet />
        </ErrorBoundary>
      </main>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        // A new project is made in the main window.
        onNewProject={() => void window.ostlerAPI.openInMainWindow(homePath())}
      />
    </div>
  )
}

/** The pop-out's title bar: what it shows, and its menu with Reopen at start. */
function PopOutTitleBar({ route, title }: { route: string; title: string }) {
  const { projects } = useOstler()
  const target = parsePopOutRoute(route)
  const project =
    target?.kind === 'project'
      ? (projects.find((candidate) => candidate.id === target.projectId) ?? null)
      : null
  useReserveTitleBar()
  const [reopen, setReopen] = useState(false)
  useEffect(() => {
    let cancelled = false
    void window.ostlerAPI.getPopOut().then((result) => {
      if (!cancelled && result.ok && result.value) setReopen(result.value.reopenAtStart)
    })
    return () => {
      cancelled = true
    }
  }, [route])

  const toggleReopen = () => {
    const next = !reopen
    setReopen(next)
    void window.ostlerAPI.setPopOutReopenAtStart(next).then((result) => {
      if (!result.ok) setReopen(!next)
    })
  }

  return (
    <header className="ostler-titlebar ostler-popout-titlebar">
      {project ? (
        <ProjectMark
          project={{ color: project.color || 'var(--color-accent)', icon: project.icon }}
        />
      ) : (
        <img className="ostler-titlebar-icon" src={markUrl} alt="" draggable={false} />
      )}
      <p className="ostler-titlebar-title">
        <span className="ostler-titlebar-place">{title}</span>
      </p>
      <Menu
        label={t('navigation:popOut.windowMenu')}
        renderTrigger={(props) => (
          <IconButton
            {...props}
            className="ostler-titlebar-menu"
            icon={AppMenu}
            label={t('navigation:popOut.windowMenu')}
            size="sm"
          />
        )}
        items={[
          {
            label: t('navigation:popOut.reopenAtStart'),
            checked: reopen,
            hint: t('navigation:popOut.reopenAtStartHint'),
            onSelect: toggleReopen
          },
          {
            label: t('navigation:popOut.showMainWindow'),
            icon: AppWindow,
            // '/' only brings the main window forward, wherever it is.
            onSelect: () => void window.ostlerAPI.openInMainWindow('/')
          }
        ]}
      />
      <WindowControls />
    </header>
  )
}
