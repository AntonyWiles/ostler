/**
 * The config migrations: each numbered change to the shape of `config.json`,
 * in order. `ConfigStore` runs the pending ones when it loads the file;
 * config-store.ts re-exports these so callers and tests import them from there.
 */
import { BRAND } from '@shared/brand'
import { LEGACY_NAMES } from '@shared/legacy-names'
import { normalizeAgentLimits, normalizeModelPrices } from '@shared/agent-run-history'
import { normalizePopOutSettings } from '@shared/pop-out'
import { normalizeStickyTaskSettings } from '@shared/sticky-task'
import {
  DEFAULT_CONFIG,
  DEFAULT_BACKUP_SETTINGS,
  isAIEffortLevel,
  isValidHotkey,
  DEFAULT_DESKTOP_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  THEME_SETTINGS,
  DENSITY_SETTINGS,
  ACCENT_SETTINGS,
  START_PAGE_SETTINGS,
  ESTIMATE_UNITS,
  type EstimateUnit,
  type StartPageSetting,
  type ThemeSetting,
  type DensitySetting,
  type AccentSetting
} from '@shared/ostler-api'
import {
  encryptApiKey,
  isEncryptedSecret,
  isEncryptionAvailable,
  openSecret
} from '../safe-storage'
import { AI_PROFILE_SETTINGS, type AiProfileSetting } from '@shared/ai-profile'
import { normalizeAreas } from '@shared/project-areas'
import { normalizeProjectStage, normalizeProjectStageNames } from '@shared/project-stages'
import { normalizeUpdateReminder } from '@shared/status-updates'
import { isClockTime, isKeepRemindingMinutes, isWeekday } from '@shared/reminder-settings'
import { normalizeZoomLevel } from '@shared/zoom'
import { normalizeWorkingHours } from '@shared/planning/time-blocks'
import { normalizeFocusSettings } from '@shared/focus'
import { normalizeTipsSettings } from '@shared/tips'
import { parseTaskPrefix, prefixFromName } from '@shared/task-key'
import { isRecord, PROJECT_TOKEN_FIELDS } from '../config-store-helpers'

/**
 * One numbered change to the shape of `config.json`. `up` edits the parsed file
 * in place, before secrets are decrypted or defaults merged in.
 *
 * Append only, and never edit one that has shipped. When a new setting must
 * keep existing users' behaviour, add a migration that writes their current
 * effective value, rather than changing `DEFAULT_CONFIG` alone.
 */

export interface ConfigMigration {
  version: number
  name: string
  /** `newInstall` is true only while building a brand-new config. */
  up(config: Record<string, unknown>, context: { newInstall: boolean }): void
}

export const CONFIG_MIGRATIONS: readonly ConfigMigration[] = [
  // The shape every config had before versions existed.
  { version: 1, name: 'baseline', up: () => {} },
  {
    version: 2,
    name: 'backup-settings',
    up: (config) => {
      if (!isRecord(config.backups)) config.backups = { ...DEFAULT_BACKUP_SETTINGS }
    }
  },
  {
    // Light, Dark and System themes, density and accent (P2.1, D7, D8).
    // Existing configs keep the theme they had (every one was dark before);
    // new installs follow Windows.
    version: 3,
    name: 'appearance',
    up: (config, { newInstall }) => {
      const ui: Record<string, unknown> = isRecord(config.ui) ? config.ui : {}
      const stored = THEME_SETTINGS.includes(ui.theme as ThemeSetting) ? ui.theme : 'dark'
      ui.theme = newInstall ? 'system' : stored
      if (!DENSITY_SETTINGS.includes(ui.density as DensitySetting)) ui.density = 'comfortable'
      if (!ACCENT_SETTINGS.includes(ui.accent as AccentSetting)) ui.accent = 'ostler'
      config.ui = ui
    }
  },
  {
    // "Use AI agents" (D10): agents and both local HTTP servers are opt-in for
    // new installs. Existing configs keep what they had, and both switches were
    // on by default before.
    version: 4,
    name: 'agents-opt-in',
    up: (config, { newInstall }) => {
      for (const key of ['harness', 'automationApi'] as const) {
        const section: Record<string, unknown> = isRecord(config[key]) ? config[key] : {}
        section.enabled = newInstall
          ? false
          : typeof section.enabled === 'boolean'
            ? section.enabled
            : true
        config[key] = section
      }
    }
  },
  {
    // Settings › General › "When Ostler starts" (P3.3). Everyone opened on Home
    // before, so every config starts there.
    version: 5,
    name: 'start-page',
    up: (config) => {
      const ui: Record<string, unknown> = isRecord(config.ui) ? config.ui : {}
      if (!START_PAGE_SETTINGS.includes(ui.startPage as StartPageSetting)) ui.startPage = 'home'
      config.ui = ui
    }
  },
  {
    // Estimates (P5.1, D22): every project counts in points until it chooses hours.
    version: 6,
    name: 'estimate-unit',
    up: (config) => {
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (isRecord(project) && !ESTIMATE_UNITS.includes(project.estimateUnit as EstimateUnit)) {
          project.estimateUnit = 'points'
        }
      }
    }
  },
  {
    // Reminders, quiet hours and per-source notifications (P5.6). Everyone
    // gets due-date reminders at 09:00, quiet hours off, and every source on.
    version: 7,
    name: 'reminders',
    up: (config) => {
      const notifications: Record<string, unknown> = isRecord(config.notifications)
        ? config.notifications
        : {}
      const defaults = DEFAULT_CONFIG.notifications as unknown as Record<string, unknown>
      for (const key of [
        'dueReminders',
        'reminderTime',
        'quietHoursEnabled',
        'quietHoursStart',
        'quietHoursEnd',
        'onReminder',
        'onAgentQuestion',
        'onReviewWaiting',
        'onBlocker'
      ]) {
        if (typeof notifications[key] !== typeof defaults[key]) notifications[key] = defaults[key]
      }
      config.notifications = notifications
    }
  },
  {
    // "Ostler AI can read this project" and its planning profile (P7.1): every
    // project stays readable, as it was, and its profile follows the project.
    version: 8,
    name: 'project-ai',
    up: (config) => {
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (!isRecord(project)) continue
        if (typeof project.aiAccess !== 'boolean') project.aiAccess = true
        if (!AI_PROFILE_SETTINGS.includes(project.aiProfile as AiProfileSetting)) {
          project.aiProfile = 'auto'
        }
      }
    }
  },
  {
    // Agent experience (P7.2): project conventions for coding agents (D25),
    // every project starting with none, and the built-in agent's settings.
    // The agent keeps using Ostler AI's model, and a project that never chose
    // its own auto-run still starts nothing by itself, as before.
    version: 9,
    name: 'agent-experience',
    up: (config) => {
      const harness: Record<string, unknown> = isRecord(config.harness) ? config.harness : {}
      if (typeof harness.agentProvider !== 'string') harness.agentProvider = ''
      if (typeof harness.agentModel !== 'string') harness.agentModel = ''
      if (typeof harness.maxConcurrentAgents !== 'number') harness.maxConcurrentAgents = 1
      if (typeof harness.autoRunQueued !== 'boolean') harness.autoRunQueued = false
      config.harness = harness
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (isRecord(project) && typeof project.agentConventions !== 'string') {
          project.agentConventions = ''
        }
      }
    }
  },
  {
    // First run and getting started (P8.1). A new install, or one that never
    // added a project, starts with the welcome and the checklist; someone who
    // already has projects sees neither. What's new waits for the next version
    // anyone runs, so it starts unseen.
    version: 10,
    name: 'first-run',
    up: (config, { newInstall }) => {
      const ui: Record<string, unknown> = isRecord(config.ui) ? config.ui : {}
      const established =
        !newInstall && Array.isArray(config.projects) && config.projects.length > 0
      if (typeof ui.firstRunCompleted !== 'boolean') ui.firstRunCompleted = established
      if (typeof ui.lastSeenVersion !== 'string') ui.lastSeenVersion = ''
      if (!isRecord(ui.gettingStarted)) {
        ui.gettingStarted = {
          dismissed: established,
          triedView: false,
          usedSearch: false,
          sawBackups: false
        }
      }
      config.ui = ui
    }
  },
  {
    // Windows integration (P8.2): every install starts with Ostler's own title
    // bar, and with background mode, start at sign-in and the system-wide
    // Quick add key off, so closing the window still quits, as before.
    version: 11,
    name: 'desktop',
    up: (config) => {
      const desktop: Record<string, unknown> = isRecord(config.desktop) ? config.desktop : {}
      // The settings as P8.2 shipped them: later ones (Snip to task, 27) have their own migration.
      const {
        snipHotkeyEnabled: _snipOn,
        snipHotkey: _snipKey,
        ...shipped
      } = DEFAULT_DESKTOP_SETTINGS
      for (const [key, value] of Object.entries(shipped)) {
        if (typeof desktop[key] !== typeof value) desktop[key] = value
      }
      config.desktop = desktop
    }
  },
  {
    // Page zoom (P9.2): everyone starts at 100%, as before, where Chromium
    // forgot the zoom at every restart.
    version: 12,
    name: 'zoom',
    up: (config) => {
      const ui: Record<string, unknown> = isRecord(config.ui) ? config.ui : {}
      ui.zoom = normalizeZoomLevel(ui.zoom)
      config.ui = ui
    }
  },
  {
    // Updates (P10.1): every install checks at start-up and downloads in the
    // background, and stays off the beta channel.
    version: 13,
    name: 'updates',
    up: (config) => {
      const updates: Record<string, unknown> = isRecord(config.updates) ? config.updates : {}
      for (const [key, value] of Object.entries(DEFAULT_UPDATE_SETTINGS)) {
        if (typeof updates[key] !== typeof value) updates[key] = value
      }
      config.updates = updates
    }
  },
  {
    // The interface language (P11.1): everyone starts on "Match Windows",
    // which is English until Ostler has the Windows language.
    version: 14,
    name: 'language',
    up: (config) => {
      const ui: Record<string, unknown> = isRecord(config.ui) ? config.ui : {}
      if (typeof ui.language !== 'string' || ui.language === '') ui.language = 'system'
      config.ui = ui
    }
  },
  {
    // The automation API gets its own switch, independent of AI agents (R4.3,
    // D38). It listened only while both switches were on, so it stays on
    // exactly where it listened: on with agents off becomes off.
    version: 15,
    name: 'automation-api-switch',
    up: (config) => {
      const harness = isRecord(config.harness) ? config.harness : {}
      const automation: Record<string, unknown> = isRecord(config.automationApi)
        ? config.automationApi
        : {}
      automation.enabled = harness.enabled === true && automation.enabled === true
      config.automationApi = automation
    }
  },
  {
    // A project's own effort for the built-in agent (R5.2, D42). A project
    // that chose its own model ran it with the provider's default effort,
    // so every such project starts there.
    version: 16,
    name: 'project-agent-effort',
    up: (config) => {
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (!isRecord(project) || !isRecord(project.autoDispatch)) continue
        if (!isAIEffortLevel(project.autoDispatch.defaultEffort)) {
          project.autoDispatch.defaultEffort = ''
        }
      }
    }
  },
  {
    // Run history, usage and limits (R5.3, D43): no prices and no limits, so
    // nobody's costs or agents change until they set them.
    version: 17,
    name: 'agent-prices-and-limits',
    up: (config) => {
      const harness: Record<string, unknown> = isRecord(config.harness) ? config.harness : {}
      harness.modelPrices = normalizeModelPrices(harness.modelPrices)
      config.harness = harness
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (!isRecord(project)) continue
        project.agentLimits = normalizeAgentLimits(project.agentLimits)
      }
    }
  },
  {
    // GitHub links (R4.4, D40): no token, and no project has a repository,
    // so nothing is fetched from GitHub until the person sets it up.
    version: 18,
    name: 'github',
    up: (config) => {
      const github: Record<string, unknown> = isRecord(config.github) ? config.github : {}
      if (typeof github.token !== 'string') github.token = ''
      config.github = github
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (!isRecord(project)) continue
        if (typeof project.githubRepository !== 'string') project.githubRepository = ''
      }
    }
  },
  {
    // Harness and automation tokens are encrypted at rest, like AI keys. A
    // token already encrypted is left alone. Without secure storage a plain
    // token stays as it is and keeps working (openSecret).
    version: 19,
    name: 'encrypt-project-tokens',
    up: (config) => {
      if (!Array.isArray(config.projects) || !isEncryptionAvailable()) return
      for (const project of config.projects) {
        if (!isRecord(project)) continue
        for (const field of PROJECT_TOKEN_FIELDS) {
          const value = project[field]
          if (typeof value === 'string' && value !== '' && !isEncryptedSecret(value)) {
            project[field] = encryptApiKey(value)
          }
        }
      }
    }
  },
  {
    // Ostler AI reads the project folder (simplify pass §4): every enabled
    // project is readable, so the per-project switch goes, and the files it
    // reads fit in a 100,000-token context unless the person changes it.
    version: 20,
    name: 'ai-reads-project-files',
    up: (config) => {
      const ai: Record<string, unknown> = isRecord(config.ai) ? config.ai : {}
      if (typeof ai.contextTokens !== 'number') ai.contextTokens = 100_000
      config.ai = ai
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (isRecord(project)) delete project.aiAccess
      }
    }
  },
  {
    // Agents work in copies in the person's own repository (simplify pass):
    // each run has its own password, so the project password goes, and so do
    // commit rules and the two auto-dispatch switches -- ready work always
    // goes to the queue, and a run that changed nothing shows "Close". The
    // history keeps restore points 30 days and saves the person's edits.
    version: 21,
    name: 'agent-copies-and-history',
    up: (config) => {
      const history: Record<string, unknown> = isRecord(config.history) ? config.history : {}
      if (typeof history.retentionDays !== 'number') history.retentionDays = 30
      if (typeof history.saveMyEdits !== 'boolean') history.saveMyEdits = true
      config.history = history
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (!isRecord(project)) continue
        delete project.harnessToken
        delete project.harnessCommitRules
        if (isRecord(project.autoDispatch)) {
          delete project.autoDispatch.autoQueueReadyWork
          delete project.autoDispatch.autoAcceptNoChangeSessions
        }
      }
    }
  },
  {
    // Backups in a second place (N6.1, N44): no folder until the person
    // chooses one, and no copy made or failed yet.
    version: 22,
    name: 'backup-second-place',
    up: (config) => {
      const backups: Record<string, unknown> = isRecord(config.backups)
        ? config.backups
        : { ...DEFAULT_BACKUP_SETTINGS }
      if (typeof backups.copyTo !== 'string') backups.copyTo = null
      if (typeof backups.lastCopiedAt !== 'number') backups.lastCopiedAt = null
      if (typeof backups.copyFailedAt !== 'number') backups.copyFailedAt = null
      config.backups = backups
    }
  },
  {
    // Areas and project icons (N5.1, N36): no areas, so the sidebar stays one
    // list, and no project has an area or an icon until the person sets one.
    version: 23,
    name: 'areas-and-project-icons',
    up: (config) => {
      config.areas = normalizeAreas(config.areas)
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (!isRecord(project)) continue
        if (typeof project.areaId !== 'string') project.areaId = null
        if (typeof project.icon !== 'string') project.icon = null
      }
    }
  },
  {
    // Weekly review reminder (N1.5, N13): off for everyone, new installs too,
    // with 16:00 ready for when the person picks a day.
    version: 24,
    name: 'weekly-review-reminder',
    up: (config) => {
      const notifications: Record<string, unknown> = isRecord(config.notifications)
        ? config.notifications
        : {}
      if (!isWeekday(notifications.weeklyReviewDay)) notifications.weeklyReviewDay = null
      if (!isClockTime(notifications.weeklyReviewTime)) notifications.weeklyReviewTime = '16:00'
      config.notifications = notifications
    }
  },
  {
    // Keep reminding (N1.7, N15): a reminder that keeps reminding comes back
    // every 15 minutes unless the person chooses otherwise.
    version: 25,
    name: 'keep-reminding-interval',
    up: (config) => {
      const notifications: Record<string, unknown> = isRecord(config.notifications)
        ? config.notifications
        : {}
      if (!isKeepRemindingMinutes(notifications.keepRemindingMinutes))
        notifications.keepRemindingMinutes = 15
      config.notifications = notifications
    }
  },
  {
    // Working hours (N3.4a, N28): the Calendar's Week opens on 09:00 to
    // 17:00 and shades the rest, for everyone, new installs too.
    version: 26,
    name: 'working-hours',
    up: (config) => {
      const ui: Record<string, unknown> = isRecord(config.ui) ? config.ui : {}
      ui.workingHours = normalizeWorkingHours(ui.workingHours)
      config.ui = ui
    }
  },
  {
    // Snip to task (N4.2a, N32): its system-wide key is off for everyone, new
    // installs too, with Ctrl+Alt+S ready for when the person turns it on.
    version: 27,
    name: 'snip-to-task-key',
    up: (config) => {
      const desktop: Record<string, unknown> = isRecord(config.desktop) ? config.desktop : {}
      if (typeof desktop.snipHotkeyEnabled !== 'boolean') desktop.snipHotkeyEnabled = false
      if (!isValidHotkey(desktop.snipHotkey)) desktop.snipHotkey = 'Ctrl+Alt+S'
      config.desktop = desktop
    }
  },
  {
    // A board of projects (N5.3, N38): every project starts Active, and the
    // board's four columns keep their default names until renamed.
    version: 28,
    name: 'project-stages',
    up: (config) => {
      const ui: Record<string, unknown> = isRecord(config.ui) ? config.ui : {}
      ui.projectStageNames = normalizeProjectStageNames(ui.projectStageNames)
      config.ui = ui
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (!isRecord(project)) continue
        project.stage = normalizeProjectStage(project.stage)
      }
    }
  },
  {
    // Status updates (N5.5, N40): every project's reminder to post one
    // starts off, on Mondays when it is turned on.
    version: 29,
    name: 'status-update-reminder',
    up: (config) => {
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (!isRecord(project)) continue
        project.updateReminder = normalizeUpdateReminder(project.updateReminder)
      }
    }
  },
  {
    // Approve the plan (N9.3b, N61): every project's Agents plan first starts
    // off, so no run waits on a plan until the person asks for one.
    version: 30,
    name: 'agents-plan-first',
    up: (config) => {
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (!isRecord(project) || !isRecord(project.autoDispatch)) continue
        if (typeof project.autoDispatch.agentsPlanFirst !== 'boolean')
          project.autoDispatch.agentsPlanFirst = false
      }
    }
  },
  {
    // Try it (N9.4, N62): no project has a try command until the person sets
    // one, and nobody has seen its warning yet.
    version: 31,
    name: 'try-it',
    up: (config) => {
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (!isRecord(project)) continue
        if (typeof project.tryCommand !== 'string') project.tryCommand = ''
        if (typeof project.tryItWarningSeen !== 'boolean') project.tryItWarningSeen = false
      }
    }
  },
  {
    // Conventions that learn (N9.6a): every project starts with no lessons.
    version: 32,
    name: 'project-lessons',
    up: (config) => {
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (isRecord(project) && !Array.isArray(project.agentLessons)) project.agentLessons = []
      }
    }
  },
  {
    // Task IDs (N9.8a, N66): every project gets a prefix from its name, made
    // unique among projects in the order they are listed.
    version: 33,
    name: 'task-prefixes',
    up: (config) => {
      if (!Array.isArray(config.projects)) return
      const taken: string[] = []
      for (const project of config.projects) {
        if (!isRecord(project)) continue
        const own = parseTaskPrefix(project.taskPrefix)
        project.taskPrefix =
          own !== null && !taken.includes(own)
            ? own
            : prefixFromName(typeof project.name === 'string' ? project.name : '', taken)
        taken.push(project.taskPrefix as string)
      }
    }
  },
  {
    // Triage (N4.3a, N33): every project's Triage new captures starts off.
    version: 34,
    name: 'triage-captures',
    up: (config) => {
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (isRecord(project) && typeof project.triageCaptures !== 'boolean')
          project.triageCaptures = false
      }
    }
  },
  {
    // Focus (N3.5, N29): 25 and 50 minutes offered, a 5-minute break and the
    // chime on, for everyone, new installs too.
    version: 35,
    name: 'focus-timer',
    up: (config) => {
      const notifications: Record<string, unknown> = isRecord(config.notifications)
        ? config.notifications
        : {}
      notifications.focus = normalizeFocusSettings(notifications.focus)
      config.notifications = notifications
    }
  },
  {
    // Progress and your year (N3.6, N30): Show my progress starts off, for
    // everyone, new installs too.
    version: 36,
    name: 'show-progress',
    up: (config) => {
      const ui: Record<string, unknown> = isRecord(config.ui) ? config.ui : {}
      if (typeof ui.showProgress !== 'boolean') ui.showProgress = false
      config.ui = ui
    }
  },
  {
    // Pop out a view (N5.8a, N43): no pop-out windows remembered yet, for
    // everyone, new installs too.
    version: 37,
    name: 'pop-out-windows',
    up: (config) => {
      config.popOuts = normalizePopOutSettings(config.popOuts)
    }
  },
  {
    // Sticky task on the desktop (N5.8b, N43): no task pinned yet, for
    // everyone, new installs too.
    version: 38,
    name: 'sticky-tasks',
    up: (config) => {
      config.stickyTasks = normalizeStickyTaskSettings(config.stickyTasks)
    }
  },
  {
    // Reviewer notes in Review changes (N9.5b, N63): every project's Review
    // agent work before me starts off, so no run starts a second one until
    // the person asks for it.
    version: 39,
    name: 'review-before-me',
    up: (config) => {
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (!isRecord(project) || !isRecord(project.autoDispatch)) continue
        if (typeof project.autoDispatch.reviewBeforeMe !== 'boolean')
          project.autoDispatch.reviewBeforeMe = false
      }
    }
  },
  {
    // How much to show (interface levels) was removed: every view and
    // control shows for everyone, so the saved level goes.
    version: 40,
    name: 'interface-level',
    up: (config) => {
      if (isRecord(config.ui)) delete config.ui.interfaceLevel
    }
  },
  {
    // Tips and the walkthrough: on for everyone, none dismissed yet. They
    // start in the sample project, so an existing install sees them only there.
    version: 41,
    name: 'tips',
    up: (config) => {
      const ui: Record<string, unknown> = isRecord(config.ui) ? config.ui : {}
      ui.tips = normalizeTipsSettings(ui.tips)
      config.ui = ui
    }
  },
  {
    // Nexus Dashboard was renamed Ostler: secrets sealed under the old prefix
    // are relabelled (the encrypted part is the same), Nexus AI's actor token
    // becomes Ostler AI's, and the sample project takes its new name.
    version: 42,
    name: 'ostler-names',
    up: (config) => {
      const rename = (value: unknown): unknown => {
        if (typeof value === 'string') {
          if (value.startsWith(LEGACY_NAMES.secretPrefix))
            return `ostler-secure:v1:${value.slice(LEGACY_NAMES.secretPrefix.length)}`
          return value === 'nexus-ai' ? 'ostler-ai' : value
        }
        if (Array.isArray(value)) return value.map(rename)
        if (isRecord(value)) {
          for (const key of Object.keys(value)) value[key] = rename(value[key])
        }
        return value
      }
      rename(config)
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (isRecord(project) && project.name === 'Welcome to Nexus')
          project.name = BRAND.sampleProjectName
      }
    }
  },
  {
    // The sample project's name says it is a demo. It is found by its name,
    // so the one already made takes the new name too.
    version: 43,
    name: 'demo-project-name',
    up: (config) => {
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (isRecord(project) && project.name === 'Welcome to Ostler')
          project.name = BRAND.sampleProjectName
      }
    }
  },
  {
    // Demos made before they were marked: known by their names then. A copy
    // opened from a backup ("Backup copy of …", "… (from backup)") is no demo.
    version: 44,
    name: 'mark-demo-projects',
    up: (config) => {
      if (!Array.isArray(config.projects)) return
      const kinds: Record<string, string> = {
        'Welcome to Ostler (Demo Project)': 'simple',
        'Harbour Café refit (Advanced Demo)': 'advanced'
      }
      for (const project of config.projects) {
        if (isRecord(project) && typeof project.name === 'string' && kinds[project.name])
          project.demo = kinds[project.name]
      }
    }
  },
  {
    // Undo history: every change the person makes is kept 30 days by default.
    version: 45,
    name: 'undo-history-days',
    up: (config) => {
      const history: Record<string, unknown> = isRecord(config.history) ? config.history : {}
      if (typeof history.keepChangesDays !== 'number') history.keepChangesDays = 30
      config.history = history
    }
  },
  {
    // A task another person assigns to you raises a notice: on (people and devices, D11).
    version: 46,
    name: 'assigned-to-me-notice',
    up: (config) => {
      const notifications: Record<string, unknown> = isRecord(config.notifications)
        ? config.notifications
        : {}
      if (typeof notifications.onAssignedToMe !== 'boolean') notifications.onAssignedToMe = true
      config.notifications = notifications
    }
  },
  {
    // Email invites (MOP-4): no email server until the person sets one up.
    version: 47,
    name: 'email-server',
    up: (config) => {
      const email: Record<string, unknown> = isRecord(config.email) ? config.email : {}
      const defaults = DEFAULT_CONFIG.email as unknown as Record<string, unknown>
      for (const [key, value] of Object.entries(defaults)) {
        if (typeof email[key] !== typeof value) email[key] = value
      }
      config.email = email
    }
  },
  {
    // Nested projects (MOP-32): every project starts at the top level.
    version: 48,
    name: 'nested-projects',
    up: (config) => {
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (!isRecord(project)) continue
        if (typeof project.parentProjectId !== 'string') project.parentProjectId = null
      }
    }
  },
  {
    // Nested projects are gone (replaced by sub-projects): every project is top level.
    version: 49,
    name: 'remove-nested-projects',
    up: (config) => {
      if (!Array.isArray(config.projects)) return
      for (const project of config.projects) {
        if (!isRecord(project)) continue
        delete project.parentProjectId
      }
    }
  },
  {
    // A comment that mentions you raises a notice: on (prompt 14).
    version: 50,
    name: 'mentioned-notice',
    up: (config) => {
      const notifications: Record<string, unknown> = isRecord(config.notifications)
        ? config.notifications
        : {}
      if (typeof notifications.onMentioned !== 'boolean') notifications.onMentioned = true
      config.notifications = notifications
    }
  },
  {
    // A followed task that someone else changes raises a notice: on (prompt 15).
    version: 51,
    name: 'followed-task-notice',
    up: (config) => {
      const notifications: Record<string, unknown> = isRecord(config.notifications)
        ? config.notifications
        : {}
      if (typeof notifications.onFollowedTaskChanged !== 'boolean')
        notifications.onFollowedTaskChanged = true
      config.notifications = notifications
    }
  },
  {
    // A sign-off asked of you, or answered, raises a notice: on (prompt 17).
    version: 52,
    name: 'sign-off-notice',
    up: (config) => {
      const notifications: Record<string, unknown> = isRecord(config.notifications)
        ? config.notifications
        : {}
      if (typeof notifications.onSignOff !== 'boolean') notifications.onSignOff = true
      config.notifications = notifications
    }
  }
]

export const LATEST_CONFIG_VERSION = CONFIG_MIGRATIONS[CONFIG_MIGRATIONS.length - 1].version

/** Applies every pending config migration to `raw` and stamps the version. */
export function applyConfigMigrations(
  raw: Record<string, unknown>,
  from: number,
  newInstall = false
): void {
  for (const migration of CONFIG_MIGRATIONS) {
    if (migration.version > from) migration.up(raw, { newInstall })
  }
  raw.configVersion = LATEST_CONFIG_VERSION
}
