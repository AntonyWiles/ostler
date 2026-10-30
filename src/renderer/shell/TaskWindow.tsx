import { Suspense, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TaskWindowRef } from '@shared/task-window'
import markUrl from '../../../build/icons/mark.svg?url'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useOstler } from '../context/OstlerContext'
import { usePlanningWorkspace } from '../hooks/usePlanningWorkspace'
import { lazyLayer, lazyNamed } from '../lib/lazy-named'
import { taskPath } from '../navigation/paths'
import { ShellProviders } from './AppShell'
import { useFlushOnQuitChannel } from './flush-on-quit'
import { useReserveTitleBar, WindowControls } from './TitleBar'
import './TitleBar.css'
import './AppShell.css'
import './PopOutShell.css'
import './TaskWindow.css'
import { BRAND } from '@shared/brand'

const WorkItemDrawer = lazyNamed(() => import('../views/planning/WorkItemDrawer'), 'WorkItemDrawer')
const WontDoDialog = lazyLayer(() => import('../views/planning/WontDoDialog'), 'WontDoDialog')
const BlockTimeFor = lazyLayer(
  () => import('../components/time-blocks/BlockTimeDialog'),
  'BlockTimeFor'
)
const MarkDuplicateDialog = lazyLayer(
  () => import('../views/planning/MarkDuplicateDialog'),
  'MarkDuplicateDialog'
)

/**
 * One task in a window of its own (MOP-12): the task's drawer, filling the window, on the
 * task's own planning workspace, so everything in it saves and undoes as it does in the main
 * window. "Back to main window" opens the task there and closes this one; closing the drawer
 * closes the window. Nothing else of the app is here.
 */
export function TaskWindow({ taskRef }: { taskRef: TaskWindowRef }) {
  useEffect(() => {
    document.body.classList.add('is-task-window')
    return () => document.body.classList.remove('is-task-window')
  }, [])
  return (
    <ShellProviders>
      <TaskFrame {...taskRef} />
    </ShellProviders>
  )
}

function TaskFrame({ projectId, taskId }: TaskWindowRef) {
  const navigate = useNavigate()
  const { projects } = useOstler()
  const project = projects.find((candidate) => candidate.id === projectId)
  const ws = usePlanningWorkspace(projectId, navigate, {
    view: 'board',
    setView: () => {},
    safetyPoll: false
  })
  useFlushOnQuitChannel()
  useReserveTitleBar()
  const opened = useRef(false)
  const read = useRef(false)
  if (ws.loading) read.current = true
  const item = ws.workItems.find((candidate) => candidate.id === taskId)

  const title = item?.title || BRAND.name
  const place = project ? `${title} · ${project.name}` : title
  useEffect(() => {
    document.title = place
  }, [place])

  useEffect(() => {
    if (opened.current || !item) return
    opened.current = true
    ws.openWorkItem(item)
  }, [item])
  // Gone before it opened (deleted elsewhere), or closed: the window has done its job.
  useEffect(() => {
    if (read.current && !opened.current && !ws.loading && !item) window.close()
  }, [ws.loading, item])
  useEffect(() => {
    if (opened.current && ws.selectedWorkItem === null) window.close()
  }, [ws.selectedWorkItem])

  const backToMain = async () => {
    ws.flushEdits()
    await ws.waitForSaves()
    await window.ostlerAPI.openInMainWindow(taskPath(projectId, taskId))
    window.close()
  }

  return (
    <div className="ostler-shell ostler-popout ostler-task-window">
      <header className="ostler-titlebar ostler-popout-titlebar">
        <img className="ostler-titlebar-icon" src={markUrl} alt="" draggable={false} />
        <p className="ostler-titlebar-title">
          <span className="ostler-titlebar-place">{place}</span>
        </p>
        <WindowControls />
      </header>
      <main className="ostler-content" tabIndex={-1}>
        <ErrorBoundary scope="view">
          <Suspense fallback={null}>
            {opened.current && <WorkItemDrawer ws={ws} onBackToMain={() => void backToMain()} />}
          </Suspense>
          <Suspense fallback={null}>
            {ws.wontDoTargets && <WontDoDialog ws={ws} targets={ws.wontDoTargets} />}
            {ws.blockTimeTarget && (
              <BlockTimeFor item={ws.blockTimeTarget} onClose={() => ws.setBlockTimeTarget(null)} />
            )}
            {ws.duplicateTarget && <MarkDuplicateDialog ws={ws} target={ws.duplicateTarget} />}
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  )
}
