import { spawn, type ChildProcess } from 'child_process'
import { createWriteStream, mkdirSync, readdirSync, readFileSync } from 'fs'
import * as path from 'path'
import simpleGit from 'simple-git'
import type { WatchedProject, WorkspaceSetupRecord } from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'
import {
  resolveWorkspaceSetup,
  type ResolvedSetup,
  type SetupInputs
} from '@shared/workspace-setup'
import { stripTerminalCodes } from '@shared/try-it'
import type { HarnessContext } from './context'
import {
  inheritableEnvironment,
  prepareSlotEnvironment,
  slotBaseEnvironment
} from './slot-environment'
import { killProcessTree } from './workspace-processes'

/**
 * Workspace setup: the one command that prepares a new agent workspace before
 * an agent can act in it (install dependencies, usually). It runs for every
 * session type, once, against the reviewed baseline, and its result is stored
 * on the workspace.
 *
 * The security boundary is the timing: setup runs project code at Medium
 * integrity, but before any agent has touched the worktree, and no route or
 * agent tool can run it again.
 */

/** Long enough for a cold `npm ci` on a slow disk; short enough that a hung install cannot hold a slot for hours. */
export const SETUP_TIMEOUT_MS = 15 * 60_000

/** How long a killed setup gets to report its exit before we stop waiting for it. */
const KILL_GRACE_MS = 10_000

/** Only the last lines of output are kept for the one-line failure text. */
const TAIL_LINES = 40

/** Secrets the embedded runner generates for its own opencode process. Setup must never see them. */
const RUNNER_SECRET_ENV = ['OPENCODE_SERVER_PASSWORD', 'OSTLER_BRIDGE_SECRET'] as const

/** A setup resolved to run: what to execute, and where the command came from. */
export interface SetupRun {
  command: string
  source: 'detected' | 'custom'
}

export interface SetupOptions {
  timeoutMs?: number
  /** Injected by tests; defaults to killing the real process tree. */
  killTree?: (pid: number) => Promise<void>
  /** Injected by tests; defaults to running the command in the shell. */
  spawnShell?: (command: string, cwd: string, env: NodeJS.ProcessEnv) => ChildProcess
}

/** Reads what resolution needs from the worktree: the baseline, not the human's folder. */
export function readSetupInputs(worktreePath: string): SetupInputs {
  const rootFiles = readdirSync(worktreePath)
  let packageManagerField: string | undefined
  if (rootFiles.includes('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(worktreePath, 'package.json'), 'utf8')) as {
        packageManager?: unknown
      }
      if (typeof pkg.packageManager === 'string') packageManagerField = pkg.packageManager
    } catch {
      // A malformed package.json means no packageManager pin; lockfiles still decide.
    }
  }
  return { rootFiles, packageManagerField, hasYarnrcYml: rootFiles.includes('.yarnrc.yml') }
}

/**
 * Decides, synchronously and before the session is returned, whether setup
 * runs at all. The record it returns is what the session shows at once:
 * `running` with the command, or `skipped` with why.
 */
export function planWorkspaceSetup(
  project: WatchedProject,
  worktreePath: string
): { setup: WorkspaceSetupRecord; run: SetupRun | null } {
  let resolved: ResolvedSetup
  try {
    resolved = resolveWorkspaceSetup(project.agentSetup, readSetupInputs(worktreePath))
  } catch (error) {
    // An invalid custom command is refused on save; reaching here means a hand-edited config.
    return {
      setup: {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        failure: `Setup failed: ${error instanceof Error ? error.message : String(error)}`
      },
      run: null
    }
  }
  if (resolved.kind === 'none') {
    return { setup: { status: 'skipped', skipReason: resolved.reason }, run: null }
  }
  return {
    setup: {
      status: 'running',
      command: resolved.command,
      source: resolved.source,
      startedAt: new Date().toISOString()
    },
    run: { command: resolved.command, source: resolved.source }
  }
}

/**
 * What Automatic setup would run for a project's folder, for the Project
 * settings preview. Reads the folder root only, and calls the same resolver
 * the harness uses, so the preview and a real session cannot disagree.
 */
export function describeProjectSetup(project: WatchedProject): ResolvedSetup {
  const folder = projectFolder(project)
  if (!folder) return { kind: 'none', reason: 'no-lockfile' }
  return resolveWorkspaceSetup({ mode: 'auto' }, readSetupInputs(folder))
}

/** Strips terminal colour codes so a log tail reads as text. */
function plain(line: string): string {
  return stripTerminalCodes(line).trimEnd()
}

/**
 * Spawns the command through the shell, because a custom command is a string
 * and `.cmd` shims need it. Try it (N9.4) runs its command through this too.
 */
export function defaultSpawnShell(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): ChildProcess {
  if (process.platform === 'win32') {
    // `/s` plus our own outer quotes keeps the command's inner quotes intact,
    // which Node's default argument quoting would escape for the wrong parser.
    return spawn('cmd.exe', ['/d', '/s', '/c', `"${command}"`], {
      cwd,
      env,
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  }
  return spawn('/bin/sh', ['-c', command], {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function summarize(paths: string[]): string {
  const shown = paths.slice(0, 5)
  return paths.length > shown.length
    ? `${shown.join(', ')} and ${paths.length - shown.length} more`
    : shown.join(', ')
}

/**
 * Fails setup that touched anything a human reviewed. Tracked changes are
 * refused outright: setup must not edit the project. Untracked files are
 * refused unless the project's own .gitignore covers them, because the rescue
 * commit runs `git add -A` and would otherwise commit all of it. Ostler does
 * not add ignore rules itself: the project owns what it ignores.
 */
async function checkWorktree(worktreePath: string): Promise<string | null> {
  const status = await simpleGit(worktreePath).raw(['status', '--porcelain'])
  const lines = status.split('\n').filter((line) => line.trim().length > 0)
  const tracked = lines.filter((line) => !line.startsWith('??')).map((line) => line.slice(3))
  if (tracked.length > 0) return `Setup changed tracked files: ${summarize(tracked)}`
  const untracked = lines.filter((line) => line.startsWith('??')).map((line) => line.slice(3))
  if (untracked.length > 0) {
    return `Setup created files Git doesn't ignore: ${summarize(untracked)}. Add them to .gitignore.`
  }
  return null
}

/** The first word of the command, for "not installed" advice. */
function programName(command: string): string | null {
  const first = command.trim().split(/\s+/)[0]?.replace(/^"|"$/g, '')
  return first || null
}

/**
 * The environment a command Ostler runs in a copy gets: workspace setup, and
 * Try it (N9.4). The shared non-secret base plus CI=1 so installers never
 * prompt. The embedded runner's own secrets are never passed: postinstall
 * scripts run here. Other variables (a registry token, say) are inherited as
 * Ostler always did.
 */
export function workspaceCommandEnvironment(worktreePath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...inheritableEnvironment(),
    ...slotBaseEnvironment(worktreePath),
    CI: '1'
  }
  for (const key of RUNNER_SECRET_ENV) delete env[key]
  return env
}

/** Where setup runs, and where its record is kept: a task's copy (simplify pass §2.1). */
export interface SetupTarget {
  /** Names the log file. */
  id: string
  worktreePath: string
  save(record: WorkspaceSetupRecord): void
}

/**
 * Runs setup in one copy and records the outcome through `target.save`. It
 * resolves, never rejects: every outcome, including abort and timeout, is a
 * record. The caller owns the abort signal.
 */
export async function runWorkspaceSetup(
  ctx: HarnessContext,
  project: WatchedProject,
  target: SetupTarget,
  run: SetupRun,
  signal: AbortSignal,
  options: SetupOptions = {}
): Promise<WorkspaceSetupRecord> {
  const timeoutMs = options.timeoutMs ?? SETUP_TIMEOUT_MS
  const killTree = options.killTree ?? killProcessTree
  const spawnShell = options.spawnShell ?? defaultSpawnShell
  const worktreePath = target.worktreePath
  const logDir = path.join(ctx.projectDir(project.id), 'logs')
  mkdirSync(logDir, { recursive: true })
  const logPath = path.join(logDir, `setup-${target.id}.log`)
  const startedAt = new Date().toISOString()
  const logStream = createWriteStream(logPath, { flags: 'w' })
  const write = (text: string) => logStream.write(text)
  write(`$ ${run.command}\n`)

  const finish = async (
    outcome: Pick<WorkspaceSetupRecord, 'status'> &
      Partial<Pick<WorkspaceSetupRecord, 'exitCode' | 'failure'>>
  ): Promise<WorkspaceSetupRecord> => {
    const record: WorkspaceSetupRecord = {
      command: run.command,
      source: run.source,
      startedAt,
      finishedAt: new Date().toISOString(),
      logPath,
      ...outcome
    }
    write(`\n[setup ${record.status}]\n`)
    await new Promise<void>((resolve) => logStream.end(resolve))
    target.save(record)
    ctx.notifyWorkspaceSetup(project)
    return record
  }

  try {
    await prepareSlotEnvironment(worktreePath, (message) => write(`[ostler] ${message}\n`))
  } catch (error) {
    return finish({
      status: 'failed',
      failure: `Setup failed: could not prepare the temp folder (${String(error)})`
    })
  }
  if (signal.aborted) return finish({ status: 'cancelled' })

  const env = workspaceCommandEnvironment(worktreePath)
  const child = spawnShell(run.command, worktreePath, env)
  if (!child.pid) {
    return finish({ status: 'failed', failure: `Setup failed: \`${run.command}\` did not start` })
  }

  const tail: string[] = []
  const collect = (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    write(text)
    for (const line of text.split(/\r?\n/)) {
      const cleaned = plain(line)
      if (cleaned.trim()) tail.push(cleaned)
    }
    if (tail.length > TAIL_LINES) tail.splice(0, tail.length - TAIL_LINES)
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)

  type Exit = { kind: 'exit'; code: number | null } | { kind: 'error'; error: Error }
  const exited = new Promise<Exit>((resolve) => {
    child.once('error', (error) => resolve({ kind: 'error', error }))
    child.once('close', (code) => resolve({ kind: 'exit', code }))
  })

  // Once a kill is requested, a process that never reports its exit must not
  // hold the workspace forever: give up waiting after a grace period.
  let kill: 'abort' | 'timeout' | null = null
  let giveUp: (value: 'gave-up') => void = () => {}
  const gaveUp = new Promise<'gave-up'>((resolve) => (giveUp = resolve))
  const stop = async (reason: 'abort' | 'timeout') => {
    if (kill) return
    kill = reason
    setTimeout(() => giveUp('gave-up'), KILL_GRACE_MS).unref()
    await killTree(child.pid!)
  }
  const onAbort = () => void stop('abort')
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => void stop('timeout'), timeoutMs)

  let result: Exit | 'gave-up'
  try {
    result = await Promise.race([exited, gaveUp])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }

  if (kill === 'abort') return finish({ status: 'cancelled' })
  if (kill === 'timeout') {
    return finish({
      status: 'failed',
      failure: `Setup timed out after ${Math.round(timeoutMs / 60_000)} minutes: \`${run.command}\``
    })
  }
  if (result === 'gave-up') {
    return finish({ status: 'failed', failure: `Setup did not stop: \`${run.command}\`` })
  }
  if (result.kind === 'error') {
    return finish({ status: 'failed', failure: `Setup failed: ${result.error.message}` })
  }

  const code = result.code
  if (code !== 0) {
    const output = tail.join('\n')
    const notFound =
      /is not recognized as an internal or external command|ENOENT|: not found/i.test(output)
    const program = programName(run.command)
    const last = tail[tail.length - 1] ?? '(no output)'
    return finish({
      status: 'failed',
      exitCode: code,
      failure:
        notFound && program
          ? `\`${program}\` is not installed on this computer. Install it, or change the setup command in Project settings › Agents.`
          : `Setup failed: \`${run.command}\` exited ${code ?? 'without a code'} — ${last.trim()}`
    })
  }

  let problem: string | null
  try {
    problem = await checkWorktree(worktreePath)
  } catch (error) {
    problem = `Setup failed: could not read the workspace status (${String(error)})`
  }
  if (problem) return finish({ status: 'failed', exitCode: 0, failure: problem })
  return finish({ status: 'succeeded', exitCode: 0 })
}
