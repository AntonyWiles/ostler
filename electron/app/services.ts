import { app, net, powerMonitor, type BrowserWindow } from 'electron'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import * as nodeFs from 'node:fs'
import { userInfo } from 'os'
import { EMPTY_POLICY, IPC_CHANNELS, type OrgPolicy } from '@shared/ostler-api'
import { projectReviewBeforeMe } from '@shared/reviewer-runs'
import type {
  AIDraftSource,
  GitCommit,
  InboxItemKind,
  NotificationType,
  FocusState,
  PlanningReadinessReport,
  PlanningWorkItem,
  PlanningWorkItemStatus,
  HarnessProjectState,
  ProjectStateUpdate,
  TaskSplitJob,
  WatchedProject,
  WorkItemAttachment
} from '@shared/ostler-api'
import { ConfigStore } from '../config-store'
import { EventDatabase } from '../services/event-database'
import { FileWatcherService } from '../services/file-watcher'
import { GitReaderService } from '../services/git-reader'
import { LegacyAgentMigration } from '../services/harness/legacy-migration'
import { HarnessService, normalizeRelativePath } from '../services/harness-service'
import { ProjectRemovalService } from '../services/project-removal-service'
import { ProjectCareService } from '../services/project-care-service'
import { ProjectScaffoldService } from '../services/project-scaffold-service'
import { ProjectPackageService } from '../services/project-package-service'
import { HarnessHttpServer } from '../services/harness-http-server'
import { ReportService } from '../services/report-service'
import { registerReportHandlers } from '../ipc/report-handlers'
import {
  OpenCodeRunnerService,
  embeddedFailureNote,
  embeddedRunPhase
} from '../services/opencode-runner-service'
import { DispatcherService } from '../services/dispatcher-service'
import { AutomationHttpServer } from '../services/automation-http-server'
import { AgentEventStream } from '../services/agent-events'
import { RunGuidanceService } from '../services/run-guidance'
import { PlanningService, type BlockerChange } from '../services/planning-service'
import { PeopleService } from '../services/people-service'
import { DaysOffService } from '../services/days-off-service'
import { AwaySharingService } from '../services/away-sharing-service'
import { registerDaysOffHandlers } from '../ipc/days-off-handlers'
import { OutsideCalendarService } from '../services/outside-calendar-service'
import { readCalendarFile, registerOutsideCalendarHandlers } from '../ipc/outside-calendar-handlers'
import { CalendarLinkError, fetchCalendarLink } from '../services/calendar-link-fetch'
import { CalendarLinkSchedule } from '../services/calendar-link-schedule'
import { decryptApiKey, encryptApiKey } from '../safe-storage'
import { AIPlanningService } from '../services/ai-planning-service'
import { ProjectAiSettingsService } from '../services/project-ai-settings'
import { TaskSplitJobService } from '../services/task-split-job-service'
import { buildReadinessReport } from '../../src/shared/planning-readiness'
import {
  formatPlanningTaskDetails,
  queueWorkItemForHarness as queueWorkItemForHarnessService,
  type QueueWorkItemForHarness
} from '../services/task-intake'
import { runWorkItemHousekeeping } from '../services/work-item-housekeeping'
import { syncAgentWorkItemStatus as syncAgentWorkItem } from '../services/agent-status-sync'
import { isWatchedProject, isWithinRoot } from '../paths'
import { NotificationService, type NotificationShell } from '../services/notification-service'
import { emergencyStopAi } from '../services/emergency-stop'
import type { AgentSetupSetting } from '@shared/workspace-setup'
import { ProjectRuntimeController } from '../services/project-runtime-controller'
import { registerSystemHandlers } from '../ipc/system-handlers'
import { registerAgentPromptHandlers } from '../ipc/agent-prompt-handlers'
import { mcpStdioLaunch } from './mcp-stdio'
import { registerDiagnosticsHandlers } from '../ipc/diagnostics-handlers'
import { registerBackupHandlers } from '../ipc/backup-handlers'
import { registerSharingHandlers } from '../ipc/sharing-handlers'
import { registerDevicesHandlers } from '../ipc/devices-handlers'
import { registerAccountHandlers } from '../ipc/account-handlers'
import { ConnectedAccountsService } from '../services/accounts/connected-accounts-service'
import { accountCalendarIcs } from '../services/accounts/account-calendars'
import { AccountCallError } from '../services/accounts/account-fetch'
import { WebhookService } from '../services/webhook-service'
import { TimeBlockMirror } from '../services/accounts/time-block-mirror'
import { TaskListMirror } from '../services/accounts/task-list-mirror'
import { registerWebhookHandlers } from '../ipc/webhook-handlers'
import { openExternalUrl } from './security'
import {
  receivedProjectUpdate,
  sharedProjectSettings
} from '../services/sync/shared-project-settings'
import { SyncService } from '../services/sync/sync-service'
import { registerJoinedProject } from '../services/sync/joined-project'
import { syncedRoots } from '../services/sync/share-folder-finder'
import { SyncServerSettings } from '../services/sync/sync-server-settings'
import { R2Bridge } from '../services/sync/r2-bridge'
import { isDriveLocation as isDrivePlace } from '../services/sync/drive-transport'
import { isR2Location } from '../services/sync/r2-transport'
import { SharingError } from '../services/sync/sharing'
import { DriveSyncSettings } from '../services/sync/drive-sync-settings'
import { isDriveLocation } from '../services/sync/drive-transport'
import { readPolicy, systemPolicySources } from '../services/policy'
import { registerPolicyHandlers } from '../ipc/policy-handlers'
import { registerProjectCareHandlers } from '../ipc/project-care-handlers'
import { registerUpdateHandlers } from '../ipc/update-handlers'
import { autoUpdater } from 'electron-updater'
import { UpdateService, updatesOffReason, type Updater } from '../services/update-service'
import { appLog } from './logging'
import { registerCodeWorkspaceHandlers } from '../ipc/code-workspace-handlers'
import { registerProjectHandlers } from '../ipc/project-handlers'
import { registerHarnessHandlers } from '../ipc/harness-handlers'
import { registerTryItHandlers } from '../ipc/try-it-handlers'
import { registerTriageHandlers } from '../ipc/triage-handlers'
import { triageOn } from '../services/triage-service'
import { TryItService } from '../services/harness/try-it'
import { registerAiHandlers } from '../ipc/ai-handlers'
import { registerPlanningHandlers } from '../ipc/planning-handlers'
import { registerTimeHandlers } from '../ipc/time-handlers'
import { registerCostHandlers } from '../ipc/cost-handlers'
import { registerBillingHandlers } from '../ipc/billing-handlers'
import { registerContactsHandlers } from '../ipc/contacts-handlers'
import { registerPlanningWorkflowHandlers } from '../ipc/planning-workflow-handlers'
import { registerLibraryHandlers } from '../ipc/library-handlers'
import { registerWhiteboardHandlers } from '../ipc/whiteboard-handlers'
import { registerWhiteboardFileHandlers } from '../ipc/whiteboard-file-handlers'
import { registerPeopleHandlers } from '../ipc/people-handlers'
import { registerTeamHandlers } from '../ipc/team-handlers'
import { registerFollowHandlers } from '../ipc/follow-handlers'
import { FollowService } from '../services/follow-service'
import { registerSignOffHandlers } from '../ipc/sign-off-handlers'
import { SignOffService } from '../services/sign-off-service'
import type { SignOffArrived } from '../services/sync/sync-runner'
import { TeamService } from '../services/team-service'
import { registerTasksFromTextHandlers } from '../ipc/tasks-from-text-handlers'
import { registerFilterFromWordsHandlers } from '../ipc/filter-from-words-handlers'
import { registerNoteActionsHandlers } from '../ipc/note-actions-handlers'
import { registerLineTasksHandlers } from '../ipc/line-tasks-handlers'
import { registerWhiteboardTasksHandlers } from '../ipc/whiteboard-tasks-handlers'
import { registerWritingHelpHandlers } from '../ipc/writing-help-handlers'
import { registerHomeHandlers } from '../ipc/home-handlers'
import { registerSearchHandlers } from '../ipc/search-handlers'
import { registerPinHandlers } from '../ipc/pin-handlers'
import { registerChangeHistoryHandlers } from '../ipc/change-history-handlers'
import { ChangeHistoryService, type UndoneRow } from '../services/change-history/history-service'
import type { IndexedEntityType } from '../services/search-service'
import { registerStatusUpdateHandlers } from '../ipc/status-update-handlers'
import { registerGoalCheckInHandlers } from '../ipc/goal-check-in-handlers'
import { registerPersonalGoalHandlers } from '../ipc/personal-goal-handlers'
import { statusUpdateReminderSource } from '../services/status-update-reminder'
import { normalizeUpdateReminder, type UpdateReminder } from '@shared/status-updates'
import { myWorkingDays, type PersonWorkingDays } from '@shared/planning/working-days'
import { todayIsoDate } from '@shared/dates'
import { countdownEntries, type CountdownEntry } from './desktop/countdowns'
import { registerFindReplaceHandlers } from '../ipc/find-replace-handlers'
import { registerAskOstlerHandlers } from '../ipc/ask-ostler-handlers'
import { HomeService, plansWaiting, type AgentAttention } from '../services/home-service'
import { ProgressService, trackedTime } from '../services/progress-service'
import { registerProgressHandlers } from '../ipc/progress-handlers'
import { TaskPlansService } from '../services/task-plans-service'
import { RescheduleService } from '../services/reschedule-service'
import { MyDayService } from '../services/my-day-service'
import { TimeBlockService } from '../services/time-block-service'
import { FocusService } from '../services/focus-service'
import { registerFocusHandlers } from '../ipc/focus-handlers'
import { BlockMoveService } from '../services/block-move-service'
import { registerTimeBlockHandlers } from '../ipc/time-block-handlers'
import { BriefingService } from '../services/briefing-service'
import { writeBriefingUp } from '../services/briefing-ai'
import { GettingStartedService } from '../services/getting-started-service'
import { isAiConfigured } from '@shared/ai-configured'
import { normalizeModelPrices } from '@shared/agent-run-history'
import { InboxService } from '../services/inbox-service'
import {
  agentSources,
  blockerSource,
  triageSource,
  importSource,
  agentLimitSource,
  mentionSource,
  signOffSource,
  reminderSource,
  ruleNoticeSource,
  roundSource,
  scheduledQueueSource,
  commitFixSource,
  ruleNoticeText,
  reviewsNeedingYou
} from '../services/inbox-sources'
import { ImportService } from '../services/import-service'
import { registerImportHandlers } from '../ipc/import-handlers'
import { GithubClient } from '../services/github/github-client'
import { GithubLinkService } from '../services/github/github-link-service'
import { registerEmailHandlers } from '../ipc/email-handlers'
import { registerGithubHandlers } from '../ipc/github-handlers'
import { BRAND } from '@shared/brand'
import { ReminderService, reminderTaskReader } from '../services/reminder-service'
import {
  queueDueScheduledTasks,
  queueScheduledTaskNow,
  type ScheduledQueueDeps
} from '../services/scheduled-agent-tasks'
import { WeeklyReviewService } from '../services/weekly-review-service'
import { WeeklyReviewReminder, weeklyReviewSource } from '../services/weekly-review-reminder'
import { inQuietHours } from '@shared/reminder-settings'
import { LibraryService } from '../services/library-service'
import { LibraryTextPass } from '../services/library-text-pass'
import { BackupService } from '../services/backup-service'
import { projectFolder, requireProjectFolder } from '@shared/project-folder'
import { moveLegacyRefs } from '../services/project-history'
import { projectFolderRef } from '../services/project-files'
import { folderVersionNow } from '../services/harness/task-copies'
import { setAiActivityListener } from '../services/ai-provider'
import { showAgentColumnsWhereNeeded, syncHttpServers } from '../services/agents-switch'
import { performance } from 'node:perf_hooks'
import { PERF_MARKS } from '@shared/perf-marks'
import { handleApi } from '../ipc/handle-ipc'
import { applyLanguageSetting } from './locale'
import { createDeferredStartup, DEFERRED_STARTUP_FALLBACK_MS } from './deferred-startup'
import { t } from '@shared/i18n'
import { agentRunStateLabel, sessionRunState } from '@shared/agent-run-state'
import {
  askingWindow,
  broadcastToWindows,
  createOtherWindowsNotifier,
  registerOstlerWindow
} from '../services/send-to-window'
import { rewriteLiveListBody } from '../services/live-lists'

// ─── State ──────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null

// Change events reach every Ostler window, pop-outs too (N5.8a).
const sendToRenderer = (channel: string, payload: unknown): void =>
  broadcastToWindows(channel, payload)

/** Tells every window that `field` changed; listeners reload it. Empty projectId: not one project's. */
const signalChanged = (field: ProjectStateUpdate['field'], projectId = ''): void =>
  sendToRenderer(IPC_CHANNELS.ON_PROJECT_STATE_CHANGE, { projectId, field, data: null })

/** A dialog's parent: the window that asked, or the main window (N5.8a). */
const dialogParent = (): BrowserWindow | null => askingWindow() ?? mainWindow

let notificationService: NotificationService
let pendingNotificationShell: NotificationShell | null = null
// Tracks each project's currently-active harness sessions (id -> title) so the
// harness monitor loop can detect start/end transitions to notify on.
const trackedHarnessSessions = new Map<string, Map<string, string>>()

let dataDir = ''
let configStore!: ConfigStore
let database!: EventDatabase
let fileWatcher!: FileWatcherService
let gitReader!: GitReaderService
let harnessService!: HarnessService
let legacyMigration!: LegacyAgentMigration
let projectRemovalService!: ProjectRemovalService
let backupService!: BackupService
let projectCareService!: ProjectCareService
let projectScaffoldService!: ProjectScaffoldService
let projectPackageService!: ProjectPackageService
let importService!: ImportService
let githubLinkService!: GithubLinkService
let harnessHttpServer!: HarnessHttpServer
let openCodeRunnerService!: OpenCodeRunnerService
let dispatcherService!: DispatcherService
let automationHttpServer!: AutomationHttpServer
/** Both APIs' GET /events (D41): one stream, in memory. */
let agentEvents!: AgentEventStream
let runGuidance!: RunGuidanceService
let taskPlans!: TaskPlansService
let tryIt!: TryItService
let planningService!: PlanningService
let peopleService!: PeopleService
let teamService!: TeamService
let followService!: FollowService
let signOffService!: SignOffService
let changeHistory!: ChangeHistoryService
let daysOffService!: DaysOffService
let awaySharingService!: AwaySharingService
let awaySharingTimer: ReturnType<typeof setInterval> | null = null
/** Away days are made to match again this often: a day off ends, and a pull may not say so. */
const AWAY_SHARING_INTERVAL_MS = 10 * 60 * 1000
let outsideCalendarService!: OutsideCalendarService
let webhookService: WebhookService | null = null
let blockMirror: TimeBlockMirror | null = null
let taskMirror: TaskListMirror | null = null
let calendarLinkSchedule: CalendarLinkSchedule | null = null
let aiPlanningService!: AIPlanningService
let projectAiSettingsService!: ProjectAiSettingsService
let libraryService!: LibraryService
let syncService: SyncService | null = null
let syncServerSettings: SyncServerSettings | null = null
let driveSyncSettings: DriveSyncSettings | null = null
let r2Bridge: R2Bridge | null = null
/** The organisation's policy (integrations phase 7), read once at start. */
let orgPolicy: OrgPolicy = EMPTY_POLICY
let accountsService: ConnectedAccountsService | null = null
let libraryTextPass: LibraryTextPass | null = null
let libraryTextPassTimer: ReturnType<typeof setTimeout> | null = null
/** Start-up is over this long after the first screen: then the Library's files are read (N4.5). */
const LIBRARY_TEXT_PASS_DELAY_MS = 30_000
/** The person counts as busy until the keyboard and mouse have been still this many seconds. */
const LIBRARY_TEXT_PASS_IDLE_SECONDS = 2
let taskSplitJobService!: TaskSplitJobService
let taskReviewService!: import('../services/task-review-service').TaskReviewService
let projectRuntimeController!: ProjectRuntimeController
let homeService!: HomeService
let progressService!: ProgressService
let rescheduleService!: RescheduleService
let myDayService!: MyDayService
let timeBlockService!: TimeBlockService
let focusService!: FocusService
let blockMoveService!: BlockMoveService
let briefingService!: BriefingService
let gettingStartedService!: GettingStartedService
let reportService!: ReportService
let inboxService!: InboxService
let reminderService!: ReminderService
let weeklyReviewService!: WeeklyReviewService
let weeklyReviewReminder!: WeeklyReviewReminder
let updateService!: UpdateService
/** Set by main.ts: marks the quit as real, so a hidden window cannot hold up the installer. */
let beforeUpdateInstall: () => void = () => {}

/**
 * Keeps a planning work item in step with the agent task it was handed off to.
 *
 * The harness queue always tracked execution; the work item's own `status`
 * never moved, so items that had run and shipped still read `ready` and every
 * planning metric derived from that field stayed at zero.
 */
function syncAgentWorkItemStatus(
  projectId: string,
  taskId: string,
  status: PlanningWorkItemStatus
): void {
  try {
    syncAgentWorkItem(planningService, projectId, taskId, status)
  } catch (error) {
    // Status bookkeeping must never take down a start or a merge.
    console.error('Failed to sync planning work item status:', error)
  }
}

// ─── Service Initialization ─────────────────────────────────────────────────

/**
 * What waits until the first screen is on (P9.1): the backup check,
 * housekeeping and the Git history sync. Agent-session recovery does not
 * wait, and a pending restore was applied before the services were built.
 */
const deferredStartup = createDeferredStartup({
  fallbackMs: DEFERRED_STARTUP_FALLBACK_MS,
  onError: (name, error) => console.error(`Deferred start-up work failed (${name}):`, error),
  onReleased: () => performance.mark(PERF_MARKS.deferredStartup)
})

/**
 * Version watch (simplify pass §4): how often Ostler reads each folder's version
 * while agents are on. One small file read per project, so a switch shows on a
 * running task, and in Apply, within seconds.
 */
const VERSION_WATCH_MS = 3_000
let versionWatch: ReturnType<typeof setInterval> | null = null
const lastFolderVersion = new Map<string, string | null>()

function checkFolderVersions(): void {
  if (!configStore.get().harness.enabled) return
  for (const project of configStore.get().projects) {
    const folder = projectFolder(project)
    if (folder === null) continue
    const version = folderVersionNow(folder)
    const seen = lastFolderVersion.get(project.id)
    lastFolderVersion.set(project.id, version)
    if (seen !== undefined && seen !== version) notifyHarnessState(project)
  }
}

/** How often Ostler notes that it is still running with a timer (R2.3, D33). */
const TIMER_HEARTBEAT_MS = 60_000
let timerHeartbeat: ReturnType<typeof setInterval> | null = null

function startServices(): void {
  const config = configStore.get()

  // The last moment Ostler was seen running with a timer: "the time Ostler closed" next start.
  timerHeartbeat = setInterval(() => planningService.time.heartbeat(), TIMER_HEARTBEAT_MS)
  timerHeartbeat.unref?.()
  versionWatch = setInterval(checkFolderVersions, VERSION_WATCH_MS)
  versionWatch.unref?.()

  syncHttpServers(null, config, { harness: harnessHttpServer, automation: automationHttpServer })

  // Forward file watcher events to renderer and database
  fileWatcher.on('watch-event', (event) => {
    database.insertWatchEvent(event)
    sendToRenderer(IPC_CHANNELS.ON_WATCH_EVENT, event)
    notifyWatcherStatus(event.projectId, { throttle: true })
  })
  fileWatcher.on('status-changed', (projectId: string) => notifyWatcherStatus(projectId))

  fileWatcher.on('watcher-error', (err) => {
    console.error('Watcher error:', err)
  })

  // Never deferred. Projects with the agent setup from before the simplify
  // pass move to the new one first (§6), before any project's runtime reads
  // or writes its agent state, anything is dispatched, or sessions the last
  // exit interrupted are recovered.
  void legacyMigration
    .migrateAll()
    .catch((error: unknown) => console.error('Moving to the new agent setup failed:', error))
    .then(() => {
      // Every per-project runtime starts through the same lifecycle path used by IPC updates.
      for (const project of configStore.get().projects) {
        projectRuntimeController.start(project)
      }
      return recoverInterruptedSessions(configStore.get().projects)
    })

  // A backup now if the newest is older than the interval, then a check every
  // six hours; housekeeping now, then hourly. Both once the first screen is on.
  void deferredStartup.run('backups', () => backupService.start())
  void deferredStartup.run('housekeeping', () => {
    runHousekeeping()
    housekeepingTimer = setInterval(runHousekeeping, HOUSEKEEPING_INTERVAL_MS)
  })
  // Restore points and discarded work kept before the rename move from
  // refs/nexus/ to refs/ostler/ (legacy-names.ts); nothing to do once moved.
  void deferredStartup.run('legacy refs', async () => {
    for (const project of configStore.get().projects) {
      const folder = projectFolder(project)
      if (!folder) continue
      await moveLegacyRefs(folder).catch((error: unknown) =>
        console.warn(`[legacy refs] Could not move the kept work in ${folder}:`, error)
      )
    }
  })
  // The start-up update check waits for the first screen too (P10.1).
  void deferredStartup.run('update check', () => updateService.start())
  // Subscribed calendar links (N3.3b): a minute after the first screen, then hourly.
  void deferredStartup.run('calendar links', () => calendarLinkSchedule?.start())
  // Library files the current text reader has not read, once, in the background (N4.5).
  void deferredStartup.run('library text', () => {
    libraryTextPassTimer = setTimeout(() => {
      libraryTextPassTimer = null
      void libraryTextPass?.start()
    }, LIBRARY_TEXT_PASS_DELAY_MS)
    libraryTextPassTimer.unref?.()
  })
  deferredStartup.arm()

  // What the Inbox holds now is not news; only what arrives after is.
  inboxService.refresh()
  reminderService.start()
  weeklyReviewReminder.start()
  // Waking from sleep may have skipped the timer, or crossed a time zone.
  powerMonitor.on('resume', onSystemResume)
}

function onSystemResume(): void {
  // A focus that ended while the PC slept ends now, from its stored end (N3.5).
  focusService.check()
  desktopHooks?.dateMayHaveChanged()
  reminderService.systemTimeChanged()
  weeklyReviewReminder.fire()
  weeklyReviewReminder.plan()
}

/**
 * What the Windows integration (P8.2, `electron/app/desktop/`) hears about:
 * the taskbar badge and tray follow the Inbox, the jump list follows the
 * projects, and the taskbar flashes and shows progress.
 */
export interface DesktopHooks {
  /** The Inbox may have changed: the badge and the tray's count read it again. */
  inboxChanged(): void
  /** A project was added, renamed, archived or removed: the jump list's recent projects. */
  projectsChanged(): void
  /** The config changed: title bar colours, the menu's theme, background mode, sign-in and the key. */
  configChanged(): void
  /** An agent asked a question (the taskbar flashes while the window is in the background). */
  agentQuestionArrived(): void
  /** Progress on the taskbar button: a fraction, indeterminate, or none. */
  progress(source: 'import' | 'task-split', value: number | 'indeterminate' | null): void
  /** The timer started or stopped: the tray's and the jump list's Stop timer (R2.3). */
  timerChanged(): void
  /** A focus started, ended or moved on: the tray's tooltip and Stop focus (N3.5). */
  focusChanged(): void
  /** Pins, their items or the days off may have changed: the tray's and jump list's countdowns (N5.2b). */
  countdownsChanged(): void
  /** Back from sleep: the countdowns, if the date has changed meanwhile (N5.2b). */
  dateMayHaveChanged(): void
}

let desktopHooks: DesktopHooks | null = null

const HOME_PUSH_DELAY_MS = 250
let homePushTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Something Home, the Inbox or the reminder timer reads may have changed:
 * re-plan the reminder timer, turn new Inbox items into desktop
 * notifications, and push one 'home' refresh to the renderer. Debounced, so
 * a burst of writes makes one push.
 */
function notifyHomeChanged(): void {
  if (homePushTimer) return
  homePushTimer = setTimeout(() => {
    homePushTimer = null
    try {
      reminderService?.plan()
      notifyNewInboxItems()
    } catch (error) {
      console.error('Refreshing Home and the Inbox failed:', error)
    }
    signalChanged('home')
    desktopHooks?.inboxChanged()
    desktopHooks?.countdownsChanged()
  }, HOME_PUSH_DELAY_MS)
}

const INBOX_NOTIFICATION_TYPES: Partial<Record<InboxItemKind, NotificationType>> = {
  question: 'agent_question',
  // A plan waiting for approval notifies like a question (N9.3b).
  plan: 'agent_question',
  review: 'review_waiting',
  blocker: 'blocker',
  agentLimit: 'info',
  // A status update reminder (N5.5) follows the reminders' notification setting.
  statusUpdate: 'reminder',
  // A round started on schedule (N5.7a) too.
  round: 'reminder'
}

/** New questions, reviews and blockers as desktop notifications. Reminders notify as they fire. */
function notifyNewInboxItems(): number {
  const arrived = inboxService.refresh()
  for (const item of arrived) {
    const type = INBOX_NOTIFICATION_TYPES[item.kind]
    if (!type) continue
    if (item.kind === 'question') desktopHooks?.agentQuestionArrived()
    // A review waiting is news for the team too (integrations phase 4).
    if (item.kind === 'review' && item.projectId) {
      void webhookService?.send({
        kind: 'reviewWaiting',
        projectId: item.projectId,
        title: t('settings:webhooks.event.reviewWaiting', { title: item.title }),
        text: item.body
      })
    }
    notificationService?.notify(
      type,
      item.title,
      item.body,
      item.projectId,
      item.projectId && item.taskId
        ? { kind: 'task', projectId: item.projectId, taskId: item.taskId }
        : item.kind === 'statusUpdate' && item.projectId
          ? { kind: 'status-update', projectId: item.projectId }
          : item.milestoneId && item.projectId
            ? { kind: 'milestone', projectId: item.projectId, id: item.milestoneId }
            : { kind: 'inbox' }
    )
  }
  return arrived.length
}

/** Agent sessions working now, embedded or external: a restart to update would stop them. */
function countWorkingAgents(): number {
  if (!configStore.get().harness.enabled) return 0
  let count = 0
  for (const project of configStore.getProjects()) {
    if (!project.enabled || !projectFolder(project)) continue
    try {
      count += harnessService.getState(project).activeSessions.length
    } catch (error) {
      console.error('Counting running agents failed:', error)
    }
  }
  return count
}

/** The harness's questions and reviews for one project, with the task each is about. */
function agentAttention(project: WatchedProject): AgentAttention | null {
  if (!projectFolder(project)) return null
  try {
    const state = harnessService.getState(project)
    const sessions = [...state.activeSessions, ...state.reviewSessions]
    const taskOf = (sessionId: string): string | null => {
      const session = sessions.find((entry) => entry.id === sessionId)
      const task = state.taskQueue.find((entry) =>
        session?.taskId ? entry.id === session.taskId : entry.claimedBy === sessionId
      )
      return task?.planningWorkItemId ?? null
    }
    return {
      questions: state.questions
        .filter((question) => question.status === 'pending')
        .map((question) => ({
          id: question.id,
          text: question.question,
          at: Date.parse(question.askedAt) || 0,
          taskId: taskOf(question.sessionId)
        })),
      reviews: reviewsNeedingYou(state.reviewSessions, taskOf),
      // Plans waiting for approval (N9.3b): the run waits as long as they do.
      plans: plansWaiting(state.activeSessions, taskOf)
    }
  } catch {
    return null
  }
}

const attentionSeen = new Map<string, string>()

/** Harness state is pushed on every poll; Home hears only when what it shows changed. */
function notifyHomeIfAttentionChanged(project: WatchedProject): void {
  const attention = agentAttention(project)
  const signature = attention
    ? [
        ...attention.questions.map((q) => q.id),
        '|',
        ...attention.reviews.map((r) => r.id),
        '|',
        ...(attention.plans ?? []).map((p) => `${p.id}:${p.version}`)
      ].join(',')
    : ''
  if (attentionSeen.get(project.id) === signature) return
  attentionSeen.set(project.id, signature)
  notifyHomeChanged()
}

/** Ends embedded sessions a crash or force-quit left marked active (see OpenCodeRunnerService). */
async function recoverInterruptedSessions(projects: WatchedProject[]): Promise<void> {
  for (const project of projects) {
    try {
      const recovered = await openCodeRunnerService?.recoverInterruptedSessions(project)
      if (recovered) notifyHarnessState(project)
    } catch (error) {
      console.error(`Recovering interrupted sessions failed for project ${project.id}:`, error)
    }
  }
}

/** Event counts move with every file change; the status bar needs them only this often. */
const WATCHER_STATUS_THROTTLE_MS = 5_000
let watcherStatusTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Tells the renderer the watcher's status changed, so it re-reads it. A
 * started, stopped, paused, resumed or failed watcher says so at once; a file
 * event only bumps a counter, so those are sent at most every five seconds.
 */
function notifyWatcherStatus(projectId: string, { throttle = false } = {}): void {
  const send = () => signalChanged('watcher', projectId)
  if (!throttle) {
    send()
    return
  }
  if (watcherStatusTimer) return
  watcherStatusTimer = setTimeout(() => {
    watcherStatusTimer = null
    send()
  }, WATCHER_STATUS_THROTTLE_MS)
}

/** A settings change: the renderer re-reads the feature switches (agents, AI). */
function notifyConfigChanged(): void {
  signalChanged('config')
  // Reminder settings re-plan due reminders; agents on or off changes Needs you.
  const { dueReminders, reminderTime } = configStore.get().notifications
  const reminderKey = `${dueReminders}|${reminderTime}`
  if (reminderKey !== lastReminderSettings) {
    lastReminderSettings = reminderKey
    reminderService?.settingsChanged()
  }
  const { weeklyReviewDay, weeklyReviewTime } = configStore.get().notifications
  const weeklyKey = `${weeklyReviewDay}|${weeklyReviewTime}`
  if (weeklyKey !== lastWeeklyReviewSettings) {
    lastWeeklyReviewSettings = weeklyKey
    weeklyReviewReminder?.settingsChanged()
  }
  notifyHomeChanged()
  // Before the menus and tray rebuild, so they are rebuilt in the new language.
  applyLanguageSetting(configStore.get().ui.language)
  desktopHooks?.configChanged()
  updateService?.settingsChanged()
  // The personal settings go to this person's other devices a few seconds later (settings-sync.ts).
  syncService?.settingsChanged()
}

let lastReminderSettings = ''
let lastWeeklyReviewSettings = ''

/** Model requests started or finished: the status bar's "AI busy". */
function notifyAiActivity(activeRequests: number): void {
  sendToRenderer(IPC_CHANNELS.ON_PROJECT_STATE_CHANGE, {
    projectId: '',
    field: 'ai',
    data: { activeRequests }
  })
}

/** The Windows user name, for the first Me. */
function osUserName(): string {
  try {
    return userInfo().username
  } catch {
    return process.env.USERNAME ?? ''
  }
}

/**
 * The person's own working days, for countdowns (Home, the tray, the jump
 * list, the automation API) and the streak: Me's working days, Me's days off
 * and everyone's; Monday to Friday less everyone's when nobody is Me.
 */
function ownWorkingDays(): PersonWorkingDays {
  return myWorkingDays(peopleService.getMe(), daysOffService.list())
}

/** Shared away days follow Me's days off; never lets a failure reach the person's own work. */
function reconcileAwaySharing(): void {
  try {
    awaySharingService?.reconcile()
  } catch (error) {
    console.error('Could not update shared away days:', error)
  }
}

/** A day off was added, changed or removed: countdowns, the streak and the days-off lists. */
function notifyDaysOffChanged(): void {
  reconcileAwaySharing()
  // A day off changes a countdown's working days (N5.2b) and what the streak skips.
  desktopHooks?.countdownsChanged()
  signalChanged('daysOff')
  notifyHomeChanged()
}

/** An outside calendar or its events changed (N3.3a): the Calendar and Home re-read events. */
function notifyCalendarsChanged(): void {
  signalChanged('calendars')
}

/** A contact was added, edited or deleted (N6.5): the Contacts view and pickers re-read them. */
function notifyContactsChanged(): void {
  signalChanged('contacts')
}

/** The undo history gained, lost or undid a step: its view and the toolbar re-read it. */
function notifyChangeHistory(): void {
  signalChanged('history')
}

const UNDO_SEARCH_TYPES: Readonly<Record<string, IndexedEntityType>> = {
  planning_work_items: 'task',
  planning_comments: 'comment',
  planning_milestones: 'milestone',
  planning_goals: 'goal',
  planning_decisions: 'decision'
}

/**
 * An undo wrote these rows straight to the database: search learns their
 * text again, and every window re-reads what they show.
 */
function afterChangeUndone(rows: UndoneRow[]): void {
  const projects = new Set<string>()
  const columns = new Set<string>()
  const global = new Set<string>()
  const libraries = new Set<string>()
  for (const row of rows) {
    if (row.projectId) projects.add(row.projectId)
    const type = UNDO_SEARCH_TYPES[row.table]
    try {
      if (type && row.id) planningService.search.indexEntity(type, row.id)
      if (row.workItemId) planningService.search.indexEntity('task', row.workItemId)
    } catch (error) {
      console.error('Reindexing after an undo failed:', error)
    }
    if (row.table === 'planning_column_settings' || row.table === 'planning_wip_limits')
      if (row.projectId) columns.add(row.projectId)
    if (row.table === 'whiteboard_objects' && row.projectId) libraries.add(row.projectId)
    if (row.table === 'people') global.add('people')
    if (row.table === 'teams' || row.table === 'team_members') global.add('teams')
    if (row.table === 'contacts' || row.table === 'task_contacts') global.add('contacts')
    if (row.table === 'days_off') global.add('daysOff')
  }
  for (const projectId of projects) signalChanged('planning', projectId)
  // An open whiteboard reloads its objects on a 'library' change.
  for (const projectId of libraries) signalChanged('library', projectId)
  for (const projectId of columns) signalChanged('columns', projectId)
  if (global.has('people')) notifyPeopleChanged()
  if (global.has('teams')) notifyTeamsChanged()
  if (global.has('contacts')) notifyContactsChanged()
  if (global.has('daysOff')) notifyDaysOffChanged()
  notifyHomeChanged()
}

/** A team was made, changed or removed (D1): Settings and Workload read the teams again. */
function notifyTeamsChanged(): void {
  signalChanged('teams')
}

/** Someone was added, renamed, recoloured, archived or made Me: pickers re-read people. */
function notifyPeopleChanged(): void {
  signalChanged('people')
  // Who Me is, and Me's working days, decide what Home lists and how countdowns count.
  notifyHomeChanged()
  desktopHooks?.countdownsChanged()
}

/** The project list or a project's config changed: the renderer re-reads its projects. */
function notifyProjectsChanged(projectId: string): void {
  // A project added or deleted is shared into, or left from, the personal space (prompt 11).
  syncService?.projectsChanged(projectId)
  signalChanged('projects', projectId)
  // Enabling, disabling or removing a project changes Home, the Inbox and which reminders fire.
  notifyHomeChanged()
  desktopHooks?.projectsChanged()
}

/**
 * The emergency stop, from the status bar or the tray: everything halts, and
 * the Agents views and the status bar hear about it.
 */
function stopAllAi(): Promise<import('@shared/ostler-api').AIHaltState> {
  return emergencyStopAi({
    stopRunners: (reason) => {
      // Setups have no runner yet, so the runners' own stop cannot reach them.
      harnessService.cancelAllWorkspaceSetups()
      return openCodeRunnerService.stopAll(reason)
    },
    afterStop: () => {
      for (const project of configStore.getProjects()) notifyHarnessState(project)
      sendToRenderer(IPC_CHANNELS.ON_PROJECT_STATE_CHANGE, {
        projectId: '',
        field: 'ai',
        data: { activeRequests: 0, halted: true }
      })
    }
  })
}

/** The AI task split's progress on the taskbar: finished phases over all phases. */
function taskSplitProgress(job: TaskSplitJob): number | 'indeterminate' | null {
  if (job.status !== 'running') return null
  if (job.phases.length === 0) return 'indeterminate'
  const done = job.phases.filter((phase) => phase.status === 'done').length
  return Math.max(0.02, done / job.phases.length)
}

const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000
let housekeepingTimer: ReturnType<typeof setInterval> | null = null

/** Recycle-bin purge and opt-in auto-archive for every project; tells the Board when items moved. */
function runHousekeeping(): void {
  // Undo history past its keep period.
  try {
    changeHistory.prune()
  } catch (error) {
    console.error('Tidying the undo history failed:', error)
  }
  for (const project of configStore.get().projects) {
    // Restore points and discarded agent work past the retention period (§3.5).
    if (projectFolder(project) !== null) {
      void harnessService.pruneHistory(project).catch((error: unknown) => {
        console.error(`Tidying the history failed for project ${project.id}:`, error)
      })
    }
    try {
      const { archived, purged } = runWorkItemHousekeeping(
        planningService,
        harnessService,
        project,
        configStore.getProjectAutoDispatchConfig(project.id)
      )
      if (archived + purged > 0) {
        sendToRenderer(IPC_CHANNELS.ON_PROJECT_STATE_CHANGE, {
          projectId: project.id,
          field: 'planning',
          data: { archived, purged }
        })
      }
    } catch (error) {
      console.error(`Work item housekeeping failed for project ${project.id}:`, error)
    }
  }
  // A status update reminder's day (N5.5) begins without any write, so the
  // Inbox is looked at hourly too; only something new reloads Home.
  try {
    if (notifyNewInboxItems() > 0) notifyHomeChanged()
  } catch (error) {
    console.error('Looking for new Inbox items failed:', error)
  }
}

async function stopServices(): Promise<void> {
  deferredStartup.cancel()
  if (timerHeartbeat) clearInterval(timerHeartbeat)
  timerHeartbeat = null
  if (versionWatch) clearInterval(versionWatch)
  versionWatch = null
  try {
    planningService.time.heartbeat()
  } catch (error) {
    console.error('Could not note the timer at quit:', error)
  }
  if (housekeepingTimer) clearInterval(housekeepingTimer)
  housekeepingTimer = null
  if (homePushTimer) clearTimeout(homePushTimer)
  homePushTimer = null
  powerMonitor.removeListener('resume', onSystemResume)
  // Closing Ostler ends a focus; its timer follows R2.3's question next start.
  focusService?.dispose()
  reminderService?.stop()
  weeklyReviewReminder?.stop()
  updateService?.stop()
  if (watcherStatusTimer) clearTimeout(watcherStatusTimer)
  watcherStatusTimer = null
  backupService?.stop()
  // Must run before harnessHttpServer/database shut down -- it still needs
  // both to record each stopped session's final state.
  await openCodeRunnerService?.stopAll()
  await tryIt?.stopAll()
  if (libraryTextPassTimer) clearTimeout(libraryTextPassTimer)
  libraryTextPassTimer = null
  await libraryTextPass?.stop()
  // Before the database closes: a push or pull in hand finishes first.
  r2Bridge?.stop()
  await syncService?.stop()
  fileWatcher.stopAll()
  gitReader.stopAll()
  harnessService.stopAll()
  harnessHttpServer.stop()
  automationHttpServer.stop()
  planningService.close()
  peopleService.close()
  teamService?.close()
  followService?.close()
  signOffService?.close()
  changeHistory.close()
  if (awaySharingTimer) clearInterval(awaySharingTimer)
  awaySharingService?.close()
  daysOffService.close()
  calendarLinkSchedule?.stop()
  accountsService?.close()
  webhookService?.close()
  blockMirror?.close()
  taskMirror?.close()
  syncServerSettings?.close()
  outsideCalendarService.close()
  libraryService.close()
  database.close()
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────

function registerHandlers(): void {
  // The window's first screen is on: the deferred start-up work may run.
  handleApi('reportFirstScreen', () => deferredStartup.release())

  registerProjectHandlers({
    configStore,
    database,
    fileWatcher,
    gitReader,
    harnessService,
    harnessHttpServer,
    automationHttpServer,
    projectRemovalService,
    projectScaffoldService,
    projectPackageService,
    showAgentColumns: (projectId) => planningService.columns.showAgentColumns(projectId),
    runtimeController: projectRuntimeController,
    getMainWindow: dialogParent,
    getProject,
    validateProjectRelativePath
  })

  registerTryItHandlers({ tryIt, getProject, notifyHarnessState })
  registerTriageHandlers({
    planningService,
    libraryService,
    aiPlanningService,
    getProject,
    notifyHarnessState
  })
  registerHarnessHandlers({
    configStore,
    harnessService,
    openCodeRunnerService,
    planningService,
    getMainWindow: dialogParent,
    getProject,
    notifyHarnessState,
    runGuidance,
    legacyMigration,
    taskPlans
  })

  registerAiHandlers({
    dataDir,
    configStore,
    database,
    planningService,
    libraryService,
    taskReviewService,
    openCodeRunnerService,
    getMainWindow: () => mainWindow,
    getProject,
    queueWorkItemForHarness,
    notifyHarnessState,
    projectAiSettings: projectAiSettingsService,
    stopAllAi
  })

  registerPlanningHandlers({
    configStore,
    database,
    aiPlanningService,
    gitReader,
    harnessService,
    planningService,
    getProject,
    queueWorkItemForHarness,
    agentAttachmentsFor,
    notifyHarnessState,
    notifyPlanningChanged: (project) => signalChanged('planning', project.id),
    recordWorkItemSources,
    recordWorkItemAttachments
  })

  registerTimeHandlers({
    planningService,
    getProject,
    getProjects: () => configStore.getProjects(),
    getMainWindow: dialogParent
  })
  registerFocusHandlers({ focus: focusService, getProject })
  registerCostHandlers({ planningService, getProject, getMainWindow: dialogParent })
  registerBillingHandlers({ planningService, getProject, getMainWindow: dialogParent })
  registerContactsHandlers({
    planningService,
    getProject,
    getMainWindow: dialogParent,
    notifyContactsChanged
  })

  registerPlanningWorkflowHandlers({
    aiPlanningService,
    taskSplitJobService,
    harnessService,
    planningService,
    getProject,
    formatPlanningTaskDetails: planningTaskDetails,
    notifyHarnessState,
    recordWorkItemSources,
    recordWorkItemAttachments
  })

  registerTasksFromTextHandlers({
    aiPlanningService,
    planningService,
    peopleService,
    libraryService,
    getProject,
    notifyPlanningChanged: (project) => signalChanged('planning', project.id)
  })
  registerFilterFromWordsHandlers({
    aiPlanningService,
    planningService,
    peopleService,
    getProject
  })
  registerNoteActionsHandlers({
    aiPlanningService,
    planningService,
    peopleService,
    libraryService,
    getProject,
    notifyPlanningChanged: (project) => signalChanged('planning', project.id),
    notifyLibraryChanged: (project) => signalChanged('library', project.id)
  })
  registerLineTasksHandlers({
    planningService,
    libraryService,
    getProject,
    notifyPlanningChanged: (project) => signalChanged('planning', project.id),
    notifyLibraryChanged: (project) => signalChanged('library', project.id)
  })
  registerWhiteboardTasksHandlers({
    planningService,
    libraryService,
    getProject,
    notifyPlanningChanged: (project) => signalChanged('planning', project.id),
    notifyLibraryChanged: (project) => signalChanged('library', project.id)
  })
  registerWritingHelpHandlers({
    aiPlanningService,
    planningService,
    peopleService,
    getProject,
    notifyPlanningChanged: (project) => signalChanged('planning', project.id)
  })
  registerPeopleHandlers({
    peopleService,
    notifyPeopleChanged,
    notifyPlanningChanged: (projectId) => signalChanged('planning', projectId)
  })
  registerTeamHandlers({ teamService, notifyTeamsChanged })
  registerFollowHandlers({ followService, database: planningService.database })
  registerSignOffHandlers({
    signOffService,
    notifyPlanningChanged: (projectId) => signalChanged('planning', projectId)
  })
  registerTimeBlockHandlers({ timeBlockService, blockMoveService, notifyHomeChanged })
  registerDaysOffHandlers({
    daysOffService,
    awaySharingService,
    getMainWindow: dialogParent,
    notifyDaysOffChanged
  })
  registerOutsideCalendarHandlers({
    outsideCalendarService,
    getMainWindow: dialogParent,
    notifyCalendarsChanged
  })
  registerHomeHandlers({
    homeService,
    briefingService,
    writeBriefing: (briefing) => writeBriefingUp(configStore.get(), briefing),
    gettingStartedService,
    inboxService,
    planningService,
    rescheduleService,
    myDayService,
    weeklyReviewService,
    getProject,
    notifyHomeChanged,
    queueScheduledTaskNow: (workItemId) => {
      const item = queueScheduledTaskNow(
        scheduledQueueDeps(),
        workItemId,
        planningService.humanActor()
      )
      const project = configStore.getProjects().find((entry) => entry.id === item.projectId)
      if (project) notifyHarnessState(project)
    }
  })

  registerProgressHandlers({ progressService })
  registerSearchHandlers({ planningService, getProject })
  registerPinHandlers({ planningService })
  registerChangeHistoryHandlers({ changeHistory })
  if (webhookService) registerWebhookHandlers(webhookService, getProject)
  registerStatusUpdateHandlers({
    planningService,
    aiPlanningService,
    getProject,
    getProjectIds: () =>
      configStore
        .getProjects()
        .filter((project) => project.enabled)
        .map((project) => project.id)
  })
  registerGoalCheckInHandlers({
    planningService,
    getProject,
    getProjectIds: () =>
      configStore
        .getProjects()
        .filter((project) => project.enabled)
        .map((project) => project.id)
  })
  registerPersonalGoalHandlers({
    planningService,
    getProject,
    getProjectIds: () =>
      configStore
        .getProjects()
        .filter((project) => project.enabled)
        .map((project) => project.id)
  })
  registerFindReplaceHandlers({ planningService, getProject })
  registerAskOstlerHandlers({
    getConfig: () => configStore.get(),
    planningService,
    libraryService,
    peopleService,
    sendToRenderer
  })
  registerReportHandlers({ reportService, getProject })
  registerEmailHandlers({ configStore })
  registerGithubHandlers({
    configStore,
    githubLinks: githubLinkService,
    importService,
    gitReader,
    getProject
  })
  registerImportHandlers({
    importService,
    projectPackageService,
    planningService,
    getReportService: () => reportService,
    runtimeController: projectRuntimeController,
    getMainWindow: dialogParent,
    getProject,
    notifyPlanningChanged: (projectId) => {
      signalChanged('planning', projectId)
      // An import may have added people as well as tasks.
      notifyPeopleChanged()
    },
    importProgress: (running) => desktopHooks?.progress('import', running ? 'indeterminate' : null)
  })

  registerLibraryHandlers({
    libraryService,
    getMainWindow: dialogParent,
    getProject,
    getTextProgress: () => libraryTextPass?.progress ?? null
  })
  registerWhiteboardHandlers({ libraryService, getProject })
  registerWhiteboardFileHandlers({
    libraryService,
    getProject,
    getMainWindow: dialogParent,
    notifyLibraryChanged: (project) => signalChanged('library', project.id)
  })

  registerSystemHandlers({ configStore, database })
  registerAgentPromptHandlers({
    configStore,
    harnessService,
    getProject,
    mcpStdioLaunch: (projectId) => mcpStdioLaunch(projectId, dataDir)
  })
  registerDiagnosticsHandlers({ configStore })
  registerProjectCareHandlers({
    projectCareService,
    importService,
    runtimeController: projectRuntimeController,
    getMainWindow: dialogParent,
    getProject,
    notifyPlanningChanged: (projectId) => signalChanged('planning', projectId)
  })
  registerBackupHandlers({
    backupService,
    configStore,
    dataDir,
    getMainWindow: dialogParent,
    notifyHomeChanged
  })
  registerPolicyHandlers({ policy: () => orgPolicy, syncServer: syncServerSettings })
  if (syncService) {
    registerSharingHandlers({
      syncService,
      syncServer: syncServerSettings,
      driveSync: driveSyncSettings,
      configStore,
      peopleService,
      dataDir,
      getMainWindow: dialogParent
    })
    registerDevicesHandlers({
      syncService,
      driveSync: driveSyncSettings,
      r2Bridge: () => r2Bridge,
      dataDir,
      getMainWindow: dialogParent
    })
  }
  if (accountsService) {
    registerAccountHandlers(accountsService, {
      calendars: { service: outsideCalendarService, changed: notifyCalendarsChanged },
      contacts: () => planningService.contacts,
      blockMirror,
      taskMirror
    })
  }
  registerUpdateHandlers(updateService)
  registerCodeWorkspaceHandlers({
    assertWorkspaceRoot: assertCodeWorkspaceRoot,
    sendCommandOutput: (output) => {
      sendToRenderer(IPC_CHANNELS.ON_CODE_COMMAND_OUTPUT, output)
    },
    notifyCommandFailure: (projectId, command, exitCode) => {
      const project = configStore.getProjects().find((item) => item.id === projectId)
      notificationService.notify(
        'build_failure',
        t('desktop:services.commandFailed'),
        project
          ? t('desktop:services.exitedCode', { command, exitCode, projectName: project.name })
          : t('desktop:services.exitedCode2', { command, exitCode }),
        projectId,
        { kind: 'project', projectId, view: 'files' }
      )
    }
  })
}

/**
 * A Code tab root is either the project's own checkout or one of that
 * project's harness-managed worktrees (session workspaces, merge-review
 * worktrees) under dataDir/harness/<projectId>. Anything else is rejected
 * before it reaches the filesystem.
 */
function assertCodeWorkspaceRoot(projectId: string, rootPath: string): void {
  const project = getProject(projectId)
  const harnessRoot = harnessService.getProjectWorkspaceRoot(projectId)
  const folder = projectFolder(project)
  const inFolder = folder !== null && isWithinRoot(rootPath, folder)
  if (!inFolder && !isWithinRoot(rootPath, harnessRoot)) {
    throw new Error('Workspace root is not part of this project')
  }
}

function getProject(projectId: string): WatchedProject {
  const project = configStore.getProjects().find((item) => item.id === projectId)
  if (!project) throw new Error('Project not found')
  if (!project.enabled) throw new Error('Project is disabled')
  return project
}

function startHarnessMonitoring(project: WatchedProject): void {
  const harnessConfig = configStore.get().harness
  harnessService.startMonitoring(
    project,
    harnessConfig.pollIntervalMs,
    (projectId, state) => {
      notifyHarnessSessionChanges(project, state)
      notifyHomeIfAttentionChanged(project)
      sendToRenderer(IPC_CHANNELS.ON_PROJECT_STATE_CHANGE, {
        projectId,
        field: 'harness',
        data: state
      })
      void dispatcherService?.evaluate(projectId).catch((err) => {
        console.error(`Auto-dispatcher evaluation failed for project ${projectId}:`, err)
      })
    },
    {
      reportIntervalMs: harnessConfig.reportIntervalMs,
      staleSessionThresholdMs: harnessConfig.staleSessionThresholdMs,
      reportRetentionDays: harnessConfig.reportRetentionDays,
      maxToolCallsPerMinute: harnessConfig.maxToolCallsPerMinute
    }
  )
}

function validateProjectRelativePath(project: WatchedProject, relativePath: string): string {
  const folder = requireProjectFolder(project, 'Reading project files')
  const safeRelativePath = normalizeRelativePath(relativePath)
  if (!isWatchedProject(resolve(folder, safeRelativePath), [folder])) {
    throw new Error(t('desktop:services.pathOutsideProjectFolder'))
  }
  return safeRelativePath
}

function handleNewGitCommits(project: WatchedProject, commits: GitCommit[]): void {
  for (const commit of commits) {
    database.insertGitEvent(project.id, { ...commit, branch: '' })
  }
  // Smart commits (N9.8b): new commits link the tasks they name, and one that
  // fixes an open task offers Mark as done in the Inbox.
  linkCommits(project, commits, true)

  const threshold = configStore.get().notifications.largeChangesetThreshold
  for (const commit of commits) {
    if (commit.filesChanged >= threshold) {
      notificationService.notify(
        'large_changeset',
        t('desktop:services.manyFilesChangedOne'),
        t('desktop:services.filesChanged', {
          count: commit.filesChanged,
          message: commit.message.slice(0, 80),
          projectName: project.name
        }),
        project.id,
        { kind: 'project', projectId: project.id, view: 'files' }
      )
    }
  }

  signalChanged('git', project.id)
}

function notifyHarnessSessionChanges(project: WatchedProject, state: HarnessProjectState): void {
  const { activeSessions } = state
  const previous = trackedHarnessSessions.get(project.id) ?? new Map<string, string>()
  const current = new Map<string, string>()
  for (const session of activeSessions) {
    current.set(session.id, session.title)
    if (!previous.has(session.id)) {
      notificationService.notify(
        'agent_session_start',
        t('desktop:services.agentStarted'),
        `${session.title} — ${project.name}`,
        project.id,
        { kind: 'project', projectId: project.id, view: 'agents' }
      )
    }
  }
  for (const [sessionId, title] of previous) {
    if (!current.has(sessionId)) {
      // Say where the run stands now, in the shared words: In review, not "done".
      const ended = state.reviewSessions.find((session) => session.id === sessionId)
      notificationService.notify(
        'agent_session_end',
        t('desktop:services.agentFinished'),
        ended
          ? t('desktop:services.agentFinishedState', {
              title,
              state: agentRunStateLabel(sessionRunState(ended, state)),
              projectName: project.name
            })
          : `${title} — ${project.name}`,
        project.id,
        { kind: 'project', projectId: project.id, view: 'agents' }
      )
    }
  }
  trackedHarnessSessions.set(project.id, current)
}

/** Records which library items an approved AI draft's work items came from. */
function recordWorkItemSources(
  projectId: string,
  workItemIds: string[],
  sources: AIDraftSource[] | undefined
): void {
  if (!sources || sources.length === 0 || workItemIds.length === 0) return
  libraryService.recordDraftSources(projectId, workItemIds, sources)
  signalChanged('library', projectId)
}

/** The queued task a blocker's work item was handed to, for its event. */
function blockerTaskId(workItemId: string): { taskId?: string } {
  try {
    const taskId = planningService.getWorkItem(workItemId).linkedHarnessTaskId
    return taskId ? { taskId } : {}
  } catch {
    return {}
  }
}

/**
 * A blocker was reported or resolved, here or on another device (sync): the Overview's Blockers
 * panel reloads and agents waiting on GET /events hear of it.
 */
function publishBlockerChange(projectId: string, change: BlockerChange): void {
  sendToRenderer(IPC_CHANNELS.ON_PROJECT_STATE_CHANGE, {
    projectId,
    field: 'planning',
    data: { blockers: true }
  })
  agentEvents.publish(projectId, {
    type: change.kind === 'reported' ? 'blocker.reported' : 'blocker.resolved',
    blockerId: change.blockerId,
    workItemId: change.workItemId,
    ...blockerTaskId(change.workItemId)
  })
}

function notifyHarnessState(project: WatchedProject): void {
  harnessService.refreshReport(project)
  notifyHomeIfAttentionChanged(project)
  sendToRenderer(IPC_CHANNELS.ON_PROJECT_STATE_CHANGE, {
    projectId: project.id,
    field: 'harness',
    data: harnessService.getState(project)
  })
  void dispatcherService?.evaluate(project.id).catch((err) => {
    console.error(`Auto-dispatcher evaluation failed for project ${project.id}:`, err)
  })
}

/**
 * What scheduled agent tasks (N9.7) queue with: the schedule's own check and
 * the person's Queue it now take the same path, marked as scheduled.
 */
function scheduledQueueDeps(): ScheduledQueueDeps {
  return {
    planning: planningService,
    getProjects: () => configStore.getProjects(),
    agentsOn: () => configStore.get().harness.enabled,
    queuedTasks: (project) => harnessService.getState(project).taskQueue,
    queue: (project, workItemId) => {
      queueWorkItemForHarnessService(planningService, harnessService, project, workItemId, {
        allowUnmetDependencies: true,
        attachments: agentAttachmentsFor(project.id, workItemId),
        scheduled: true
      })
    }
  }
}

/** Reserves a harness handoff for a planning work item and adds/reprioritizes its queue entry. */
function queueWorkItemForHarness(
  ...[project, workItemId, options = {}]: Parameters<QueueWorkItemForHarness>
): ReturnType<QueueWorkItemForHarness> {
  return queueWorkItemForHarnessService(planningService, harnessService, project, workItemId, {
    ...options,
    attachments: agentAttachmentsFor(project.id, workItemId)
  })
}

/** A work item's agent-visible library attachments; none when the Library cannot say. */
function agentAttachmentsFor(projectId: string, workItemId: string): WorkItemAttachment[] {
  try {
    return libraryService.agentAttachments(projectId, workItemId).given
  } catch (error) {
    console.error(`Failed to read attachments for work item ${workItemId}:`, error)
    return []
  }
}

/** `formatPlanningTaskDetails` with the work item's attachments: what every queued task is copied from. */
function planningTaskDetails(item: PlanningWorkItem): string {
  return formatPlanningTaskDetails(
    item,
    agentAttachmentsFor(item.projectId, item.id),
    planningService.taskTypes.nameOf(item.typeId)
  )
}

/**
 * A work item is the one source of what its agent is asked to do. Its queued
 * task holds a copy (the agent's prompt is built from it), so every edit to
 * the item or its attachments re-copies it while no agent holds the task yet.
 */
function syncPendingWorkItemTaskText(item: PlanningWorkItem): void {
  if (!item.linkedHarnessTaskId) return
  harnessService.syncPendingTaskText(
    getProject(item.projectId),
    item.linkedHarnessTaskId,
    item.title,
    planningTaskDetails(item)
  )
}

/** Records the attachments an approved AI draft proposed, as `ostler-ai`. */
function recordWorkItemAttachments(
  projectId: string,
  entries: { workItemId: string; itemIds: string[] | undefined }[]
): void {
  if (!entries.some((entry) => entry.itemIds && entry.itemIds.length > 0)) return
  libraryService.recordDraftAttachments(projectId, entries)
  signalChanged('library', projectId)
}

/**
 * Imports a bounded, read-only history when a project is first monitored.
 * Repeated syncs are safe because git_events is keyed by project and commit SHA.
 */
async function syncProjectGitHistory(project: WatchedProject): Promise<void> {
  const commits = await gitReader.getLog(project.id, 500)
  for (const commit of commits) {
    database.insertGitEvent(project.id, { ...commit, branch: '' })
  }
  // Linked, never offered: a first import of 500 commits must not flood the Inbox.
  linkCommits(project, commits, false)
}

/**
 * Links commits to the tasks their messages name (N9.8b). The first time a
 * project's commits arrive after this feature, every commit stored before it
 * is read once too, without offering anything.
 */
function linkCommits(project: WatchedProject, commits: GitCommit[], offer: boolean): void {
  try {
    const links = planningService.commitLinks
    // The batch first, so its own commits keep their offer; then, once, the rest.
    const made = links.link(project.id, commits, { offer })
    links.linkStoredOnce(project.id)
    if (made > 0 && offer) notifyHomeChanged()
  } catch (error) {
    console.error(`Failed to link commits to tasks for project ${project.id}:`, error)
  }
}

// ─── Construction ───────────────────────────────────────────────────────────

/** Every service, constructed and wired, plus the lifecycle steps main.ts runs in order. */
export interface AppServices {
  configStore: ConfigStore
  libraryService: LibraryService
  getProject: (projectId: string) => WatchedProject
  /** One picture from an agent's report (N9.1), for the `ostler-report-picture:` scheme. */
  readReportPicture: (
    project: WatchedProject,
    sessionId: string,
    name: string
  ) => { bytes: Buffer; mimeType: string } | null
  registerHandlers: () => void
  /** Sets the window every service sends to; the first call also creates the notifier. */
  attachWindow: (window: BrowserWindow) => void
  start: () => void
  stop: () => Promise<void>
  /** Windows integration (P8.2): what it hears about, and what the tray and taskbar read and do. */
  setDesktopHooks: (hooks: DesktopHooks) => void
  /** Clicks on notifications open through the deep-link route, with the app icon. */
  setNotificationShell: (shell: NotificationShell) => void
  unreadInboxCount: () => number
  /** Main marks the quit as real before the update installer takes over (P10.1). */
  setBeforeUpdateInstall: (hook: () => void) => void
  stopAllAi: () => Promise<unknown>
  pauseReminders: (until: number | null) => void
  /** Development only: writes the P9.1 scale dataset (`npm run seed:scale`). */
  seedScale: (projectsParent: string) => Promise<void>
  remindersPausedUntil: () => number | null
  /** The running timer's task title, or null (R2.3). */
  runningTimerTitle: () => string | null
  stopTimer: () => void
  /** The focus, or null (N3.5). */
  focus: () => FocusState | null
  stopFocus: () => void
  /** The tray's and the jump list's countdowns, worded for `today` (N5.2b). */
  countdowns: (today: string) => CountdownEntry[]
}

/** Constructs and wires every service over the prepared data folder. */
export async function createAppServices(dir: string): Promise<AppServices> {
  dataDir = dir
  const databasePath = join(dataDir, 'ostler.db')
  configStore = new ConfigStore(join(dataDir, 'config.json'))
  // A Viewer of a shared project can't change the settings its members share, from any surface.
  configStore.isViewerOf = (projectId) =>
    ['viewer', 'contributor'].includes(syncService?.myRole(projectId) ?? '')
  orgPolicy = await readPolicy(systemPolicySources((message) => console.warn(message)))
  configStore.setPolicy(orgPolicy)
  configStore.setProjectsChangedListener(notifyProjectsChanged)
  configStore.setConfigChangedListener(notifyConfigChanged)
  setAiActivityListener(notifyAiActivity)
  database = new EventDatabase(databasePath)
  planningService = new PlanningService(
    databasePath,
    () => configStore.getProjects().map((project) => project.id),
    () => configStore.get().notifications,
    (projectId) =>
      configStore.getProjects().find((project) => project.id === projectId)?.taskPrefix ?? null
  )
  // Triage new captures (N4.3a), read from the project's settings at each capture.
  planningService.setTriageSetting((projectId) => {
    const project = configStore.getProjects().find((entry) => entry.id === projectId)
    return project ? triageOn(project) : false
  })
  // Every task write, from every surface, reaches Home, the Inbox and the reminder timer.
  // A task written in one window shows in every other window at once (N5.8a).
  const tellOtherWindows = createOtherWindowsNotifier((projectId, except) =>
    broadcastToWindows(
      IPC_CHANNELS.ON_PROJECT_STATE_CHANGE,
      { projectId, field: 'planning', data: null },
      except
    )
  )
  planningService.setChangedListener((projectId) => {
    notifyHomeChanged()
    tellOtherWindows(projectId)
    // A block may have moved, a task changed: their copies follow (integrations phase 6).
    blockMirror?.schedule()
    taskMirror?.schedule()
  })
  // A time entry or the timer changed anywhere: the window, the tray and the jump list (R2.3).
  // Focus (N3.5): a countdown on the one timer, in memory only.
  focusService = new FocusService({
    time: planningService.time,
    settings: () => configStore.get().notifications.focus,
    rememberLength: (minutes) => {
      const notifications = configStore.get().notifications
      if (notifications.focus.lastMinutes === minutes) return
      configStore.update({
        notifications: { ...notifications, focus: { ...notifications.focus, lastMinutes: minutes } }
      })
    }
  })
  planningService.time.setChangedListener((projectId) => {
    sendToRenderer(IPC_CHANNELS.ON_TIME_CHANGE, { projectId })
    desktopHooks?.timerChanged()
    // A timer stopped or switched anywhere ends the focus on it.
    focusService.timerChanged()
  })
  focusService.setChangedListener((change) => {
    sendToRenderer(IPC_CHANNELS.ON_FOCUS_CHANGE, change)
    desktopHooks?.focusChanged()
    const focus = change.focus
    if (change.event === 'finished' && focus)
      notificationService?.notify(
        'focus',
        t('desktop:focus.finished', { task: focus.workItemTitle }),
        '',
        focus.projectId,
        { kind: 'task', projectId: focus.projectId, taskId: focus.workItemId }
      )
  })
  // A config written by an older build, or edited by hand, may hide what agents use.
  showAgentColumnsWhereNeeded(configStore.get(), (projectId) =>
    planningService.columns.showAgentColumns(projectId)
  )
  // A project's column names or hidden columns changed anywhere (R2.4).
  planningService.columns.setChangedListener((projectId) => {
    signalChanged('columns', projectId)
  })
  agentEvents = new AgentEventStream()
  // A blocker reported or resolved anywhere reaches the Overview at once, and
  // the agent event stream.
  planningService.setBlockersChangedListener(publishBlockerChange)
  const { dueReminders, reminderTime } = configStore.get().notifications
  lastReminderSettings = `${dueReminders}|${reminderTime}`
  const { weeklyReviewDay, weeklyReviewTime } = configStore.get().notifications
  lastWeeklyReviewSettings = `${weeklyReviewDay}|${weeklyReviewTime}`
  homeService = new HomeService({
    db: planningService.database,
    getProjects: () => configStore.getProjects(),
    getMeId: () => planningService.humanActor().personId ?? null,
    agentsOn: () => configStore.get().harness.enabled,
    agentAttention,
    getPeople: () => peopleService.list()
  })
  progressService = new ProgressService({
    db: planningService.database,
    getProjects: () => configStore.getProjects(),
    getMe: () => peopleService.getMe(),
    getDaysOff: () => daysOffService.list(),
    getTimeEntries: trackedTime(planningService.time, () => peopleService.getMe()?.id ?? null)
  })
  myDayService = new MyDayService({
    db: planningService.database,
    planning: planningService,
    getProjects: () => configStore.getProjects()
  })
  timeBlockService = new TimeBlockService({
    db: planningService.database,
    planning: planningService,
    getProjects: () => configStore.getProjects()
  })
  blockMoveService = new BlockMoveService({
    db: planningService.database,
    timeBlocks: timeBlockService,
    myDay: myDayService,
    getWorkingHours: () => configStore.get().ui.workingHours,
    getMe: () => peopleService.getMe(),
    getDaysOff: () => daysOffService.list(),
    getEvents: (from, to) => outsideCalendarService.events({ from, to })
  })
  rescheduleService = new RescheduleService({
    planning: planningService,
    getProjects: () => configStore.getProjects(),
    getPerson: (id) =>
      peopleService.list({ includeArchived: true }).find((p) => p.id === id) ?? null,
    getMe: () => peopleService.getMe(),
    getDaysOff: () => daysOffService.list()
  })
  briefingService = new BriefingService({
    db: planningService.database,
    getProjects: () => configStore.getProjects(),
    agentsOn: () => configStore.get().harness.enabled,
    agentAttention
  })
  gettingStartedService = new GettingStartedService({
    db: planningService.database,
    getProjectIds: () =>
      configStore
        .getProjects()
        .filter((project) => project.enabled)
        .map((project) => project.id),
    aiConfigured: () => {
      const ai = configStore.get().ai
      return isAiConfigured({ ...ai, hasApiKey: ai.apiKey !== '' })
    },
    getProgress: () => configStore.get().ui.gettingStarted,
    saveProgress: (gettingStarted) => configStore.update({ ui: { gettingStarted } })
  })
  inboxService = new InboxService(planningService.database)
  const agentInbox = agentSources(
    () => configStore.getProjects(),
    () => configStore.get().harness.enabled,
    agentAttention
  )
  inboxService.registerSource(
    'reminders',
    reminderSource(planningService.database, () => configStore.getProjects())
  )
  inboxService.registerSource(
    'mentions',
    mentionSource(planningService.database, () => configStore.getProjects())
  )
  inboxService.registerSource(
    'signOffs',
    signOffSource(planningService.database, () => configStore.getProjects())
  )
  inboxService.registerSource('questions', agentInbox.questions)
  inboxService.registerSource('reviews', agentInbox.reviews)
  inboxService.registerSource('plans', agentInbox.plans)
  inboxService.registerSource(
    'blockers',
    blockerSource(planningService.database, () => configStore.getProjects())
  )
  inboxService.registerSource(
    'imports',
    importSource(planningService.database, () => configStore.getProjects())
  )
  // A rule's "Notify me" (R6.2): an Inbox item, and a desktop notification once written.
  inboxService.registerSource(
    'rules',
    ruleNoticeSource(planningService.database, () => configStore.getProjects())
  )
  // Weekly review (N1.5, N13): the review's lists, and its reminder.
  weeklyReviewService = new WeeklyReviewService({
    db: planningService.database,
    getProjects: () => configStore.getProjects(),
    getMeId: () => planningService.humanActor().personId ?? null,
    inboxCount: () => inboxService.list().items.length,
    atRisk: (project) => reportService?.getReport(project, undefined).atRisk ?? null
  })
  inboxService.registerSource(
    'weeklyReview',
    weeklyReviewSource(planningService.database, () => configStore.get().notifications)
  )
  weeklyReviewReminder = new WeeklyReviewReminder({
    db: planningService.database,
    getSettings: () => configStore.get().notifications,
    inQuietHours: (now) => inQuietHours(new Date(now), configStore.get().notifications),
    notify: (title, body) =>
      notificationService?.notify('weekly_review', title, body, null, { kind: 'weekly-review' }),
    onDelivered: () => notifyHomeChanged()
  })
  planningService.rules.setNoticeListener((notice) => {
    const project = configStore.getProjects().find((entry) => entry.id === notice.projectId)
    notificationService?.notify(
      'rule',
      notice.taskTitle,
      ruleNoticeText(notice.message, notice.ruleName, project?.name ?? ''),
      notice.projectId,
      notice.taskLive
        ? { kind: 'task', projectId: notice.projectId, taskId: notice.workItemId }
        : undefined
    )
    notifyHomeChanged()
  })
  inboxService.registerSource(
    'rounds',
    roundSource(planningService.database, () => configStore.getProjects())
  )
  // Scheduled agent tasks (N9.7): each occurrence its schedule queued, or could not.
  inboxService.registerSource(
    'scheduled',
    scheduledQueueSource(planningService.database, () => configStore.getProjects())
  )
  inboxService.registerSource(
    'commits',
    commitFixSource(planningService.commitLinks, () => configStore.getProjects())
  )
  // To triage (N4.3a): how many quick captures wait, per project.
  inboxService.registerSource(
    'triage',
    triageSource(planningService.database, () => configStore.getProjects())
  )
  inboxService.registerSource(
    'statusUpdates',
    statusUpdateReminderSource(planningService.statusUpdates, () => configStore.getProjects())
  )
  inboxService.registerSource(
    'agentLimits',
    agentLimitSource(
      () => configStore.getProjects(),
      () => configStore.get().harness.enabled,
      (project) => {
        try {
          return harnessService.getAgentUsage(project)
        } catch {
          return null
        }
      }
    )
  )
  updateService = new UpdateService({
    offReason: updatesOffReason(
      process.env,
      app.isPackaged,
      app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'))
    ),
    loadUpdater: () => autoUpdater as unknown as Updater,
    settings: () => configStore.get().updates,
    agentsRunning: countWorkingAgents,
    beforeInstall: () => beforeUpdateInstall(),
    onChange: (state) => {
      sendToRenderer(IPC_CHANNELS.ON_UPDATE_STATE, state)
      notifyHomeChanged()
    },
    log: (message, error) => appLog.error(message, error)
  })
  inboxService.registerSource('updates', () => {
    const item = updateService.inboxItem()
    return item ? [item] : []
  })
  reminderService = new ReminderService({
    reminders: planningService.reminders,
    getProjects: () => configStore.getProjects(),
    getTask: reminderTaskReader(planningService),
    replanDueReminders: () => planningService.replanDueReminders(),
    runDueRules: () => {
      const projectIds = configStore
        .getProjects()
        .filter((project) => project.enabled)
        .map((project) => project.id)
      if (planningService.rules.runDueDates(projectIds) > 0) notifyHomeChanged()
    },
    // Repeating rounds (N5.7a): a round whose start date has come is made.
    startDueRounds: () => {
      const projectIds = configStore
        .getProjects()
        .filter((project) => project.enabled)
        .map((project) => project.id)
      if (planningService.rounds.startDueRounds(projectIds).length > 0) notifyHomeChanged()
    },
    // Scheduled agent tasks (N9.7): an occurrence whose day has come goes to agents.
    queueScheduledTasks: () => {
      const results = queueDueScheduledTasks(scheduledQueueDeps())
      if (results.length === 0) return
      for (const projectId of new Set(results.map((result) => result.projectId))) {
        const project = configStore.getProjects().find((candidate) => candidate.id === projectId)
        if (project) notifyHarnessState(project)
      }
      notifyHomeChanged()
    },
    notify: (type, title, body, projectId, target) =>
      notificationService?.notify(type, title, body, projectId, target),
    onDelivered: () => notifyHomeChanged(),
    getQuietHours: () => configStore.get().notifications
  })
  peopleService = new PeopleService(databasePath, (projectId) =>
    configStore.getProjects().some((project) => project.id === projectId)
  )
  // Undo history: every change made in a window, kept history.keepChangesDays.
  changeHistory = new ChangeHistoryService(databasePath, {
    getProjectIds: () => configStore.getProjects().map((project) => project.id),
    keepDays: () => configStore.get().history.keepChangesDays ?? 30,
    afterUndo: afterChangeUndone,
    changed: notifyChangeHistory
  })
  teamService = new TeamService(databasePath)
  followService = new FollowService(databasePath)
  signOffService = new SignOffService(databasePath, {
    projectIds: () => configStore.getProjects().map((project) => project.id),
    // Sent back: out of Done and out of Complete, through the same write paths as an edit.
    reopenTask: (taskId) =>
      planningService.updateWorkItem(taskId, { status: 'active' }, planningService.humanActor()),
    reopenMilestone: (milestoneId) =>
      planningService.updateMilestone(milestoneId, { status: 'active' })
  })
  daysOffService = new DaysOffService(databasePath, {
    // Days off travel to your other PCs; a project's own people do not (migration 78).
    personExists: (id) => peopleService.inAddressBook(id)
  })
  // Shared away days (D6): matched to my days off now, after any change, after a pull, and every 10 minutes.
  awaySharingService = new AwaySharingService(databasePath, {
    projectIds: () => configStore.getProjects().map((project) => project.id)
  })
  reconcileAwaySharing()
  awaySharingTimer = setInterval(reconcileAwaySharing, AWAY_SHARING_INTERVAL_MS)
  // A countdown's words (N5.2b): the local date and my own working days, read when worded.
  planningService.pins.setCountdownContext(() => ({
    today: todayIsoDate(),
    ...ownWorkingDays()
  }))
  // Connected accounts (docs/plans/integrations/overview.md, phase 0): tokens
  // sealed with Windows' protection, every call host-pinned through net.fetch.
  accountsService = new ConnectedAccountsService(databasePath, {
    fetch: (url, init) => net.fetch(url, init),
    userAgent: BRAND.fullName,
    openBrowser: openExternalUrl,
    seal: encryptApiKey,
    open: decryptApiKey,
    policyApps: () => orgPolicy.apps,
    forbiddenProviders: () => orgPolicy.forbiddenProviders,
    onChanged: () => sendToRenderer(IPC_CHANNELS.ON_ACCOUNTS_CHANGE, null)
  })
  // Telling the team (integrations phase 4): a project's news to its channels,
  // each address sealed, every post one https request with no redirects.
  webhookService = new WebhookService(databasePath, {
    fetch: (url, init) => net.fetch(url, init),
    seal: encryptApiKey,
    open: decryptApiKey,
    projectName: (projectId) =>
      configStore.getProjects().find((project) => project.id === projectId)?.name ?? null
  })
  planningService.onTeamEvent((event) => void webhookService?.send(event))
  // Writing back (integrations phase 6): time blocks copied into one account calendar.
  if (accountsService) {
    const accounts = accountsService
    blockMirror = new TimeBlockMirror(databasePath, {
      accounts,
      blocks: (from, to) => timeBlockService.list({ from, to }),
      today: () => todayIsoDate(),
      projectName: (projectId) =>
        configStore.getProjects().find((project) => project.id === projectId)?.name ?? null,
      changed: notifyCalendarsChanged
    })
    // A minute after start, as calendar links are fetched.
    blockMirror.schedule(60_000)
    // My open tasks in To Do or Google Tasks; ticked off there, done here (as Me).
    taskMirror = new TaskListMirror(databasePath, {
      accounts,
      projects: () =>
        configStore
          .getProjects()
          .filter((project) => project.enabled)
          .map((project) => ({ id: project.id, name: project.name })),
      meId: () => peopleService.getMe()?.id ?? null,
      markDone: (workItemId) => {
        planningService.updateWorkItem(workItemId, { status: 'done' }, planningService.humanActor())
      },
      changed: () => sendToRenderer(IPC_CHANNELS.ON_ACCOUNTS_CHANGE, null)
    })
    taskMirror.start()
  }
  outsideCalendarService = new OutsideCalendarService(databasePath, {
    readFile: readCalendarFile,
    // A calendar link is a secret (N3.3b): encrypted, never kept in plain text.
    sealLink: encryptApiKey,
    openLink: decryptApiKey,
    fetchLink: (link, conditions) =>
      fetchCalendarLink(link, conditions, { userAgent: BRAND.fullName }),
    // Showing a hidden link fetches it at once; the Calendar reads again when it is in.
    onShownFetched: notifyCalendarsChanged,
    // Calendars from connected accounts (integrations phase 1), read through the account.
    accountCalendarText: async (accountId, remoteId, from, to) => {
      if (!accountsService) throw new CalendarLinkError('signInAgain')
      try {
        return await accountCalendarIcs(accountsService, accountId, remoteId, from, to)
      } catch (error) {
        if (!(error instanceof AccountCallError)) throw new CalendarLinkError('unreachable')
        throw new CalendarLinkError(
          error.reason === 'expired'
            ? 'signInAgain'
            : error.reason === 'cannotEncrypt'
              ? 'server'
              : error.reason
        )
      }
    },
    accountLabel: (accountId) => {
      const account = accountsService?.list().find((entry) => entry.id === accountId)
      return account
        ? `${t(`settings:accounts.provider.${account.provider}`)} · ${account.label}`
        : null
    }
  })
  calendarLinkSchedule = new CalendarLinkSchedule({
    hasLinks: () => outsideCalendarService.hasLinks(),
    refreshLinks: () => outsideCalendarService.refreshLinks(),
    onRefreshed: notifyCalendarsChanged
  })
  // Someone is always Me, so "Assign to me" works from the first run (P8.1
  // asks for a name instead).
  try {
    peopleService.ensureMe(osUserName())
  } catch (error) {
    console.error('Could not create the Me person:', error)
  }
  projectAiSettingsService = new ProjectAiSettingsService({
    getProject,
    updateProject: (projectId, updates) => configStore.updateProject(projectId, updates),
    // Read-only, and only a registered project's own folder (rules 1 and 4).
    isGitRepo: (project) => gitReader.isRepository(projectFolder(project))
  })
  aiPlanningService = new AIPlanningService(
    dataDir,
    () => configStore.get(),
    () => libraryService ?? null,
    // Only a registered watched project's folder is ever read (rule 4), read-only (rule 1).
    (projectId) =>
      projectFolderRef(configStore.getProjects().find((entry) => entry.id === projectId)),
    (projectId) => projectAiSettingsService.profile(projectId)
  )
  // After PlanningService: the library's link tables reference planning_work_items.
  libraryService = new LibraryService(databasePath, dataDir)
  // Shared-folder sync (docs/plans/integrations/shared-folder-sync.md): after the
  // Library, whose files it carries.
  // The sync server (integrations phase 7): shares kept in a space on it.
  const accountsForServer = accountsService
  const serverSettings = new SyncServerSettings(databasePath, {
    seal: encryptApiKey,
    open: decryptApiKey,
    policy: () => orgPolicy.syncServer,
    accessTokenFor: (accountId, scope) => {
      if (!accountsForServer) return Promise.reject(new Error('No connected accounts'))
      return accountsForServer.accessTokenFor(accountId, scope)
    },
    isMicrosoftAccount: (accountId) =>
      accountsForServer
        ?.list()
        .some((account) => account.id === accountId && account.provider === 'microsoft') ?? false,
    fetch: (url, init) => net.fetch(url, init)
  })
  syncServerSettings = serverSettings
  // Google Drive (mobile plan, phase 3): shares kept in a Drive folder, through one Google account.
  const driveSync = new DriveSyncSettings({
    accountsWithDrive: () => accountsForServer?.accountsWith('sync.drive') ?? [],
    call: (accountId, url, call) => {
      if (!accountsForServer) return Promise.reject(new Error('No connected accounts'))
      return accountsForServer.call(accountId, url, call)
    }
  })
  driveSyncSettings = driveSync
  // A sign-off asked of Me, or answered for Me, by another PC (prompt 17): a notice that opens the item.
  const notifySignOff = (
    type: 'sign_off_requested' | 'sign_off_answered',
    event: SignOffArrived
  ): void => {
    let title: string
    try {
      title =
        event.itemKind === 'task'
          ? planningService.getWorkItem(event.itemId).title
          : event.itemKind === 'decision'
            ? planningService.getDecision(event.itemId).title
            : (planningService.listMilestones(event.projectId).find((m) => m.id === event.itemId)
                ?.name ?? '')
    } catch {
      return // Deleted again before the notice: nothing to say.
    }
    if (!title) return
    const sender = event.byPersonId
      ? peopleService
          .list({ includeArchived: true })
          .find((person) => person.id === event.byPersonId)
      : undefined
    const name = sender?.name ?? t('desktop:services.someone')
    const text =
      type === 'sign_off_requested'
        ? sender
          ? t('desktop:services.signOffRequestedByPerson', { name })
          : t('desktop:services.signOffRequested')
        : t(
            event.state === 'approved'
              ? 'desktop:services.signOffApproved'
              : 'desktop:services.signOffSentBack',
            { name }
          )
    notificationService?.notify(
      type,
      text,
      title,
      event.projectId,
      event.itemKind === 'task'
        ? { kind: 'task', projectId: event.projectId, taskId: event.itemId }
        : { kind: event.itemKind, projectId: event.projectId, id: event.itemId }
    )
  }
  syncService = new SyncService({
    openServer: (location) => serverSettings.open(location),
    openDrive: (place) => driveSync.open(place),
    openR2: (place) => {
      if (!r2Bridge) throw new SharingError('no-r2-bucket')
      return r2Bridge.openPlace(place)
    },
    onPushed: (folder) => {
      if (isDriveLocation(folder)) driveSync.kick()
    },
    // The space lives in the bucket now: the folder copying stops (this PC's or a followed move).
    onSpaceMoved: () => r2Bridge?.stopCopying(),
    databasePath,
    library: libraryService,
    projectSettings: (projectId) => {
      const project = configStore.getProjects().find((entry) => entry.id === projectId)
      return project ? sharedProjectSettings(project) : null
    },
    applyProjectSettings: (projectId, settings) => {
      if (!configStore.getProjects().some((entry) => entry.id === projectId)) return
      const shared = receivedProjectUpdate(settings)
      try {
        configStore.updateProject(
          projectId,
          { ...shared, ...(settings.taskPrefix ? { taskPrefix: settings.taskPrefix } : {}) },
          { received: true }
        )
      } catch (error) {
        // A task prefix another project here already uses: the rest still applies.
        console.error('A shared project setting could not be applied:', error)
        configStore.updateProject(projectId, shared, { received: true })
      }
    },
    onProjectChanged: (projectId) => {
      reconcileAwaySharing()
      notifyTeamsChanged()
      for (const field of ['planning', 'library'] as const) {
        signalChanged(field, projectId)
      }
      notifyHomeChanged()
    },
    // A blocker resolved or a status changed on another device wakes dispatch, as the same
    // change made here does (planning-workflow-handlers resolveBlocker).
    // A blocker reported or resolved on another device is announced as one made here is.
    onBlockerArrived: (blocker) => publishBlockerChange(blocker.projectId, blocker),
    onDispatchInputsChanged: (projectId) => {
      const project = configStore.getProjects().find((entry) => entry.id === projectId)
      if (project) notifyHarnessState(project)
    },
    // The settings that follow the person: applied through the config store, which saves them.
    settings: configStore,
    // A new device asked to join this person's personal space (D16): the code is checked on both.
    onPairingRequest: ({ deviceName, code }) =>
      notificationService?.notify(
        'device_pairing_request',
        t('desktop:services.devicePairingRequest', { name: deviceName }),
        t('desktop:services.devicePairingCode', { code }),
        null,
        { kind: 'devices' }
      ),
    // A development build lets the person's own test phones in without asking (OSTLER_ALLOW_DEVICES=0 turns it off).
    allowDevicesAutomatically: !app.isPackaged && process.env.OSTLER_ALLOW_DEVICES !== '0',
    // Every project of this PC: each one without a share is shared into the personal space (D17).
    projectIds: () => configStore.getProjects().map((project) => project.id),
    // A project joined from the personal space is listed here as the join by invite lists it.
    registerJoinedProject: (joined) =>
      registerJoinedProject(configStore, joined, t('errors:sharing.sharedProjectName')),
    // Another device removed the project: this PC keeps its copy and says so.
    onLeftShare: (projectId) => {
      const name = configStore.getProjects().find((project) => project.id === projectId)?.name ?? ''
      notificationService?.notify(
        'info',
        t('desktop:services.sharedProjectLeft'),
        t('desktop:services.sharedProjectLeftBody', { name }),
        projectId
      )
    },
    syncedRoots: () => syncedRoots(process.env, nodeFs),
    // Another PC assigned a task to this PC's Me (D11): a notice that opens the task.
    onAssigned: ({ projectId, taskId, byPersonId }) => {
      // Assigned to Me from another PC: Me follows it, unless they chose not to (prompt 15).
      followService.autoFollow(projectId, taskId)
      let title: string
      try {
        title = planningService.getWorkItem(taskId).title
      } catch {
        return // Deleted again before the notice: nothing to say.
      }
      const sender = byPersonId
        ? peopleService.list({ includeArchived: true }).find((person) => person.id === byPersonId)
        : undefined
      notificationService?.notify(
        'assigned_by_someone',
        sender
          ? t('desktop:services.assignedByPerson', { name: sender.name })
          : t('desktop:services.assignedToYou'),
        title,
        projectId,
        { kind: 'task', projectId, taskId }
      )
    },
    // Another PC wrote a comment that mentions this PC's Me (prompt 14): a notice that opens the task.
    onMentioned: ({ projectId, taskId, byPersonId }) => {
      let title: string
      try {
        title = planningService.getWorkItem(taskId).title
      } catch {
        return // Deleted again before the notice: nothing to say.
      }
      const sender = byPersonId
        ? peopleService.list({ includeArchived: true }).find((person) => person.id === byPersonId)
        : undefined
      notificationService?.notify(
        'mentioned',
        sender
          ? t('desktop:services.mentionedByPerson', { name: sender.name })
          : t('desktop:services.mentionedYou'),
        title,
        projectId,
        { kind: 'task', projectId, taskId }
      )
    },
    // A sign-off was asked of Me, or one Me asked for was answered, on another PC (prompt 17).
    onSignOffRequested: (event) => notifySignOff('sign_off_requested', event),
    onSignOffAnswered: (event) => notifySignOff('sign_off_answered', event),
    // Another person changed or commented on a task, in a pull (prompt 15): a notice if Me follows it.
    onTaskChanged: ({ projectId, taskId, byPersonId }) => {
      if (!followService.isFollowing(taskId)) return
      let title: string
      try {
        title = planningService.getWorkItem(taskId).title
      } catch {
        return // Deleted again before the notice: nothing to say.
      }
      const sender = byPersonId
        ? peopleService.list({ includeArchived: true }).find((person) => person.id === byPersonId)
        : undefined
      notificationService?.notify(
        'task_changed',
        sender
          ? t('desktop:services.taskChangedByPerson', { name: sender.name, title })
          : t('desktop:services.taskChanged', { title }),
        '',
        projectId,
        { kind: 'task', projectId, taskId }
      )
    },
    onMemberLeft: ({ projectId, name }) => {
      const projectName = configStore
        .getProjects()
        .find((project) => project.id === projectId)?.name
      notificationService?.notify(
        'info',
        t('desktop:services.memberLeft', { name }),
        t('desktop:services.memberLeftBody', { name, projectName: projectName ?? '' }),
        projectId
      )
    },
    onStateChanged: (projectId) => signalChanged('sharing', projectId),
    memberName: () => peopleService.getMe()?.name ?? '',
    me: () => {
      const me = peopleService.getMe()
      return me ? { personId: me.id, name: me.name, initials: me.initials, color: me.color } : null
    },
    logError: (message, error) => console.error(message, error)
  })
  // Advanced sync: the personal space folder copied to and from an R2 bucket, for the phone.
  const syncForR2 = syncService
  r2Bridge = new R2Bridge({
    dataDir,
    seal: encryptApiKey,
    open: decryptApiKey,
    fetch: (url, init) => net.fetch(url, init),
    spaceFolder: () => {
      const space = syncForR2.personalSpaceFolder()
      return space && !isDrivePlace(space) && !isR2Location(space) && !/^https?:/.test(space)
        ? space
        : null
    },
    shareFolders: () => syncForR2.shareFolders(),
    // A join request copied down into the folder raises no folder event, so look for one now.
    onDownloaded: () => syncForR2.checkPairingRequests(),
    log: (message, error) =>
      console.error(message, error instanceof Error ? error.message : (error ?? ''))
  })
  // After the bridge exists: `r2:` places open through it.
  syncService.start()
  r2Bridge.start()
  libraryTextPass = new LibraryTextPass({
    library: libraryService,
    isBusy: () => powerMonitor.getSystemIdleTime() < LIBRARY_TEXT_PASS_IDLE_SECONDS,
    onRead: (projectId) => signalChanged('library', projectId),
    logError: (message, error) => console.error(message, error)
  })
  taskSplitJobService = new TaskSplitJobService({
    aiPlanningService,
    emitProgress: (job) => {
      sendToRenderer(IPC_CHANNELS.ON_TASK_SPLIT_PROGRESS, job)
      desktopHooks?.progress('task-split', taskSplitProgress(job))
    },
    // The split runs for minutes with the wizard closed, so each finished phase
    // is worth surfacing outside the window it was started from.
    notify: (title, body, projectId) =>
      notificationService?.notify('info', title, body, projectId, {
        kind: 'project',
        projectId,
        view: 'milestones'
      })
  })
  fileWatcher = new FileWatcherService()
  gitReader = new GitReaderService()
  harnessService = new HarnessService(dataDir, database)
  // Try it (N9.4): the person's try command in a finished task's copy. Every
  // verdict, from the app or the automation API, stops it first.
  tryIt = new TryItService({
    getProject,
    findSession: (project, sessionId) => harnessService.findSession(project, sessionId),
    ensureSetup: (project, sessionId, signal) =>
      harnessService.ensureSessionSetup(project, sessionId, signal),
    markWarningSeen: (projectId) => {
      configStore.updateProject(projectId, { tryItWarningSeen: true })
    },
    notify: (run) => sendToRenderer(IPC_CHANNELS.ON_TRY_RUN_CHANGED, run)
  })
  harnessService.setBeforeVerdict((_project, sessionId, verdict) =>
    tryIt.beforeVerdict(sessionId, verdict)
  )
  // Every plan version and decision is kept with its task (N9.3b).
  taskPlans = new TaskPlansService(planningService.database)
  harnessService.setPlanListener((source, plan) => taskPlans.record(source, plan))
  // The run history's costs use the person's prices (R5.3, D43).
  harnessService.setModelPrices(() => normalizeModelPrices(configStore.get().harness.modelPrices))
  harnessService.setAgentEventStream(agentEvents)
  // Review agent work before me (N9.5b): the project, while its switch is on.
  harnessService.setReviewBeforeMe((projectId) => {
    const project = configStore.getProjects().find((item) => item.id === projectId)
    return project && projectReviewBeforeMe(project) ? project : null
  })
  // Settings › Data (retention) and › Advanced ("I manage version history myself").
  harnessService.setHistoryOptions(() => {
    const { retentionDays, saveMyEdits } = configStore.get().history
    return { retentionDays, saveMyEdits }
  })
  legacyMigration = new LegacyAgentMigration(dataDir, () => configStore.getProjects())
  harnessService.setLegacyMigrationProblem((projectId) =>
    legacyMigration.attentionNeeded(projectId)
  )
  reportService = new ReportService({
    planning: planningService,
    listPeople: () => peopleService.list({ includeArchived: true }),
    harnessState: (project) => harnessService.getState(project)
  })
  // The board calls a dependency done as soon as its agent finishes, while the
  // planning row only reaches 'done' when a human moves it. Teaching planning
  // the same rule stops the Queue button from offering work that the main
  // process then rejected for "incomplete" dependencies.
  planningService.setHarnessCompletionResolver((projectId, harnessTaskId, sessionId) => {
    try {
      return harnessService.isTaskWorkComplete(getProject(projectId), harnessTaskId, sessionId)
    } catch {
      return false
    }
  })
  planningService.setWorkItemChangedListener(syncPendingWorkItemTaskText)
  // A task's activity shows its agent runs; the harness says which runs were whose.
  planningService.setHarnessActivityResolver((projectId) => {
    const project = configStore.getProjects().find((entry) => entry.id === projectId)
    return project ? harnessService.activityLinks(project) : null
  })
  // A note's live lists (N4.4c) get their words line written again on every save.
  libraryService.setBodyRewriter((projectId, body) =>
    rewriteLiveListBody(planningService, projectId, body)
  )
  // The attachments are part of that text, so the same sync runs when they change.
  libraryService.setAttachmentsChangedListener((projectId, workItemId) => {
    const item = planningService.getWorkItem(workItemId)
    if (item.projectId === projectId) syncPendingWorkItemTaskText(item)
  })
  // The queue's own watcher: every claim path asks planning how many
  // dependencies a queued task is still waiting on, so work can be queued long
  // before it can run and is released the moment the work ahead of it lands --
  // the same rule for the embedded runner and for an external agent.
  // A workspace setup's progress shows on the session like any other harness change.
  harnessService.setWorkspaceSetupListener((project) => notifyHarnessState(project))
  harnessService.setPlanningDispatchResolver((projectId, planningWorkItemId, sessionId) =>
    planningService.unmetDependencyCount(projectId, planningWorkItemId, sessionId)
  )
  // A reported blocker is documented as making work ineligible for dispatch.
  // The auto-dispatcher honoured that; the HTTP claim route did not, so an
  // external agent could pick up work a human was still meant to unblock.
  harnessService.setPlanningBlockerResolver((projectId, planningWorkItemId) => {
    try {
      const item = planningService.getWorkItem(planningWorkItemId)
      if (item.projectId !== projectId) return false
      return planningService
        .listBlockersForWorkItem(planningWorkItemId)
        .some((blocker) => blocker.status === 'open')
    } catch {
      // Unknown planning work never holds the queue up.
      return false
    }
  })
  projectRemovalService = new ProjectRemovalService(
    databasePath,
    dataDir,
    planningService,
    harnessService,
    (sessionId) => openCodeRunnerService?.isRunning(sessionId) ?? false
  )
  backupService = new BackupService({
    dataDir,
    appVersion: app.getVersion(),
    getSettings: () => configStore.get().backups,
    // After the IPC reply has gone back. The new instance starts only once this
    // one has exited, so nothing still holds ostler.db when the restore runs.
    relaunch: () => {
      setTimeout(() => {
        app.relaunch()
        app.quit()
      }, 250)
    },
    saveCopyState: (state) => {
      configStore.update({ backups: state })
    },
    onCopyStateChange: () => notifyHomeChanged(),
    logError: (message, error) => console.error(message, error)
  })
  // Backups that could not be copied to the second place (N6.1).
  inboxService.registerSource('backupCopy', () => {
    const item = backupService.inboxItem()
    return item ? [item] : []
  })
  projectScaffoldService = new ProjectScaffoldService(configStore, () => app.getPath('documents'))
  projectPackageService = new ProjectPackageService({
    planning: planningService,
    registerProject: (request, fixed) => projectScaffoldService.createProject(request, fixed),
    getProject,
    projectNames: () => configStore.getProjects().map((project) => project.name),
    dataDir,
    appVersion: app.getVersion(),
    libraryFilePath: (projectId, itemId) => libraryService.originalFilePath(projectId, itemId),
    agentsOn: () => configStore.get().harness.enabled
  })
  // GitHub (R4.4, D40): read only, and only on the person's action. Electron's
  // net.fetch, so system proxy settings apply as they do to update checks.
  const githubClient = new GithubClient({
    fetch: (url, init) => net.fetch(url, init),
    token: () => configStore.get().github.token,
    userAgent: BRAND.fullName
  })
  githubLinkService = new GithubLinkService({
    planning: planningService,
    client: githubClient,
    getProject,
    changed: (project) => signalChanged('planning', project.id)
  })
  projectCareService = new ProjectCareService({
    dataDir,
    databasePath,
    writeProjectFile: (projectId, filePath) => {
      projectPackageService.exportProjectFile(projectId, filePath)
    },
    createFullBackup: () => backupService.createBackup('manual')
  })
  importService = new ImportService({
    github: githubClient,
    planning: planningService,
    packages: projectPackageService,
    getProjects: () => configStore.getProjects(),
    addLibraryFile: async (projectId, filePath) =>
      (await libraryService.importPaths(projectId, [filePath]))[0].item.id,
    updateLibraryItem: (projectId, itemId, updates) => {
      libraryService.updateItem(projectId, itemId, updates)
    },
    setWhiteboardPictures: (projectId, whiteboardId, pictures) => {
      libraryService.whiteboards.setPictures(projectId, whiteboardId, pictures)
    },
    locale: () => app.getLocale(),
    unpackDir: join(dataDir, 'temp', 'imports')
  })
  openCodeRunnerService = new OpenCodeRunnerService(
    harnessService,
    () => configStore.get(),
    dataDir,
    { taskAttachments: libraryService }
  )
  // A review whose task ended stops its built-in agent (N9.5a).
  harnessService.setRunStopper(async (sessionId) => {
    if (openCodeRunnerService?.isRunning(sessionId)) {
      await openCodeRunnerService.stop(sessionId, 'Stopped: the reviewed task ended.')
    }
  })
  runGuidance = new RunGuidanceService(
    harnessService,
    openCodeRunnerService,
    () => peopleService?.getMe()?.name ?? null
  )
  dispatcherService = new DispatcherService(
    harnessService,
    openCodeRunnerService,
    planningService,
    configStore,
    (project) => notifyHarnessState(project),
    (project, workItemId) => {
      // Same path as the board's Queue button, including its unmet-dependency
      // allowance: the queue is where work waits, not the board.
      queueWorkItemForHarness(project, workItemId, { allowUnmetDependencies: true })
    }
  )
  const { TaskReviewService } = await import('../services/task-review-service')
  taskReviewService = new TaskReviewService(
    dataDir,
    database,
    planningService,
    harnessService,
    () => configStore.get(),
    (projectId) => {
      signalChanged('taskReview', projectId)
    }
  )
  harnessHttpServer = new HarnessHttpServer(
    () => configStore.getProjects(),
    harnessService,
    (project) => notifyHarnessState(project),
    dataDir,
    planningService,
    libraryService,
    agentEvents
  )
  automationHttpServer = new AutomationHttpServer(
    () => configStore.getProjects(),
    dataDir,
    undefined,
    planningService,
    harnessService,
    (project) => notifyHarnessState(project),
    async (project): Promise<PlanningReadinessReport[]> => {
      const harness = harnessService.getState(project)
      const git = await gitReader.getState(
        project.id,
        projectFolder(project),
        configStore.get().git.maxCommitsToFetch
      )
      // Every task's metrics from one history query, not one per task (P9.1).
      const allItems = planningService.listWorkItems(project.id)
      const allMetrics = planningService.getProjectWorkItemMetrics(project.id)
      return planningService.listMilestones(project.id).map((milestone) => {
        const items = allItems.filter((item) => item.milestoneId === milestone.id)
        const metrics = new Map(items.map((item) => [item.id, allMetrics[item.id]]))
        return buildReadinessReport(milestone.id, {
          items,
          metrics,
          reviewCount: harness.reviewSessions.length,
          pendingQuestionCount: harness.questions.filter(
            (question) => question.status === 'pending'
          ).length,
          gitDirty:
            git.workingTreeStatus.modified +
              git.workingTreeStatus.untracked +
              git.workingTreeStatus.staged >
            0,
          gitConflicted: git.workingTreeStatus.conflicted
        })
      })
    },
    async (project, taskId) => {
      const session = await harnessService.startEmbeddedSessionForTask(project, taskId)
      harnessService.touchSessionConnection(project, session.id)
      notifyHarnessState(project)
      const task = harnessService
        .getState(project)
        .taskQueue.find((item) => item.claimedBy === session.id)
      if (!task) throw new Error('Reserved task could not be located after session start')
      syncAgentWorkItemStatus(project.id, task.id, 'active')
      void openCodeRunnerService.start(project, session, task).catch((error) => {
        console.error(`Embedded session ${session.id} failed (${embeddedRunPhase(error)}):`, error)
        try {
          harnessService.failSession(project, session.id, embeddedFailureNote(error))
          syncAgentWorkItemStatus(project.id, task.id, 'ready')
        } finally {
          notifyHarnessState(project)
        }
      })
      return session
    },
    async (project, sessionId) => {
      const live = await openCodeRunnerService?.getLiveTranscript(sessionId)
      if (live && live.length > 0) return live
      return harnessService.getSessionTranscript(project, sessionId)
    },
    async (project, questionId, answer) => {
      const question = harnessService.answerQuestion(project, questionId, answer)
      openCodeRunnerService.onQuestionAnswered(question)
      notifyHarnessState(project)
      return question
    },
    async (project, sessionId, note) => {
      if (!openCodeRunnerService.isRunning(sessionId)) {
        throw new Error(`Session ${sessionId} is not a running embedded session`)
      }
      await openCodeRunnerService.stop(
        sessionId,
        note ?? 'Stopped through the automation control API.'
      )
      notifyHarnessState(project)
    },
    {
      get: (projectId) => configStore.getProjectAutoDispatchConfig(projectId),
      update: (projectId, updates) =>
        configStore.updateProjectAutoDispatchConfig(projectId, updates)
    },
    {
      service: libraryService,
      notify: (project) => signalChanged('library', project.id)
    },
    (project) => signalChanged('planning', project.id),
    {
      service: peopleService,
      notify: notifyPeopleChanged,
      notifyPlanning: (projectId) => signalChanged('planning', projectId)
    },
    {
      service: projectPackageService,
      projectCreated: (project) => projectRuntimeController.start(project)
    },
    {
      service: importService,
      changed: (project) => {
        signalChanged('planning', project.id)
        notifyPeopleChanged()
      }
    },
    reportService,
    projectAiSettingsService,
    {
      update: (projectId, text) => {
        const project = configStore.updateProject(projectId, { agentConventions: text })
        return project.agentConventions ?? ''
      },
      addLesson: (projectId, text) => configStore.addProjectLesson(projectId, { text }),
      updateLesson: (projectId, lessonId, changes) =>
        configStore.updateProjectLesson(projectId, lessonId, changes),
      removeLesson: (projectId, lessonId) => configStore.removeProjectLesson(projectId, lessonId)
    },
    {
      // Validated by `configStore.updateProject`, the one place every writer goes through.
      update: (projectId, value) => {
        const project = configStore.updateProject(projectId, {
          agentSetup: value as AgentSetupSetting
        })
        return project.agentSetup ?? { mode: 'auto' }
      }
    },
    {
      events: agentEvents,
      sendGuidance: (project, sessionId, text) =>
        runGuidance.send(project, sessionId, text, 'automation')
    }
  )
  automationHttpServer.mcpVersion = app.getVersion()
  automationHttpServer.agentsOn = () => configStore.get().harness.enabled
  automationHttpServer.getConfig = () => configStore.get()
  automationHttpServer.appearance = {
    areas: () => configStore.getAreas(),
    // Validated by `configStore.updateProject`, as Project settings is.
    update: (projectId, updates) => {
      const project = configStore.updateProject(projectId, updates as Partial<WatchedProject>)
      return { areaId: project.areaId ?? null, icon: project.icon ?? null }
    }
  }
  automationHttpServer.triageSetting = {
    // The same save as Project settings (N4.3a).
    update: (projectId, enabled) =>
      configStore.updateProject(projectId, { triageCaptures: enabled }).triageCaptures === true
  }
  automationHttpServer.projectStage = {
    // The same save as the board and Project settings (N5.3).
    update: (projectId, stage) => configStore.updateProject(projectId, { stage }).stage ?? stage
  }
  automationHttpServer.taskPrefix = {
    // The same save as Project settings (N9.8a): `configStore.updateProject` checks it.
    update: (projectId, taskPrefix) =>
      configStore.updateProject(projectId, { taskPrefix }).taskPrefix ?? taskPrefix
  }
  automationHttpServer.updateReminder = {
    // The same save as Project settings (N5.5): main works out `since`.
    update: (projectId, reminder) =>
      normalizeUpdateReminder(
        configStore.updateProject(projectId, { updateReminder: reminder as UpdateReminder })
          .updateReminder
      )
  }
  automationHttpServer.daysOff = { service: daysOffService, notify: notifyDaysOffChanged }
  automationHttpServer.contactsChanged = notifyContactsChanged
  automationHttpServer.calendars = {
    service: outsideCalendarService,
    notify: notifyCalendarsChanged
  }
  automationHttpServer.getBriefing = (project, since, until) =>
    briefingService.build({ since, until, projectIds: [project.id] }).projects[0] ?? null
  automationHttpServer.progress = progressService
  automationHttpServer.github = githubLinkService
  automationHttpServer.focus = focusService
  automationHttpServer.taskPlans = taskPlans

  projectRuntimeController = new ProjectRuntimeController({
    getConfig: () => configStore.get(),
    fileWatcher,
    gitReader,
    harnessService,
    startHarnessMonitoring,
    clearTrackedHarnessSessions: (projectId) => trackedHarnessSessions.delete(projectId),
    handleNewGitCommits,
    // The first sync reads up to 500 commits per project: after the first screen.
    syncProjectGitHistory: (project) =>
      deferredStartup.run(`git history ${project.id}`, () => syncProjectGitHistory(project)),
    logError: (message, error) => console.error(message, error)
  })

  return {
    configStore,
    libraryService,
    getProject,
    readReportPicture: (project, sessionId, name) =>
      harnessService.readReportPicture(project, sessionId, name),
    registerHandlers,
    attachWindow: (window) => {
      mainWindow = window
      registerOstlerWindow(window)
      if (!notificationService) {
        notificationService = new NotificationService(() => configStore.get(), window)
        notificationService.setFocusHold(() => focusService.holdsNotifications())
        if (pendingNotificationShell) notificationService.setShell(pendingNotificationShell)
      }
    },
    start: startServices,
    stop: stopServices,
    setDesktopHooks: (hooks) => {
      desktopHooks = hooks
    },
    setNotificationShell: (shell) => {
      pendingNotificationShell = shell
      notificationService?.setShell(shell)
    },
    unreadInboxCount: () => inboxService.unreadCount(),
    setBeforeUpdateInstall: (hook) => {
      beforeUpdateInstall = hook
    },
    stopAllAi,
    pauseReminders: (until) => reminderService.pauseUntil(until),
    remindersPausedUntil: () => reminderService.pausedUntil(),
    runningTimerTitle: () => planningService.time.timerState().running?.workItemTitle ?? null,
    stopTimer: () => {
      planningService.time.stopTimer()
    },
    focus: () => focusService.get(),
    stopFocus: () => {
      focusService.stop()
    },
    countdowns: (today) =>
      countdownEntries(planningService.pins.countdowns(), today, ownWorkingDays()),
    seedScale: async (projectsParent) => {
      const { seedScaleDataset } = await import('./dev-seed/seed-scale')
      await seedScaleDataset({
        planning: planningService,
        people: peopleService,
        library: libraryService,
        packages: projectPackageService,
        timeBlocks: timeBlockService,
        calendars: outsideCalendarService,
        projectsParent,
        log: (message) => console.log(`seed:scale: ${message}`)
      })
    }
  }
}
