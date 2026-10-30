import type { Notification, BrowserWindow } from 'electron'
import type {
  NavigateRequest,
  OstlerNotification,
  NotificationType,
  OstlerConfig
} from '@shared/ostler-api'
import { v4 as uuidv4 } from 'uuid'
import { IPC_CHANNELS } from '@shared/ostler-api'
import { inQuietHours } from '@shared/reminder-settings'
import { sendToWindow } from './send-to-window'
import { showDesktopNotification } from '../app/off-screen'

/** Reminders and Inbox items are each worth seeing; the rest are rate-limited. */
const UNLIMITED: readonly NotificationType[] = [
  'reminder',
  'agent_question',
  'review_waiting',
  'blocker',
  'rule',
  'weekly_review',
  'focus',
  'assigned_by_someone',
  'mentioned',
  'sign_off_requested',
  'sign_off_answered'
]

/** How many unclicked notifications are held so their clicks still arrive. */
const CLICKABLE_HELD = 50

/** What a notification click opens, and the icon it shows (P8.2). */
export interface NotificationShell {
  /** Opens the target through the deep-link route: focuses the window and navigates. */
  open(target: NavigateRequest | null): void
  /** The app icon's path, or undefined to use Windows' default. */
  icon?: string
}

export class NotificationService {
  private lastNotificationTime: Map<NotificationType, number> = new Map()
  private shell: NotificationShell | null = null
  /**
   * Notifications that can still be clicked. On Windows a notification
   * Electron has garbage collected no longer fires `click` (see
   * `Notification.handleActivation` in Electron's docs), and one that timed
   * out can still be clicked in the notification centre, so the latest are
   * held until clicked.
   */
  private readonly clickable = new Set<Notification>()

  constructor(
    private getConfig: () => OstlerConfig,
    private mainWindow: BrowserWindow,
    private now: () => Date = () => new Date()
  ) {}

  /** Routes clicks through the deep-link handler and sets the icon (P8.2). */
  setShell(shell: NotificationShell): void {
    this.shell = shell
  }

  /**
   * Shows a Windows notification, if the settings allow it: notifications
   * on, this kind on, not in quiet hours, and never for a disabled project.
   * `target` is where a click takes the person (P5.6): main focuses the
   * window and sends a navigate event the renderer obeys. Without one, a
   * project's notification opens the project (P8.2).
   */
  public notify(
    type: NotificationType,
    title: string,
    body: string,
    projectId: string | null,
    target?: NavigateRequest
  ): void {
    if (!this.shouldNotify(type, projectId)) return
    if (this.isRateLimited(type)) return

    // Update rate limit map
    this.lastNotificationTime.set(type, Date.now())

    // The Windows notification: none off screen (`showDesktopNotification`).
    const opens = notificationTarget(target, projectId)
    showDesktopNotification(
      { title, body, ...(this.shell?.icon ? { icon: this.shell.icon } : {}) },
      (notification) => {
        this.clickable.add(notification)
        if (this.clickable.size > CLICKABLE_HELD) {
          this.clickable.delete(this.clickable.values().next().value as Notification)
        }
        const release = () => this.clickable.delete(notification)
        notification.on('failed', release)
        notification.on('click', () => {
          release()
          if (this.shell) {
            this.shell.open(opens)
            return
          }
          if (!this.mainWindow || this.mainWindow.isDestroyed()) return
          if (this.mainWindow.isMinimized()) this.mainWindow.restore()
          this.mainWindow.focus()
          if (opens) sendToWindow(this.mainWindow, IPC_CHANNELS.ON_NAVIGATE, opens)
        })
      }
    )

    // Emit event to renderer via IPC
    const payload: OstlerNotification = {
      id: uuidv4(),
      type,
      title,
      body,
      projectId,
      timestamp: Date.now()
    }

    sendToWindow(this.mainWindow, IPC_CHANNELS.ON_NOTIFICATION, payload)
  }

  /** True while a focus counts down (N3.5): notifications wait, as in quiet hours. */
  private focusHolds: () => boolean = () => false

  setFocusHold(holds: () => boolean): void {
    this.focusHolds = holds
  }

  /**
   * The one gate every desktop notification passes. Quiet hours and a focus
   * hold desktop notifications only: Inbox items are recorded either way.
   */
  shouldNotify(type: NotificationType, projectId: string | null): boolean {
    const config = this.getConfig()
    const settings = config.notifications
    if (!settings.enabled) return false
    if (this.focusHolds()) return false
    if (
      projectId &&
      !config.projects.some((project) => project.id === projectId && project.enabled)
    )
      return false
    if (inQuietHours(this.now(), settings)) return false

    switch (type) {
      case 'build_failure':
        return settings.onBuildFailure
      case 'large_changeset':
        return settings.onLargeChangeset
      case 'agent_session_start':
      case 'agent_session_end':
        return settings.onAgentSessionChange
      case 'reminder':
        return settings.onReminder
      case 'agent_question':
        return settings.onAgentQuestion
      case 'review_waiting':
        return settings.onReviewWaiting
      case 'blocker':
        return settings.onBlocker
      case 'assigned_by_someone':
        return settings.onAssignedToMe
      case 'mentioned':
        return settings.onMentioned
      case 'sign_off_requested':
      case 'sign_off_answered':
        return settings.onSignOff
      case 'task_changed':
        return settings.onFollowedTaskChanged
      case 'info':
      case 'rule':
      case 'focus':
      case 'device_pairing_request':
        return true
      case 'weekly_review':
        return settings.weeklyReviewDay !== null
      default:
        return false
    }
  }

  private isRateLimited(type: NotificationType): boolean {
    if (UNLIMITED.includes(type)) return false
    const lastTime = this.lastNotificationTime.get(type)
    if (!lastTime) return false

    // 30 seconds rate limit
    return Date.now() - lastTime < 30000
  }
}

/** Where a click goes: the given target, else the notification's project, else just the window. */
export function notificationTarget(
  target: NavigateRequest | undefined,
  projectId: string | null
): NavigateRequest | null {
  if (target) return target
  return projectId ? { kind: 'project', projectId, view: 'overview' } : null
}
