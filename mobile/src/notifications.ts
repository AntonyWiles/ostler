/**
 * The phone's notifications through expo-notifications: the settings kept on the phone, the
 * permission, Android's channels, and posting or scheduling what `data/notifications.ts` plans.
 *
 * Notifications are local: the phone schedules reminders and the Today summary itself, so they
 * come even when the app is closed. Words are fixed when they are scheduled; the app plans again
 * whenever it opens, syncs or an edit is made.
 */
import { useSyncExternalStore } from 'react'
import { Linking, Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { t } from '@shared/i18n/index'
import type { InboxEntry } from '@shared/ostler-api'
import {
  parseNotificationSettings,
  type NotificationSettings,
  type NotificationTarget,
  type PlannedNotification
} from './data/notifications'

const SETTINGS_KEY = 'ostler.notifications'
const ASKED_KEY = 'ostler.notifications.asked'
const INBOX_SEEN_KEY = 'ostler.notifications.inboxSeen'

const TIMER_ID = 'timer'
const SYNC_ID = 'sync'
const TIMER_CATEGORY = 'timer'
export const STOP_ACTION = 'stop'

type Channel = 'due' | 'timer' | 'today' | 'inbox' | 'sync'

// ---- Settings (kept on the phone, not synced: each device has its own) ----

const listeners = new Set<() => void>()
let settings: NotificationSettings = parseNotificationSettings(SecureStore.getItem(SETTINGS_KEY))

export function notificationSettings(): NotificationSettings {
  return settings
}

export function useNotificationSettings(): NotificationSettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => settings
  )
}

export function setNotificationSettings(next: NotificationSettings): void {
  settings = next
  SecureStore.setItem(SETTINGS_KEY, JSON.stringify(next))
  for (const listener of listeners) listener()
}

/** Listens for a change of settings, so the app can plan again. */
export function onNotificationSettingsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The Inbox keys seen at the last look, or null before the first. */
export function inboxSeen(): string[] | null {
  try {
    const raw = SecureStore.getItem(INBOX_SEEN_KEY)
    return raw === null ? null : (JSON.parse(raw) as string[])
  } catch {
    return null
  }
}

export function setInboxSeen(keys: string[]): void {
  SecureStore.setItem(INBOX_SEEN_KEY, JSON.stringify(keys))
}

// ---- Permission ----

export type NotificationPermission = 'granted' | 'undetermined' | 'denied'

export async function notificationPermission(): Promise<NotificationPermission> {
  const { status } = await Notifications.getPermissionsAsync()
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined'
}

/**
 * Asks for permission once, at a moment a notification is clearly useful (a timer started, a
 * reminder set), never at launch. Later calls do nothing; Settings › Notifications can ask again.
 */
export async function askForNotificationsOnce(): Promise<void> {
  if (SecureStore.getItem(ASKED_KEY) !== null) return
  SecureStore.setItem(ASKED_KEY, '1')
  await askForNotifications().catch(() => undefined)
}

/** Asks for permission now; true when granted. Android says no without asking once refused. */
export async function askForNotifications(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync()
  return status === 'granted'
}

/** Opens the phone's settings for this app, where notifications are turned back on. */
export function openPhoneSettings(): void {
  void Linking.openSettings()
}

async function allowed(): Promise<boolean> {
  try {
    return (await notificationPermission()) === 'granted'
  } catch {
    return false
  }
}

// ---- Set up ----

let ready: Promise<void> | null = null

/** Channels, the timer's Stop button and how notifications show while the app is open. */
export function setUpNotifications(): Promise<void> {
  ready ??= (async () => {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        // The timer and sync notices stay in the shade; the app already shows both.
        const quiet = [TIMER_ID, SYNC_ID].includes(notification.request.identifier)
        return {
          shouldShowBanner: !quiet,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false
        }
      }
    })
    if (Platform.OS === 'android') {
      const { AndroidImportance } = Notifications
      const channels: [Channel, string, Notifications.AndroidImportance][] = [
        ['due', 'mobile:notifications.channelDue', AndroidImportance.HIGH],
        ['timer', 'mobile:notifications.channelTimer', AndroidImportance.LOW],
        ['today', 'mobile:notifications.channelToday', AndroidImportance.DEFAULT],
        ['inbox', 'mobile:notifications.channelInbox', AndroidImportance.DEFAULT],
        ['sync', 'mobile:notifications.channelSync', AndroidImportance.LOW]
      ]
      for (const [id, name, importance] of channels) {
        await Notifications.setNotificationChannelAsync(id, { name: t(name), importance })
      }
    }
    await Notifications.setNotificationCategoryAsync(TIMER_CATEGORY, [
      {
        identifier: STOP_ACTION,
        buttonTitle: t('mobile:notifications.stop'),
        options: { opensAppToForeground: true }
      }
    ])
  })().catch((error: unknown) => {
    ready = null
    throw error
  })
  return ready
}

// ---- Posting and scheduling ----

function content(
  title: string,
  body: string,
  target: NotificationTarget,
  extra: Partial<Notifications.NotificationContentInput> = {}
): Notifications.NotificationContentInput {
  return { title, body, data: { ...target }, ...extra }
}

/** Replaces every scheduled notification with `planned`. */
export async function schedule(planned: PlannedNotification[]): Promise<void> {
  await setUpNotifications()
  await Notifications.cancelAllScheduledNotificationsAsync()
  if (!(await allowed())) return
  const now = Date.now()
  for (const item of planned) {
    if (item.at <= now) continue
    await Notifications.scheduleNotificationAsync({
      identifier: item.id,
      content: content(item.title, item.body, item.target),
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: item.at,
        channelId: item.kind
      }
    })
  }
}

async function post(
  id: string,
  channel: Channel,
  body: Notifications.NotificationContentInput
): Promise<void> {
  await setUpNotifications()
  if (!(await allowed())) return
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: body,
    trigger: { channelId: channel }
  })
}

/** Shows the running timer (ongoing, with Stop), or takes it away with null. */
export async function showTimer(
  timer: { title: string; body: string; target: NotificationTarget } | null
): Promise<void> {
  if (timer === null) {
    await Notifications.dismissNotificationAsync(TIMER_ID).catch(() => undefined)
    return
  }
  await post(
    TIMER_ID,
    'timer',
    content(timer.title, timer.body, timer.target, {
      sticky: true,
      autoDismiss: false,
      categoryIdentifier: TIMER_CATEGORY
    })
  )
}

/** One notification per new Inbox item. */
export async function notifyInbox(items: InboxEntry[]): Promise<void> {
  for (const item of items) {
    await post(
      `inbox:${item.key}`,
      'inbox',
      content(item.title, item.body, {
        taskId: item.taskId ?? undefined,
        projectId: item.projectId ?? undefined,
        tab: 'inbox'
      })
    )
  }
}

/** Says sync needs attention, or takes that away again. */
export async function showSyncProblem(show: boolean): Promise<void> {
  if (!show) {
    await Notifications.dismissNotificationAsync(SYNC_ID).catch(() => undefined)
    return
  }
  await post(
    SYNC_ID,
    'sync',
    content(t('mobile:notifications.syncTitle'), t('mobile:notifications.syncBody'), {})
  )
}

/**
 * Calls `handler` when the person taps a notification or one of its buttons, including the tap
 * that opened the app.
 */
export function onNotificationResponse(
  handler: (target: NotificationTarget, action: 'open' | 'stop') => void
): () => void {
  const handle = (response: Notifications.NotificationResponse | null) => {
    if (response === null) return
    const data = (response.notification.request.content.data ?? {}) as NotificationTarget
    handler(data, response.actionIdentifier === STOP_ACTION ? 'stop' : 'open')
    Notifications.clearLastNotificationResponse()
  }
  handle(Notifications.getLastNotificationResponse())
  const subscription = Notifications.addNotificationResponseReceivedListener(handle)
  return () => subscription.remove()
}
