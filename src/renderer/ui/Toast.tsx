import { useConfig } from '../hooks/useConfig'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useAnnounce } from './Announcer'
import { Button } from './Button'
import { ErrorText } from './ErrorText'
import { IconButton } from './IconButton'
import { Portal } from './Portal'
import { playExit } from './overlay/exit'
import { CircleAlert, CircleCheck, Icon, Info, TriangleAlert, Undo2, X } from './icons'
import { cx } from './cx'
import './Toast.css'
import { t } from '@shared/i18n'
import type { InAppNotificationDuration } from '@shared/ostler-api'
import { normalizeTipsSettings } from '@shared/tips'

/**
 * How long each "Keep in-app notifications on screen" choice keeps a toast,
 * null for until it is closed. Hover or focus pauses the timer.
 */
export const TOAST_DURATIONS_MS: Record<InAppNotificationDuration, number | null> = {
  short: 6000,
  normal: 10000,
  long: 20000,
  untilClosed: null
}

/** How long a toast stays by default before it goes on its own. */
export const TOAST_DURATION_MS = 10000

/** At most this many toasts show at once; older ones leave the screen for the notification centre. */
export const MAX_VISIBLE_TOASTS = 3

/** The notification centre keeps this many, newest first, until Ostler closes. */
export const NOTIFICATION_HISTORY_LIMIT = 50

/** The "kept under the bell" hint's id in `ui.tips.dismissed`: shown with the first toast, then never again. */
export const NOTIFICATION_CENTER_HINT_ID = 'hint:notification-center'

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface ToastAction {
  label: string
  onClick: () => void | Promise<unknown>
}

export interface ToastOptions {
  title: string
  body?: ReactNode
  tone?: ToastTone
  action?: ToastAction
  /** A second choice beside `action`, such as "Leave them"; it closes the toast too. */
  secondaryAction?: ToastAction
}

interface ToastEntry extends ToastOptions {
  id: number
  /** Set by toastUndo: the action Ctrl+Z runs. */
  undo?: () => void | Promise<unknown>
}

/** A toast as the notification centre keeps it, after it has left the screen too. */
export interface NotificationRecord extends ToastEntry {
  /** When it was shown, ms since the epoch. */
  at: number
  /** Its action or second action has run, so neither is offered again. */
  used: boolean
  /** Seen: closed or acted on by the person, or listed in an open notification centre. */
  read: boolean
}

export interface NotificationCenterApi {
  /** Every toast this session, newest first. */
  records: NotificationRecord[]
  /** How many went away on their own and have not been seen in the centre. */
  unread: number
  open: boolean
  /** Opening the centre marks everything in it read and clears the toasts from the corner. */
  setOpen: (open: boolean) => void
  /** Runs a kept toast's action (or its second one) once, from the toast or the centre. */
  runAction: (id: number, which: 'action' | 'secondary') => void
  remove: (id: number) => void
  clear: () => void
  setDuration: (duration: InAppNotificationDuration) => void
  /** The status bar's bell says it is there, so the toasts can point to it. */
  registerCenter: () => () => void
}

export interface ToastApi {
  /** Shows a toast; returns its id. */
  toast: (options: ToastOptions) => number
  /**
   * The standard undo pattern: the action already happened, and this offers to
   * take it back (the Undo button, Ctrl+Z while the toast is showing, or the
   * notification centre afterwards).
   */
  toastUndo: (title: string, undo: () => void | Promise<unknown>, body?: ReactNode) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)
const NotificationCenterContext = createContext<NotificationCenterApi | null>(null)

export const TONE_ICON = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert
}

const NON_TEXT_INPUTS = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file']

/** True when Ctrl+Z belongs to a text field's own undo rather than to a toast or a drawer. */
export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement) return !target.readOnly
  if (target instanceof HTMLInputElement) {
    return !target.readOnly && !NON_TEXT_INPUTS.includes(target.type)
  }
  return !!target.closest('[role="textbox"], .monaco-editor')
}

/**
 * Hosts the toast stack: bottom right, above the status bar, at most
 * MAX_VISIBLE_TOASTS at once. Each toast is said once, through the app's live
 * region (P9.2), and never takes focus. Every toast is also kept, with its
 * Undo or other action, for the status bar's notification centre.
 * Mounted once, in App.tsx; anything below it calls `useToast()`.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<NotificationRecord[]>([])
  // The ids on screen, oldest first.
  const [visible, setVisible] = useState<number[]>([])
  const [open, setOpenState] = useState(false)
  const [duration, setDuration] = useState<InAppNotificationDuration>('normal')
  const [centers, setCenters] = useState(0)
  // Starts true so nothing flashes before the config loads.
  const [hintSeen, setHintSeen] = useState(true)
  // Settings › Notifications › Show Undo notices (MOP-38).
  const showUndoRef = useRef(true)
  // 'showing' once the hint has come up this run; 'over' once the toasts it came with are gone.
  const hintShownThisRun = useRef<'none' | 'showing' | 'over'>('none')
  const nextId = useRef(1)

  const { config } = useConfig()
  useEffect(() => {
    if (!config) return
    const tips = normalizeTipsSettings(config.ui?.tips)
    setHintSeen(!tips.enabled || tips.dismissed.includes(NOTIFICATION_CENTER_HINT_ID))
    showUndoRef.current = config.notifications?.inAppUndo !== false
  }, [config])

  const update = useCallback((id: number, changes: Partial<NotificationRecord>) => {
    setRecords((list) =>
      list.map((record) => (record.id === id ? { ...record, ...changes } : record))
    )
  }, [])

  // Off the screen only: the centre keeps it.
  const hide = useCallback((id: number) => {
    setVisible((ids) => ids.filter((entry) => entry !== id))
  }, [])

  // Closed by the person: off the screen, and seen.
  const dismiss = useCallback(
    (id: number) => {
      hide(id)
      update(id, { read: true })
    },
    [hide, update]
  )

  const announce = useAnnounce()
  const show = useCallback(
    (options: Omit<ToastEntry, 'id'>, quiet = false) => {
      const id = nextId.current++
      const record: NotificationRecord = {
        tone: 'info',
        ...options,
        id,
        at: Date.now(),
        used: false,
        read: quiet
      }
      setRecords((list) => [record, ...list].slice(0, NOTIFICATION_HISTORY_LIMIT))
      // A quiet one goes to the notification centre only, already read.
      if (quiet) return id
      setVisible((ids) => [...ids, id].slice(-MAX_VISIBLE_TOASTS))
      announce(toastWords(options))
      return id
    },
    [announce]
  )

  const toastUndo = useCallback(
    (title: string, undo: () => void | Promise<unknown>, body?: ReactNode) =>
      show(
        {
          title,
          body,
          tone: 'success',
          undo,
          action: { label: t('common:toast.undo'), onClick: undo }
        },
        !showUndoRef.current
      ),
    [show]
  )

  const api = useMemo<ToastApi>(
    () => ({ toast: (options) => show(options), toastUndo, dismiss }),
    [show, toastUndo, dismiss]
  )

  const recordsRef = useRef(records)
  recordsRef.current = records

  // An action runs once, wherever it was clicked: the toast and its copy in
  // the centre are the same notification.
  const runAction = useCallback(
    (id: number, which: 'action' | 'secondary') => {
      const record = recordsRef.current.find((entry) => entry.id === id)
      const action = which === 'action' ? record?.action : record?.secondaryAction
      if (!record || !action || record.used) return
      recordsRef.current = recordsRef.current.map((entry) =>
        entry.id === id ? { ...entry, used: true } : entry
      )
      hide(id)
      update(id, { used: true, read: true })
      void action.onClick()
    },
    [hide, update]
  )

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    if (!next) return
    // Everything on screen is in the centre too, so the corner clears.
    setVisible([])
    setRecords((list) => list.map((record) => ({ ...record, read: true })))
  }, [])

  const registerCenter = useCallback(() => {
    setCenters((count) => count + 1)
    return () => setCenters((count) => count - 1)
  }, [])

  const center = useMemo<NotificationCenterApi>(
    () => ({
      records,
      unread: records.filter((record) => !record.read).length,
      open,
      setOpen,
      runAction,
      remove: (id) => {
        hide(id)
        setRecords((list) => list.filter((record) => record.id !== id))
      },
      clear: () => {
        setVisible([])
        setRecords([])
      },
      setDuration,
      registerCenter
    }),
    [records, open, setOpen, runAction, hide, registerCenter]
  )

  // Ctrl+Z runs the newest visible toast's undo, unless focus is in a text
  // field, where Ctrl+Z is the field's own undo.
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() !== 'z' || isEditable(event.target)) return
      const newest = [...visibleRef.current]
        .reverse()
        .map((id) => recordsRef.current.find((record) => record.id === id))
        .find((record) => record?.undo && !record.used)
      if (!newest) return
      event.preventDefault()
      visibleRef.current = visibleRef.current.filter((id) => id !== newest.id)
      runAction(newest.id, 'action')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [runAction])

  const shown = visible
    .map((id) => records.find((record) => record.id === id))
    .filter((record): record is NotificationRecord => !!record)
  const durationMs = TOAST_DURATIONS_MS[duration] ?? null

  // The hint comes up with the first toast it can show with, then stays until
  // those toasts are gone; the seen id is saved with the tips so it never returns.
  const showHint =
    shown.length > 0 &&
    centers > 0 &&
    (hintShownThisRun.current === 'showing' || (hintShownThisRun.current === 'none' && !hintSeen))

  useEffect(() => {
    if (shown.length === 0 && hintShownThisRun.current === 'showing') {
      hintShownThisRun.current = 'over'
    }
  }, [shown.length])

  useEffect(() => {
    if (hintShownThisRun.current !== 'none' || hintSeen || shown.length === 0 || centers === 0) {
      return
    }
    hintShownThisRun.current = 'showing'
    const markSeen = async () => {
      const result = await window.ostlerAPI.getConfig()
      if (!result.ok) return
      const tips = normalizeTipsSettings(result.value.ui?.tips)
      if (tips.dismissed.includes(NOTIFICATION_CENTER_HINT_ID)) {
        setHintSeen(true)
        return
      }
      const saved = await window.ostlerAPI.updateConfig({
        ui: {
          tips: { ...tips, dismissed: [...tips.dismissed, NOTIFICATION_CENTER_HINT_ID] }
        }
      })
      if (saved.ok) setHintSeen(true)
    }
    void markSeen()
  }, [hintSeen, shown.length, centers])

  return (
    <ToastContext.Provider value={api}>
      <NotificationCenterContext.Provider value={center}>
        {children}
        <Portal>
          <section className="ui-toaster" aria-label={t('common:toast.notifications')}>
            <ol className="ui-toaster__list">
              {shown.map((entry) => (
                <ToastItem
                  key={entry.id}
                  entry={entry}
                  durationMs={durationMs}
                  onTimeout={() => hide(entry.id)}
                  onDismiss={() => dismiss(entry.id)}
                  onAction={(which) => runAction(entry.id, which)}
                />
              ))}
            </ol>
            {showHint && (
              <button type="button" className="ui-toaster__all" onClick={() => setOpen(true)}>
                {t('common:toast.keptInCenter')}
              </button>
            )}
          </section>
        </Portal>
      </NotificationCenterContext.Provider>
    </ToastContext.Provider>
  )
}

/**
 * What a toast says aloud: its title, its body when that is text, and its
 * actions, both of them when it has two, in the order they show.
 */
export function toastWords(
  options: Pick<ToastOptions, 'title' | 'body' | 'action' | 'secondaryAction'>
): string {
  const body = typeof options.body === 'string' ? options.body : ''
  // The secondary action shows first, beside the main one.
  const labels = [options.secondaryAction?.label, options.action?.label].filter(
    (label): label is string => !!label?.trim()
  )
  const action =
    labels.length === 2
      ? t('common:toast.availableBoth', { firstLabel: labels[0], secondLabel: labels[1] })
      : labels.length === 1
        ? t('common:toast.available', { actionLabel: labels[0] })
        : ''
  return [options.title, body, action]
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(' ')
}

function ToastItem({
  entry,
  durationMs,
  onTimeout,
  onDismiss,
  onAction
}: {
  entry: ToastEntry
  /** Null: it stays until it is closed. */
  durationMs: number | null
  onTimeout: () => void
  onDismiss: () => void
  onAction: (which: 'action' | 'secondary') => void
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const remaining = useRef(durationMs)
  const timeoutRef = useRef(onTimeout)
  timeoutRef.current = onTimeout
  const paused = hovered || focused

  useEffect(() => {
    if (paused || remaining.current === null) return
    const startedAt = Date.now()
    const timer = setTimeout(() => timeoutRef.current(), remaining.current)
    return () => {
      clearTimeout(timer)
      if (remaining.current !== null)
        remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt))
    }
  }, [paused])

  // Leaving the stack, it fades out where it stood (exit.ts).
  const itemRef = useRef<HTMLLIElement | null>(null)
  useLayoutEffect(() => {
    const item = itemRef.current
    return () => playExit(item, { pinnedAbove: 'var(--z-toast)' })
  }, [])

  const tone = entry.tone ?? 'info'
  // A short toast keeps its one button beside the title; with a body or two
  // buttons, they go on their own row so the text gets the full width.
  const actionsBelow = !!entry.action && (!!entry.body || !!entry.secondaryAction)
  const actions = (entry.action || entry.secondaryAction) && (
    <div className={cx('ui-toast__actions', actionsBelow && 'ui-toast__actions--below')}>
      {entry.secondaryAction && (
        <Button
          size="sm"
          variant="ghost"
          className="ui-toast__action"
          onClick={() => onAction('secondary')}
        >
          {entry.secondaryAction.label}
        </Button>
      )}
      {entry.action && (
        <Button
          size="sm"
          variant="ghost"
          className="ui-toast__action"
          onClick={() => onAction('action')}
        >
          {entry.action.label}
        </Button>
      )}
    </div>
  )
  return (
    <li
      ref={itemRef}
      className={cx('ui-toast', `ui-toast--${tone}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      <span className="ui-toast__icon">
        <Icon icon={entry.undo ? Undo2 : TONE_ICON[tone]} />
      </span>
      <div className="ui-toast__text">
        <p className="ui-toast__title">{entry.title}</p>
        {entry.body && (
          <div className="ui-toast__body">
            <ErrorText>{entry.body}</ErrorText>
          </div>
        )}
        {actionsBelow && actions}
      </div>
      {!actionsBelow && actions}
      <IconButton
        label={t('common:toast.dismissNotification')}
        icon={X}
        size="sm"
        onClick={onDismiss}
      />
    </li>
  )
}

/**
 * `toast(...)`, `toastUndo(title, undo)` and `dismiss(id)`. Outside a
 * ToastProvider (some component tests) they do nothing: a toast only reports
 * what already happened, so dropping one loses no work.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NO_TOASTS
}

const NO_TOASTS: ToastApi = { toast: () => -1, toastUndo: () => -1, dismiss: () => {} }

/** The kept notifications, for the status bar's notification centre. Null outside a ToastProvider. */
export function useNotificationCenter(): NotificationCenterApi | null {
  return useContext(NotificationCenterContext)
}
