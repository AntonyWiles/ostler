import * as fs from 'fs'
import { normalizeAgentLimits, normalizeModelPrices } from '@shared/agent-run-history'
import { parseTryCommand } from '@shared/try-it'
import { normalizePopOutSettings } from '@shared/pop-out'
import { normalizeStickyTaskSettings } from '@shared/sticky-task'
import {
  addLesson,
  editLesson,
  parseProjectLessons,
  projectLessons,
  removeLesson
} from '@shared/project-lessons'
import * as path from 'path'
import { randomBytes } from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import {
  OstlerConfig,
  OstlerConfigUpdate,
  WatchedProject,
  ProjectAutoDispatchConfig,
  DEFAULT_CONFIG,
  AI_VISION_SETTINGS,
  isAIEffortLevel,
  normalizeBackupSettings,
  normalizeDesktopSettings,
  normalizeUpdateSettings,
  MAX_PROJECT_CONVENTIONS_LENGTH,
  type ProjectLesson,
  ESTIMATE_UNITS,
  type EstimateUnit,
  type DemoKind
} from '@shared/ostler-api'
import { isEncryptedSecret, isEncryptionAvailable, openSecret, sealSecret } from './safe-storage'
import { backupTimestamp } from './services/database/backup-timestamp'
import { projectFolder } from '@shared/project-folder'
import { parseAgentSetup } from '@shared/workspace-setup'
import { normalizeGithubRepositorySetting } from '@shared/github/github-reference'
import { AI_PROFILE_SETTINGS } from '@shared/ai-profile'
import { PROJECT_COLORS } from '@shared/project-colors'
import { normalizeAreaName, normalizeAreas, type ProjectArea } from '@shared/project-areas'
import { normalizeProjectIcon } from '@shared/project-icons'
import { SHARED_PROJECT_FIELDS } from '@shared/sync/shared-project-fields'
import {
  DEFAULT_PROJECT_STAGE,
  normalizeProjectStage,
  normalizeProjectStageNames,
  parseProjectStage,
  type ProjectStage
} from '@shared/project-stages'
import {
  DEFAULT_UPDATE_REMINDER,
  normalizeUpdateReminder,
  parseUpdateReminder
} from '@shared/status-updates'
import { toIsoDate } from '@shared/dates'
import { normalizeNotificationSettings } from '@shared/reminder-settings'
import { normalizeZoomLevel } from '@shared/zoom'
import { normalizeWorkingHours } from '@shared/planning/time-blocks'
import { normalizeFocusSettings } from '@shared/focus'
import { normalizeTipsSettings } from '@shared/tips'
import { containsPath, normalizeAndResolve, pathsEqual, sanitizePath } from './paths'
import { projectAgentsPlanFirst } from '@shared/plan-first'
import { projectReviewBeforeMe } from '@shared/reviewer-runs'
import { parseTaskPrefix, prefixFromName } from '@shared/task-key'
import { t } from '@shared/i18n'
import { isRecord, PROJECT_TOKEN_FIELDS } from './config-store-helpers'
import { Refusal } from '@shared/refusal'
import {
  applyConfigMigrations,
  CONFIG_MIGRATIONS,
  LATEST_CONFIG_VERSION,
  type ConfigMigration
} from './config-migrations'

export { CONFIG_MIGRATIONS, LATEST_CONFIG_VERSION, type ConfigMigration }

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T
  }

  if (isRecord(value)) {
    const clone: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value)) {
      clone[key] = cloneValue(nestedValue)
    }
    return clone as T
  }

  return value
}

/**
 * Deeply merges source into target.
 * Arrays in source overwrite arrays in target.
 * @param target The target object.
 * @param source The source object.
 * @returns A new merged object.
 */
function deepMerge<T = unknown>(target: unknown, source: unknown): T {
  if (!isRecord(target) || !isRecord(source)) {
    return cloneValue(source) as T
  }

  const result = cloneValue(target) as Record<string, unknown>
  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = result[key]
    result[key] =
      isRecord(targetValue) && isRecord(sourceValue)
        ? deepMerge(targetValue, sourceValue)
        : cloneValue(sourceValue)
  }
  return result as T
}

/** The built-in agent's settings within their bounds (P7.2). */
function normalizeAgentSettings(harness: OstlerConfig['harness']): OstlerConfig['harness'] {
  const concurrency = Math.floor(Number(harness.maxConcurrentAgents))
  return {
    ...harness,
    agentProvider: typeof harness.agentProvider === 'string' ? harness.agentProvider.trim() : '',
    agentModel: typeof harness.agentModel === 'string' ? harness.agentModel.trim() : '',
    agentEffort: isAIEffortLevel(harness.agentEffort) ? harness.agentEffort : '',
    maxConcurrentAgents: Number.isFinite(concurrency) ? Math.min(4, Math.max(1, concurrency)) : 1,
    autoRunQueued: harness.autoRunQueued === true,
    modelPrices: normalizeModelPrices(harness.modelPrices)
  }
}

/** A new install's config: the defaults, after every migration. */
function freshConfig(): OstlerConfig {
  const raw: Record<string, unknown> = {}
  applyConfigMigrations(raw, 0, true)
  return deepMerge<OstlerConfig>(DEFAULT_CONFIG, raw)
}

/** What a project field's check can see besides the new value. */
interface ProjectFieldContext {
  project: WatchedProject
  /** Every other project, for checks that must be unique across projects. */
  otherProjects: WatchedProject[]
  checkAreaId: (areaId: unknown) => string | null
}

/** Checks a new value for one project field and returns what to store; throws if it's invalid. */
type ProjectFieldCheck = (value: unknown, context: ProjectFieldContext) => unknown

/** A check that the value is one of `allowed`, stored as given. */
function oneOf(allowed: readonly unknown[], message: string): ProjectFieldCheck {
  return (value) => {
    if (!allowed.includes(value)) throw new Error(message)
    return value
  }
}

/** A check that the value is true or false, stored as given. */
function trueOrFalse(message: string): ProjectFieldCheck {
  return (value) => {
    if (typeof value !== 'boolean') throw new Error(message)
    return value
  }
}

/**
 * The one check for each project field that has one, whichever surface saves it. `updateProject`
 * runs them in this order, so with several bad fields the first one here is the error reported.
 * Fields not listed are stored as given. Adding a checked field is one entry here.
 */
const PROJECT_FIELD_CHECKS: { [K in keyof WatchedProject]?: ProjectFieldCheck } = {
  estimateUnit: oneOf(ESTIMATE_UNITS, 'Estimates count in points or hours'),
  aiProfile: oneOf(AI_PROFILE_SETTINGS, 'The AI profile is Auto, Software or General'),
  agentConventions: (value) => {
    if (typeof value !== 'string') throw new Error('Project conventions are text')
    if (value.length > MAX_PROJECT_CONVENTIONS_LENGTH) {
      throw new Error(
        `Project conventions can be at most ${MAX_PROJECT_CONVENTIONS_LENGTH} characters`
      )
    }
    return value
  },
  // N9.8a: a valid prefix no other project uses.
  taskPrefix: (value, { otherProjects }) => {
    const taskPrefix = parseTaskPrefix(value)
    if (taskPrefix === null) throw new Error(t('errors:taskKey.prefixInvalid'))
    const owner = otherProjects.find((other) => other.taskPrefix === taskPrefix)
    if (owner) throw new Error(t('errors:taskKey.prefixTaken', { name: owner.name }))
    return taskPrefix
  },
  agentLessons: (value) => parseProjectLessons(value), // N9.6a
  agentSetup: (value) => parseAgentSetup(value),
  tryCommand: (value) => parseTryCommand(value), // N9.4: one line, 500 characters
  triageCaptures: trueOrFalse('Triage new captures is true or false'),
  tryItWarningSeen: trueOrFalse("Whether Try it's warning was seen is true or false"),
  agentLimits: (value) => normalizeAgentLimits(value),
  githubRepository: (value) => normalizeGithubRepositorySetting(value),
  icon: (value) => normalizeProjectIcon(value),
  areaId: (value, { checkAreaId }) => checkAreaId(value),
  stage: (value) => parseProjectStage(value),
  updateReminder: (value, { project }) =>
    parseUpdateReminder(
      value,
      normalizeUpdateReminder(project.updateReminder),
      toIsoDate(new Date())
    )
}

/**
 * A JSON-based configuration store for Ostler.
 */
export class ConfigStore {
  private configPath: string
  private config: OstlerConfig

  /**
   * Initializes the ConfigStore.
   * @param configPath The absolute path where the config JSON should be stored.
   */
  constructor(configPath: string) {
    this.configPath = configPath
    this.config = this.load()
  }

  /**
   * Loads the configuration from disk, applying defaults and decrypting API keys.
   * @returns The loaded OstlerConfig.
   */
  private load(): OstlerConfig {
    if (!fs.existsSync(this.configPath)) {
      this.config = freshConfig()
      this.save()
      return this.config
    }

    let parsed: Partial<OstlerConfig>
    try {
      parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as Partial<OstlerConfig>
    } catch (error) {
      // The config holds every watched project. Never let an unreadable file
      // turn into a silent reset that the next save writes over the top of --
      // keep the original bytes aside so they can be recovered by hand.
      this.quarantineUnreadableConfig(error)
      this.config = freshConfig()
      this.save()
      return this.config
    }

    try {
      let needsSave = this.migrate(parsed as Record<string, unknown>)

      // Every stored secret (the AI key, the GitHub token, each project's
      // harness and automation tokens) is opened by one rule: encrypted ones
      // are decrypted, plain ones kept (saved while Windows could not encrypt)
      // and saved again so they are encrypted now that it can. One that
      // cannot be opened (secure storage unavailable, or encrypted by a
      // different OS user) costs only that secret, not the project list.
      const openStored = (value: string, what: string): string | undefined => {
        try {
          const opened = openSecret(value)
          if (!isEncryptedSecret(value) && isEncryptionAvailable()) needsSave = true
          return opened
        } catch (error) {
          console.error(`Stored ${what} could not be decrypted; continuing without it:`, error)
          return undefined
        }
      }
      if (parsed.ai?.apiKey) parsed.ai.apiKey = openStored(parsed.ai.apiKey, 'API key') ?? ''
      // The same rule for the GitHub token (R4.4).
      if (parsed.github?.token) {
        parsed.github.token = openStored(parsed.github.token, 'GitHub token') ?? ''
      }
      // And for the email server's password (MOP-4).
      if (parsed.email?.password) {
        parsed.email.password = openStored(parsed.email.password, 'email password') ?? ''
      }
      // And for the automation token: one that cannot be opened is dropped,
      // and the person makes a new one.
      if (Array.isArray(parsed.projects)) {
        for (const project of parsed.projects) {
          if (!isRecord(project)) continue
          for (const field of PROJECT_TOKEN_FIELDS) {
            const value = project[field]
            if (typeof value !== 'string' || value === '') continue
            const opened = openStored(value, field)
            if (opened !== undefined) project[field] = opened
            else {
              delete project[field]
              needsSave = true
            }
          }
        }
      }

      // Merge with defaults to ensure all fields exist
      const merged = deepMerge<OstlerConfig>(DEFAULT_CONFIG, parsed)
      // Configs saved before the vision setting, or holding an unknown value,
      // fall back to 'auto'.
      if (!AI_VISION_SETTINGS.includes(merged.ai.vision)) merged.ai.vision = 'auto'
      if (merged.ai.effort !== '' && !isAIEffortLevel(merged.ai.effort)) merged.ai.effort = ''
      merged.backups = normalizeBackupSettings(merged.backups)
      merged.desktop = normalizeDesktopSettings(merged.desktop)
      merged.updates = normalizeUpdateSettings(merged.updates)
      merged.notifications.focus = normalizeFocusSettings(merged.notifications.focus)
      merged.areas = normalizeAreas(merged.areas)
      merged.ui.projectStageNames = normalizeProjectStageNames(merged.ui.projectStageNames)
      merged.popOuts = normalizePopOutSettings(merged.popOuts)
      merged.stickyTasks = normalizeStickyTaskSettings(merged.stickyTasks)
      const areaIds = new Set(merged.areas.map((area) => area.id))
      for (const project of merged.projects) {
        // An area that went away, or an icon this version does not know,
        // reads as none rather than breaking the sidebar.
        if (project.areaId && !areaIds.has(project.areaId)) project.areaId = null
        project.stage = normalizeProjectStage(project.stage)
        project.updateReminder = normalizeUpdateReminder(project.updateReminder)
        try {
          project.icon = normalizeProjectIcon(project.icon)
        } catch {
          project.icon = null
        }
        // Configs written before folders were optional always hold a string;
        // an empty one means "no folder" (D4). No migration: a real path stays.
        if (projectFolder(project) === null && project.path !== null) {
          project.path = null
          needsSave = true
        }
      }
      if (needsSave) this.save(merged)

      return merged
    } catch (error) {
      // Structurally wrong contents (e.g. `projects` is not an array). Same
      // rule as unparseable JSON: keep the original file before replacing it.
      this.quarantineUnreadableConfig(error)
      this.config = freshConfig()
      this.save()
      return this.config
    }
  }

  /**
   * Runs pending config migrations on the parsed file. Before the first change,
   * the file as it was is copied to
   * `<dataDir>/backups/pre-migration-config-v<from>-v<to>-<timestamp>.json`. If
   * that copy fails, nothing is migrated this time. Returns whether `raw` changed.
   */
  private migrate(raw: Record<string, unknown>): boolean {
    const from = typeof raw.configVersion === 'number' ? raw.configVersion : 0
    if (from >= LATEST_CONFIG_VERSION) return false
    try {
      const backupDir = path.join(path.dirname(this.configPath), 'backups')
      fs.mkdirSync(backupDir, { recursive: true })
      fs.copyFileSync(
        this.configPath,
        path.join(
          backupDir,
          `pre-migration-config-v${from}-v${LATEST_CONFIG_VERSION}-${backupTimestamp()}.json`
        )
      )
    } catch (error) {
      console.error('Could not back up config.json before updating it; leaving it as it is:', error)
      return false
    }
    applyConfigMigrations(raw, from)
    return true
  }

  /**
   * Moves a config file Ostler could not read to a timestamped sibling before
   * defaults are written over it, and reports where it went. Losing the
   * watched-project list to a transient read error is not recoverable
   * otherwise; the copy is.
   */
  private quarantineUnreadableConfig(error: unknown): void {
    const backupPath = `${this.configPath}.corrupt-${Date.now()}`
    try {
      fs.renameSync(this.configPath, backupPath)
      console.error(
        `Failed to load config (${error instanceof Error ? error.message : String(error)}). ` +
          `The previous file was kept at ${backupPath}; starting from defaults.`
      )
    } catch (renameError) {
      console.error(
        `Failed to load config (${error instanceof Error ? error.message : String(error)}) ` +
          `and could not preserve it: ${
            renameError instanceof Error ? renameError.message : String(renameError)
          }`
      )
    }
  }

  /**
   * Saves the configuration to disk atomically, encrypting the API key.
   */
  private save(config: OstlerConfig = this.config): void {
    try {
      const configToSave = deepMerge<OstlerConfig>({}, config)

      // Encrypt every secret before saving; when Windows cannot, it is kept as
      // it is (sealSecret) so it keeps working after a restart.
      if (configToSave.ai?.apiKey) configToSave.ai.apiKey = sealSecret(configToSave.ai.apiKey)
      if (configToSave.github?.token) {
        configToSave.github.token = sealSecret(configToSave.github.token)
      }
      if (configToSave.email?.password) {
        configToSave.email.password = sealSecret(configToSave.email.password)
      }
      for (const project of configToSave.projects ?? []) {
        for (const field of PROJECT_TOKEN_FIELDS) {
          const value = project[field]
          if (value) project[field] = sealSecret(value)
        }
      }

      const tempPath = `${this.configPath}.${randomBytes(6).toString('hex')}.tmp`
      const dir = path.dirname(this.configPath)

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      try {
        fs.writeFileSync(tempPath, JSON.stringify(configToSave, null, 2), 'utf-8')
        fs.renameSync(tempPath, this.configPath)
      } catch (error) {
        // A half-written temp file is never the config, but leaving one
        // behind on every failed save slowly fills the data directory.
        fs.rmSync(tempPath, { force: true })
        throw error
      }
    } catch (error) {
      console.error('Failed to save config:', error)
      throw error
    }
  }

  private projectsChangedListener: ((projectId: string) => void) | null = null

  /**
   * Called after the project list or any project's config is saved, with the
   * project that changed. The one place main learns of it, whichever caller
   * made the change (IPC, the new-project wizard, the automation API).
   */
  public setProjectsChangedListener(listener: ((projectId: string) => void) | null): void {
    this.projectsChangedListener = listener
  }

  private configChangedListener: (() => void) | null = null

  /**
   * Called after `update` saves a settings change (theme, AI, agents, …), so
   * the renderer can re-read what its feature switches depend on.
   */
  public setConfigChangedListener(listener: (() => void) | null): void {
    this.configChangedListener = listener
  }

  private projectsChanged(projectId: string): void {
    try {
      this.projectsChangedListener?.(projectId)
    } catch (error) {
      console.error('Projects-changed listener failed:', error)
    }
  }

  /**
   * Retrieves the current configuration.
   * @returns The current OstlerConfig.
   */
  public get(): OstlerConfig {
    return this.withPolicy(this.config)
  }

  /**
   * What the person set, without the organisation's overlay `get` adds. Settings sync reads this,
   * so that a policy's switch is never sent to another device as the person's own choice.
   */
  public getOwn(): OstlerConfig {
    return this.config
  }

  /**
   * The organisation's switches (integrations phase 7): AI or agents off,
   * whatever Settings says. Laid over what `get` returns, never saved, so
   * the person's own choice comes back if the policy goes.
   */
  public setPolicy(policy: { disableAi: boolean; disableAgents: boolean }): void {
    this.policy = policy.disableAi || policy.disableAgents ? { ...policy } : null
  }

  private policy: { disableAi: boolean; disableAgents: boolean } | null = null

  private withPolicy(config: OstlerConfig): OstlerConfig {
    if (!this.policy) return config
    return {
      ...config,
      ai: this.policy.disableAi ? { ...config.ai, model: '' } : config.ai,
      harness: this.policy.disableAgents ? { ...config.harness, enabled: false } : config.harness
    }
  }

  /**
   * Updates the configuration with the given partial updates.
   * @param updates The updates to apply.
   * @returns The newly updated OstlerConfig.
   */
  public update(updates: OstlerConfigUpdate): OstlerConfig {
    const nextConfig = deepMerge<OstlerConfig>(this.config, updates)
    // What the policy sets stays as the person left it underneath.
    if (this.policy?.disableAi) nextConfig.ai.model = this.config.ai.model
    if (this.policy?.disableAgents) nextConfig.harness.enabled = this.config.harness.enabled
    if (!AI_VISION_SETTINGS.includes(nextConfig.ai.vision)) nextConfig.ai.vision = 'auto'
    if (nextConfig.ai.effort !== '' && !isAIEffortLevel(nextConfig.ai.effort))
      nextConfig.ai.effort = ''
    nextConfig.backups = normalizeBackupSettings(nextConfig.backups)
    nextConfig.desktop = normalizeDesktopSettings(nextConfig.desktop)
    nextConfig.updates = normalizeUpdateSettings(nextConfig.updates)
    nextConfig.notifications = normalizeNotificationSettings(nextConfig.notifications)
    nextConfig.harness = normalizeAgentSettings(nextConfig.harness)
    nextConfig.popOuts = normalizePopOutSettings(nextConfig.popOuts)
    nextConfig.stickyTasks = normalizeStickyTaskSettings(nextConfig.stickyTasks)
    nextConfig.ui = {
      ...nextConfig.ui,
      zoom: normalizeZoomLevel(nextConfig.ui.zoom),
      workingHours: normalizeWorkingHours(nextConfig.ui.workingHours),
      projectStageNames: normalizeProjectStageNames(nextConfig.ui.projectStageNames),
      showProgress: nextConfig.ui.showProgress === true,
      tips: normalizeTipsSettings(nextConfig.ui.tips)
    }
    this.save(nextConfig)
    this.config = nextConfig
    try {
      this.configChangedListener?.()
    } catch (error) {
      console.error('Config-changed listener failed:', error)
    }
    return this.withPolicy(nextConfig)
  }

  /**
   * Retrieves the list of watched projects.
   * @returns An array of WatchedProject.
   */
  public getProjects(): WatchedProject[] {
    return this.config.projects
  }

  /**
   * Registers a project. `folder` is an already validated, resolved folder
   * (`validateProjectFolder`), or null for a project that lives only in Ostler.
   * Creating projects goes through `ProjectScaffoldService.createProject`,
   * which owns the folder choices; this only records the result.
   */
  public registerProject(details: {
    name: string
    folder: string | null
    color?: string
    notes?: string
    tags?: string[]
    /** Chosen in advance when the project's records are written first (P5.8). */
    id?: string
    estimateUnit?: EstimateUnit
    icon?: WatchedProject['icon']
    /** A project file's task prefix (N9.8a): kept when no other project uses it. */
    taskPrefix?: string
    /** Set only when the project is made from a demo's built-in package. */
    demo?: DemoKind
    /** The stage to start in, checked by `parseProjectStage`; left out, Active. */
    stage?: ProjectStage
  }): WatchedProject {
    if (details.id !== undefined && this.config.projects.some((p) => p.id === details.id))
      throw new Error('A project with that id already exists')
    const stage =
      details.stage === undefined ? DEFAULT_PROJECT_STAGE : parseProjectStage(details.stage)
    const folder = details.folder === null ? null : this.validateProjectFolder(details.folder)
    const color = details.color || PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)]

    const newProject: WatchedProject = {
      id: details.id ?? uuidv4(),
      name: details.name,
      path: folder,
      color,
      enabled: true,
      customIgnorePatterns: [],
      notes: details.notes ?? '',
      tags: details.tags ?? [],
      addedAt: Date.now(),
      lastActivity: null,
      estimateUnit: details.estimateUnit === 'hours' ? 'hours' : 'points',
      aiProfile: 'auto',
      agentConventions: '',
      agentLimits: { tokensPerDay: null, tokensPerMonth: null },
      githubRepository: '',
      areaId: null,
      icon: details.icon ?? null,
      stage,
      updateReminder: { ...DEFAULT_UPDATE_REMINDER },
      tryCommand: '',
      tryItWarningSeen: false,
      triageCaptures: false,
      agentLessons: [],
      taskPrefix: this.freeTaskPrefix(details.name, details.taskPrefix),
      ...(details.demo ? { demo: details.demo } : {})
    }

    this.config.projects.push(newProject)
    this.save()
    this.projectsChanged(newProject.id)
    return newProject
  }

  /**
   * A new project's task prefix (N9.8a): `wanted` when it is one and no other
   * project uses it, else one from the name, made unique.
   */
  private freeTaskPrefix(name: string, wanted?: string): string {
    const taken = this.config.projects.map((project) => project.taskPrefix ?? '')
    const own = parseTaskPrefix(wanted)
    return own !== null && !taken.includes(own) ? own : prefixFromName(name, taken)
  }

  /**
   * Checks that `folderPath` can be a project's folder and returns it resolved:
   * it exists, is a directory, and neither is, contains nor sits inside another
   * project's folder. `forProjectId` is the project being linked, which may
   * keep the folder it already has.
   */
  public validateProjectFolder(folderPath: string, forProjectId?: string): string {
    if (typeof folderPath !== 'string' || folderPath.trim() === '') {
      throw new Error('Choose a folder.')
    }
    const resolvedPath = normalizeAndResolve(sanitizePath(folderPath))
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project path does not exist: ${resolvedPath}`)
    }
    if (!fs.statSync(resolvedPath).isDirectory()) {
      throw new Error(`Project path is not a directory: ${resolvedPath}`)
    }
    this.assertNoWatchedOverlap(resolvedPath, forProjectId)
    return resolvedPath
  }

  /**
   * Links (`folder` set, already validated) or unlinks (`null`) a project's
   * folder. The rules about agent work live in `ProjectFolderService`.
   */
  public setProjectFolder(id: string, folder: string | null): WatchedProject {
    const project = this.config.projects.find((p) => p.id === id)
    if (!project) throw new Error(`Project with ID ${id} not found`)
    project.path = folder
    this.save()
    this.projectsChanged(project.id)
    return project
  }

  /** The palette new projects draw their color from. */
  public getProjectColors(): string[] {
    return [...PROJECT_COLORS]
  }

  /**
   * Throws when `resolvedPath` is, contains, or sits inside a watched project.
   * Exposed so a folder can be vetted before anything is created on disk.
   */
  public assertNoWatchedOverlap(resolvedPath: string, exceptProjectId?: string): void {
    // Overlapping roots would give one directory two project IDs, two
    // watchers, and two independent harness state directories, with nothing
    // in the UI to tell the copies apart.
    for (const existing of this.config.projects) {
      if (existing.id === exceptProjectId) continue
      const existingFolder = projectFolder(existing)
      if (existingFolder === null) continue
      const existingPath = normalizeAndResolve(existingFolder)
      if (pathsEqual(existingPath, resolvedPath)) {
        throw new Error(`This folder is already a project: "${existing.name}".`)
      }
      if (containsPath(existingPath, resolvedPath)) {
        throw new Error(
          `This folder is inside "${existing.name}" (${existingFolder}), which is already being watched. Remove that project first, or pick a folder outside it.`
        )
      }
      if (containsPath(resolvedPath, existingPath)) {
        throw new Error(
          `This folder contains "${existing.name}" (${existingFolder}), which is already being watched. Remove that project first, or pick a folder that does not contain it.`
        )
      }
    }
  }

  public generateAutomationToken(id: string): WatchedProject {
    const project = this.config.projects.find((p) => p.id === id)
    if (!project) throw new Error(`Project with ID ${id} not found`)
    project.automationToken = randomBytes(24).toString('hex')
    this.save()
    this.projectsChanged(project.id)
    return project
  }

  public revokeAutomationToken(id: string): WatchedProject {
    const project = this.config.projects.find((p) => p.id === id)
    if (!project) throw new Error(`Project with ID ${id} not found`)
    delete project.automationToken
    this.save()
    this.projectsChanged(project.id)
    return project
  }

  /**
   * Removes a project by its ID.
   * @param id The ID of the project to remove.
   */
  public removeProject(id: string): void {
    const index = this.config.projects.findIndex((p) => p.id === id)
    if (index !== -1) {
      this.config.projects.splice(index, 1)
      this.save()
      this.projectsChanged(id)
    }
  }

  /**
   * Puts the projects in `orderedIds` in that order: the sidebar's order is
   * the order of `config.projects`. The ids must be distinct and registered.
   * A subset is allowed (the sidebar lists enabled projects only); the named
   * projects take the positions they already held between them, so projects
   * left out keep their places.
   */
  public reorderProjects(orderedIds: string[]): WatchedProject[] {
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
      throw new Error('Project order must be a list of project ids')
    }
    if (new Set(orderedIds).size !== orderedIds.length) {
      throw new Error('Project order lists a project twice')
    }
    const byId = new Map(this.config.projects.map((project) => [project.id, project]))
    const unknown = orderedIds.find((id) => !byId.has(id))
    if (unknown !== undefined) throw new Error(`Project with ID ${unknown} not found`)

    const named = new Set(orderedIds)
    const queue = orderedIds.map((id) => byId.get(id)!)
    const next = this.config.projects.map((project) =>
      named.has(project.id) ? queue.shift()! : project
    )
    if (next.every((project, index) => project === this.config.projects[index])) {
      return this.config.projects
    }
    this.config.projects = next
    this.save()
    this.projectsChanged(orderedIds[0])
    return this.config.projects
  }

  /**
   * Whether this PC is a Viewer of a shared project (set by the sync service). A Viewer's PC
   * refuses changes to the settings the project's members share (SHARED_PROJECT_FIELDS).
   */
  public isViewerOf: ((projectId: string) => boolean) | null = null

  /**
   * Changes a project's settings. `received` is for settings that arrived from another member
   * of a shared project, which apply even on a Viewer's PC. Each field is checked by its entry
   * in PROJECT_FIELD_CHECKS. Returns the updated project.
   */
  public updateProject(
    id: string,
    updates: Partial<WatchedProject>,
    options: { received?: boolean } = {}
  ): WatchedProject {
    const project = this.config.projects.find((p) => p.id === id)
    if (!project) {
      throw new Error(`Project with ID ${id} not found`)
    }
    if (!options.received && this.isViewerOf?.(id)) {
      const changes = SHARED_PROJECT_FIELDS.some(
        (field) =>
          updates[field] !== undefined &&
          JSON.stringify(updates[field]) !== JSON.stringify(project[field] ?? null)
      )
      if (changes) throw new Refusal(t('errors:sharing.viewerSettings'))
    }

    // Check every field before changing any, so a bad field leaves the project as it was.
    const checked: Record<string, unknown> = { ...updates }
    const context: ProjectFieldContext = {
      project,
      otherProjects: this.config.projects.filter((other) => other.id !== id),
      checkAreaId: (areaId) => this.checkAreaId(areaId)
    }
    for (const [field, check] of Object.entries(PROJECT_FIELD_CHECKS)) {
      if (checked[field] !== undefined) checked[field] = check(checked[field], context)
    }
    Object.assign(project, checked)
    this.save()
    this.projectsChanged(project.id)
    return project
  }

  /** Adds a lesson (N9.6a) to a project, on, and returns it. */
  public addProjectLesson(
    projectId: string,
    input: { text: unknown; source?: ProjectLesson['source'] }
  ): ProjectLesson {
    const project = this.requireProject(projectId)
    const agentLessons = addLesson(projectLessons(project), input, {
      id: uuidv4(),
      now: Date.now()
    })
    this.updateProject(projectId, { agentLessons })
    return agentLessons[agentLessons.length - 1]
  }

  /** Changes a lesson's text or switch and returns it. */
  public updateProjectLesson(
    projectId: string,
    lessonId: string,
    changes: { text?: unknown; enabled?: unknown }
  ): ProjectLesson {
    const project = this.requireProject(projectId)
    const agentLessons = editLesson(projectLessons(project), lessonId, changes)
    this.updateProject(projectId, { agentLessons })
    return agentLessons.find((lesson) => lesson.id === lessonId)!
  }

  /** Deletes a lesson. */
  public removeProjectLesson(projectId: string, lessonId: string): void {
    const project = this.requireProject(projectId)
    this.updateProject(projectId, {
      agentLessons: removeLesson(projectLessons(project), lessonId)
    })
  }

  private requireProject(projectId: string): WatchedProject {
    const project = this.config.projects.find((p) => p.id === projectId)
    if (!project) throw new Error(`Project with ID ${projectId} not found`)
    return project
  }

  /** An area id a project may be put in: a saved area's, or null for "No area". */
  private checkAreaId(areaId: unknown): string | null {
    if (areaId === null || areaId === '') return null
    if (typeof areaId !== 'string' || !this.config.areas.some((area) => area.id === areaId)) {
      throw new Error(`Area with ID ${String(areaId)} not found`)
    }
    return areaId
  }

  /** The areas (N5.1) in their order. */
  public getAreas(): ProjectArea[] {
    return this.config.areas
  }

  /**
   * Saves the whole list of areas, in its order: the one way areas are made,
   * renamed, reordered and removed. A project whose area is no longer in the
   * list moves to "No area"; nothing else about it changes. `assignments`
   * puts projects back in areas in the same save, which is how Undo of a
   * removal restores it in one step.
   */
  public saveAreas(areas: unknown, assignments: Record<string, string | null> = {}): ProjectArea[] {
    if (!Array.isArray(areas)) throw new Error('Areas must be a list')
    const checked: ProjectArea[] = areas.map((entry) => {
      const record = isRecord(entry) ? entry : {}
      const id = typeof record.id === 'string' && record.id.trim() ? record.id : uuidv4()
      return { id, name: normalizeAreaName(record.name) }
    })
    if (new Set(checked.map((area) => area.id)).size !== checked.length) {
      throw new Error('Areas list an area twice')
    }
    const ids = new Set(checked.map((area) => area.id))
    if (!isRecord(assignments)) throw new Error('Area assignments must be an object')
    for (const [projectId, areaId] of Object.entries(assignments)) {
      if (!this.config.projects.some((project) => project.id === projectId)) {
        throw new Error(`Project with ID ${projectId} not found`)
      }
      if (areaId !== null && !ids.has(areaId)) throw new Error(`Area with ID ${areaId} not found`)
    }
    this.config.areas = checked
    for (const project of this.config.projects) {
      if (project.id in assignments) project.areaId = assignments[project.id]
      else if (project.areaId && !ids.has(project.areaId)) project.areaId = null
    }
    this.save()
    this.projectsChanged(this.config.projects[0]?.id ?? '')
    return this.config.areas
  }

  public getProjectAutoDispatchConfig(projectId: string): ProjectAutoDispatchConfig {
    const project = this.config.projects.find((p) => p.id === projectId)
    if (!project) {
      throw new Error(`Project with ID ${projectId} not found`)
    }
    // A project that never chose its own auto-run follows Settings › Agents.
    const { autoRunQueued, maxConcurrentAgents } = this.config.harness
    return {
      projectId: project.id,
      enabled: project.autoDispatch?.enabled ?? autoRunQueued,
      maxConcurrentEmbeddedSessions:
        project.autoDispatch?.maxConcurrentEmbeddedSessions ??
        (autoRunQueued ? maxConcurrentAgents : 0),
      aiOverrideEnabled: project.autoDispatch?.aiOverrideEnabled ?? false,
      defaultProvider: project.autoDispatch?.defaultProvider ?? '',
      defaultModel: project.autoDispatch?.defaultModel ?? '',
      defaultEffort: isAIEffortLevel(project.autoDispatch?.defaultEffort)
        ? project.autoDispatch.defaultEffort
        : '',
      autoArchiveDoneAfterDays: project.autoDispatch?.autoArchiveDoneAfterDays ?? 0,
      agentsPlanFirst: projectAgentsPlanFirst(project),
      reviewBeforeMe: projectReviewBeforeMe(project)
    }
  }

  public updateProjectAutoDispatchConfig(
    projectId: string,
    updates: Partial<ProjectAutoDispatchConfig>
  ): ProjectAutoDispatchConfig {
    const project = this.config.projects.find((p) => p.id === projectId)
    if (!project) {
      throw new Error(`Project with ID ${projectId} not found`)
    }
    const current = this.getProjectAutoDispatchConfig(projectId)
    const next: ProjectAutoDispatchConfig = {
      projectId: project.id,
      enabled: updates.enabled !== undefined ? Boolean(updates.enabled) : current.enabled,
      maxConcurrentEmbeddedSessions:
        updates.maxConcurrentEmbeddedSessions !== undefined
          ? Math.max(0, Math.floor(updates.maxConcurrentEmbeddedSessions))
          : current.maxConcurrentEmbeddedSessions,
      aiOverrideEnabled:
        updates.aiOverrideEnabled !== undefined
          ? Boolean(updates.aiOverrideEnabled)
          : current.aiOverrideEnabled,
      defaultProvider:
        updates.defaultProvider !== undefined
          ? String(updates.defaultProvider).trim()
          : current.defaultProvider,
      defaultModel:
        updates.defaultModel !== undefined
          ? String(updates.defaultModel).trim()
          : current.defaultModel,
      defaultEffort:
        updates.defaultEffort !== undefined
          ? isAIEffortLevel(updates.defaultEffort)
            ? updates.defaultEffort
            : ''
          : current.defaultEffort,
      autoArchiveDoneAfterDays:
        updates.autoArchiveDoneAfterDays !== undefined
          ? Math.min(3650, Math.max(0, Math.floor(Number(updates.autoArchiveDoneAfterDays) || 0)))
          : current.autoArchiveDoneAfterDays,
      agentsPlanFirst:
        updates.agentsPlanFirst !== undefined
          ? updates.agentsPlanFirst === true
          : current.agentsPlanFirst === true,
      reviewBeforeMe:
        updates.reviewBeforeMe !== undefined
          ? updates.reviewBeforeMe === true
          : current.reviewBeforeMe === true
    }
    project.autoDispatch = next
    this.save()
    this.projectsChanged(project.id)
    return next
  }
}
