import type {
  HarnessSession,
  OstlerConfig,
  OstlerConfigUpdate,
  RendererConfig,
  RendererConfigUpdate,
  RendererHarnessSession,
  RendererProject,
  RendererProjectUpdate,
  WatchedProject
} from './ostler-api'

/**
 * The one place secrets are taken out of what the renderer receives. The AI
 * key and project tokens stay in the main process; the renderer gets flags.
 * Built field by field from the source, so a secret added to the config later
 * reaches the renderer only if it is added here on purpose.
 */
export function toRendererConfig(config: OstlerConfig): RendererConfig {
  const { apiKey, ...ai } = config.ai
  const { github, email, ...rest } = config
  const { password, ...server } = email
  return {
    ...rest,
    projects: config.projects.map(toRendererProject),
    ai: { ...ai, hasApiKey: apiKey.length > 0, apiKeyHint: apiKey ? apiKey.slice(-4) : '' },
    github: { hasToken: Boolean(github?.token) },
    email: { ...server, hasPassword: password.length > 0 }
  }
}

/** A project without its automation token. */
export function toRendererProject(project: WatchedProject): RendererProject {
  const { automationToken, ...rest } = project
  return { ...rest, hasAutomationToken: Boolean(automationToken) }
}

/** A started session without its token. */
export function toRendererSession(session: HarnessSession): RendererHarnessSession {
  const { token, ...rest } = session
  void token
  return rest
}

/**
 * What main applies from a renderer `updateConfig`. Never the GitHub token
 * or the email server.
 * Projects change only
 * through their own calls, and an AI key arrives only when the human typed
 * one: a missing or empty `ai.apiKey` keeps the saved key (`clearAiApiKey`
 * removes it), since the renderer no longer has the key to send back.
 */
export function fromRendererConfigUpdate(updates: RendererConfigUpdate): OstlerConfigUpdate {
  // The GitHub token changes only through setGithubToken and clearGithubToken (R4.4).
  const { projects, ai, github, email, popOuts, stickyTasks, ...rest } =
    updates as OstlerConfigUpdate & { github?: unknown }
  void projects
  void github
  // So does the email server, through setEmailSettings and clearEmailSettings (MOP-4).
  void email
  // Pop-out windows (N5.8a) are kept by main's pop-out windows alone.
  void popOuts
  // So are sticky tasks (N5.8b), by main's sticky windows.
  void stickyTasks
  // The second place changes only through chooseBackupCopyFolder and stopBackupCopy (N6.1).
  if (rest.backups) {
    const { copyTo, lastCopiedAt, copyFailedAt, ...backups } = rest.backups
    void copyTo
    void lastCopiedAt
    void copyFailedAt
    rest.backups = backups
  }
  if (!ai) return rest
  const { apiKey, ...otherAi } = ai
  const keepKey = typeof apiKey !== 'string' || apiKey.trim() === ''
  return { ...rest, ai: keepKey ? otherAi : { ...otherAi, apiKey: apiKey.trim() } }
}

/**
 * What main applies from a renderer `updateProject`: never the id, a token or
 * the folder (which changes only through `linkProjectFolder` and
 * `unlinkProjectFolder`, where the agent-work rules are enforced).
 */
export function fromRendererProjectUpdate(updates: RendererProjectUpdate): Partial<WatchedProject> {
  const rest: Record<string, unknown> = { ...updates }
  for (const field of PROTECTED_PROJECT_FIELDS) delete rest[field]
  return rest as Partial<WatchedProject>
}

const PROTECTED_PROJECT_FIELDS = ['id', 'path', 'automationToken', 'hasAutomationToken', 'demo']
