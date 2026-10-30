import { t } from '@shared/i18n'
import type { FocusState, NavigateRequest } from '@shared/ostler-api'
import { minutesLeft } from '@shared/focus'

/**
 * The tray's menu (P8.2), as data, so it is testable: Open, Quick add, Snip
 * to task (N4.2a), Inbox
 * with its count, Pause reminders for 1 hour, Stop all AI (only while AI or
 * agents are on), and Quit. While a timer runs (R2.3), Stop timer comes
 * first, naming its task; while a focus or its break counts down (N3.5),
 * Stop focus comes before it. Countdowns (N5.2b) follow, each opening its item.
 */

export type TrayAction =
  | 'open'
  | 'quick-add'
  | 'snip'
  | 'inbox'
  | 'open-countdown'
  | 'stop-timer'
  | 'stop-focus'
  | 'pause-reminders'
  | 'resume-reminders'
  | 'stop-ai'
  | 'quit'

export type TrayMenuItem =
  { type: 'separator' } | { label: string; action: TrayAction; request?: NavigateRequest }

export interface TrayMenuState {
  unread: number
  /** Ostler AI is set up or AI agents are on. */
  aiOn: boolean
  /** When paused reminders resume, or null. */
  remindersPausedUntil: number | null
  /** The running timer's task title, or null when no timer runs. */
  timerTask?: string | null
  /** Formats a moment as a short local time ("14:05"). */
  time: (at: number) => string
  /** A focus or its break counting down (N3.5): Stop focus comes first. */
  focus?: FocusState | null
  /** Countdowns (N5.2b), worded, with the item each opens. */
  countdowns?: readonly { label: string; request: NavigateRequest }[]
}

/**
 * The tray's tooltip: the focus's time left while one counts down (N3.5),
 * else the Inbox count, else the name. Time left comes from the stored end.
 */
export function trayTooltip(state: {
  focus: FocusState | null
  unread: number
  now: number
  name: string
}): string {
  const { focus } = state
  if (focus?.phase === 'focus')
    return t('desktop:trayMenu.focusTooltip', {
      count: minutesLeft(focus.endsAt, state.now),
      task: tooltipTitle(focus.workItemTitle)
    })
  if (focus?.phase === 'break' && focus.breakEndsAt !== null)
    return t('desktop:trayMenu.breakTooltip', { count: minutesLeft(focus.breakEndsAt, state.now) })
  return state.unread > 0
    ? t('desktop:desktop.trayTooltipUnread', { count: state.unread })
    : state.name
}

/** Windows cuts a tray tooltip at 127 characters. */
function tooltipTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim()
  return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean
}

export const PAUSE_REMINDERS_MS = 60 * 60 * 1000

export function buildTrayMenu(state: TrayMenuState): TrayMenuItem[] {
  const separator = { type: 'separator' } as const
  const focus: TrayMenuItem[] = state.focus
    ? [{ label: t('desktop:trayMenu.stopFocus'), action: 'stop-focus' }]
    : []
  const timer: TrayMenuItem[] =
    state.timerTask === null || state.timerTask === undefined
      ? []
      : [
          {
            label: t('desktop:trayMenu.stopTimer', { task: shortTitle(state.timerTask) }),
            action: 'stop-timer'
          }
        ]
  const countdowns: TrayMenuItem[] = (state.countdowns ?? []).map((countdown) => ({
    label: menuLabel(countdown.label),
    action: 'open-countdown',
    request: countdown.request
  }))
  const first = [...focus, ...timer, ...countdowns]
  return [
    ...(first.length > 0 ? [...first, separator] : []),
    { label: t('desktop:trayMenu.open'), action: 'open' },
    { label: t('desktop:trayMenu.quickAdd'), action: 'quick-add' },
    { label: t('desktop:trayMenu.snipToTask'), action: 'snip' },
    {
      label:
        state.unread > 0
          ? t('desktop:trayMenu.inbox', { unread: state.unread })
          : t('desktop:trayMenu.inbox2'),
      action: 'inbox'
    },
    separator,
    state.remindersPausedUntil === null
      ? { label: t('desktop:trayMenu.pauseReminders1Hour'), action: 'pause-reminders' }
      : {
          label: t('desktop:trayMenu.resumeRemindersPausedUntil', {
            time: state.time(state.remindersPausedUntil)
          }),
          action: 'resume-reminders'
        },
    ...(state.aiOn ? [{ label: t('desktop:trayMenu.stopAllAi'), action: 'stop-ai' as const }] : []),
    separator,
    { label: t('desktop:trayMenu.quit'), action: 'quit' }
  ]
}

/** A label as a menu shows it: each "&" doubled, as `shortTitle` does. */
function menuLabel(label: string): string {
  return label.replace(/&/g, '&&')
}

/**
 * A task title short enough for a menu item, with each "&" doubled: Windows
 * reads a single "&" in a menu label as the next letter's access key and hides it.
 */
function shortTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim()
  const short = clean.length > 40 ? `${clean.slice(0, 39)}…` : clean
  return short.replace(/&/g, '&&')
}
