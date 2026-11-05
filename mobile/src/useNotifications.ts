import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import type { OstlerDatabase } from './db/database'
import type { PhoneSync } from './sync/phone-sync'
import { inboxList } from './data/inbox'
import { myWork } from './data/home'
import { projectColor, projectName } from './data/project-display'
import { runningTimer, stopTimer } from './data/time'
import {
  newInboxItems,
  planNotifications,
  SYNC_CALM,
  syncAttention,
  timerNotification,
  type NotificationTarget
} from './data/notifications'
import {
  inboxSeen,
  notifyInbox,
  onNotificationResponse,
  schedule,
  setInboxSeen,
  showSyncProblem,
  showTimer,
  useNotificationSettings
} from './notifications'

const info = {
  name: (id: string) => projectName({ id, name: null }),
  color: (id: string) => projectColor({ id, color: null })
}

/** How often the timer's time so far, and sync's state, are looked at while the app is open. */
const TICK_MS = 60 * 1000

function warn(what: string) {
  return (error: unknown) =>
    console.log(`OSTLER12 ${what}`, error instanceof Error ? error.message : '')
}

/**
 * Keeps the phone's notifications in step with its data: plans reminders and the Today summary,
 * shows the running timer, posts new Inbox items and tells of sync that keeps failing. `version`
 * changes whenever the data may have (a sync, an edit). `onOpen` handles a tapped notification;
 * `onEdited` follows a timer stopped from the notification.
 */
export function useNotifications(
  db: OstlerDatabase | null,
  sync: PhoneSync | null,
  version: number,
  onOpen: (target: NotificationTarget) => void,
  onEdited: () => void
): void {
  const settings = useNotificationSettings()

  // Reminders and the Today summary: planned again a moment after the data or settings change.
  useEffect(() => {
    if (db === null) return
    const timer = setTimeout(() => {
      try {
        const planned = planNotifications(db, settings, Date.now(), {
          projectName: info.name,
          workFor: (day) => myWork(db, info, day)
        })
        void schedule(planned).catch(warn('Could not schedule notifications:'))
      } catch (error) {
        warn('Could not plan notifications:')(error)
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [db, settings, version])

  // New Inbox items. The first look only remembers what is there.
  useEffect(() => {
    if (db === null) return
    try {
      const { notify, seen } = newInboxItems(inboxList(db).items, inboxSeen(), settings)
      setInboxSeen(seen)
      if (notify.length > 0) void notifyInbox(notify).catch(warn('Could not post Inbox items:'))
    } catch (error) {
      warn('Could not read the Inbox:')(error)
    }
  }, [db, settings, version])

  // The running timer, with its time so far brought up to date each minute while the app is open.
  useEffect(() => {
    if (db === null) return
    const update = () => {
      const running = settings.timer ? runningTimer(db) : null
      void showTimer(running ? timerNotification(running, Date.now()) : null).catch(
        warn('Could not show the timer:')
      )
    }
    update()
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') update()
    }, TICK_MS)
    const subscription = AppState.addEventListener('change', (state) => {
      // Up to date as the app goes to the background, where it is read most.
      if (state !== 'active') update()
    })
    return () => {
      clearInterval(interval)
      subscription.remove()
    }
  }, [db, settings, version])

  // Sync that has failed for a while: told once, taken away when it works again.
  const attention = useRef(SYNC_CALM)
  useEffect(() => {
    if (sync === null) return
    const check = () => {
      const failing = sync
        .shares()
        .some((share) => share.status === 'problems' || share.status === 'cannot-reach-drive')
      const next = syncAttention(attention.current, failing, Date.now())
      attention.current = next.state
      if (next.notify && settings.sync) void showSyncProblem(true).catch(warn('Sync notice:'))
      if (next.clear || !settings.sync) void showSyncProblem(false)
    }
    check()
    const interval = setInterval(check, TICK_MS)
    return () => clearInterval(interval)
  }, [sync, settings, version])

  // A tapped notification, or its Stop button.
  const handlers = useRef({ onOpen, onEdited })
  handlers.current = { onOpen, onEdited }
  useEffect(() => {
    if (db === null) return
    return onNotificationResponse((target, action) => {
      if (action === 'stop') {
        try {
          stopTimer(db)
          handlers.current.onEdited()
        } catch (error) {
          warn('Could not stop the timer:')(error)
        }
        return
      }
      handlers.current.onOpen(target)
    })
  }, [db])
}
