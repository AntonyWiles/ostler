import { useCallback, useEffect, useState } from 'react'
import type { FocusState, PlanningWorkItem, TimeEntry } from '@shared/ostler-api'
import type { StickyTaskRef } from '@shared/sticky-task'
import { minutesLeft } from '@shared/focus'
import { formatTimerClock } from '@shared/time/duration'
import { ProjectMark } from '../components/ProjectMark'
import { useOstler } from '../context/OstlerContext'
import { taskPath } from '../navigation/paths'
import { useNow } from '../time/TimerProvider'
import { Button, Checkbox, IconButton, Spinner, useToast } from '../ui'
import { Check, Square, Timer, X } from '../ui/icons'
import { cardDue } from '../views/planning/card-due'
import { checklistProgressText } from '../views/planning/TaskChecklistEditor'
import { t } from '@shared/i18n'
import './StickyTaskWindow.css'

/** Why a sticky window has no task to show: it is done, closed, or gone. */
export type StickyGone = 'done' | 'archived' | 'deleted' | 'missing' | 'projectRemoved'

export type StickyLoad =
  | { kind: 'loading' }
  | { kind: 'task'; task: PlanningWorkItem }
  | { kind: 'gone'; why: StickyGone; task: PlanningWorkItem | null }

/**
 * Finds the pinned task wherever it is now: live (or in To triage), done,
 * archived, or in the recycle bin. One list call per scope, only as far as
 * needed.
 */
export async function loadStickyTask(ref: StickyTaskRef): Promise<StickyLoad> {
  for (const scope of ['live', 'triage'] as const) {
    const result = await window.ostlerAPI.getPlanningWorkItems(ref.projectId, scope)
    if (!result.ok) continue
    const task = result.value.find((item) => item.id === ref.taskId)
    if (task)
      return task.status === 'done' ? { kind: 'gone', why: 'done', task } : { kind: 'task', task }
  }
  for (const scope of ['archived', 'deleted'] as const) {
    const result = await window.ostlerAPI.getPlanningWorkItems(ref.projectId, scope)
    const task = result.ok ? result.value.find((item) => item.id === ref.taskId) : undefined
    if (task) return { kind: 'gone', why: scope, task }
  }
  return { kind: 'gone', why: 'missing', task: null }
}

const GONE_TEXT: Record<StickyGone, string> = {
  done: 'tasks:sticky.isDone',
  archived: 'tasks:sticky.isArchived',
  deleted: 'tasks:sticky.isDeleted',
  missing: 'tasks:sticky.isMissing',
  projectRemoved: 'tasks:sticky.projectRemoved'
}

/** The one timer (R2.3) and the focus countdown (N3.5), read straight from main. */
function useTimeOnTask(taskId: string) {
  const [running, setRunning] = useState<TimeEntry | null>(null)
  const [focus, setFocus] = useState<FocusState | null>(null)
  const loadTimer = useCallback(async () => {
    const result = await window.ostlerAPI.getTimer()
    if (result.ok) setRunning(result.value.running)
  }, [])
  useEffect(() => {
    void loadTimer()
    void window.ostlerAPI.getFocus().then((result) => {
      if (result.ok) setFocus(result.value)
    })
    const offTime = window.ostlerAPI.onTimeChange(() => void loadTimer())
    const offFocus = window.ostlerAPI.onFocusChange((change) => setFocus(change.focus))
    return () => {
      offTime()
      offFocus()
    }
  }, [loadTimer])
  const timing = running?.workItemId === taskId ? running : null
  const focusing = focus?.workItemId === taskId && focus.phase === 'focus' ? focus : null
  return { timing, focusing, reload: loadTimer, setRunning }
}

/**
 * A sticky task (N5.8b, N43): one task in a small window on top of the
 * others, with its project's colour and icon, its due date in words, its
 * checklist to tick, the timer and the focus time left, and Done. It follows
 * every change from any window; when the task is done, closed or gone it says
 * so and offers Unpin. Esc hands the focus back to the app before it.
 */
export function StickyTaskWindow({ taskRef }: { taskRef: StickyTaskRef }) {
  const { projects, loading: projectsLoading } = useOstler()
  const { toast, toastUndo } = useToast()
  const [load, setLoad] = useState<StickyLoad>({ kind: 'loading' })
  const { timing, focusing, reload: reloadTimer, setRunning } = useTimeOnTask(taskRef.taskId)
  const now = useNow(timing !== null || focusing !== null)
  const project = projects.find((candidate) => candidate.id === taskRef.projectId) ?? null
  const projectGone = !projectsLoading && project === null

  const reload = useCallback(async () => {
    setLoad(await loadStickyTask(taskRef))
  }, [taskRef])

  useEffect(() => {
    void reload()
    // Live (N5.8a's broadcast): every change to the project's tasks, from any window.
    return window.ostlerAPI.onProjectStateChange((state) => {
      if (state.projectId === taskRef.projectId && state.field === 'planning') void reload()
    })
  }, [reload, taskRef.projectId])

  const shown: StickyLoad = projectGone ? { kind: 'gone', why: 'projectRemoved', task: null } : load
  const task = shown.kind === 'loading' ? null : shown.task
  const title = task?.title ?? ''

  // The window's accessible name is the task's title.
  useEffect(() => {
    if (title) document.title = title
  }, [title])

  // Esc returns the focus to the app before this one; the window stays.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      void window.ostlerAPI.releaseStickyFocus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const failed = (error: string) =>
    toast({ title: t('tasks:sticky.couldNotChange'), body: error, tone: 'danger' })

  const tick = async (text: string, checked: boolean) => {
    if (!task) return
    const result = await window.ostlerAPI.setPlanningChecklistItemChecked(task.id, text, checked)
    if (!result.ok) return failed(result.error)
    setLoad({ kind: 'task', task: result.value })
  }

  // Done, through the normal status change; Undo puts the status back.
  const markDone = async () => {
    if (!task) return
    const before = task.status
    const result = await window.ostlerAPI.updatePlanningWorkItem(task.id, { status: 'done' })
    if (!result.ok) return failed(result.error)
    setLoad({ kind: 'gone', why: 'done', task: result.value })
    toastUndo(t('tasks:sticky.markedDone', { title: result.value.title }), async () => {
      await window.ostlerAPI.updatePlanningWorkItem(task.id, { status: before })
      await reload()
    })
  }

  const startTimer = async () => {
    const result = await window.ostlerAPI.startTimer(taskRef.projectId, taskRef.taskId)
    if (!result.ok)
      return toast({ title: t('tasks:time.couldNotStart'), body: result.error, tone: 'danger' })
    setRunning(result.value.started)
  }
  const stopTimer = async () => {
    const result = await window.ostlerAPI.stopTimer()
    if (!result.ok)
      return toast({ title: t('tasks:time.couldNotStop'), body: result.error, tone: 'danger' })
    void reloadTimer()
  }

  const unpin = () => void window.ostlerAPI.unpinStickyTask()
  const openInMain = () =>
    void window.ostlerAPI.openInMainWindow(taskPath(taskRef.projectId, taskRef.taskId))

  const due = task?.targetDate ? cardDue(task.targetDate, task.status === 'done') : null
  const checked = new Set(task?.checkedCriteria ?? [])

  return (
    <div className="sticky-task" aria-label={title || undefined} role="region">
      <header className="sticky-task-header">
        <ProjectMark
          project={
            project ? { color: project.color || 'var(--color-accent)', icon: project.icon } : null
          }
        />
        {task ? (
          <button
            type="button"
            className="sticky-task-title"
            onClick={openInMain}
            aria-label={t('tasks:sticky.openTask', { title })}
            title={title}
          >
            {title}
          </button>
        ) : (
          <span className="sticky-task-title" />
        )}
        <IconButton icon={X} label={t('tasks:sticky.unpin')} size="sm" onClick={unpin} />
      </header>
      <main className="sticky-task-body">
        {shown.kind === 'loading' ? (
          <Spinner label={t('tasks:sticky.loading')} />
        ) : shown.kind === 'gone' ? (
          <div className="sticky-task-gone" role="status">
            <p>{t(GONE_TEXT[shown.why])}</p>
            <Button size="sm" onClick={unpin}>
              {t('tasks:sticky.unpin')}
            </Button>
          </div>
        ) : (
          <>
            <p className="sticky-task-meta">
              <span className={due ? `sticky-task-due is-${due.tone}` : 'sticky-task-due'}>
                {due ? due.title : t('tasks:sticky.noDue')}
              </span>
              {focusing && (
                <span className="sticky-task-focus">
                  {t('tasks:sticky.focusLeft', { count: minutesLeft(focusing.endsAt, now) })}
                </span>
              )}
            </p>
            {shown.task.acceptanceCriteria.length > 0 && (
              <section className="sticky-task-checklist" aria-label={t('tasks:sticky.checklist')}>
                <p className="sticky-task-progress">
                  {checklistProgressText(
                    shown.task.acceptanceCriteria.filter((text) => checked.has(text)).length,
                    shown.task.acceptanceCriteria.length
                  )}
                </p>
                <ul>
                  {shown.task.acceptanceCriteria.map((text) => (
                    <li key={text}>
                      <Checkbox
                        label={text}
                        checked={checked.has(text)}
                        onChange={(event) => void tick(text, event.currentTarget.checked)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
      {shown.kind === 'task' && (
        <footer className="sticky-task-footer">
          {timing ? (
            <Button size="sm" icon={Square} onClick={() => void stopTimer()}>
              {t('tasks:time.stopTimer')}
              <span className="sticky-task-clock">{formatTimerClock(now - timing.startedAt)}</span>
            </Button>
          ) : (
            <Button size="sm" icon={Timer} onClick={() => void startTimer()}>
              {t('tasks:time.startTimer')}
            </Button>
          )}
          <Button size="sm" variant="primary" icon={Check} onClick={() => void markDone()}>
            {t('tasks:sticky.done')}
          </Button>
        </footer>
      )}
    </div>
  )
}
