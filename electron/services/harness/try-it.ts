import type { ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import simpleGit from 'simple-git'
import type { HarnessSession, WatchedProject, WorkspaceSetupRecord } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import {
  needsTryWarning,
  parseTryCommand,
  stripTerminalCodes,
  trimOutput,
  type TryRun
} from '@shared/try-it'
import { prepareSlotEnvironment } from './slot-environment'
import { killProcessTree, stopWorkspaceProcesses } from './workspace-processes'
import { defaultSpawnShell, workspaceCommandEnvironment } from './workspace-setup'

/**
 * Try it (N9.4, decision N62): runs the project's try command in a finished
 * task's copy, so the person can see the change working before they apply it.
 *
 * There is no sandbox: the command runs as an ordinary process with the
 * person's rights, through the same shell and environment as workspace setup
 * (never Ostler's keys or tokens), the way running it by hand would. Only the
 * person starts it, from Review changes; the command is theirs, saved in
 * Project settings. Nothing an agent writes is run, and nothing is applied.
 *
 * One Try per session. Stopping ends the process tree and everything still
 * running from the copy (dev servers detach). Before a run, the copy's Git
 * status is recorded; after it, the files the run changed are listed so the
 * person can undo exactly those.
 */

/** How long a stopped run gets to report its exit before Ostler stops waiting. */
const STOP_GRACE_MS = 10_000
/** Output reaches the window at most this often. */
const NOTIFY_EVERY_MS = 150

export interface TryItDeps {
  getProject(projectId: string): WatchedProject
  findSession(project: WatchedProject, sessionId: string): HarnessSession | null
  /** Runs setup first when the copy's has not finished successfully. */
  ensureSetup(
    project: WatchedProject,
    sessionId: string,
    signal: AbortSignal
  ): Promise<WorkspaceSetupRecord>
  /** Remembers that the person has seen the warning in this project. */
  markWarningSeen(projectId: string): void
  /** Sends a run's state to the window. */
  notify(run: TryRun): void
  /** Injected by tests; default to the real ones. */
  spawnShell?: (command: string, cwd: string, env: NodeJS.ProcessEnv) => ChildProcess
  killTree?: (pid: number) => Promise<void>
  stopInside?: (dir: string) => Promise<unknown>
  prepareEnvironment?: (worktreePath: string) => Promise<void>
}

interface LiveRun {
  run: TryRun
  worktreePath: string
  child: ChildProcess | null
  setupAbort: AbortController
  /** The copy's changed files before the run, by path, with their status. */
  before: Map<string, string> | null
  stopping: boolean
  ended: Promise<void>
  partial: string
  timer: NodeJS.Timeout | null
}

/** `git status` as a map of path to its two-letter status; untracked files listed one by one. */
export async function copyStatus(worktreePath: string): Promise<Map<string, string>> {
  const out = await simpleGit(worktreePath).raw([
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all'
  ])
  const entries = out.split('\0')
  const status = new Map<string, string>()
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (entry.length < 4) continue
    const code = entry.slice(0, 2)
    status.set(entry.slice(3), code)
    // A rename or copy is followed by the path it came from.
    if (code[0] === 'R' || code[0] === 'C') {
      const from = entries[++index]
      if (from) status.set(from, 'D ')
    }
  }
  return status
}

/**
 * Pure: the files a run changed or added, from the copy's status before and
 * after it. A file already changed before the run is never the run's, even
 * when the run changed it again: it is left as the person and agent left it.
 */
export function filesTheRunChanged(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>
): string[] {
  return [...after.keys()].filter((file) => !before.has(file)).sort()
}

/** A path inside the copy, or null when it would leave it. */
function insideCopy(worktreePath: string, file: string): string | null {
  const full = path.resolve(worktreePath, file)
  const relative = path.relative(worktreePath, full)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return full
}

/**
 * Puts back only the given files, which the run changed: tracked ones from
 * the copy's last commit, untracked ones removed. Nothing else in the copy is
 * touched. Returns the files that still differ afterwards.
 */
export async function undoRunChanges(
  worktreePath: string,
  files: readonly string[],
  before: ReadonlyMap<string, string>
): Promise<string[]> {
  const status = await copyStatus(worktreePath)
  const ours = files.filter((file) => !before.has(file) && status.has(file))
  const untracked = ours.filter((file) => status.get(file) === '??')
  const tracked = ours.filter((file) => status.get(file) !== '??')
  for (const file of untracked) {
    const full = insideCopy(worktreePath, file)
    if (full) fs.rmSync(full, { force: true })
  }
  if (tracked.length > 0) {
    await simpleGit(worktreePath).raw([
      'restore',
      '--source=HEAD',
      '--staged',
      '--worktree',
      '--',
      ...tracked
    ])
  }
  const after = await copyStatus(worktreePath)
  return files.filter((file) => !before.has(file) && after.has(file))
}

export class TryItService {
  private readonly runs = new Map<string, LiveRun>()

  constructor(private readonly deps: TryItDeps) {}

  /** A session's Try, or null when it has none. */
  get(sessionId: string): TryRun | null {
    const live = this.runs.get(sessionId)
    return live ? { ...live.run, lines: [...live.run.lines] } : null
  }

  /**
   * Starts Try it in a finished task's copy. `acknowledged` says the person
   * has just accepted the warning; without it the first run in a project is
   * refused, so the warning cannot be skipped.
   */
  async start(projectId: string, sessionId: string, acknowledged: boolean): Promise<TryRun> {
    const project = this.deps.getProject(projectId)
    const command = parseTryCommand(project.tryCommand ?? '')
    if (!command) throw new Refusal(t('errors:tryIt.noCommand'))
    if (needsTryWarning(project)) {
      if (!acknowledged) throw new Refusal(t('errors:tryIt.readWarning'))
      this.deps.markWarningSeen(projectId)
    }
    const session = this.deps.findSession(project, sessionId)
    if (!session || session.status !== 'done') {
      throw new Refusal(t('errors:tryIt.notFinished'))
    }
    const workspace = session.workspace
    if (!workspace || workspace.closed || !fs.existsSync(workspace.worktreePath)) {
      throw new Refusal(t('errors:tryIt.noCopy'))
    }
    const existing = this.runs.get(sessionId)
    if (existing && (existing.run.state === 'running' || existing.run.state === 'setting-up')) {
      throw new Refusal(t('errors:tryIt.alreadyRunning'))
    }
    if (existing) await existing.ended

    const run: TryRun = {
      projectId,
      sessionId,
      command,
      state: 'setting-up',
      exitCode: null,
      lines: [],
      startedAt: new Date().toISOString(),
      leftFiles: []
    }
    let endedResolve: () => void = () => {}
    const live: LiveRun = {
      run,
      worktreePath: workspace.worktreePath,
      child: null,
      setupAbort: new AbortController(),
      before: null,
      stopping: false,
      ended: new Promise<void>((resolve) => (endedResolve = resolve)),
      partial: '',
      timer: null
    }
    this.runs.set(sessionId, live)
    this.push(live, true)
    void this.execute(project, live).finally(() => endedResolve())
    return this.get(sessionId)!
  }

  private async execute(project: WatchedProject, live: LiveRun): Promise<void> {
    const { run } = live
    try {
      live.before = await copyStatus(live.worktreePath)
    } catch (error) {
      return this.end(
        live,
        'failed',
        t('errors:tryIt.statusUnreadable', { message: message(error) })
      )
    }
    const setup = await this.deps
      .ensureSetup(project, run.sessionId, live.setupAbort.signal)
      .catch((error: unknown): WorkspaceSetupRecord => ({
        status: 'failed',
        failure: message(error)
      }))
    if (live.stopping) return this.end(live, 'stopped')
    if (setup.status === 'failed' || setup.status === 'cancelled') {
      return this.end(live, 'failed', setup.failure ?? t('errors:tryIt.setupDidNotFinish'))
    }
    // Setup may have written ignored files only; record the status again so
    // nothing setup did is counted as the run's.
    try {
      live.before = await copyStatus(live.worktreePath)
      await (this.deps.prepareEnvironment ?? prepareEnvironment)(live.worktreePath)
    } catch (error) {
      return this.end(live, 'failed', message(error))
    }
    if (live.stopping) return this.end(live, 'stopped')

    const spawnShell = this.deps.spawnShell ?? defaultSpawnShell
    const child = spawnShell(
      run.command,
      live.worktreePath,
      workspaceCommandEnvironment(live.worktreePath)
    )
    live.child = child
    this.append(live, `$ ${run.command}\n`)
    run.state = 'running'
    this.push(live, true)
    child.stdout?.on('data', (chunk: Buffer) => this.append(live, chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => this.append(live, chunk.toString('utf8')))
    const exit = await new Promise<{ code: number | null; error?: Error }>((resolve) => {
      child.once('error', (error) => resolve({ code: null, error }))
      child.once('close', (code) => resolve({ code }))
    })
    this.flushPartial(live)
    if (live.stopping) return this.end(live, 'stopped')
    if (exit.error) return this.end(live, 'failed', exit.error.message)
    run.exitCode = exit.code
    return this.end(live, 'exited')
  }

  /** Output as it comes: split into lines, colour codes stripped, the last 2,000 kept. */
  private append(live: LiveRun, text: string): void {
    const pieces = (live.partial + text).split(/\r?\n/)
    live.partial = pieces.pop() ?? ''
    for (const piece of pieces) {
      // A carriage return redraws a progress line: keep what it ended as.
      const shown = piece.split('\r').pop() ?? ''
      live.run.lines.push(stripTerminalCodes(shown).trimEnd())
    }
    trimOutput(live.run.lines)
    this.push(live)
  }

  private flushPartial(live: LiveRun): void {
    if (!live.partial) return
    live.run.lines.push(stripTerminalCodes(live.partial.split('\r').pop() ?? '').trimEnd())
    live.partial = ''
    trimOutput(live.run.lines)
  }

  private async end(
    live: LiveRun,
    state: 'exited' | 'stopped' | 'failed',
    failure?: string
  ): Promise<void> {
    const { run } = live
    // Whatever the command left running from the copy (a detached dev
    // server) goes too, or it keeps the port and the copy's files.
    await (this.deps.stopInside ?? stopWorkspaceProcesses)(live.worktreePath)
    let leftFiles: string[] = []
    if (live.before && fs.existsSync(live.worktreePath)) {
      try {
        leftFiles = filesTheRunChanged(live.before, await copyStatus(live.worktreePath))
      } catch {
        leftFiles = []
      }
    }
    // The state changes last, with the files, so an ended run is never seen without them.
    run.leftFiles = leftFiles
    if (failure) run.failure = failure
    run.endedAt = new Date().toISOString()
    run.state = state
    this.push(live, true)
  }

  /**
   * Stop: ends the command's process tree and everything still running from
   * the copy, and waits until the run has ended. Nothing to do when no run
   * is going; a finished run is swept again in case it left a server behind.
   */
  async stop(sessionId: string): Promise<TryRun | null> {
    const live = this.runs.get(sessionId)
    if (!live) return null
    if (live.run.state === 'running' || live.run.state === 'setting-up') {
      live.stopping = true
      live.setupAbort.abort()
      const pid = live.child?.pid
      if (pid) await (this.deps.killTree ?? killProcessTree)(pid)
      await Promise.race([live.ended, delay(STOP_GRACE_MS)])
    } else {
      await (this.deps.stopInside ?? stopWorkspaceProcesses)(live.worktreePath)
    }
    return this.get(sessionId)
  }

  /**
   * Before a verdict (Apply, Send back, Discard, Stop) from any surface: the
   * run stops. Apply is refused while the run's changed files are still
   * listed, so they never end up in what Apply adds to the project folder.
   */
  async beforeVerdict(sessionId: string, verdict: 'apply' | 'other'): Promise<void> {
    const live = this.runs.get(sessionId)
    if (!live) return
    await this.stop(sessionId)
    if (verdict === 'apply' && live.run.leftFiles.length > 0) {
      throw new Refusal(
        t('errors:tryIt.leftFilesBeforeApply', { count: live.run.leftFiles.length })
      )
    }
    this.forget(sessionId)
  }

  /** Undo those changes: puts back only the files the run changed. */
  async undoLeftFiles(sessionId: string): Promise<TryRun> {
    const live = this.requireEnded(sessionId)
    if (live.before && live.run.leftFiles.length > 0) {
      live.run.leftFiles = await undoRunChanges(live.worktreePath, live.run.leftFiles, live.before)
    }
    this.push(live, true)
    return this.get(sessionId)!
  }

  /** Keep them: the run's files stay, as if the person had made them. */
  keepLeftFiles(sessionId: string): TryRun {
    const live = this.requireEnded(sessionId)
    live.run.leftFiles = []
    this.push(live, true)
    return this.get(sessionId)!
  }

  /** Quit: every run stops. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.runs.keys()].map((sessionId) => this.stop(sessionId)))
  }

  private requireEnded(sessionId: string): LiveRun {
    const live = this.runs.get(sessionId)
    if (!live) throw new Refusal(t('errors:tryIt.notRun'))
    if (live.run.state === 'running' || live.run.state === 'setting-up') {
      throw new Refusal(t('errors:tryIt.stopFirst'))
    }
    return live
  }

  private forget(sessionId: string): void {
    const live = this.runs.get(sessionId)
    if (live?.timer) clearTimeout(live.timer)
    this.runs.delete(sessionId)
  }

  /** Sends the run to the window, at most every 150 ms unless `now`. */
  private push(live: LiveRun, now = false): void {
    const send = () => {
      live.timer = null
      try {
        this.deps.notify(this.get(live.run.sessionId) ?? { ...live.run })
      } catch {
        // A window refresh must never fail a run.
      }
    }
    if (now) {
      if (live.timer) clearTimeout(live.timer)
      send()
      return
    }
    if (!live.timer) live.timer = setTimeout(send, NOTIFY_EVERY_MS)
  }
}

async function prepareEnvironment(worktreePath: string): Promise<void> {
  await prepareSlotEnvironment(worktreePath, () => undefined)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref?.())
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
