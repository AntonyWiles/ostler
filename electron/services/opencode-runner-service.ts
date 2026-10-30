import { formatReviewCommentsForAgent, latestReviewComments } from '@shared/review-comments'
import { createServer as createNetServer } from 'net'
import {
  createServer as createHttpServer,
  IncomingMessage,
  ServerResponse,
  Server as HttpServer
} from 'http'
import { randomBytes } from 'crypto'
import { Agent } from 'undici'
import * as path from 'path'
import { execFile, spawn } from 'child_process'
import { respondJson } from './loopback-http'
import { reportHasBlockers } from './harness/report-rules'
import { stopWorkspaceProcesses } from './harness/workspace-processes'
import {
  inheritableEnvironment,
  prepareSlotEnvironment,
  slotBaseEnvironment,
  slotRuntimeHome
} from './harness/slot-environment'
import {
  readFileSync,
  appendFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  statSync,
  openSync,
  rmSync
} from 'fs'
import type {
  AgentRunRecordOutcome,
  HarnessGuidance,
  HarnessPlan,
  HarnessQuestion,
  HarnessSession,
  HarnessTask,
  HarnessReviewOf,
  HarnessTaskReport,
  OstlerConfig,
  SessionTranscriptEntry,
  WatchedProject,
  WorkspaceSetupRecord
} from '@shared/ostler-api'
import type { HarnessService } from './harness-service'
import { GuidanceRefusal } from './harness/guidance'
import { agentLimitMessage } from '@shared/agent-run-history'
import { t } from '@shared/i18n'
import { isSandboxSupported } from './sandbox-service'
import { getRuntimeApiKey } from './runtime-credentials'
import { logAiCall } from './ai-call-logger'
import {
  generateOstlerPluginJs,
  generateOstlerAskQuestionToolTs,
  generateOstlerCompleteTaskToolTs,
  generateOstlerAgentInstructionsMd,
  generateOstlerSubmitPlanToolTs
} from './opencode/ostler-plugin-template'
import { PLAN_FIRST_AVAILABLE, PLAN_FIRST_EMBEDDED_PROMPT } from '@shared/plan-first'
import { REVIEWER_RUNS_AVAILABLE } from '@shared/reviewer-runs'
import { PROJECT_CONVENTIONS_FILE, resolveProjectConventions } from './project-conventions'
import {
  TASK_ATTACHMENTS_FILE,
  generateTaskAttachmentsMd,
  materializeTaskAttachments,
  taskAttachmentsDir,
  type TaskAttachmentReader
} from './opencode/task-attachments'
import {
  CUSTOM_PROVIDER_API_KEY_ENV,
  CUSTOM_PROVIDER_ID,
  PROVIDER_ENV_VAR,
  openCodeProviderConfig,
  resolveOpenCodeTarget,
  slotPermissions
} from './opencode/slot-config'
import {
  TOOL_CALL_RATE_WINDOW_MS,
  bridgeRoute,
  readJsonBody,
  type BridgeHost
} from './opencode/bridge-routes'
import type {
  PendingQuestion,
  RunningEmbeddedSession,
  SessionOutcomeSubject
} from './opencode/running-session'

/**
 * Phase 2 (H2) embedded-session runner: owns the lifecycle of one opencode
 * `serve` process launched inside a session's already-provisioned worktree
 * slot, at normal (Medium) integrity -- see the `launch` doc comment on
 * `OpenCodeRunnerDeps` below for why this is no longer Low-IL sandboxed.
 *
 * Provides an event-driven plugin bridge via a loopback HTTP server:
 * 1. Session/task lifecycle events: hooks opencode's `session.status`,
 *    `session.idle`, `session.error`, `session.updated` events.
 * 2. File-presence tracking: hooks `file.edited` events and calls
 *    `HarnessService.setFilePresence`.
 * 3. Defense-in-depth path validation: hooks `tool.execute.before` to ensure
 *    file tools operate strictly inside the session workspace slot.
 * 4. Question bridge: registers `ostler_ask_question` tool and bridges questions
 *    to `HarnessService.askQuestion` / `answerQuestion`, blocking until human input.
 */

export const OPENCODE_VERSION = '1.18.23'

/**
 * How far a failed embedded run got. `start()` only settles when the whole run
 * is over, so without this every failure -- including a turn that blew the
 * `sendMessageTimeoutMs` after an hour of real work -- was reported
 * to the human as "failed to start".
 */
export type EmbeddedRunPhase = 'start' | 'run'

const RUN_PHASE_KEY = '__ostlerRunPhase'

export function markEmbeddedRunPhase(error: unknown, phase: EmbeddedRunPhase): void {
  if (error && typeof error === 'object') {
    ;(error as Record<string, unknown>)[RUN_PHASE_KEY] = phase
  }
}

export function embeddedRunPhase(error: unknown): EmbeddedRunPhase {
  const phase =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)[RUN_PHASE_KEY]
      : undefined
  return phase === 'run' ? 'run' : 'start'
}

/** The note a human sees when an embedded run fails, honest about which phase failed. */
export function embeddedFailureNote(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return embeddedRunPhase(error) === 'run'
    ? `Embedded opencode session stopped before it finished: ${message}. Work already done is left in the workspace for review.`
    : `Embedded opencode session failed to start: ${message}`
}

export interface OpenCodeLaunchHandle {
  pid: number
  port: number
  password: string
  openCodeSessionId: string
}

export interface OpenCodeProcessLaunchOptions {
  /** Optional diagnostic file to redirect the child's stdout/stderr into. */
  outputPath?: string
  /** Per-child environment overrides. */
  environment?: Readonly<Record<string, string>>
}

export interface OpenCodeProcessLaunchResult {
  pid: number
}

export interface OpenCodeRunnerDeps {
  /**
   * Defaults to a normal (Medium-integrity) child process launch. Overridable
   * so tests never spawn a real process.
   *
   * Embedded sessions previously launched at Windows Low Integrity as an
   * OS-enforced write boundary (see `sandbox-service.ts`), but Git Bash's
   * MSYS2 runtime cannot run under Low Integrity at all -- it fails creating
   * a required shared-memory object with an Access Denied
   * (`NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0...)`), which broke
   * every bash-tool call an embedded agent made, including `git commit`.
   * Confirmed via a real agent transcript, and a targeted fix (pre-warming
   * that object at Medium integrity first) was implemented and tested
   * directly against the failure -- it did not help. Low Integrity is now
   * deliberately not used for embedded sessions; there is currently no
   * OS-enforced write boundary keeping an embedded agent inside its own
   * worktree, only the isolated git worktree itself and the plugin's
   * defense-in-depth path validation (`slot-path-check.ts`), which is
   * advisory, not OS-enforced. Accepted knowingly by the project owner
   * 2026-08-28 in exchange for embedded agents actually being able to use
   * git; see docs/architecture-decisions/002-embedded-agent-sessions.md.
   */
  launch: (
    command: string,
    args: readonly string[],
    cwd: string,
    options?: OpenCodeProcessLaunchOptions
  ) => Promise<OpenCodeProcessLaunchResult>
  /** Defaults to the global fetch. Overridable for tests. */
  fetchImpl: typeof fetch
  /** Defaults to resolving the vendored opencode-ai package. Overridable for tests. */
  resolveBinary: () => string
  /** Defaults to `taskkill /pid <pid> /f` on Windows. Overridable for tests. */
  killProcess: (pid: number) => Promise<void>
  /** Stops anything still running out of a workspace (e.g. a detached dev server). Overridable for tests. */
  stopWorkspaceProcesses: (dir: string) => Promise<unknown>
  /** Defaults to binding an ephemeral TCP port via Node's net module. */
  choosePort: () => Promise<number>
  pollIntervalMs: number
  /** How soon a running session's transcript change is saved, so a crash does not lose it. */
  transcriptSaveIntervalMs: number
  /** How many consecutive stable (no new assistant activity) polls before a session is treated as idle/complete. */
  idleStablePolls: number
  maxPolls: number
  healthCheckTimeoutMs: number
  /** Budget for near-instant admin calls (list messages, etc). */
  requestTimeoutMs: number
  /** Budget for creating the opencode session. Longer than requestTimeoutMs: on a slot that has never run a CUSTOM_PROVIDER_ID session before, opencode installs that provider's ai-sdk adapter package (and its dependency tree) on first use, which this call blocks on -- observed taking 10-15s cold vs under 100ms once a slot's already warm. */
  createSessionTimeoutMs: number
  /** Budget for accepting the first task message, longer since opencode may still be warming up its provider connection. */
  sendMessageTimeoutMs: number
  /** Maximum tool calls allowed within any rolling 60-second window before stopping session for human review. */
  maxToolCallsPerMinute?: number
  /**
   * The Library, for copying a task's work item attachments into the slot's
   * runtime home. Without it a session simply starts with none.
   */
  taskAttachments?: TaskAttachmentReader
  /**
   * Lifetime tool-call ceiling for one embedded session, independent of the
   * per-minute rate. A weak model can grind well under the rate limit forever
   * and never trip it; this bounds the total spend of a session that is simply
   * not converging.
   */
  maxToolCallsPerSession: number
  /**
   * How many times the same tool may be called with identical arguments before
   * Ostler refuses that one call and tells the agent it is repeating itself.
   *
   * This is the cheap intervention that was missing between "fine" and "torn
   * down for review": re-reading the same file or retrying the same failing
   * edit is the most common weak-model loop, and it costs a workspace slot if
   * the only available response is killing the session.
   */
  repeatedToolCallLimit: number
  /**
   * How many times Ostler will nudge an agent that went idle without finishing
   * before giving up and recording the session as unfinished.
   *
   * A weak model's characteristic failure is stopping early -- reading a few
   * files, narrating a plan, and going quiet -- and one message is all it takes
   * to get it moving again. Bounded, because a model that ignores two nudges is
   * not going to be argued into competence by a third.
   */
  maxContinuationNudges: number
  /**
   * How long an `ostler_ask_question` call waits for a human before the tool
   * returns unanswered. Must stay well under `sendMessageTimeoutMs`: a question
   * that outlives the turn kills the whole session with its work uncommitted,
   * and the human's eventual answer arrives to a dead process.
   */
  questionTimeoutMs: number
  /**
   * Plan first (N9.3a): how long one `ostler_submit_plan` call waits for the
   * person before it answers that the plan still awaits approval, and the
   * agent calls again. Not a timeout into proceeding: a plan never proceeds
   * without the person. The wait does not count against the turn's budget.
   */
  planWaitMs: number
  /** How often a plan wait reads the harness state for the person's decision. */
  planPollMs: number
  /**
   * The stall watchdog: Ostler's defence against an agent runtime that never
   * returns.
   *
   * opencode's shell tool can hang for good on Windows: its own timeout kills
   * the shell but keeps waiting on the pipe (anomalyco/opencode#49169), so a
   * command with `timeout: 180000` once sat for 14 minutes with no process
   * left behind it, until `sendMessageTimeoutMs` killed the whole session and
   * stranded its finished work. Ostler never trusts the runtime to return:
   * every `stallCheckIntervalMs` it checks for a tool call past its own declared
   * timeout plus `toolStallGraceMs` (or `toolStallDefaultMs` when it declared
   * none), or for `noProgressStallMs` with no sign of life at all. It then
   * aborts the stuck call and nudges the agent on. If the session shows no
   * life within `toolStallGraceMs` of the abort, or stalls more than
   * `maxStallAborts` times, it is ended for review with its work rescued.
   */
  stallCheckIntervalMs: number
  toolStallGraceMs: number
  toolStallDefaultMs: number
  noProgressStallMs: number
  maxStallAborts: number
  /**
   * Dispatcher for the one request that stays open for a whole agent turn.
   *
   * opencode holds the response to POST /session/:id/message until the turn
   * finishes, so no headers arrive until then. undici's default headersTimeout
   * is 300s, which silently capped sendMessageTimeoutMs and killed any turn
   * running longer than five minutes with UND_ERR_HEADERS_TIMEOUT -- mid-edit,
   * before the agent could commit. Disabling the header/body timeouts leaves
   * sendMessageTimeoutMs as the only budget, which is the intent.
   */
  longTurnDispatcher?: unknown
}

/** See the `launch` doc comment on `OpenCodeRunnerDeps` for why this replaced the Low-Integrity launcher. */
async function defaultLaunch(
  command: string,
  args: readonly string[],
  cwd: string,
  options: OpenCodeProcessLaunchOptions = {}
): Promise<OpenCodeProcessLaunchResult> {
  const output = options.outputPath ? openSync(options.outputPath, 'a') : 'ignore'
  const child = spawn(command, args, {
    cwd,
    env: { ...inheritableEnvironment(), ...options.environment },
    stdio: ['ignore', output, output],
    windowsHide: true
  })
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    // 'spawn' fires once the OS has actually created the process and its pid
    // is valid; resolving on it (rather than synchronously on child.pid)
    // avoids a race with a caller using that pid before the process exists.
    child.once('spawn', () => {
      if (!child.pid) {
        reject(new Error('Process spawned without a pid'))
        return
      }
      resolvePromise({ pid: child.pid })
    })
  })
}

/** The bundled agent runtime (opencode) this build ships with. */
export function defaultResolveBinary(): string {
  const pkgPath = require.resolve('opencode-ai/package.json')
  const pkgDir = path.dirname(pkgPath)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin?: Record<string, string> }
  const binRelative = pkg.bin?.opencode ?? './bin/opencode.exe'
  return path.resolve(pkgDir, binRelative)
}

async function defaultKillProcess(pid: number): Promise<void> {
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
    return
  }
  await new Promise<void>((resolve) => {
    execFile('taskkill', ['/pid', String(pid), '/t', '/f'], () => resolve())
  })
}

async function defaultChoosePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('Could not determine an ephemeral port'))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
  })
}

/** See `longTurnDispatcher` on OpenCodeRunnerDeps for why this exists. */
const defaultLongTurnDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 })

export const DEFAULT_OPENCODE_RUNNER_DEPS: OpenCodeRunnerDeps = {
  launch: defaultLaunch,
  longTurnDispatcher: defaultLongTurnDispatcher,
  fetchImpl: fetch,
  resolveBinary: defaultResolveBinary,
  killProcess: defaultKillProcess,
  stopWorkspaceProcesses,
  choosePort: defaultChoosePort,
  pollIntervalMs: 5000,
  transcriptSaveIntervalMs: 10_000,
  idleStablePolls: 3,
  maxPolls: 240, // ~20 minutes at the default interval
  healthCheckTimeoutMs: 20000,
  requestTimeoutMs: 15000,
  createSessionTimeoutMs: 60000,
  // A ceiling on one message's whole agent loop, not a stall detector: the
  // stall watchdog below catches a hung call within minutes, so this only has
  // to stop a session that keeps working without ever converging.
  sendMessageTimeoutMs: 30 * 60 * 1000,
  maxToolCallsPerMinute: 50,
  maxToolCallsPerSession: 600,
  repeatedToolCallLimit: 3,
  maxContinuationNudges: 2,
  // Ten minutes: long enough for a human to notice the question in the UI,
  // comfortably inside the turn budget so the session survives it.
  questionTimeoutMs: 10 * 60 * 1000,
  planWaitMs: 5 * 60 * 1000,
  planPollMs: 2000,
  stallCheckIntervalMs: 30_000,
  toolStallGraceMs: 60_000,
  toolStallDefaultMs: 4 * 60_000,
  noProgressStallMs: 10 * 60_000,
  maxStallAborts: 2
}

/** The message of an opencode message/session error, or null when there is none. */
function providerErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const { name, data } = error as { name?: string; data?: { message?: unknown } }
  // A turn Ostler aborted itself (the stall watchdog) is not a provider failure.
  if (name === 'MessageAbortedError') return null
  const message = typeof data?.message === 'string' ? data.message.trim() : ''
  return message || name || 'unknown provider error'
}

/**
 * The opening message for an embedded session: this task's scope, and the
 * workspace it happens in.
 *
 * Deliberately narrow. The durable behavioral contract -- commit discipline,
 * what "done" means, what to do when blocked, the workspace boundary rules --
 * lives in OSTLER_AGENT_INSTRUCTIONS.md, which opencode loads on every turn.
 * Restating it here too would only be a second copy to drift out of sync, and
 * durable behavior belongs in the harness rather than in the prompt.
 */
/**
 * The opening prompt of an embedded run: the task, its details, then the line
 * comments the person left when they last sent it back (N9.2a).
 */
export function buildTaskPrompt(
  task: HarnessTask,
  workspace: { baseBranch: string; baseCommit: string } | null
): string {
  if (REVIEWER_RUNS_AVAILABLE && task.reviewOf) return buildReviewPrompt(task, task.reviewOf)
  return [
    `Task: ${task.title}`,
    task.details ? `Details:\n${task.details}` : '',
    formatReviewCommentsForAgent(latestReviewComments(task.rejections)),
    '',
    'This is an Ostler-embedded agent session. Your operating instructions are loaded as context (OSTLER_AGENT_INSTRUCTIONS.md) -- follow them.',
    workspace
      ? `You are already in your isolated workspace, on your own branch forked from ${workspace.baseBranch} at ${workspace.baseCommit}. Do all work here.`
      : '',
    '',
    PLAN_FIRST_AVAILABLE && task.planFirst
      ? `${PLAN_FIRST_EMBEDDED_PROMPT} Once it is approved, work this task to completion, commit your changes, then call ostler_complete_task as your final action.`
      : 'Start now. Work this task to completion, commit your changes, then call ostler_complete_task as your final action.'
  ]
    .filter(Boolean)
    .join('\n')
}

/** The opening prompt of a review run (N9.5a): what to review, and how. */
function buildReviewPrompt(task: HarnessTask, reviewOf: HarnessReviewOf): string {
  return [
    `Task: ${task.title}`,
    task.details ? `Details:\n${task.details}` : '',
    '',
    'This is an Ostler-embedded agent session. Your operating instructions are loaded as context (OSTLER_AGENT_INSTRUCTIONS.md) -- follow them.',
    `You are in a throwaway copy detached at ${reviewOf.headCommit}, the last commit of the change you review. Read the change with \`git diff ${reviewOf.baseCommit}..${reviewOf.headCommit}\`. Ostler refuses file-editing tools in a review run.`,
    '',
    'Start now. Review the change and change nothing, then call ostler_complete_task with your summary, an empty filesChanged and your findings as your final action.'
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * An assistant message's tokens from an opencode event, or null. opencode
 * reports `info.tokens` (input, output, reasoning, cache) on each message;
 * reasoning is billed as output.
 */
export function assistantMessageTokens(
  properties: Record<string, unknown> | undefined
): { id: string; input: number; output: number } | null {
  const info = properties?.info as
    | {
        id?: unknown
        role?: unknown
        tokens?: { input?: unknown; output?: unknown; reasoning?: unknown }
      }
    | undefined
  if (!info || info.role !== 'assistant' || typeof info.id !== 'string' || !info.tokens) return null
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
  return {
    id: info.id,
    input: number(info.tokens.input),
    output: number(info.tokens.output) + number(info.tokens.reasoning)
  }
}

/**
 * A message from the person as the embedded agent sees it: labelled as theirs
 * and as guidance, so it is never mistaken for Ostler's own automated nudges.
 * How to treat it is in OSTLER_AGENT_INSTRUCTIONS.md, not here.
 */
export function embeddedGuidanceMessage(guidance: HarnessGuidance): string {
  return `[Guidance from ${guidance.from}, the person you are working for, sent through Ostler]\n${guidance.text}`
}

interface OpenCodeMessage {
  role?: string
  /** Milliseconds, or `{ created }` in the versions that nest message metadata. */
  time?: number | { created?: number; start?: number }
  info?: OpenCodeMessage
  parts?: { type?: string; text?: string }[]
}

/** The message's own clock, in whichever shape this opencode build reports it. */
function openCodeMessageTime(message: OpenCodeMessage): string {
  const raw = message.time
  const millis =
    typeof raw === 'number'
      ? raw
      : typeof raw?.created === 'number'
        ? raw.created
        : typeof raw?.start === 'number'
          ? raw.start
          : null
  return new Date(millis ?? Date.now()).toISOString()
}

/**
 * Removes tool directories written by earlier Ostler builds. They used a plural
 * `tools` name that opencode never scans, so the files were dead weight that
 * made a broken injection look like a working one on disk.
 */
function removeLegacyToolDirs(slotPath: string): string[] {
  const removed: string[] = []
  for (const dir of [
    path.join(slotRuntimeHome(slotPath), 'tools'),
    path.join(slotPath, '.opencode', 'tools')
  ]) {
    if (!existsSync(dir)) continue
    try {
      rmSync(dir, { recursive: true, force: true })
      removed.push(dir)
    } catch {
      // A stale directory is inert; never fail a launch over cleanup.
    }
  }
  return removed
}

/**
 * The runner's slot environment: the shared, non-secret base (see
 * `slot-environment.ts`) plus the server password. The runner adds its
 * provider key and bridge secrets on top; setup never sees any of them.
 */
function buildSlotEnvironment(slotPath: string, password: string): Record<string, string> {
  return {
    ...slotBaseEnvironment(slotPath),
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_SERVER_USERNAME: 'ostler'
  }
}

/**
 * Appends Ostler-owned scratch paths (.opencode, .ostler-opencode-home) to Git exclude
 * so they are never detected by git status or committed into project history.
 */
function excludeOstlerPathsFromGit(slotPath: string): void {
  try {
    const gitPath = path.join(slotPath, '.git')
    let infoExcludePath: string | null = null
    if (existsSync(gitPath)) {
      const stat = statSync(gitPath)
      if (stat.isDirectory()) {
        infoExcludePath = path.join(gitPath, 'info', 'exclude')
      } else if (stat.isFile()) {
        const content = readFileSync(gitPath, 'utf8')
        const match = content.match(/^gitdir:\s*(.+)$/m)
        if (match && match[1]) {
          const resolvedGitDir = path.isAbsolute(match[1].trim())
            ? match[1].trim()
            : path.resolve(slotPath, match[1].trim())
          infoExcludePath = path.join(resolvedGitDir, 'info', 'exclude')
        }
      }
    }
    if (infoExcludePath) {
      mkdirSync(path.dirname(infoExcludePath), { recursive: true })
      const existing = existsSync(infoExcludePath) ? readFileSync(infoExcludePath, 'utf8') : ''
      const additions: string[] = []
      if (!existing.includes('.opencode')) additions.push('.opencode')
      if (!existing.includes('.ostler-opencode-home')) additions.push('.ostler-opencode-home')
      if (additions.length > 0) {
        appendFileSync(
          infoExcludePath,
          `\n# Ostler scratch paths\n${additions.join('\n')}\n`,
          'utf8'
        )
      }
    }
  } catch {
    // Best-effort git exclusion hygiene
  }
}

export class OpenCodeRunnerService {
  private readonly deps: OpenCodeRunnerDeps
  private readonly running = new Map<string, RunningEmbeddedSession>()
  private readonly pendingQuestions = new Map<string, PendingQuestion>()
  /** What Ostler itself recorded: tool calls and results, the task prompt, questions, answers, security blocks. */
  private readonly liveTranscripts = new Map<string, SessionTranscriptEntry[]>()
  /** Pending snapshot saves of a running session's transcript (see scheduleTranscriptSave). */
  private readonly transcriptSaveTimers = new Map<string, NodeJS.Timeout>()
  /** Last view of the agent's own messages, read from opencode. Kept apart from the map above so a poll can never rewrite or drop what Ostler recorded. */
  private readonly openCodeTranscripts = new Map<string, SessionTranscriptEntry[]>()
  private bridgeServer: HttpServer | null = null
  private bridgePort: number | null = null
  /** What the bridge routes (opencode/bridge-routes.ts) may use of this runner. */
  private readonly bridgeHost: BridgeHost

  constructor(
    private readonly harnessService: HarnessService,
    private readonly getConfig: () => OstlerConfig,
    private readonly dataDir: string,
    deps: Partial<OpenCodeRunnerDeps> = {}
  ) {
    this.deps = { ...DEFAULT_OPENCODE_RUNNER_DEPS, ...deps }
    this.bridgeHost = {
      harnessService,
      deps: this.deps,
      pendingQuestions: this.pendingQuestions,
      log: (message) => this.log(message),
      recordTranscript: (sessionId, entry) => this.recordTranscript(sessionId, entry),
      syncSessionRuntimeStats: (running, overrides) =>
        this.syncSessionRuntimeStats(running, overrides),
      stopForRateLimit: (running, respond, capDescription) =>
        this.stopForRateLimit(running, respond, capDescription),
      abortTurnForLimit: (running) => this.abortTurnForLimit(running),
      handlePluginEvent: (running, event) => this.handlePluginEvent(running, event),
      waitForPlanDecision: (running, version) => this.waitForPlanDecision(running, version)
    }
  }

  /** Where one session's opencode process writes its own stdout/stderr. */
  private openCodeServerLogPath(sessionId: string): string {
    return path.join(this.dataDir, 'logs', 'opencode', `${sessionId}.log`)
  }

  /**
   * The tail of that log, which is where opencode puts the detail behind an
   * `UnknownError` its HTTP response only refers to by id.
   */
  private readOpenCodeServerLog(sessionId: string, maxChars = 4000): string | null {
    try {
      const contents = readFileSync(this.openCodeServerLogPath(sessionId), 'utf8').trim()
      if (!contents) return null
      return contents.length > maxChars ? `…${contents.slice(-maxChars)}` : contents
    } catch {
      return null
    }
  }

  private log(message: string): void {
    try {
      const logDirectory = path.join(this.dataDir, 'logs')
      mkdirSync(logDirectory, { recursive: true })
      appendFileSync(
        path.join(logDirectory, 'opencode-runner.log'),
        `[${new Date().toISOString()}] ${message}\n`,
        'utf8'
      )
    } catch {
      // Best-effort diagnostics only; never let logging fail a launch.
    }
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId)
  }

  private recordTranscript(sessionId: string, entry: SessionTranscriptEntry): void {
    const list = this.liveTranscripts.get(sessionId) ?? []
    list.push(entry)
    if (list.length > 400) {
      list.splice(0, list.length - 400)
    }
    this.liveTranscripts.set(sessionId, list)
    this.scheduleTranscriptSave(sessionId)
  }

  /**
   * Saves a running session's transcript within `transcriptSaveIntervalMs` of
   * a change. It used to be saved only when the session ended, so an Ostler
   * crash lost the whole history of the session it interrupted -- exactly
   * the one someone then needs to read.
   */
  private scheduleTranscriptSave(sessionId: string): void {
    if (this.transcriptSaveTimers.has(sessionId)) return
    const timer = setTimeout(() => {
      this.transcriptSaveTimers.delete(sessionId)
      const running = this.running.get(sessionId)
      if (running && !running.stopped) this.persistLiveTranscript(running)
    }, this.deps.transcriptSaveIntervalMs)
    timer.unref?.()
    this.transcriptSaveTimers.set(sessionId, timer)
  }

  /** Everything known about a session, in the order it happened. */
  private mergedTranscript(sessionId: string): SessionTranscriptEntry[] {
    const live = this.liveTranscripts.get(sessionId) ?? []
    // Ostler records every message it sends (the task, each nudge) as it sends
    // it, and opencode then lists the same message back as a user message. Keep
    // Ostler's copy only, or every prompt reads twice in the transcript.
    const sentByOstler = new Set(
      live.filter((entry) => entry.role === 'user').map((entry) => entry.content.trim())
    )
    const fromOpenCode = (this.openCodeTranscripts.get(sessionId) ?? []).filter(
      (entry) => entry.role !== 'user' || !sentByOstler.has(entry.content.trim())
    )
    return [...fromOpenCode, ...live].sort(
      (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)
    )
  }

  async getLiveTranscript(sessionId: string): Promise<SessionTranscriptEntry[] | null> {
    const running = this.running.get(sessionId)
    if (running) {
      try {
        const baseUrl = `http://127.0.0.1:${running.port}`
        const authHeader = `Basic ${Buffer.from(`ostler:${running.password}`).toString('base64')}`
        const response = await this.deps.fetchImpl(
          `${baseUrl}/session/${running.openCodeSessionId}/message`,
          {
            headers: { Authorization: authHeader },
            signal: AbortSignal.timeout(Math.min(2000, this.deps.requestTimeoutMs))
          }
        )
        if (response.ok) {
          const messages = (await response.json()) as OpenCodeMessage[]
          if (Array.isArray(messages) && messages.length > 0) {
            const previous = this.openCodeTranscripts.get(sessionId) ?? []
            const entries: SessionTranscriptEntry[] = []
            for (const message of messages) {
              // opencode nests the message under `info` in some versions and
              // returns it flat in others; read either shape.
              const info = (message?.info ?? message) as OpenCodeMessage
              const parts = Array.isArray(message?.parts)
                ? message.parts
                : Array.isArray(info.parts)
                  ? info.parts
                  : []
              const text = parts
                .filter((part) => part && typeof part.text === 'string' && part.text.trim())
                .map((part) => part.text)
                .join('\n\n')
              if (!text.trim()) continue
              entries.push({
                role:
                  info.role === 'user'
                    ? 'user'
                    : info.role === 'assistant'
                      ? 'assistant'
                      : 'system',
                content: text,
                // Reuse the timestamp this message already had. Re-dating every
                // message to "now" on each 1.5s poll pushed the conversation
                // below every tool line, and with auto-scroll pinned to the
                // bottom that is why tool calls looked like they were missing.
                timestamp: previous[entries.length]?.timestamp ?? openCodeMessageTime(info)
              })
            }
            if (entries.length > 0) {
              this.openCodeTranscripts.set(sessionId, entries)
              this.scheduleTranscriptSave(sessionId)
            }
            // Same proof, read from opencode's own message list rather than the
            // plugin bridge, so a session still counts as connected if the
            // bridge events are missed.
            const live = this.running.get(sessionId)
            if (live && entries.some((entry) => entry.role === 'assistant')) {
              live.modelResponded = true
            }
          }
        }
      } catch {
        // Best-effort live fetch; the last known view still stands.
      }
    }

    const merged = this.mergedTranscript(sessionId)
    return merged.length > 0 ? merged : null
  }

  /**
   * Starts the internal loopback HTTP bridge server if not already running.
   */
  async ensureBridgeServer(): Promise<number> {
    if (this.bridgeServer && this.bridgePort) {
      return this.bridgePort
    }

    return new Promise((resolve, reject) => {
      const server = createHttpServer((req, res) => {
        this.handleBridgeRequest(req, res).catch((err) => {
          this.log(`Bridge server error handling ${req.url}: ${String(err)}`)
          if (!res.headersSent) {
            respondJson(res, 500, { ok: false, error: String(err) })
          }
        })
      })

      server.unref()
      server.on('error', (err) => {
        this.log(`Bridge server failed to start: ${err.message}`)
        reject(err)
      })

      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          server.close()
          reject(new Error('Could not bind bridge server'))
          return
        }
        this.bridgeServer = server
        this.bridgePort = address.port
        this.log(`Bridge server listening on 127.0.0.1:${address.port}`)
        resolve(address.port)
      })
    })
  }

  private async handleBridgeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const authHeader = req.headers.authorization ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''

    if (req.method !== 'POST') {
      respondJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    let body: Record<string, unknown> = {}
    try {
      body = await readJsonBody(req)
    } catch {
      respondJson(res, 400, { ok: false, error: 'Invalid JSON body' })
      return
    }

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const running = this.running.get(sessionId)
    if (!running || running.bridgeSecret !== token) {
      respondJson(res, 401, { ok: false, error: 'Unauthorized bridge request' })
      return
    }

    // Every authenticated bridge call is the plugin reporting from inside a
    // live turn, which is exactly the sign of life the stall watchdog needs.
    this.markProgress(running)

    const route = bridgeRoute(url.pathname)
    if (!route) {
      respondJson(res, 404, { ok: false, error: 'Unknown bridge endpoint' })
      return
    }
    await route({
      host: this.bridgeHost,
      running,
      body,
      respond: (status, payload) => respondJson(res, status, payload)
    })
  }

  private async handlePluginEvent(
    running: RunningEmbeddedSession,
    event?: { id?: string; type?: string; properties?: Record<string, unknown> }
  ): Promise<void> {
    if (!event || !event.type) return

    this.log(`${running.sessionId}: received plugin event ${event.type}`)

    if (event.type === 'message.created' || event.type === 'message.updated') {
      running.turnCount += 1
      this.syncSessionRuntimeStats(running)
    }

    // Assistant output -- text or a part of it -- is the one unambiguous sign
    // that the model answered at all. Session lifecycle events (updated,
    // status, idle) all fire even when the request failed upstream, so they
    // prove nothing.
    const eventRole = (event.properties as { info?: { role?: string }; role?: string } | undefined)
      ?.info?.role
    // A provider failure arrives as an assistant message carrying `error` and
    // nothing else. Counting that as an answer recorded overloaded-backend
    // turns as an agent that read its task and quit -- nudged for it, then
    // abandoned with its task held.
    const messageError = providerErrorMessage(
      (event.properties as { info?: { error?: unknown } } | undefined)?.info?.error ??
        (event.type === 'session.error' ? event.properties?.error : undefined)
    )
    if (messageError) {
      if (running.providerError !== messageError) {
        this.log(`${running.sessionId}: model provider error: ${messageError}`)
      }
      running.providerError = messageError
    } else if (
      eventRole === 'assistant' &&
      (event.type === 'message.part.updated' ||
        event.type === 'message.updated' ||
        event.type === 'message.created')
    ) {
      running.modelResponded = true
      if (event.type === 'message.part.updated') running.providerError = null
    }

    // Token usage. opencode puts each assistant message's tokens on the
    // message itself; the run's usage is the sum over its messages (R5.3).
    const messageTokens = assistantMessageTokens(event.properties)
    if (messageTokens) {
      running.messageUsage.set(messageTokens.id, messageTokens)
      let input = 0
      let output = 0
      for (const counted of running.messageUsage.values()) {
        input += counted.input
        output += counted.output
      }
      running.usage = { inputTokens: input, outputTokens: output, totalTokens: input + output }
      this.syncSessionRuntimeStats(running)
      this.checkTokenLimit(running)
    } else {
      // Best-effort usage some providers put on the event instead.
      const usageObj = (event.properties?.usage || event.properties?.tokenUsage) as
        { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined
      if (usageObj && typeof usageObj === 'object') {
        running.usage = {
          inputTokens: usageObj.inputTokens ?? running.usage?.inputTokens,
          outputTokens: usageObj.outputTokens ?? running.usage?.outputTokens,
          totalTokens: usageObj.totalTokens ?? running.usage?.totalTokens
        }
        this.syncSessionRuntimeStats(running)
        this.checkTokenLimit(running)
      }
    }

    if (event.type === 'session.status') {
      const statusObj = event.properties?.status as { type?: string } | undefined
      const statusType = statusObj?.type
      if (statusType === 'busy') {
        this.harnessService.touchSessionConnection(running.project, running.sessionId)
      } else if (statusType === 'idle') {
        await this.finishOrDefer(running, 'went idle (event-driven)')
      }
      return
    }

    if (event.type === 'session.idle') {
      await this.finishOrDefer(running, 'went idle (event-driven)')
      return
    }

    if (event.type === 'session.error') {
      await this.finishOrDefer(running, 'encountered an error (event-driven)')
      return
    }

    // Which files an agent edits is read from its copy's changes at review.
    if (event.type === 'file.edited') return
  }

  /**
   * Plan first (N9.3a): holds an `ostler_submit_plan` call until the person
   * decides on this plan version, or `planWaitMs` passes, reading the harness
   * state so a decision made from any surface is seen. Returns the plan as it
   * then stands, or null once the session has ended or lost its plan.
   */
  private async waitForPlanDecision(
    running: RunningEmbeddedSession,
    version: number
  ): Promise<HarnessPlan | null> {
    const started = Date.now()
    running.planWaitStartedAt = started
    const read = (): HarnessPlan | null =>
      running.stopped
        ? null
        : this.harnessService.getSessionPlan(running.project, running.sessionId)
    try {
      for (;;) {
        const plan = read()
        if (!plan || plan.version !== version || plan.status !== 'pending') return plan
        const remaining = started + this.deps.planWaitMs - Date.now()
        if (remaining <= 0) return plan
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(this.deps.planPollMs, remaining))
        )
      }
    } finally {
      running.planWaitedMs = (running.planWaitedMs ?? 0) + (Date.now() - started)
      running.planWaitStartedAt = null
      this.markProgress(running)
    }
  }

  /**
   * Called when a question is answered in the Ostler UI/IPC handler. Unblocks any waiting agent.
   */
  onQuestionAnswered(question: HarnessQuestion): void {
    const pending = this.pendingQuestions.get(question.id)
    if (pending) {
      clearTimeout(pending.timer)
      this.pendingQuestions.delete(question.id)
      this.recordTranscript(question.sessionId, {
        role: 'user',
        content: `[Human Answer] ${question.answer ?? ''}`,
        timestamp: new Date().toISOString()
      })
      pending.resolve(question.answer ?? '')
    }
  }

  /**
   * Holds the run until the workspace is ready. Setup belongs to starting the
   * session, so the transcript shows what it is doing, and a setup that did
   * not succeed throws here, before opencode launches. The caller ends the
   * session with that message (`embeddedFailureNote`).
   */
  private async awaitWorkspaceSetup(
    project: WatchedProject,
    session: HarnessSession
  ): Promise<WorkspaceSetupRecord> {
    const pending = this.harnessService.getWorkspaceSetup(project, session.id)
    const at = () => new Date().toISOString()
    if (pending?.status === 'running' && pending.command) {
      this.recordTranscript(session.id, {
        role: 'system',
        content: `Installing dependencies (\`${pending.command}\`)…`,
        timestamp: at()
      })
    }
    const setup = await this.harnessService.waitForWorkspaceSetup(project, session.id)
    if (setup.status === 'skipped') return setup
    if (setup.status === 'succeeded') {
      const seconds =
        setup.startedAt && setup.finishedAt
          ? Math.round((Date.parse(setup.finishedAt) - Date.parse(setup.startedAt)) / 1000)
          : null
      this.recordTranscript(session.id, {
        role: 'system',
        content: seconds === null ? 'Dependencies installed.' : `Done in ${seconds} s`,
        timestamp: at()
      })
      return setup
    }
    const failure = setup.failure ?? `Workspace setup ${setup.status}`
    this.recordTranscript(session.id, { role: 'system', content: failure, timestamp: at() })
    throw new Error(failure)
  }

  /**
   * Starts the opencode process for an already-provisioned embedded
   * session (`HarnessService.startEmbeddedSessionForTask`), creates its
   * opencode session, injects the Ostler plugin and question tool, and sends
   * the task as the first message.
   */
  async start(project: WatchedProject, session: HarnessSession, task: HarnessTask): Promise<void> {
    if (!isSandboxSupported) {
      throw new Error('Embedded opencode sessions are currently only supported on Windows')
    }
    if (session.provenance !== 'embedded') {
      throw new Error(`Session ${session.id} is not an embedded session`)
    }
    if (!session.workspace) {
      throw new Error(`Session ${session.id} has no sandboxed workspace to run opencode in`)
    }
    if (this.running.has(session.id)) {
      throw new Error(`Session ${session.id} already has a running embedded runner`)
    }

    // Before anything is written or launched: no agent may act in a workspace
    // whose setup has not finished (see workspace-setup.ts).
    const workspaceSetup = await this.awaitWorkspaceSetup(project, session)

    const taskPrompt = buildTaskPrompt(task, session.workspace)
    this.recordTranscript(session.id, {
      role: 'user',
      content: taskPrompt,
      timestamp: new Date().toISOString()
    })

    const slotPath = session.workspace.worktreePath
    const binaryPath = this.deps.resolveBinary()
    const port = await this.deps.choosePort()
    const password = randomBytes(24).toString('hex')
    const bridgePort = await this.ensureBridgeServer()
    const bridgeSecret = randomBytes(24).toString('hex')

    const environment = buildSlotEnvironment(slotPath, password)
    environment.OSTLER_BRIDGE_PORT = String(bridgePort)
    environment.OSTLER_BRIDGE_SECRET = bridgeSecret
    environment.OSTLER_SESSION_ID = session.id
    environment.OSTLER_PROJECT_ID = project.id
    environment.OSTLER_SLOT_PATH = slotPath

    this.log(
      `${session.id}: resolved binary ${binaryPath}, chose port ${port}, bridgePort ${bridgePort}, slot ${slotPath}`
    )

    const config = this.getConfig()
    // The run's model is fixed here, at start (D42): a change to the task,
    // the project or Settings afterwards never reaches this run.
    const target = resolveOpenCodeTarget(config, project, task)

    // Inject Ostler Plugin and Question Tool into the slot
    try {
      const runtimeHome = slotRuntimeHome(slotPath)
      const pluginsDir = path.join(runtimeHome, 'plugins')
      const configDir = path.join(runtimeHome, 'config', 'opencode')
      // opencode only discovers custom tools in `<config>/opencode/tool` (singular);
      // anywhere else and the agent silently never sees ostler_ask_question or
      // ostler_complete_task, so completion reports come back missing.
      const toolsDir = path.join(configDir, 'tool')

      for (const stale of removeLegacyToolDirs(slotPath)) {
        this.log(`${session.id}: removed legacy tool directory ${stale}`)
      }

      mkdirSync(pluginsDir, { recursive: true })
      mkdirSync(toolsDir, { recursive: true })
      mkdirSync(configDir, { recursive: true })
      // Creates and labels the temp folder. Workspace setup runs it too, before
      // this point, so the folder is already in place for its installer.
      await prepareSlotEnvironment(slotPath, (message) => this.log(`${session.id}: ${message}`))

      const pluginFile = path.join(pluginsDir, 'ostler-plugin.js')
      const pluginContent = generateOstlerPluginJs(
        slotPath,
        bridgePort,
        bridgeSecret,
        session.id,
        project.id,
        taskAttachmentsDir(runtimeHome)
      )
      writeFileSync(pluginFile, pluginContent, 'utf8')

      const toolFile = path.join(toolsDir, 'ostler_ask_question.ts')
      const completionToolFile = path.join(toolsDir, 'ostler_complete_task.ts')
      const toolContent = generateOstlerAskQuestionToolTs(
        bridgePort,
        bridgeSecret,
        session.id,
        project.id
      )
      writeFileSync(toolFile, toolContent, 'utf8')
      writeFileSync(
        completionToolFile,
        generateOstlerCompleteTaskToolTs(bridgePort, bridgeSecret, session.id, project.id),
        'utf8'
      )
      // Plan first (N9.3a): the tool exists only while plans are available.
      const planToolFile = path.join(toolsDir, 'ostler_submit_plan.ts')
      if (PLAN_FIRST_AVAILABLE) {
        writeFileSync(
          planToolFile,
          generateOstlerSubmitPlanToolTs(bridgePort, bridgeSecret, session.id, project.id),
          'utf8'
        )
      } else {
        rmSync(planToolFile, { force: true })
      }

      // The standing operating contract, injected into the session's system
      // prompt rather than stated once in the opening message. A weak model
      // holds onto the commit/report/boundary rules far better when they sit in
      // the system prompt than when they scroll away behind a long transcript.
      //
      // `instructions` is a documented top-level opencode.json field (verified
      // against the vendored 1.18.23 binary, whose Instruction.systemPaths
      // explicitly branches on path.isAbsolute, so an absolute path like this
      // one resolves). Two consequences worth knowing:
      //  - Unknown top-level keys in opencode.json are rejected outright with
      //    ConfigInvalidError, so misspelling this key would take the whole
      //    config down with it -- including `plugin`, and with it the entire
      //    Ostler bridge. It fails loudly rather than silently, but it fails big.
      //  - It does not replace the project's own AGENTS.md/CLAUDE.md: opencode
      //    findUp's those from the worktree separately and merges both into the
      //    same set, so a watched project's agent instructions still apply.
      const instructionsFile = path.join(configDir, 'OSTLER_AGENT_INSTRUCTIONS.md')
      writeFileSync(
        instructionsFile,
        generateOstlerAgentInstructionsMd(
          slotPath,
          session.workspace.baseBranch,
          session.workspace.baseCommit,
          workspaceSetup
        ),
        'utf8'
      )

      // The task's library attachments: read-only copies in the runtime home
      // (never the worktree), indexed by their own instructions file. Their
      // content stays out of the task prompt and the standing instructions.
      // The index lives in the attachments folder itself, the one folder the
      // plugin lets read-only tools open, so an agent told to "see" it can.
      // Its own try: a failure here must never cost the session its opencode.json.
      const instructions = [instructionsFile.replace(/\\/g, '/')]

      // The project's conventions (D25): the same text an external agent's
      // claim carries, from the one resolver. Project context, not prompt text.
      const conventionsFile = path.join(configDir, PROJECT_CONVENTIONS_FILE)
      const conventions = resolveProjectConventions(project)
      if (conventions) {
        writeFileSync(conventionsFile, conventions, 'utf8')
        instructions.push(conventionsFile.replace(/\\/g, '/'))
      } else {
        rmSync(conventionsFile, { force: true })
      }

      try {
        // Older slots kept the index in the config folder; clear that copy.
        rmSync(path.join(configDir, TASK_ATTACHMENTS_FILE), { force: true })
        const attachmentsIndexFile = path.join(
          taskAttachmentsDir(runtimeHome),
          TASK_ATTACHMENTS_FILE
        )
        const delivered = this.deps.taskAttachments
          ? materializeTaskAttachments(
              this.deps.taskAttachments,
              project.id,
              task.planningWorkItemId,
              runtimeHome,
              (message) => this.log(`${session.id}: ${message}`)
            )
          : []
        if (delivered.length > 0) {
          writeFileSync(attachmentsIndexFile, generateTaskAttachmentsMd(delivered), 'utf8')
          instructions.push(attachmentsIndexFile.replace(/\\/g, '/'))
          this.harnessService.recordAttachmentsGiven(
            project,
            session.id,
            delivered.map((entry) => entry.given)
          )
          this.log(
            `${session.id}: gave ${delivered.length} attachment(s): ${delivered
              .map((entry) => `${entry.given.libraryItemId} r${entry.given.revision}`)
              .join(', ')}`
          )
        }
      } catch (error) {
        this.log(`${session.id}: warning: no attachments given: ${String(error)}`)
      }

      const opencodeConfig: Record<string, unknown> = {
        plugin: [pluginFile.replace(/\\/g, '/')],
        instructions,
        permission: slotPermissions(taskAttachmentsDir(runtimeHome))
      }
      const providerConfig = openCodeProviderConfig(target, config.ai.baseUrl)
      if (providerConfig) opencodeConfig.provider = providerConfig
      writeFileSync(
        path.join(configDir, 'opencode.json'),
        JSON.stringify(opencodeConfig, null, 2),
        'utf8'
      )

      excludeOstlerPathsFromGit(slotPath)
      this.log(`${session.id}: plugin and question tool injected into slot`)
    } catch (error) {
      this.log(`${session.id}: warning: failed to prepare slot plugin/tools: ${String(error)}`)
    }

    const providerEnvVar = PROVIDER_ENV_VAR[target.provider]
    const apiKey = getRuntimeApiKey(config)
    if (providerEnvVar && apiKey) {
      environment[providerEnvVar] = apiKey
    }
    if (target.providerID === CUSTOM_PROVIDER_ID && apiKey) {
      environment[CUSTOM_PROVIDER_API_KEY_ENV] = apiKey
    }
    this.log(
      `${session.id}: provider=${target.provider} providerID=${target.providerID} envVar=${providerEnvVar ?? (target.providerID === CUSTOM_PROVIDER_ID ? CUSTOM_PROVIDER_API_KEY_ENV : '(none)')} apiKeyPresent=${Boolean(apiKey)} projectOverride=${Boolean(project.autoDispatch?.aiOverrideEnabled)}`
    )

    // opencode's own stdout/stderr was thrown away, so when it answered a
    // request with `UnknownError ... Check server logs for details`, those
    // logs did not exist anywhere. Every embedded session that failed to send
    // its first message was therefore undiagnosable: HTTP 500 and nothing else.
    const serverLogPath = this.openCodeServerLogPath(session.id)
    try {
      mkdirSync(path.dirname(serverLogPath), { recursive: true })
    } catch {
      // Diagnostics only; never let a log directory fail a launch.
    }

    const { pid } = await this.deps.launch(
      binaryPath,
      ['serve', '--port', String(port), '--hostname', '127.0.0.1'],
      slotPath,
      { environment, outputPath: serverLogPath }
    )
    this.log(`${session.id}: launched opencode pid=${pid} (server log ${serverLogPath})`)

    const baseUrl = `http://127.0.0.1:${port}`
    const authHeader = `Basic ${Buffer.from(`ostler:${password}`).toString('base64')}`

    // Tracked outside the try so the catch block can tell a genuine startup
    // failure apart from a fetch rejection caused by stopForRateLimit()/stop()
    // killing this same process out from under an in-flight sendMessage().
    let runningRef: RunningEmbeddedSession | null = null

    try {
      this.log(`${session.id}: waiting for health at ${baseUrl}`)
      await this.waitForHealthy(baseUrl, authHeader)
      this.log(`${session.id}: healthy, creating opencode session`)
      const openCodeSessionId = await this.createOpenCodeSession(baseUrl, authHeader)
      this.log(`${session.id}: opencode session ${openCodeSessionId} created`)

      this.harnessService.setEmbeddedRuntime(project, session.id, {
        kind: 'opencode',
        version: OPENCODE_VERSION,
        processPort: port,
        openCodeSessionId,
        model: target.modelID,
        ...(target.effort ? { effort: target.effort } : {})
      })

      const config = this.getConfig()
      const maxToolCallsPerMinute =
        this.deps.maxToolCallsPerMinute ?? config.harness?.maxToolCallsPerMinute ?? 50

      const running: RunningEmbeddedSession = {
        project,
        target,
        sessionId: session.id,
        taskId: task.id,
        pid,
        port,
        password,
        openCodeSessionId,
        pollTimer: null,
        stopped: false,
        slotPath,
        bridgeSecret,
        toolCallCount: 0,
        toolCallTimestamps: [],
        lastToolCallFingerprint: null,
        consecutiveToolCallRepeats: 0,
        turnCount: 0,
        nudgePending: false,
        nudgeCount: 0,
        guidancePending: 0,
        modelResponded: false,
        lastProgressAt: Date.now(),
        toolInFlight: null,
        stallTimer: null,
        stallCheckRunning: false,
        stall: null,
        stallAborts: 0,
        abortRequestedAt: null,
        abortedForStall: false,
        stallNote: null,
        messageUsage: new Map(),
        limitStop: null,
        limitAbortAt: null,
        maxToolCallsPerMinute,
        initialMessagePending: true,
        deferredFinishReason: null
      }
      this.running.set(session.id, running)
      // The task message was recorded before the session was running, so a
      // save scheduled then may already have found nothing to save.
      this.scheduleTranscriptSave(session.id)
      runningRef = running
      this.startStallWatch(running)

      this.syncSessionRuntimeStats(running)

      this.log(
        `${session.id}: sending initial task message (providerID=${target.providerID}, modelID=${target.modelID})`
      )
      await this.sendMessage(baseUrl, authHeader, openCodeSessionId, taskPrompt, target, running)
      this.log(`${session.id}: initial task message accepted`)
      running.initialMessagePending = false

      if (running.deferredFinishReason) {
        // An idle/error event beat sendMessage()'s own response back, but
        // now we know the send genuinely succeeded -- honor it for real.
        await this.finish(running, running.deferredFinishReason)
        return
      }

      // Fallback polling safety net (events are primary)
      this.schedulePollWithCounters(running, 0, 0)
    } catch (error) {
      if (runningRef?.stopped) {
        // stopForRateLimit()/stop() already killed this same process out from
        // under our in-flight sendMessage(), which is exactly why it just
        // rejected. That stop already recorded the real outcome (cap
        // exceeded, manual stop, etc.) -- this fetch failure is not a new
        // failure and must not overwrite it with a misleading "failed to
        // start" note.
        this.log(
          `${session.id}: sendMessage rejected after an intentional stop (expected): ${
            error instanceof Error ? error.message : String(error)
          }`
        )
        return
      }
      const serverLog = this.readOpenCodeServerLog(session.id)
      this.log(
        `${session.id}: failed before completion, killing pid=${pid}: ${
          error instanceof Error ? (error.stack ?? error.message) : String(error)
        }${
          serverLog
            ? `
--- opencode server log (tail) ---
${serverLog}`
            : ''
        }`
      )
      if (serverLog) {
        // The provider's real complaint, in front of the human rather than in a
        // file they would have to know to look for.
        this.recordTranscript(session.id, {
          role: 'system',
          content: `[opencode server log]
${serverLog}`,
          timestamp: new Date().toISOString()
        })
      }
      // A deferred idle/error event turned out to be premature: the send
      // that supposedly finished never actually completed successfully.
      // Nothing was done -- don't let a stray deferred reason linger.
      // (running may not exist yet if the failure happened before it was
      // constructed, e.g. during waitForHealthy.)
      const maybeRunning = this.running.get(session.id)
      // A run that got this far had a live process driving it. Reporting that
      // as "failed to start" hid the real cause (a turn exceeding
      // `sendMessageTimeoutMs`) and sent reviewers looking at startup config
      // instead of at the work the agent had already done.
      markEmbeddedRunPhase(error, maybeRunning ? 'run' : 'start')
      if (maybeRunning) {
        maybeRunning.deferredFinishReason = null
        maybeRunning.initialMessagePending = false
        if (maybeRunning.abortedForStall || maybeRunning.limitStop) {
          // Ostler's own abort (a stall, or a token limit), surfacing as the
          // send failing. The process and the session are fine: finish()
          // puts the agent back to work, or ends a run past its limit.
          await this.finish(maybeRunning, 'stalled, and Ostler aborted the stuck call')
          return
        }
        if (maybeRunning.modelResponded) {
          // The agent did real work before this failed (typically the turn
          // budget running out). Killing it here used to leave that work
          // uncommitted in the slot, where merge refuses it and only a discard
          // can free the slot. End it the way a stop does instead: rescue,
          // assess, report, and leave it in review.
          await this.endSession(
            maybeRunning,
            embeddedFailureNote(error),
            error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'error'
          )
          return
        }
      }
      this.cleanupPendingQuestions(session.id)
      this.running.delete(session.id)
      await this.deps.killProcess(pid)
      await this.deps.stopWorkspaceProcesses(slotPath)
      throw error
    }
  }

  private syncSessionRuntimeStats(
    running: RunningEmbeddedSession,
    overrides?: Partial<import('@shared/ostler-api').HarnessEmbeddedRuntime>
  ): void {
    try {
      this.harnessService.setEmbeddedRuntime(running.project, running.sessionId, {
        kind: 'opencode',
        version: OPENCODE_VERSION,
        processPort: running.port,
        openCodeSessionId: running.openCodeSessionId,
        model: running.target.modelID,
        ...(running.target.effort ? { effort: running.target.effort } : {}),
        toolCallCount: running.toolCallCount,
        turnCount: running.turnCount,
        modelResponded: running.modelResponded,
        // Read from `running` like every other counter here, not passed in as a
        // one-off override: this method rebuilds the whole record each call, so
        // anything missing from this object is erased by the next sync -- which
        // is exactly how the nudge count vanished by the time a human saw the
        // finished session.
        nudgeCount: running.nudgeCount,
        maxToolCallsPerMinute: running.maxToolCallsPerMinute,
        // Counted at sync time, not carried from the last tool call: a stalled
        // session used to go on reporting the rate it had when it froze.
        toolCallsInLastMinute: running.toolCallTimestamps.filter(
          (timestamp) => timestamp >= Date.now() - TOOL_CALL_RATE_WINDOW_MS
        ).length,
        lastProgressAt: new Date(running.lastProgressAt).toISOString(),
        ...(running.stall ? { stall: running.stall } : {}),
        stallAborts: running.stallAborts,
        usage: running.usage,
        ...overrides
      })
    } catch {
      // Best-effort runtime sync
    }
  }

  /** Records a sign of life, which also ends any stall the watchdog was tracking. */
  private markProgress(running: RunningEmbeddedSession): void {
    running.lastProgressAt = Date.now()
    running.abortRequestedAt = null
    if (running.stall) {
      this.log(`${running.sessionId}: moving again after a stall (${running.stall.reason})`)
      running.stall = null
      this.syncSessionRuntimeStats(running)
    }
  }

  private startStallWatch(running: RunningEmbeddedSession): void {
    running.stallTimer = setInterval(() => {
      if (running.stopped || this.running.get(running.sessionId) !== running) {
        if (running.stallTimer) clearInterval(running.stallTimer)
        running.stallTimer = null
        return
      }
      if (running.stallCheckRunning) return
      running.stallCheckRunning = true
      void this.checkForStall(running)
        .catch((error) => this.log(`${running.sessionId}: stall check failed: ${String(error)}`))
        .finally(() => {
          running.stallCheckRunning = false
        })
    }, this.deps.stallCheckIntervalMs)
    running.stallTimer.unref?.()
  }

  /** What is stuck, in words for the transcript and the agent, or null if nothing is. */
  private detectStall(running: RunningEmbeddedSession, now: number): string | null {
    const minutes = (ms: number): string => `${Math.round(ms / 60_000)} min`
    const tool = running.toolInFlight
    if (tool) {
      const elapsed = now - tool.startedAt
      const limit =
        (tool.declaredTimeoutMs ?? this.deps.toolStallDefaultMs) + this.deps.toolStallGraceMs
      if (elapsed < limit) return null
      return tool.declaredTimeoutMs !== null
        ? `the ${tool.tool} call has not returned after ${minutes(elapsed)}, although its own timeout was ${minutes(tool.declaredTimeoutMs)}`
        : `the ${tool.tool} call has not returned after ${minutes(elapsed)}`
    }
    const quiet = now - running.lastProgressAt
    return quiet >= this.deps.noProgressStallMs
      ? `no activity from the agent for ${minutes(quiet)}`
      : null
  }

  private async checkForStall(running: RunningEmbeddedSession): Promise<void> {
    // A question legitimately blocks the agent for as long as a human takes;
    // it has its own timeout.
    if (
      [...this.pendingQuestions.values()].some(
        (pending) => pending.sessionId === running.sessionId
      ) ||
      // So does a plan waiting on the person (N9.3a), with no timeout at all.
      (running.planWaitStartedAt ?? null) !== null
    ) {
      return
    }
    const now = Date.now()

    if (running.limitAbortAt !== null && running.limitStop) {
      // Asked to end the turn for the limit and still nothing: end the run
      // through the ordinary end path, which keeps its work.
      if (now - running.limitAbortAt >= this.deps.toolStallGraceMs) {
        await this.endSession(running, running.limitStop, 'limit')
      }
      return
    }

    if (running.abortRequestedAt !== null) {
      // markProgress() clears this, so still being set means not one sign of
      // life since the abort. opencode itself is wedged; nothing more will
      // come from this process.
      if (now - running.abortRequestedAt >= this.deps.toolStallGraceMs) {
        await this.endSession(
          running,
          `Stopped by Ostler: the agent stalled (${running.stallNote ?? 'no progress'}) and opencode did not respond to the abort.`,
          'stalled'
        )
      }
      return
    }

    const stall = this.detectStall(running, now)
    if (!stall) return
    if (running.stallAborts >= this.deps.maxStallAborts) {
      await this.endSession(
        running,
        `Stopped by Ostler: the agent stalled again (${stall}) after ${running.stallAborts} earlier recoveries.`,
        'stalled'
      )
      return
    }
    await this.abortStalledCall(running, stall)
  }

  /**
   * Interrupts the stuck turn. opencode ends it, the agent goes idle, and the
   * ordinary completion gate in finish() then nudges it back to work -- with
   * the work and the session's context intact, which is the whole point:
   * killing the session instead is what stranded finished work before.
   */
  private async abortStalledCall(running: RunningEmbeddedSession, stall: string): Promise<void> {
    running.stallAborts += 1
    running.stall = {
      since: new Date(running.toolInFlight?.startedAt ?? running.lastProgressAt).toISOString(),
      reason: stall
    }
    running.stallNote = stall
    running.abortedForStall = true
    running.abortRequestedAt = Date.now()
    // An aborted call never reports its result, so it must not be mistaken for
    // still running once the agent moves on.
    running.toolInFlight = null
    this.log(`${running.sessionId}: stall detected (${stall}); aborting the stuck call`)
    this.recordTranscript(running.sessionId, {
      role: 'system',
      content: `[Ostler] Stall detected: ${stall}. Ostler aborted the stuck call so the agent can carry on (stall ${running.stallAborts} of ${this.deps.maxStallAborts}).`,
      timestamp: new Date().toISOString()
    })
    this.syncSessionRuntimeStats(running)
    await this.requestTurnAbort(running)
  }

  /**
   * Stops a run once it crosses a token limit (D43). Never mid-call: with a
   * tool call in flight it waits for the result (see /tool-result), then ends
   * the turn the way the stall watchdog does, and finish() ends the run
   * through endSession, which sweeps its work onto its branch for review.
   */
  private checkTokenLimit(running: RunningEmbeddedSession): void {
    if (running.stopped || running.limitStop) return
    const project =
      this.getConfig().projects.find((candidate) => candidate.id === running.project.id) ??
      running.project
    let reached: ReturnType<HarnessService['reachedAgentLimit']>
    try {
      reached = this.harnessService.reachedAgentLimit(project)
    } catch (error) {
      this.log(`${running.sessionId}: could not read the token limits: ${String(error)}`)
      return
    }
    if (!reached) return
    running.limitStop = `Stopped by Ostler: ${agentLimitMessage(reached)}`
    this.log(`${running.sessionId}: token limit reached; stopping at the next turn boundary`)
    this.recordTranscript(running.sessionId, {
      role: 'system',
      content: `[Ostler] ${agentLimitMessage(reached)} The run stops at its next turn boundary and its work is kept for review.`,
      timestamp: new Date().toISOString()
    })
    if (!running.toolInFlight) void this.abortTurnForLimit(running)
  }

  /**
   * Ends the run's current turn for its limit. The turn ending surfaces as an
   * idle or a failed send, and finish() then ends the run.
   */
  private async abortTurnForLimit(running: RunningEmbeddedSession): Promise<void> {
    if (running.stopped || running.limitAbortAt !== null) return
    running.limitAbortAt = Date.now()
    await this.requestTurnAbort(running)
  }

  /** Asks opencode to end the session's current turn. */
  private async requestTurnAbort(running: RunningEmbeddedSession): Promise<void> {
    const baseUrl = `http://127.0.0.1:${running.port}`
    const authHeader = `Basic ${Buffer.from(`ostler:${running.password}`).toString('base64')}`
    try {
      const response = await this.deps.fetchImpl(
        `${baseUrl}/session/${running.openCodeSessionId}/abort`,
        {
          method: 'POST',
          headers: { Authorization: authHeader },
          signal: AbortSignal.timeout(this.deps.requestTimeoutMs)
        }
      )
      if (!response.ok) this.log(`${running.sessionId}: abort answered HTTP ${response.status}`)
    } catch (error) {
      // Not fatal here: no sign of life within the grace period ends the
      // session through checkForStall() anyway.
      this.log(`${running.sessionId}: abort request failed: ${String(error)}`)
    }
  }

  private persistLiveTranscript(running: RunningEmbeddedSession): void {
    const pending = this.transcriptSaveTimers.get(running.sessionId)
    if (pending) {
      clearTimeout(pending)
      this.transcriptSaveTimers.delete(running.sessionId)
    }
    const entries = this.mergedTranscript(running.sessionId)
    if (entries && entries.length > 0) {
      try {
        // Ostler recorded these itself; the external-submission bound does not
        // apply, and truncating would keep only the start of a long session.
        this.harnessService.recordSessionTranscript(
          running.project,
          running.sessionId,
          entries,
          1000,
          // Each save is a full snapshot that supersedes the last.
          true
        )
      } catch {
        // Best-effort transcript persistence
      }
    }
  }

  private async stopForRateLimit(
    running: RunningEmbeddedSession,
    respond?: () => void,
    /** Overrides the note for a cap that is not the per-minute rate (e.g. the lifetime budget). */
    capDescription?: string
  ): Promise<void> {
    if (running.stopped) return
    running.stopped = true
    if (running.pollTimer) clearTimeout(running.pollTimer)
    this.cleanupPendingQuestions(running.sessionId)
    // A session cut off mid-loop is the likeliest of all to have uncommitted
    // edits, so rescue them here too rather than only on the clean-idle path.
    const rescueNote = await this.rescueUncommittedWork(running)
    const outcome = await this.assessOutcome(running)
    const completionReport = await this.buildCompletionReport(running, outcome)
    this.running.delete(running.sessionId)
    this.persistLiveTranscript(running)

    this.syncSessionRuntimeStats(running, {
      stoppedForReview: true,
      stopReason: 'tool_call_rate_exceeded'
    })

    const note = `Stopped for human review: ${
      capDescription ??
      `exceeded the tool-call rate limit of ${running.maxToolCallsPerMinute} calls/minute`
    }.${rescueNote ? ` ${rescueNote}.` : ''}`
    this.log(`${running.sessionId}: ${note}`)
    try {
      // Hitting the tool-call cap is not evidence the task was done: a session
      // that burned its budget without committing anything must not settle its
      // task complete.
      this.recordSessionOutcome(running, note, outcome, completionReport, 'stopped')
    } catch (error) {
      this.log(`${running.sessionId}: failed to record rate-limit stop: ${String(error)}`)
    } finally {
      respond?.()
      await this.endAgentProcesses(running)
    }
  }

  /**
   * Explicit stop, e.g. a human force-ending a stuck session from the UI, or
   * Ostler itself shutting down while a session was still running. Marks the
   * session done (same "stopped, needs review" outcome as hitting the
   * tool-call cap) so it lands in the review queue instead of silently
   * disappearing while its process is still alive but unmanaged.
   */
  async stop(sessionId: string, note = 'Stopped by request.'): Promise<void> {
    const running = this.running.get(sessionId)
    if (!running) return
    await this.endSession(running, note, 'manual')
  }

  /**
   * Ends a session that did not finish on its own -- a stop, a stall the
   * watchdog could not recover, a run that failed partway -- so that it lands
   * in review with its work committed rather than vanishing or stranding a
   * dirty slot.
   */
  private async endSession(
    running: RunningEmbeddedSession,
    note: string,
    stopReason: 'manual' | 'stalled' | 'timeout' | 'error' | 'limit'
  ): Promise<void> {
    if (running.stopped) return
    running.stopped = true
    if (running.pollTimer) clearTimeout(running.pollTimer)
    if (running.stallTimer) clearInterval(running.stallTimer)
    this.cleanupPendingQuestions(running.sessionId)
    const rescueNote = await this.rescueUncommittedWork(running)
    const outcome = await this.assessOutcome(running)
    const completionReport = await this.buildCompletionReport(running, outcome)
    this.running.delete(running.sessionId)
    this.persistLiveTranscript(running)
    this.syncSessionRuntimeStats(running, { stopReason })
    const fullNote = `${note}${rescueNote ? ` ${rescueNote}.` : ''}`
    this.log(`${running.sessionId}: ${fullNote}`)
    try {
      // Stopping an agent is not the same as it finishing: a session stopped
      // with nothing reported and nothing committed returns its task to the
      // queue rather than completing it.
      this.recordSessionOutcome(
        running,
        fullNote,
        outcome,
        completionReport,
        stopReason === 'manual' || stopReason === 'limit' ? 'stopped' : 'failed'
      )
    } catch (error) {
      this.log(`${running.sessionId}: failed to record stop: ${String(error)}`)
    }
    await this.endAgentProcesses(running)
  }

  /**
   * Ends an agent run: its opencode process tree, and anything the agent
   * started detached in its workspace -- a dev server left running holds its
   * port and, on Windows, files the worktree removal needs.
   */
  private async endAgentProcesses(running: RunningEmbeddedSession): Promise<void> {
    await this.deps.killProcess(running.pid)
    await this.deps.stopWorkspaceProcesses(running.slotPath)
  }

  /**
   * Stops every embedded session this instance is still tracking. Call this
   * on app shutdown: without it, a session's opencode.exe child process
   * (launched detached under its own sandboxed identity, so it is not a
   * child of the Electron process in the OS process tree) keeps running
   * after Ostler quits -- invisible, unmanaged, and still spending API
   * budget -- until something kills it by hand.
   */
  async stopAll(
    note = 'Stopped: Ostler was closed while this session was running.'
  ): Promise<number> {
    const sessionIds = [...this.running.keys()]
    await Promise.all(
      sessionIds.map((sessionId) =>
        this.stop(sessionId, note).catch((error) =>
          this.log(`${sessionId}: error stopping all sessions: ${String(error)}`)
        )
      )
    )
    return sessionIds.length
  }

  /**
   * Ends embedded sessions a previous Ostler run left marked active. A clean
   * quit records them through `stopAll`, but a crash or force-quit cannot, so
   * they used to show as working forever with nothing behind them, holding
   * their slot and task. Call once at startup, before anything is dispatched.
   */
  async recoverInterruptedSessions(project: WatchedProject): Promise<number> {
    const interrupted = this.harnessService
      .getState(project)
      .activeSessions.filter(
        (session) =>
          session.provenance === 'embedded' &&
          session.status === 'active' &&
          !this.running.has(session.id)
      )
    for (const session of interrupted) {
      const subject: SessionOutcomeSubject = {
        project,
        sessionId: session.id,
        taskId: session.taskId ?? null,
        modelResponded: session.embeddedRuntime?.modelResponded ?? false,
        completionReport: undefined,
        endedExternally: true
      }
      try {
        if (session.workspace) {
          await this.deps.stopWorkspaceProcesses(session.workspace.worktreePath)
        }
        const rescueNote = await this.rescueUncommittedWork(subject)
        const outcome = await this.assessOutcome(subject)
        const completionReport = await this.buildCompletionReport(subject, outcome)
        const note = `Stopped: Ostler closed unexpectedly while this session was running.${rescueNote ? ` ${rescueNote}.` : ''}`
        this.log(`${session.id}: ${note}`)
        this.recordSessionOutcome(subject, note, outcome, completionReport, 'stopped')
      } catch (error) {
        this.log(`${session.id}: could not recover interrupted session: ${String(error)}`)
      }
    }
    return interrupted.length
  }

  private cleanupPendingQuestions(sessionId: string): void {
    for (const [qid, p] of this.pendingQuestions.entries()) {
      if (p.sessionId === sessionId) {
        clearTimeout(p.timer)
        this.pendingQuestions.delete(qid)
        p.reject(new Error(`Session ${sessionId} was stopped`))
      }
    }
  }

  /**
   * Fallback completion detection: poll the opencode session's message list
   * as a safety net if event-driven notifications are delayed.
   */
  private async poll(
    running: RunningEmbeddedSession,
    stableCount: number,
    pollCount = 0
  ): Promise<void> {
    if (running.stopped) return
    // A plan waiting on the person (N9.3a) is neither idle nor timing out.
    if ((running.planWaitStartedAt ?? null) !== null) {
      this.schedulePollWithCounters(running, 0, pollCount)
      return
    }
    const baseUrl = `http://127.0.0.1:${running.port}`
    const authHeader = `Basic ${Buffer.from(`ostler:${running.password}`).toString('base64')}`

    let messageCount: number | null = null
    try {
      messageCount = await this.getMessageCount(baseUrl, authHeader, running.openCodeSessionId)
    } catch {
      // Transient fetch failure; keep polling rather than failing the session outright.
    }

    const previousCount = running.lastMessageCount
    const grew =
      previousCount === undefined || messageCount === null || messageCount > previousCount
    running.lastMessageCount = messageCount ?? previousCount

    const nextStableCount = grew ? 0 : stableCount + 1
    const nextPollCount = pollCount + 1

    if (nextStableCount >= this.deps.idleStablePolls || nextPollCount >= this.deps.maxPolls) {
      await this.finish(
        running,
        nextPollCount >= this.deps.maxPolls ? 'timed out' : 'went idle (polling fallback)'
      )
      return
    }

    this.schedulePollWithCounters(running, nextStableCount, nextPollCount)
  }

  private schedulePollWithCounters(
    running: RunningEmbeddedSession,
    stableCount: number,
    pollCount: number
  ): void {
    if (running.stopped) return
    running.pollTimer = setTimeout(() => {
      void this.poll(running, stableCount, pollCount).catch((error) => {
        // Nothing awaits this chain, so an unhandled rejection here would
        // terminate the main process rather than one session's polling.
        this.log(`${running.sessionId}: completion poll failed: ${String(error)}`)
      })
    }, this.deps.pollIntervalMs)
  }

  /**
   * Same as finish(), except while the initial sendMessage() call is still
   * in flight: an idle/error event over the plugin bridge can arrive before
   * that HTTP request's own response comes back, since both race off the
   * same underlying opencode turn. Marking the task "complete" at that
   * point would be premature -- sendMessage() might still go on to fail
   * (observed as HTTP 500 from the provider), in which case nothing was
   * actually done despite the event saying otherwise. Defer instead, and
   * let the code right after `await this.sendMessage(...)` in start()
   * resolve it once we know whether the call really succeeded.
   */
  private async finishOrDefer(running: RunningEmbeddedSession, reason: string): Promise<void> {
    if (running.initialMessagePending || running.nudgePending || running.guidancePending > 0) {
      running.deferredFinishReason = reason
      return
    }
    await this.finish(running, reason)
  }

  /**
   * Sweep any uncommitted leftovers onto the session branch before the process
   * is killed, and describe what happened for the session note. An agent that
   * edited files and went quiet without committing would otherwise leave a
   * dirty worktree that `mergeSessionWorkspace` refuses outright, stranding
   * both the work and the workspace slot it holds.
   */
  private async rescueUncommittedWork(running: SessionOutcomeSubject): Promise<string | null> {
    try {
      const result = await this.harnessService.commitSessionLeftovers(
        running.project,
        running.sessionId,
        `Ostler: uncommitted work swept from embedded session ${running.sessionId}\n\nThe agent stopped without committing these changes. Ostler committed them so they could be reviewed rather than stranded in the workspace slot.`
      )
      if (result.committed) {
        this.log(
          `${running.sessionId}: swept ${result.files.length} uncommitted file(s) into a rescue commit`
        )
        this.recordTranscript(running.sessionId, {
          role: 'system',
          content: `[Ostler] The agent stopped without committing. Ostler committed ${result.files.length} leftover file(s) to the session branch so the work is reviewable: ${result.files.slice(0, 20).join(', ')}`,
          timestamp: new Date().toISOString()
        })
        return `${result.files.length} unsaved file(s) were saved with the task's work`
      }
      if (result.error) {
        this.log(`${running.sessionId}: could not sweep uncommitted work: ${result.error}`)
        this.recordTranscript(running.sessionId, {
          role: 'system',
          content: `[Ostler] The agent left ${result.files.length} file(s) uncommitted and Ostler could not commit them (the project commit policy rejected it): ${result.error}`,
          timestamp: new Date().toISOString()
        })
        return `${result.files.length} file(s) are still unsaved in the task's copy -- the project's commit checks refused them`
      }
      return null
    } catch (error) {
      this.log(`${running.sessionId}: rescue commit failed: ${String(error)}`)
      return null
    }
  }

  /**
   * Ostler's own verdict on a finished session, which is not the same question
   * as "did opencode go idle".
   *
   * Going idle is how *every* embedded turn ends -- including the turn where a
   * weak model reads three files, writes a paragraph, and stops. Accepting idle
   * as completion is what let those sessions be recorded as done, so the
   * verdict is drawn from evidence instead: a submitted structured report, or
   * failing that, whether any commits actually exist on the session branch.
   */
  private async assessOutcome(
    running: SessionOutcomeSubject
  ): Promise<'reported' | 'unreported' | 'abandoned' | 'blocked' | 'no-response'> {
    // Nothing the model never answered can be a completion of any kind. This
    // is checked first deliberately: a session whose provider call failed
    // produces the same "accepted, idle, ended" shape as one that worked.
    if (!running.modelResponded) return 'no-response'
    try {
      const diff = await this.harnessService.getSessionDiff(running.project, running.sessionId)
      const noChanges = diff.mergeReadiness === 'no_changes'
      if (running.completionReport) {
        // "Blocked, changed nothing" is a report, but not of finished work.
        // Recording it as complete released everything that depended on it.
        return noChanges && reportHasBlockers(running.completionReport.blockers)
          ? 'blocked'
          : 'reported'
      }
      return noChanges ? 'abandoned' : 'unreported'
    } catch {
      // An unreadable diff is not evidence of work. This used to return
      // 'unreported', which completes the task -- so a session that died before
      // it could do anything (no workspace, provider error, process gone) was
      // recorded as having finished its task. With no evidence either way, the
      // task goes back to the queue; the session is still there to inspect.
      return 'abandoned'
    }
  }

  /**
   * What the session branch actually shows, which is the only trustworthy
   * answer to "is this agent done". Null when it cannot be read at all.
   */
  private async inspectWork(
    running: RunningEmbeddedSession
  ): Promise<{ hasCommits: boolean; uncommittedFiles: string[] } | null> {
    try {
      const diff = await this.harnessService.getSessionDiff(running.project, running.sessionId)
      return {
        hasCommits: diff.committedFilesChanged > 0,
        uncommittedFiles: diff.hasUncommittedChanges ? diff.uncommittedFiles : []
      }
    } catch {
      return null
    }
  }

  /**
   * The message Ostler sends an agent that went quiet without finishing, or null
   * if there is nothing to complain about.
   *
   * Each branch names the specific thing that is missing and the exact next
   * action. A weak model handles "commit your changes, then call
   * ostler_complete_task" far better than it handles being told it is not done.
   */
  private buildNudge(
    running: RunningEmbeddedSession,
    work: { hasCommits: boolean; uncommittedFiles: string[] } | null
  ): string | null {
    const reported = Boolean(running.completionReport)
    // A review run (N9.5a) has nothing to commit: only its report is missing.
    if (this.harnessService.sessionReviewOf(running.project, running.sessionId)) {
      return reported
        ? null
        : [
            'You stopped without submitting your review, so Ostler has no findings from you.',
            'Call ostler_complete_task now with your summary, an empty filesChanged, and your findings (none when there is nothing to fix). Change nothing.'
          ].join('\n')
    }
    const uncommitted = work?.uncommittedFiles ?? []
    const tail =
      'Do not reply with only an explanation: take the next action now. If the task genuinely cannot be completed, call ostler_complete_task anyway and put the reason in `blockers`.'

    if (uncommitted.length > 0) {
      return [
        `You stopped, but ${uncommitted.length} file(s) in this workspace are still uncommitted:`,
        uncommitted.slice(0, 30).join('\n'),
        '',
        'Uncommitted changes are never merged, so this work would be thrown away. Commit it to your session branch now (`git add -A && git commit`), then',
        reported
          ? 'confirm you are finished.'
          : 'call ostler_complete_task with your summary, changed files, verification, and blockers.',
        tail
      ].join('\n')
    }

    if (!reported && work?.hasCommits) {
      return [
        'Your changes are committed, but you never submitted the required completion report, so Ostler cannot record this task as done.',
        'Call ostler_complete_task now with summary, filesChanged, verification, and blockers.',
        tail
      ].join('\n')
    }

    if (!reported) {
      return [
        'You stopped without changing anything and without submitting a completion report, so no work has been recorded for this task.',
        'Continue working the assigned task in this workspace now: make the edits it requires, commit them, then call ostler_complete_task.',
        'If the task truly requires no code change, call ostler_complete_task with an empty filesChanged and explain why in `summary`.',
        'If you are blocked on a decision only a human can make, call ostler_ask_question.',
        tail
      ].join('\n')
    }

    return null
  }

  /**
   * Tells the agent why its last call vanished, ahead of the ordinary nudge.
   * Without it a model simply retries the command that hung.
   */
  private withStallNotice(running: RunningEmbeddedSession, nudge: string | null): string | null {
    const stall = running.stallNote
    running.stallNote = null
    if (!stall || !nudge) return nudge
    return [
      `Ostler aborted your last call because it was stuck: ${stall}. It was hung, not slow, and whatever it was waiting for had already gone.`,
      'Do not run the same command the same way again. If you still need its result, try once more in a simpler form with a short timeout; if that hangs too, skip it and record it in `blockers`.',
      '',
      nudge
    ].join('\n')
  }

  /**
   * Sends one continuation nudge into the still-running opencode session.
   *
   * This is the only place Ostler speaks to an embedded agent after its opening
   * task message. It goes in as a user message on the same session, so the
   * agent sees it exactly as it would see the human typing "you're not done
   * yet" -- which is what makes it work without any model-side cooperation.
   */
  private async sendContinuationNudge(
    running: RunningEmbeddedSession,
    text: string
  ): Promise<void> {
    running.nudgeCount += 1
    running.nudgePending = true
    // This nudge is the recovery from any stall abort; a later stall sets it again.
    running.abortedForStall = false
    // The model should know this came from the harness rather than a human, so
    // it does not mistake it for a new instruction or a change of task.
    const label = `[Automated message from Ostler — continuation ${running.nudgeCount} of ${this.deps.maxContinuationNudges}. Your task has not changed.]`
    const message = `${label}\n${text}`
    this.log(`${running.sessionId}: nudging idle-but-unfinished session (${running.nudgeCount})`)
    this.recordTranscript(running.sessionId, {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    })
    this.syncSessionRuntimeStats(running)

    const { baseUrl, authHeader, target } = this.sessionEndpoint(running)

    try {
      await this.sendMessage(
        baseUrl,
        authHeader,
        running.openCodeSessionId,
        message,
        target,
        running
      )
      running.nudgePending = false
      if (running.deferredFinishReason) {
        // The nudged turn already went idle while its send was in flight; judge
        // it the same way as any other idle, nudge budget permitting.
        const deferred = running.deferredFinishReason
        running.deferredFinishReason = null
        await this.finish(running, deferred)
        return
      }
      this.schedulePollWithCounters(running, 0, 0)
    } catch (error) {
      running.nudgePending = false
      running.deferredFinishReason = null
      if (running.stopped) return
      // The nudge itself failed, so there is no further turn coming: judge the
      // session on what it had already produced rather than nudging again.
      // Unless the failure was Ostler aborting a stall in the nudged turn, in
      // which case the session is still alive and gets the next nudge.
      await this.finish(
        running,
        `went idle unfinished and the continuation nudge failed (${
          error instanceof Error ? error.message : String(error)
        })`,
        running.abortedForStall
      )
    }
  }

  /**
   * Posts a message from the person (D41) into the running session as a user
   * message, labelled as theirs, through the same opencode session the nudges
   * use. opencode's `prompt_async` takes a message while a turn is in
   * progress without aborting it: the agent reads it at its next step.
   *
   * Guidance is not a continuation nudge. It leaves `nudgeCount` alone, so it
   * never spends the completion gate's budget, and it is not a sign of life:
   * `lastProgressAt` moves only on what the agent itself does, so the stall
   * watchdog sees a hung turn exactly as before.
   */
  async deliverGuidance(guidance: HarnessGuidance): Promise<void> {
    const running = this.running.get(guidance.sessionId)
    if (!running || running.stopped) {
      throw new GuidanceRefusal(409, t('errors:guidance.notRunning'))
    }
    const message = embeddedGuidanceMessage(guidance)
    this.log(`${running.sessionId}: delivering a message from the person (${guidance.id})`)
    running.guidancePending += 1
    try {
      const { baseUrl, authHeader, target } = this.sessionEndpoint(running)
      await this.postMessageAsync(baseUrl, authHeader, running.openCodeSessionId, message, target)
      this.recordTranscript(running.sessionId, {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
      })
      this.scheduleTranscriptSave(running.sessionId)
    } finally {
      running.guidancePending -= 1
    }
    // An idle that arrived while the post was in flight was held back; judge
    // it now, as any other idle, unless another send still holds it.
    if (
      running.guidancePending === 0 &&
      running.deferredFinishReason &&
      !running.initialMessagePending &&
      !running.nudgePending &&
      !running.stopped
    ) {
      const deferred = running.deferredFinishReason
      running.deferredFinishReason = null
      await this.finish(running, deferred)
    }
  }

  /** Where a running session's opencode server is, and the model its turns use. */
  private sessionEndpoint(running: RunningEmbeddedSession): {
    baseUrl: string
    authHeader: string
    target: { providerID: string; modelID: string }
  } {
    return {
      baseUrl: `http://127.0.0.1:${running.port}`,
      authHeader: `Basic ${Buffer.from(`ostler:${running.password}`).toString('base64')}`,
      target: running.target
    }
  }

  /**
   * Records how a session ended, and -- the part that matters -- whether its
   * task may be called complete.
   *
   * Ending a session always used to settle its claimed task complete, whatever
   * the evidence said. That is how a task no agent had touched came to sit in
   * Review: the report read INCOMPLETE while the task status said complete, and
   * the queue moved on. A session with no completion report and no commits
   * releases its task back to the queue instead, and holds it, so the
   * dispatcher cannot immediately hand the same no-op to another agent and
   * loop. A held task reads as Blocked on the board, where a human can release
   * it once they know why it stalled.
   *
   * Deliberately never auto-continuation: the opencode process is finished by
   * the time this runs, so handing this session the next queued task would
   * claim that task for a session with nothing left to run it.
   */
  private recordSessionOutcome(
    running: SessionOutcomeSubject,
    note: string,
    outcome: 'reported' | 'unreported' | 'abandoned' | 'blocked' | 'no-response',
    completionReport: HarnessTaskReport,
    /** How the run ended for the run history (R5.3); left out, the outcome says. */
    endedAs?: AgentRunRecordOutcome
  ): void {
    if (outcome === 'abandoned' || outcome === 'blocked' || outcome === 'no-response') {
      this.harnessService.failSession(
        running.project,
        running.sessionId,
        note,
        endedAs ?? (outcome === 'abandoned' ? 'abandoned' : 'failed')
      )
      if (running.taskId && !running.endedExternally) {
        try {
          this.harnessService.setTaskHold(running.project, running.taskId, true)
        } catch (error) {
          this.log(
            `${running.sessionId}: could not hold abandoned task ${running.taskId}: ${String(error)}`
          )
        }
      }
    } else {
      this.harnessService.updateSession(
        running.project,
        running.sessionId,
        note,
        true,
        completionReport,
        endedAs
      )
    }
    this.harnessService.refreshReport(running.project)
  }

  private async finish(
    running: RunningEmbeddedSession,
    reason: string,
    allowNudge = true
  ): Promise<void> {
    if (running.stopped) return
    if (running.providerError && !running.nudgePending) {
      // The turn ended because the model provider failed, not because the
      // agent stopped. Nudging only sends another request into the same
      // failure, worded as if the agent had given up.
      running.endedExternally = true
      await this.endSession(
        running,
        `Stopped: the model provider failed (${running.providerError}). The task returns to the queue.`,
        'error'
      )
      return
    }
    if (running.nudgePending || running.guidancePending > 0) {
      // A nudge's own send is still in flight; the same race as the initial
      // message. Let sendContinuationNudge() (or deliverGuidance()) resolve
      // this once it settles.
      running.deferredFinishReason = reason
      return
    }

    if (running.limitStop) {
      // The run crossed a token limit and its turn has ended: no nudge, the
      // ordinary end path, its work kept for review (D43).
      await this.endSession(running, running.limitStop, 'limit')
      return
    }

    // The completion gate. Going idle is how every turn ends, including the one
    // where a weak model quits early, so idle alone is not allowed to mean done:
    // if the evidence says unfinished and the nudge budget is intact, put the
    // agent back to work instead of recording a session that did nothing as a
    // success.
    // A turn Ostler aborted for stalling ends as an error by construction; that
    // error is the cure, not a reason to give up on the session.
    const nudgeable =
      allowNudge &&
      (running.abortedForStall || (!reason.includes('error') && !reason.includes('timed out'))) &&
      running.nudgeCount < this.deps.maxContinuationNudges
    if (nudgeable) {
      // Claim the session synchronously before the first await: `stopped` is
      // still false here, so a second idle event arriving mid-inspection would
      // otherwise enter this same branch and nudge twice for one turn.
      running.nudgePending = true
      if (running.pollTimer) clearTimeout(running.pollTimer)
      const work = await this.inspectWork(running)
      const nudge = this.withStallNotice(running, this.buildNudge(running, work))
      if (nudge) {
        await this.sendContinuationNudge(running, nudge)
        return
      }
      // Nothing to nudge about: this session really is finished. Any reason
      // deferred while we were inspecting is the same idle we are handling.
      running.nudgePending = false
      running.deferredFinishReason = null
    }

    running.stopped = true
    if (running.pollTimer) clearTimeout(running.pollTimer)
    this.cleanupPendingQuestions(running.sessionId)
    // Before assessing anything: a rescue commit turns "edited but uncommitted"
    // into commits on the branch, which is what assessOutcome() then reads.
    const rescueNote = await this.rescueUncommittedWork(running)
    const outcome = await this.assessOutcome(running)
    const completionReport = await this.buildCompletionReport(running, outcome)
    this.running.delete(running.sessionId)
    this.persistLiveTranscript(running)
    this.log(`${running.sessionId}: finishing session: ${reason} (outcome=${outcome})`)

    this.syncSessionRuntimeStats(running, {
      stopReason: reason.includes('error')
        ? 'error'
        : reason.includes('timed out')
          ? 'timeout'
          : outcome === 'reported'
            ? 'idle'
            : outcome
    })

    const outcomeNote =
      outcome === 'no-response'
        ? ' The AI never responded in this session: no assistant output and no tool calls were received, so nothing ran. This is a broken connection to the model, not a finished task — check Settings › AI and the session transcript.'
        : outcome === 'reported'
          ? ''
          : outcome === 'blocked'
            ? ` The agent reported it was blocked and changed nothing, so the task is held until the blocker is resolved: ${running.completionReport?.blockers ?? ''}`
            : outcome === 'abandoned'
              ? ' The agent stopped without submitting its required completion report and committed nothing -- treat this task as NOT done.'
              : ' The agent saved work but never submitted its required completion report -- review its work before applying it.'

    const note = [
      `Embedded opencode session ${reason}.`,
      outcomeNote,
      rescueNote ? ` ${rescueNote}.` : ''
    ]
      .filter(Boolean)
      .join('')

    try {
      this.recordSessionOutcome(running, note, outcome, completionReport)
    } catch (error) {
      // Recording the outcome must not leave the process alive, and must not
      // reject out of the poll timer that usually calls this.
      this.log(`${running.sessionId}: failed to record completion: ${String(error)}`)
    } finally {
      await this.endAgentProcesses(running)
    }
  }

  /**
   * Embedded agents finish when OpenCode becomes idle, rather than by calling
   * the external harness completion route. Turn their final response into the
   * same visible task report used elsewhere in Ostler, and add independently
   * observed tool/file evidence alongside it.
   */
  private async buildCompletionReport(
    running: SessionOutcomeSubject,
    outcome: 'reported' | 'unreported' | 'abandoned' | 'blocked' | 'no-response' = 'reported'
  ): Promise<HarnessTaskReport> {
    const entries = (await this.getLiveTranscript(running.sessionId)) ?? []
    const finalResponse = [...entries]
      .reverse()
      .find((entry) => entry.role === 'assistant' && !entry.content.startsWith('['))
      ?.content.trim()
    let filesChanged: string[] = []
    try {
      filesChanged = (
        await this.harnessService.getSessionDiff(running.project, running.sessionId)
      ).files
        .map((file) => file.path)
        .slice(0, 200)
    } catch {
      // A report is still useful if the read-only diff cannot be collected.
    }
    const toolsRun = [
      ...new Set(
        entries
          .filter((entry) => entry.role === 'tool')
          .map((entry) => entry.content.replace(/^Executed tool:\s*/, '').trim())
          .filter(Boolean)
      )
    ]
    const structured = running.completionReport
    if (structured) {
      // Substituting Ostler's observed file list for an empty one used to be
      // silent, which let a report that described entirely different work still
      // arrive stamped `structured: true` with a plausible list of files
      // attached. Keep the substitution -- the list is useful -- but say where
      // it came from and mark the mismatch, so nothing downstream (least of all
      // auto-accept) reads this as the agent's own verified account.
      const agentNamedFiles = structured.filesChanged.length > 0
      const inconsistent = !agentNamedFiles && filesChanged.length > 0
      return {
        filesChanged: agentNamedFiles ? structured.filesChanged : filesChanged,
        filesChangedSource: agentNamedFiles ? 'agent' : 'ostler',
        toolsRun,
        summary:
          `${structured.summary}\n\nVerification: ${structured.verification}\nBlockers: ${structured.blockers}`.slice(
            0,
            2000
          ),
        submittedAt: new Date().toISOString(),
        missing: false,
        structured: true,
        ...(inconsistent
          ? {
              inconsistent: true,
              inconsistentReason: `The agent reported no files changed, but its workspace shows ${filesChanged.length} changed file${
                filesChanged.length === 1 ? '' : 's'
              }. Read the transcript before accepting this report.`
            }
          : {}),
        blockers: structured.blockers,
        ...(structured.usage ? { usage: structured.usage } : {}),
        outcome: 'reported',
        ...structured.extras
      }
    }

    // No structured report. The agent's last message is *not* a completion
    // report and must not be presented as one -- that is exactly how a session
    // that quit early came to look finished. Lead with the verdict and keep the
    // final message only as labelled context beneath it.
    const verdict =
      outcome === 'no-response'
        ? 'NOT RUN - the AI never responded in this session. No assistant output and no tool calls were received, so no work was attempted. This is a model/connection failure, not a completed task.'
        : outcome === 'abandoned'
          ? 'INCOMPLETE - the agent stopped without calling ostler_complete_task and committed nothing. There is no evidence this task was done; do not accept it as complete without reading the transcript.'
          : 'UNREPORTED - the agent committed work but never called ostler_complete_task, so this summary is not its own account of being done. Review the branch before accepting.'
    return {
      filesChanged,
      toolsRun,
      summary: [verdict, finalResponse ? `\nAgent's last message:\n${finalResponse}` : '']
        .filter(Boolean)
        .join('\n')
        .slice(0, 2000),
      submittedAt: new Date().toISOString(),
      missing: true,
      structured: false,
      outcome
    }
  }

  private async waitForHealthy(baseUrl: string, authHeader: string): Promise<void> {
    const deadline = Date.now() + this.deps.healthCheckTimeoutMs
    let lastError: unknown
    while (Date.now() < deadline) {
      try {
        const response = await this.deps.fetchImpl(`${baseUrl}/doc`, {
          headers: { Authorization: authHeader },
          signal: AbortSignal.timeout(Math.min(5000, this.deps.healthCheckTimeoutMs))
        })
        if (response.ok) return
        lastError = new Error(`Health check returned HTTP ${response.status}`)
      } catch (error) {
        lastError = error
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error(
      `opencode server never became healthy at ${baseUrl}: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    )
  }

  private async createOpenCodeSession(baseUrl: string, authHeader: string): Promise<string> {
    const response = await this.deps.fetchImpl(`${baseUrl}/session`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(this.deps.createSessionTimeoutMs)
    })
    if (!response.ok) {
      throw new Error(`Failed to create opencode session: HTTP ${response.status}`)
    }
    const body = (await response.json()) as { id?: string }
    if (!body.id) throw new Error('opencode session creation response had no id')
    return body.id
  }

  private async sendMessage(
    baseUrl: string,
    authHeader: string,
    openCodeSessionId: string,
    prompt: string,
    target: { providerID: string; modelID: string },
    running?: RunningEmbeddedSession
  ): Promise<void> {
    const requestBody = {
      providerID: target.providerID,
      modelID: target.modelID,
      parts: [{ type: 'text', text: prompt }]
    }
    const started = Date.now()
    const budget = this.turnBudgetSignal(running)
    try {
      const response = await this.deps.fetchImpl(
        `${baseUrl}/session/${openCodeSessionId}/message`,
        {
          method: 'POST',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: budget.signal,
          // Non-standard but honoured by undici, which backs fetch here.
          ...(this.deps.longTurnDispatcher ? { dispatcher: this.deps.longTurnDispatcher } : {})
        } as RequestInit
      )
      let responseBody: unknown
      try {
        responseBody = await response.clone().text()
      } catch {
        // Best-effort: logging must not affect the real request.
      }
      logAiCall({
        kind: 'embedded-harness',
        provider: target.providerID,
        baseUrl,
        model: target.modelID,
        endpoint: `session/${openCodeSessionId}/message`,
        request: requestBody,
        response: responseBody,
        responseStatus: response.status,
        durationMs: Date.now() - started
      })
      if (!response.ok) {
        // The status alone said nothing a human could act on. opencode answers
        // with a JSON body naming what went wrong (or at least an error id to
        // find in its own log), so carry it into the error that becomes the
        // session's visible failure note.
        const detail =
          typeof responseBody === 'string' && responseBody.trim()
            ? ` — ${responseBody.trim().slice(0, 500)}`
            : ''
        throw new Error(`Failed to send the initial task message: HTTP ${response.status}${detail}`)
      }
    } catch (error) {
      if (!(
        error instanceof Error &&
        error.message.startsWith('Failed to send the initial task message')
      )) {
        logAiCall({
          kind: 'embedded-harness',
          provider: target.providerID,
          baseUrl,
          model: target.modelID,
          endpoint: `session/${openCodeSessionId}/message`,
          request: requestBody,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - started
        })
      }
      throw error
    } finally {
      budget.dispose()
    }
  }

  /**
   * The turn's budget, `sendMessageTimeoutMs`, as an abort signal. Time spent
   * waiting on the person to decide on a plan (N9.3a) does not count: the
   * deadline moves out by every plan wait, so a run never times out because
   * the person took a while. It aborts with a TimeoutError, as
   * `AbortSignal.timeout` does, so a timed-out turn reads the same.
   */
  private turnBudgetSignal(running?: RunningEmbeddedSession): {
    signal: AbortSignal
    dispose: () => void
  } {
    const budgetMs = this.deps.sendMessageTimeoutMs
    if (!running) return { signal: AbortSignal.timeout(budgetMs), dispose: () => undefined }
    const waited = (): number =>
      (running.planWaitedMs ?? 0) +
      (running.planWaitStartedAt != null ? Date.now() - running.planWaitStartedAt : 0)
    const controller = new AbortController()
    const started = Date.now()
    const waitedBefore = waited()
    let timer: NodeJS.Timeout | null = null
    const check = (): void => {
      const remaining = started + budgetMs + (waited() - waitedBefore) - Date.now()
      if (running.planWaitStartedAt != null || remaining > 0) {
        timer = setTimeout(check, Math.max(remaining, this.deps.planPollMs))
        timer.unref?.()
        return
      }
      controller.abort(new DOMException('The turn ran out of time', 'TimeoutError'))
    }
    timer = setTimeout(check, budgetMs)
    timer.unref?.()
    return {
      signal: controller.signal,
      dispose: () => {
        if (timer) clearTimeout(timer)
      }
    }
  }

  /**
   * Posts a user message without waiting for the turn it joins: opencode
   * answers 204 once it has taken the message, and a turn already in progress
   * carries on with it rather than being aborted.
   */
  private async postMessageAsync(
    baseUrl: string,
    authHeader: string,
    openCodeSessionId: string,
    text: string,
    target: { providerID: string; modelID: string }
  ): Promise<void> {
    const response = await this.deps.fetchImpl(
      `${baseUrl}/session/${openCodeSessionId}/prompt_async`,
      {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerID: target.providerID,
          modelID: target.modelID,
          parts: [{ type: 'text', text }]
        }),
        signal: AbortSignal.timeout(this.deps.requestTimeoutMs)
      }
    )
    if (!response.ok) {
      throw new Error(`The agent's session did not take the message: HTTP ${response.status}`)
    }
  }

  private async getMessageCount(
    baseUrl: string,
    authHeader: string,
    openCodeSessionId: string
  ): Promise<number> {
    const response = await this.deps.fetchImpl(`${baseUrl}/session/${openCodeSessionId}/message`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(this.deps.requestTimeoutMs)
    })
    if (!response.ok) {
      throw new Error(`Failed to list opencode session messages: HTTP ${response.status}`)
    }
    const body = (await response.json()) as unknown[]
    return Array.isArray(body) ? body.length : 0
  }
}
