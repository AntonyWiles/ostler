import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { NewTaskDraft } from '@shared/new-task-window'
import markUrl from '../../../build/icons/mark.svg?url'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useOstler } from '../context/OstlerContext'
import { usePlanningWorkspace } from '../hooks/usePlanningWorkspace'
import { CreateRecordModal } from '../views/planning/CreateRecordModal'
import { ShellProviders } from './AppShell'
import { useFlushOnQuitChannel } from './flush-on-quit'
import { useReserveTitleBar, WindowControls } from './TitleBar'
import './TitleBar.css'
import './AppShell.css'
import './PopOutShell.css'
import { t } from '@shared/i18n'

/**
 * New task in a window of its own: the form, filled from the draft the main window handed over.
 * Creating or cancelling closes the window; "Back to main window" hands the draft back and
 * closes it. Nothing else of the app is here.
 */
export function NewTaskWindow({ projectId }: { projectId: string }) {
  return (
    <ShellProviders>
      <NewTaskFrame projectId={projectId} />
    </ShellProviders>
  )
}

function NewTaskFrame({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const { projects } = useOstler()
  const project = projects.find((candidate) => candidate.id === projectId)
  const ws = usePlanningWorkspace(projectId, navigate)
  const wsRef = useRef(ws)
  wsRef.current = ws
  const opened = useRef(false)
  useFlushOnQuitChannel()
  useReserveTitleBar()

  const title = project
    ? t('tasks:createRecordModal.newTaskIn', { project: project.name })
    : t('tasks:createRecordModal.newTask')
  useEffect(() => {
    document.title = title
  }, [title])

  // The draft the main window handed over fills the form, once.
  useEffect(() => {
    void window.ostlerAPI.takeNewTaskDraft().then((result) => {
      if (opened.current) return
      opened.current = true
      if (result.ok && result.value) wsRef.current.applyNewTaskDraft(result.value)
      else wsRef.current.setCreateMode('work-item')
    })
  }, [])

  // Created, cancelled or discarded: the window has done its job.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (ws.createMode) wasOpen.current = true
    else if (wasOpen.current) window.close()
  }, [ws.createMode])

  const goBack = () => {
    const draft: NewTaskDraft = ws.getNewTaskDraft()
    void window.ostlerAPI.returnNewTaskToMain(draft)
  }

  return (
    <div className="ostler-shell ostler-popout">
      <header className="ostler-titlebar ostler-popout-titlebar">
        <img className="ostler-titlebar-icon" src={markUrl} alt="" draggable={false} />
        <p className="ostler-titlebar-title">
          <span className="ostler-titlebar-place">{title}</span>
        </p>
        <WindowControls />
      </header>
      <main className="ostler-content" tabIndex={-1}>
        <ErrorBoundary scope="view">
          {ws.createMode && (
            <CreateRecordModal ws={ws} selectedProject={project} onReturn={goBack} />
          )}
        </ErrorBoundary>
      </main>
    </div>
  )
}
