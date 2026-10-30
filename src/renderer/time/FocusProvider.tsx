import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { FocusChange, FocusChoice, FocusSettings, FocusState } from '@shared/ostler-api'
import { DEFAULT_FOCUS_SETTINGS, FOCUS_MAX_MINUTES, FOCUS_MIN_MINUTES } from '@shared/ostler-api'
import { focusLengthChoices, isFocusMinutes, normalizeFocusSettings } from '@shared/focus'
import { formatTime } from '@shared/format'
import { Button, Dialog, NumberField, Radio, RadioGroup, useToast } from '../ui'
import { playChimeOnce } from './chime'
import { t } from '@shared/i18n'
import './focus.css'

/**
 * Focus (N3.5, N29) for every surface in the window: the drawer, the card's
 * menu, the command palette and a time block's card ask here, which picks a
 * length and starts it through main's `FocusService` (so the task's timer
 * starts through R2.3, with the same Undo). The state comes from main and
 * follows its changes from any surface (the tray, the API).
 *
 * When a focus ends this chimes (if the setting is on) and asks: a break,
 * keep going, or stop. Closing the question keeps the timer running.
 */
export interface FocusTarget {
  projectId: string
  workItemId: string
  title: string
}

export interface FocusApi {
  focus: FocusState | null
  /** Opens the length picker for a task. */
  ask(target: FocusTarget): void
  start(target: FocusTarget, minutes: number): Promise<boolean>
  stop(): Promise<void>
}

const FocusContext = createContext<FocusApi | null>(null)

const NO_FOCUS: FocusApi = {
  focus: null,
  ask: () => {},
  start: async () => false,
  stop: async () => {}
}

export function useFocus(): FocusApi {
  return useContext(FocusContext) ?? NO_FOCUS
}

async function readSettings(): Promise<FocusSettings> {
  const result = await window.ostlerAPI.getConfig()
  return result.ok
    ? normalizeFocusSettings(result.value.notifications.focus)
    : DEFAULT_FOCUS_SETTINGS
}

export function FocusProvider({ children }: { children: ReactNode }) {
  const { toast, toastUndo } = useToast()
  const [focus, setFocus] = useState<FocusState | null>(null)
  const [asking, setAsking] = useState<{ target: FocusTarget; settings: FocusSettings } | null>(
    null
  )
  const [choosing, setChoosing] = useState(false)

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getFocus()
    if (result.ok) setFocus(result.value)
  }, [])

  useEffect(() => {
    void load()
    return window.ostlerAPI.onFocusChange((change: FocusChange) => {
      setFocus(change.focus)
      if (change.event === 'finished' || change.event === 'break-over') void chimeFor(change)
    })
  }, [load])

  const ask = useCallback((target: FocusTarget) => {
    void readSettings().then((settings) => setAsking({ target, settings }))
  }, [])

  const start = useCallback(
    async (target: FocusTarget, minutes: number) => {
      const result = await window.ostlerAPI.startFocus(target.projectId, target.workItemId, minutes)
      if (!result.ok) {
        toast({ title: t('tasks:focus.couldNotStart'), body: result.error, tone: 'danger' })
        return false
      }
      const { focus: started, timer } = result.value
      setFocus(started)
      toastUndo(
        timer.stopped
          ? t('tasks:focus.startedSwitched', {
              count: minutes,
              task: started.workItemTitle,
              stopped: timer.stopped.workItemTitle
            })
          : t('tasks:focus.started', { count: minutes, task: started.workItemTitle }),
        // Undoing the timer's start ends the focus on it too.
        () =>
          window.ostlerAPI
            .undoTimerStart(timer.started.id, timer.stopped?.id ?? null)
            .then(() => load())
      )
      return true
    },
    [toast, toastUndo, load]
  )

  const stop = useCallback(async () => {
    const result = await window.ostlerAPI.stopFocus()
    if (!result.ok) {
      toast({ title: t('tasks:focus.couldNotStop'), body: result.error, tone: 'danger' })
      return
    }
    setFocus(null)
  }, [toast])

  const choose = async (choice: FocusChoice) => {
    setChoosing(true)
    try {
      const result = await window.ostlerAPI.chooseFocusEnd(choice)
      if (result.ok) setFocus(result.value)
      else void load()
    } finally {
      setChoosing(false)
    }
  }

  const api = useMemo<FocusApi>(() => ({ focus, ask, start, stop }), [focus, ask, start, stop])

  return (
    <FocusContext.Provider value={api}>
      {children}
      {asking && (
        <FocusStartDialog
          target={asking.target}
          settings={asking.settings}
          onClose={() => setAsking(null)}
          onStart={async (minutes) => {
            if (await start(asking.target, minutes)) setAsking(null)
          }}
        />
      )}
      {focus?.phase === 'ended' && (
        <FocusEndDialog focus={focus} busy={choosing} onChoose={(choice) => void choose(choice)} />
      )}
    </FocusContext.Provider>
  )
}

/** Chimes once per focus and moment, if the setting is on; read fresh, so a change applies at once. */
async function chimeFor(change: FocusChange): Promise<void> {
  const settings = await readSettings()
  if (settings.chime) playChimeOnce(`${change.focusId}:${change.event}`)
}

function FocusStartDialog({
  target,
  settings,
  onClose,
  onStart
}: {
  target: FocusTarget
  settings: FocusSettings
  onClose: () => void
  onStart: (minutes: number) => Promise<void>
}) {
  const choices = focusLengthChoices(settings)
  const [picked, setPicked] = useState<number | 'other'>(settings.lastMinutes)
  const [other, setOther] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const minutes = picked === 'other' ? other : picked
  const valid = isFocusMinutes(minutes)
  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    try {
      await onStart(minutes)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      title={t('tasks:focus.title', { task: target.title })}
      description={t('tasks:focus.description')}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('tasks:focus.cancel')}
          </Button>
          <Button variant="primary" disabled={!valid || busy} onClick={() => void submit()}>
            {t('tasks:focus.start')}
          </Button>
        </>
      }
    >
      <form
        className="focus-start"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <RadioGroup legend={t('tasks:focus.length')}>
          {choices.map((choice) => (
            <Radio
              key={choice}
              name="focus-length"
              label={t('tasks:focus.minutes', { count: choice })}
              checked={picked === choice}
              data-autofocus={picked === choice ? true : undefined}
              onChange={() => setPicked(choice)}
            />
          ))}
          <Radio
            name="focus-length"
            label={t('tasks:focus.otherLength')}
            checked={picked === 'other'}
            onChange={() => setPicked('other')}
          />
        </RadioGroup>
        {picked === 'other' && (
          <NumberField
            label={t('tasks:focus.otherMinutes')}
            hint={t('tasks:focus.otherHint', { min: FOCUS_MIN_MINUTES, max: FOCUS_MAX_MINUTES })}
            unit={t('tasks:focus.minutesUnit')}
            min={FOCUS_MIN_MINUTES}
            max={FOCUS_MAX_MINUTES}
            value={other}
            onChange={setOther}
          />
        )}
      </form>
    </Dialog>
  )
}

function FocusEndDialog({
  focus,
  busy,
  onChoose
}: {
  focus: FocusState
  busy: boolean
  onChoose: (choice: FocusChoice) => void
}) {
  const breakMinutes = useBreakMinutes()
  return (
    <Dialog
      open
      onClose={() => onChoose('keep')}
      canDismiss={!busy}
      closeOnBackdrop={false}
      role="alertdialog"
      title={t('tasks:focus.finishedTitle', { task: focus.workItemTitle })}
      description={t('tasks:focus.finishedBody', {
        count: focus.minutes,
        time: formatTime(focus.endsAt)
      })}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onChoose('stop')}>
            {t('tasks:focus.stopAtEnd')}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => onChoose('keep')}>
            {t('tasks:focus.keepGoing')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            data-autofocus
            onClick={() => onChoose('break')}
          >
            {t('tasks:focus.takeBreak', { count: breakMinutes })}
          </Button>
        </>
      }
    />
  )
}

function useBreakMinutes(): number {
  const [minutes, setMinutes] = useState(DEFAULT_FOCUS_SETTINGS.breakMinutes)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    void readSettings().then((settings) => {
      if (mounted.current) setMinutes(settings.breakMinutes)
    })
    return () => {
      mounted.current = false
    }
  }, [])
  return minutes
}
