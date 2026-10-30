import type { AIEffortSetting, AIProvider, AIVisionSetting } from './ai-types'
import { DEFAULT_OSTLER_AI_SYSTEM_PROMPT } from '../ostler-ai-prompts'
import type { RendererProject, WatchedProject } from './project-types'
import type { AgentModelPrice } from './harness-types'
import { DEFAULT_BACKUP_SETTINGS, type BackupSettings } from './backup-types'
import type { AccentSetting, DensitySetting, ThemeSetting } from './appearance-types'
import type { LanguageSetting } from './locale-types'
import type { DueReminderMode, InAppNotificationDuration } from './home-types'
import type { ProjectArea } from '../project-areas'
import type { ProjectStageNames } from '../project-stages'
import { DEFAULT_TIPS_SETTINGS, type TipsSettings } from '../tips'
import { DEFAULT_DESKTOP_SETTINGS, type DesktopSettings } from './desktop-types'
import { DEFAULT_UPDATE_SETTINGS, type UpdateSettings } from './update-types'
import { DEFAULT_FOCUS_SETTINGS, type FocusSettings } from './focus-types'
import { DEFAULT_POP_OUT_SETTINGS, type PopOutSettings } from '../pop-out'
import { DEFAULT_STICKY_TASK_SETTINGS, type StickyTaskSettings } from '../sticky-task'

// ─── Config Types ───────────────────────────────────────────────────────────

/**
 * The getting-started steps that are things the person did rather than state
 * Ostler can read back (P8.1), and whether the checklist was dismissed.
 */
export interface GettingStartedProgress {
  dismissed: boolean
  /** Opened List, Calendar or Timeline. */
  triedView: boolean
  /** Opened the command palette. */
  usedSearch: boolean
  /** Opened Settings › Data, where the backups are. */
  sawBackups: boolean
}

export const START_PAGE_SETTINGS = ['home', 'lastProject'] as const
export type StartPageSetting = (typeof START_PAGE_SETTINGS)[number]

/** Working hours (N3.4a): two local times, `HH:mm`, the end after the start. */
export interface WorkingHours {
  start: string
  end: string
}

export interface OstlerConfig {
  /** Which config migrations (`CONFIG_MIGRATIONS` in config-store.ts) this file has had. */
  configVersion: number
  projects: WatchedProject[]
  /**
   * Areas (N5.1, N36) in their order. Change them with `saveAreas`, never
   * `updateConfig`. Config migration 23 writes [].
   */
  areas: ProjectArea[]
  ai: {
    provider: AIProvider
    apiKey: string
    baseUrl: string
    model: string
    maxTokens: number
    temperature: number
    /**
     * How hard the model reasons. '' sends nothing, so the provider's own
     * default applies; a level is offered only when the provider said the
     * model takes it (`AIModelEffortSupport`).
     */
    effort: AIEffortSetting
    systemPrompt: string
    /**
     * Whether to send images. 'auto' and 'on' send them and fall back to text
     * descriptions if the provider refuses; 'off' always sends descriptions.
     */
    vision: AIVisionSetting
    /**
     * The context the model has, in tokens (Settings › Advanced › "AI context
     * size"). Ostler sends up to about 60% of it as project files
     * (`project-files.ts`). Config migration 20 writes 100,000.
     */
    contextTokens: number
    /** Scheduled, read-only improvement reviews sourced only from Ostler user data. */
    improvementReviewEnabled: boolean
    improvementReviewIntervalMs: number
  }
  watcher: {
    pollingIntervalMs: number
    ignorePatterns: string[]
    maxFileSize: number
    debounceMs: number
  }
  ui: {
    theme: ThemeSetting
    /** Text and control sizes (D8). */
    density: DensitySetting
    /** The Ostler blue, or Windows' accent colour adjusted for contrast. */
    accent: AccentSetting
    sidebarWidth: number
    refreshIntervalMs: number
    timelineMaxEvents: number
    /** Whether Enter alone sends AI chat messages, or Ctrl/Cmd+Enter is required. */
    sendMessageOn: 'enter' | 'ctrlEnter'
    /** Where the app opens: Home, or the project open when it last closed. */
    startPage: StartPageSetting
    /** The welcome (P8.1) has been finished or skipped; until then it fills the window. */
    firstRunCompleted: boolean
    /** The version whose What's new was last shown; '' before any. */
    lastSeenVersion: string
    /** Home's getting-started checklist (P8.1): what was done, and whether it was dismissed. */
    gettingStarted: GettingStartedProgress
    /**
     * Page zoom as a Chromium zoom level (P9.2): 0 is 100%. Ctrl+=, Ctrl+- and
     * Ctrl+0 change it; `src/shared/zoom.ts` holds the steps.
     */
    zoom: number
    /** The interface language (P11.1): 'system' ("Match Windows") or a bundled language tag. */
    language: LanguageSetting
    /**
     * Working hours (N3.4a, N28): the hours the Calendar's Week opens on, the
     * rest shaded. Config migration 26 writes 09:00 to 17:00.
     */
    workingHours: WorkingHours
    /**
     * The board of projects' column names (N5.3, N38), '' for the default in
     * the interface language. Display only. Config migration 28 writes ''.
     */
    projectStageNames: ProjectStageNames
    /**
     * Show my progress (N3.6, N30): Home's progress card and Your year. Off
     * until the person turns it on; config migration 36 writes false.
     */
    showProgress: boolean
    /**
     * Tips and the walkthrough (`src/shared/tips.ts`): on or off, and the ones
     * dismissed for good. Config migration 41 writes them on, none dismissed.
     */
    tips: TipsSettings
  }
  notifications: {
    enabled: boolean
    onBuildFailure: boolean
    onLargeChangeset: boolean
    onAgentSessionChange: boolean
    largeChangesetThreshold: number
    /** "Remind me about due tasks" (P5.6). */
    dueReminders: DueReminderMode
    /** When due reminders fire, local wall-clock time `HH:MM`. */
    reminderTime: string
    /** No desktop notifications between these times (`HH:MM`); Inbox items still arrive. */
    quietHoursEnabled: boolean
    quietHoursStart: string
    quietHoursEnd: string
    /** Desktop notifications per Inbox source. */
    onReminder: boolean
    onAgentQuestion: boolean
    onReviewWaiting: boolean
    onBlocker: boolean
    /** Someone else on a shared project assigns you a task (people and devices, D11). */
    onAssignedToMe: boolean
    /** Someone else on a shared project mentions you in a comment (prompt 14). */
    onMentioned: boolean
    /** Someone else changes or comments on a task you follow (prompt 15). */
    onFollowedTaskChanged: boolean
    /** Someone asks you to sign something off, or answers a sign-off you asked for (prompt 17). */
    onSignOff: boolean
    /**
     * Weekly review reminder (N1.5, N13): the weekday (0 Sunday to 6 Saturday)
     * and local time `HH:MM` it says it is time, or null for off.
     */
    weeklyReviewDay: number | null
    weeklyReviewTime: string
    /**
     * Keep reminding (N1.7, N15): how many minutes a reminder that keeps
     * reminding waits before it comes back, unless the reminder says otherwise.
     * One of `KEEP_REMINDING_MINUTES`.
     */
    keepRemindingMinutes: number
    /** Focus (N3.5, N29): the lengths offered, the break and the chime. */
    focus: FocusSettings
    /**
     * How long an in-app notification (a toast inside Ostler's window, not a
     * Windows notification) stays on screen. Every one is kept in the
     * notification centre either way.
     */
    inAppDuration: InAppNotificationDuration
    /**
     * Undo notices ("Moved to the recycle bin" with Undo) pop up in the corner
     * (MOP-38). Off, they go straight to the notification centre, Undo and all.
     * Missing in older configs: read as on.
     */
    inAppUndo?: boolean
  }
  git: {
    enabled: boolean
    pollIntervalMs: number
    maxCommitsToFetch: number
  }
  harness: {
    enabled: boolean
    pollIntervalMs: number
    reportIntervalMs: number
    staleSessionThresholdMs: number
    reportRetentionDays: number
    /** Loopback-only port the agent-facing harness HTTP API listens on. */
    port: number
    /** Maximum tool calls allowed within any rolling 60-second window before stopping for human review. */
    maxToolCallsPerMinute: number
    /** The built-in agent's provider; '' uses Ostler AI's (P7.2). A project's own override wins. */
    agentProvider: string
    /** The built-in agent's model; '' is "Same as Ostler AI" (P7.2). */
    agentModel: string
    /**
     * The built-in agent's effort when it has its own model ('' is the
     * provider's default). On "Same as Ostler AI" it uses `ai.effort`.
     */
    agentEffort: AIEffortSetting
    /** How many built-in agents may run at once in a project that has not chosen its own (1 to 4). */
    maxConcurrentAgents: number
    /** Whether queued tasks start by themselves in a project that has not chosen for itself. */
    autoRunQueued: boolean
    /**
     * Prices per million input and output tokens, per model, entered by the
     * person (R5.3, D43). Without a price the run history shows no cost.
     * Config migration 17 writes []; read it through `normalizeModelPrices`.
     */
    modelPrices: AgentModelPrice[]
  }
  automationApi: { enabled: boolean; port: number }
  /**
   * The project history agents and the person share (simplify pass §3).
   * Config migration 21 writes the defaults below.
   */
  history: {
    /** Days restore points and discarded agent work are kept (Settings › Data). */
    retentionDays: number
    /**
     * Save the person's own edits as a "Your edits" entry before Ostler changes
     * the folder. Off is Advanced › "I manage version history myself": Ostler
     * then refuses to touch a file with unsaved edits.
     */
    saveMyEdits: boolean
    /**
     * Days the undo history keeps each step (the Undo history view). Config
     * migration 45 writes 30.
     */
    keepChangesDays: number
  }
  /** Windows integration: title bar, background mode, sign-in and the Quick add key (P8.2). */
  desktop: DesktopSettings
  /** Settings › About › Updates (P10.1). */
  updates: UpdateSettings
  /** Automatic backups of the data folder (backup-service.ts). */
  backups: BackupSettings
  /**
   * GitHub (R4.4, D40). `token` is optional and read only; it is encrypted
   * with safeStorage on disk and never leaves the main process: the renderer
   * sees `hasToken`. Set with `setGithubToken`, never through `updateConfig`.
   */
  github: { token: string }
  /**
   * Email (MOP-4): the person's own SMTP server, for emailing invites.
   * `password` is encrypted with safeStorage on disk and never leaves the
   * main process: the renderer sees `hasPassword`. Set with
   * `setEmailSettings`, never through `updateConfig`.
   */
  email: EmailSettings
  /**
   * Pop-out windows (N5.8a, N43): each one's route, size and place, Reopen at
   * start, and whether it was open at quit. Window layout, changed only by
   * main's pop-out windows; config migration 37 writes it.
   */
  popOuts: PopOutSettings
  /**
   * Sticky tasks (N5.8b, N43): each pinned task's project and task, size and
   * place. Window layout, changed only by main's sticky windows; config
   * migration 38 writes it.
   */
  stickyTasks: StickyTaskSettings
}

/** Partial nested configuration update used by the settings UI. */
export type OstlerConfigUpdate = {
  projects?: OstlerConfig['projects']
  ai?: Partial<OstlerConfig['ai']>
  watcher?: Partial<OstlerConfig['watcher']>
  ui?: Partial<OstlerConfig['ui']>
  notifications?: Partial<OstlerConfig['notifications']>
  git?: Partial<OstlerConfig['git']>
  harness?: Partial<OstlerConfig['harness']>
  automationApi?: Partial<OstlerConfig['automationApi']>
  history?: Partial<OstlerConfig['history']>
  backups?: Partial<OstlerConfig['backups']>
  desktop?: Partial<OstlerConfig['desktop']>
  updates?: Partial<OstlerConfig['updates']>
  /** Main only (R4.4): the renderer sets the token through `setGithubToken`. */
  github?: Partial<OstlerConfig['github']>
  /** Main only (MOP-4): the renderer sets it through `setEmailSettings`. */
  email?: Partial<OstlerConfig['email']>
  /** Main only (N5.8a): the pop-out windows keep it. */
  popOuts?: Partial<OstlerConfig['popOuts']>
  /** Main only (N5.8b): the sticky windows keep it. */
  stickyTasks?: Partial<OstlerConfig['stickyTasks']>
}

/**
 * The config as the renderer sees it (`toRendererConfig`): no AI key and no
 * project tokens. `hasApiKey` and `apiKeyHint` (the key's last four
 * characters) are all a screen needs to say a key is saved.
 */
export interface RendererConfig extends Omit<OstlerConfig, 'projects' | 'ai' | 'github' | 'email'> {
  projects: RendererProject[]
  ai: Omit<OstlerConfig['ai'], 'apiKey'> & { hasApiKey: boolean; apiKeyHint: string }
  /** Whether a GitHub token is saved; never the token (R4.4). */
  github: { hasToken: boolean }
  /** The email server, and whether a password is saved; never the password (MOP-4). */
  email: Omit<EmailSettings, 'password'> & { hasPassword: boolean }
}

/**
 * What the renderer may send to `updateConfig`. Projects change through their
 * own calls, never here. A missing or empty `ai.apiKey` keeps the saved key;
 * `clearAiApiKey` removes it.
 */
export type RendererConfigUpdate = Omit<
  OstlerConfigUpdate,
  'projects' | 'github' | 'email' | 'areas'
>

/** How the connection to the email server is secured: TLS from the start, or STARTTLS. */
export type EmailSecurity = 'tls' | 'starttls'

/** The person's own SMTP server (MOP-4). Empty `host` means not set up. */
export interface EmailSettings {
  host: string
  port: number
  security: EmailSecurity
  /** Empty for a server that needs no sign-in. */
  username: string
  password: string
  fromAddress: string
  fromName: string
}

/** What Settings › Connections › Email sends: an empty `password` keeps the saved one. */
export type EmailSettingsInput = EmailSettings

// ─── Notification Types ─────────────────────────────────────────────────────

export type NotificationType =
  | 'build_failure'
  | 'large_changeset'
  | 'agent_session_start'
  | 'agent_session_end'
  | 'info'
  | 'reminder'
  | 'agent_question'
  | 'review_waiting'
  | 'blocker'
  /** A rule's "Notify me" (R6.2): asked for by the person who made the rule. */
  | 'rule'
  /** The weekly review reminder (N1.5): it has its own day and time, off by default. */
  | 'weekly_review'
  /** A focus finished (N3.5): shown whenever notifications are on. */
  | 'focus'
  /** Another person assigned you a task on a shared project (people and devices, D11). */
  | 'assigned_by_someone'
  /** Another person mentioned you in a comment on a shared project. */
  | 'mentioned'
  /** Another person changed or commented on a task you follow. */
  | 'task_changed'
  /** Another person asked you to sign a task, decision or milestone off (prompt 17). */
  | 'sign_off_requested'
  /** The person you asked answered your sign-off request (prompt 17). */
  | 'sign_off_answered'
  /** A new device asked to join this person's personal space; its code is in the body (D16). */
  | 'device_pairing_request'

export interface OstlerNotification {
  id: string
  type: NotificationType
  title: string
  body: string
  projectId: string | null
  timestamp: number
}

// ─── Default Configuration ──────────────────────────────────────────────────

export const DEFAULT_CONFIG: OstlerConfig = {
  // Stamped by the config migrations on load; never edit defaults here alone
  // when existing users must keep their behaviour.
  configVersion: 0,
  projects: [],
  areas: [],
  ai: {
    provider: 'openai',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    maxTokens: 4096,
    temperature: 0.7,
    effort: '',
    vision: 'auto',
    // Config migration 20 writes this into every config (simplify pass).
    contextTokens: 100_000,
    // Off by default: this is the only scheduler that sends anything to an
    // AI provider without the user asking for it, so it is opt-in.
    improvementReviewEnabled: false,
    improvementReviewIntervalMs: 15 * 60 * 1000,
    systemPrompt: DEFAULT_OSTLER_AI_SYSTEM_PROMPT
  },
  watcher: {
    pollingIntervalMs: 2000,
    ignorePatterns: [
      'node_modules/**',
      '.git/**',
      'out/**',
      'dist/**',
      'build/**',
      '.next/**',
      '*.lock',
      'package-lock.json',
      '.agent-harness/history/**',
      '__pycache__/**',
      '.venv/**',
      '*.log'
    ],
    maxFileSize: 10 * 1024 * 1024, // 10MB
    debounceMs: 500
  },
  ui: {
    // Config migration 3 writes all three into every config, so existing
    // installs keep 'dark' and new ones get these (D7, D8).
    theme: 'system',
    density: 'comfortable',
    accent: 'ostler',
    sidebarWidth: 240,
    refreshIntervalMs: 2000,
    timelineMaxEvents: 10000,
    sendMessageOn: 'ctrlEnter',
    startPage: 'home',
    // Config migration 10 writes these into every config (P8.1): a new
    // install starts with the welcome, an existing one with projects skips it.
    firstRunCompleted: false,
    lastSeenVersion: '',
    gettingStarted: { dismissed: false, triedView: false, usedSearch: false, sawBackups: false },
    // Config migration 12 writes this into every config (P9.2).
    zoom: 0,
    // Config migration 14 writes this into every config (P11.1).
    language: 'system',
    // Config migration 26 writes this into every config (N3.4a).
    workingHours: { start: '09:00', end: '17:00' },
    // Config migration 28 writes this into every config (N5.3).
    projectStageNames: { planning: '', active: '', 'on-hold': '', done: '' },
    // Config migration 36 writes this into every config (N3.6).
    showProgress: false,
    // Config migration 41 writes this into every config.
    tips: DEFAULT_TIPS_SETTINGS
  },
  notifications: {
    enabled: true,
    onBuildFailure: true,
    onLargeChangeset: true,
    onAgentSessionChange: true,
    largeChangesetThreshold: 20,
    // Config migration 7 writes these into every config (P5.6).
    dueReminders: 'dueDate',
    reminderTime: '09:00',
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    onReminder: true,
    onAgentQuestion: true,
    onReviewWaiting: true,
    onBlocker: true,
    // Config migration 46 writes this into every config (people and devices, D11): on.
    onAssignedToMe: true,
    // Config migration 50 writes this into every config: on.
    onMentioned: true,
    // Config migration 51 writes this into every config: on.
    onFollowedTaskChanged: true,
    // Config migration 52 writes this into every config: on.
    onSignOff: true,
    // Config migration 24 writes these into every config (N1.5): off.
    weeklyReviewDay: null,
    weeklyReviewTime: '16:00',
    // Config migration 25 writes this into every config (N1.7).
    keepRemindingMinutes: 15,
    // Config migration 35 writes this into every config (N3.5).
    focus: DEFAULT_FOCUS_SETTINGS,
    inAppDuration: 'normal',
    inAppUndo: true
  },
  git: {
    enabled: true,
    pollIntervalMs: 30000,
    maxCommitsToFetch: 50
  },
  harness: {
    // Config migration 4 writes both switches into every config, so existing
    // installs keep agents on and new ones start with them off (D10).
    enabled: false,
    pollIntervalMs: 10000,
    reportIntervalMs: 60000,
    staleSessionThresholdMs: 30 * 60 * 1000,
    reportRetentionDays: 30,
    port: 8934,
    maxToolCallsPerMinute: 50,
    agentProvider: '',
    agentModel: '',
    agentEffort: '',
    maxConcurrentAgents: 1,
    autoRunQueued: false,
    // Config migration 17 writes this into every config (R5.3).
    modelPrices: []
  },
  automationApi: { enabled: false, port: 8935 },
  // Config migration 21 writes these into every config (simplify pass §9).
  history: { retentionDays: 30, saveMyEdits: true, keepChangesDays: 30 },
  backups: { ...DEFAULT_BACKUP_SETTINGS },
  // Config migration 11 writes these into every config (P8.2).
  desktop: { ...DEFAULT_DESKTOP_SETTINGS },
  // Config migration 13 writes these into every config (P10.1).
  updates: { ...DEFAULT_UPDATE_SETTINGS },
  // Config migration 18 writes this into every config (R4.4).
  github: { token: '' },
  email: {
    host: '',
    port: 587,
    security: 'starttls',
    username: '',
    password: '',
    fromAddress: '',
    fromName: ''
  },
  // Config migration 37 writes this into every config (N5.8a).
  popOuts: { ...DEFAULT_POP_OUT_SETTINGS, windows: [] },
  // Config migration 38 writes this into every config (N5.8b).
  stickyTasks: { ...DEFAULT_STICKY_TASK_SETTINGS, windows: [] }
}
