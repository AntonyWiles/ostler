import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { TimeEntry, TimerState } from '@shared/ostler-api'
import { formatDateTime, formatTime } from '@shared/format'
import { formatHours } from '@shared/time/duration'
import { Button, Dialog, useToast } from '../ui'
import { t } from '@shared/i18n'

/**
 * The one timer (R2.3, D33), for every surface in the window: the status bar,
 * the drawer, cards and the command palette start and stop it here, so each
 * shows the same toast with Undo. The state comes from main and is read again
 * whenever main says time changed, from any surface (the tray, the API).
 *
 * When Ostler starts and finds a timer that was running when it closed, this
 * asks whether to keep it running or stop it at the time Ostler closed.
 */
export interface TimerApi {
  running: TimeEntry | null
  start(projectId: string, workItemId: string): Promise<boolean>
  stop(): Promise<void>
}

const TimerContext = createContext<TimerApi | null>(null)

const NO_TIMER: TimerApi = {
  running: null,
  start: async () => false,
  stop: async () => {}
}

export function useTimer(): TimerApi {
  return useContext(TimerContext) ?? NO_TIMER
}

/** The time now, ticking every `intervalMs` while `active`. */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [active, intervalMs])
  return now
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const { toast, toastUndo } = useToast()
  const [state, setState] = useState<TimerState>({ running: null, interrupted: null })
  const [answering, setAnswering] = useState(false)

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getTimer()
    if (result.ok) setState(result.value)
  }, [])

  useEffect(() => {
    void load()
    return window.ostlerAPI.onTimeChange(() => void load())
  }, [load])

  const start = useCallback(
    async (projectId: string, workItemId: string) => {
      const result = await window.ostlerAPI.startTimer(projectId, workItemId)
      if (!result.ok) {
        toast({ title: t('tasks:time.couldNotStart'), body: result.error, tone: 'danger' })
        return false
      }
      const { started, stopped } = result.value
      setState({ running: started, interrupted: null })
      toastUndo(
        stopped
          ? t('tasks:time.switchedTimer', {
              task: started.workItemTitle,
              stopped: stopped.workItemTitle
            })
          : t('tasks:time.startedTimer', { task: started.workItemTitle }),
        () => window.ostlerAPI.undoTimerStart(started.id, stopped?.id ?? null).then(() => load())
      )
      return true
    },
    [toast, toastUndo, load]
  )

  const stop = useCallback(async () => {
    const result = await window.ostlerAPI.stopTimer()
    if (!result.ok) {
      toast({ title: t('tasks:time.couldNotStop'), body: result.error, tone: 'danger' })
      return
    }
    setState({ running: null, interrupted: null })
    const entry = result.value
    if (entry && entry.durationSeconds)
      toast({
        title: t('tasks:time.loggedTime', {
          time: formatHours(entry.durationSeconds),
          task: entry.workItemTitle
        })
      })
  }, [toast])

  const answer = async (choice: 'keep' | 'stop') => {
    setAnswering(true)
    try {
      const result = await window.ostlerAPI.resolveInterruptedTimer(choice)
      if (result.ok) setState(result.value)
    } finally {
      setAnswering(false)
    }
  }

  const api = useMemo<TimerApi>(
    () => ({ running: state.running, start, stop }),
    [state.running, start, stop]
  )
  const interrupted = state.interrupted && state.running ? state : null

  return (
    <TimerContext.Provider value={api}>
      {children}
      {interrupted?.running && interrupted.interrupted && (
        <Dialog
          open
          onClose={() => void answer('keep')}
          canDismiss={!answering}
          closeOnBackdrop={false}
          role="alertdialog"
          title={t('tasks:time.interruptedTitle')}
          description={t('tasks:time.interruptedBody', {
            task: interrupted.running.workItemTitle,
            started: formatDateTime(interrupted.running.startedAt),
            closed: formatDateTime(interrupted.interrupted.closedAt)
          })}
          footer={
            <>
              <Button variant="secondary" disabled={answering} onClick={() => void answer('stop')}>
                {t('tasks:time.stopAtClose', {
                  time: formatTime(interrupted.interrupted.closedAt)
                })}
              </Button>
              <Button
                variant="primary"
                disabled={answering}
                data-autofocus
                onClick={() => void answer('keep')}
              >
                {t('tasks:time.keepRunning')}
              </Button>
            </>
          }
        />
      )}
    </TimerContext.Provider>
  )
}
