import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { Recorder } from './recorder'

/**
 * The monkey playing an external coding agent. Ostler starts the session for a
 * queued task (the person presses "Start this task", or copies the prompt from
 * the queue), and the agent is handed that session: its id, its own token and
 * its folder, a copy of the project made when the task was queued. The agent
 * reads GET /help, works and commits in that folder, asks, reports blockers
 * and reports the task done, exactly as a fresh CLI agent would after pasting
 * the prompt. It exists so the review, Apply, Send back, Discard and History
 * screens get real work to show without a paid model.
 *
 * Every call is recorded. A response that would leave a real agent confused
 * is a finding about the API, not about the agent.
 */

export interface SimSession {
  id: string
  token: string
  /** The task Ostler started the session for. */
  taskId: string
  workspace: {
    worktreePath: string
    branchName: string
    /** The project folder's version the copy was made from. */
    baseBranch: string
    setup?: { status?: string }
  } | null
}

export interface SimTask {
  id: string
  title: string
  details?: string
  status: string
  planningWorkItemId?: string | null
}

export class HarnessCallError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export class SimAgent {
  constructor(
    private readonly baseUrl: string,
    readonly session: SimSession,
    private readonly recorder: Recorder,
    readonly name: string
  ) {
    recorder.secret(session.token)
  }

  async call<T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
    const started = Date.now()
    const target = `${this.name}: ${method} ${route.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id')}`
    let status = 0
    try {
      const response = await fetch(`${this.baseUrl}${route}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.session.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
      status = response.status
      const raw = await response.text()
      let parsed: unknown = raw
      try {
        parsed = raw ? JSON.parse(raw) : null
      } catch {
        // Plain text answers are kept as they are.
      }
      if (!response.ok) {
        const message =
          parsed && typeof parsed === 'object' && 'error' in parsed
            ? String((parsed as { error: unknown }).error)
            : raw.slice(0, 300)
        throw new HarnessCallError(status, message)
      }
      // Every JSON answer is { ok: true, value }.
      if (parsed && typeof parsed === 'object' && 'ok' in parsed && 'value' in parsed) {
        parsed = (parsed as { value: unknown }).value
      }
      this.recorder.action({
        kind: 'agent',
        target,
        value: String(status),
        durationMs: Date.now() - started,
        ok: true
      })
      return parsed as T
    } catch (error) {
      this.recorder.action({
        kind: 'agent',
        target,
        value: String(status || 'no answer'),
        durationMs: Date.now() - started,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  async help(): Promise<{ instructions: string; routes: unknown[] }> {
    return this.call('GET', '/help')
  }

  /** The session as Ostler handed it over; the folder's setup has already run. */
  async read(): Promise<{
    session: { workspace?: { setup?: { status?: string } } | null }
    questions?: { id: string; status: string; answer?: string }[]
  }> {
    return this.call('GET', `/session/${this.session.id}`)
  }

  async tasks(): Promise<SimTask[]> {
    const result = await this.call<SimTask[] | { tasks: SimTask[] }>('GET', '/tasks')
    return Array.isArray(result) ? result : result.tasks
  }

  async blocker(description: string, resolutionOptions: string[]): Promise<unknown> {
    return this.call('POST', `/tasks/${this.session.taskId}/blocker`, {
      sessionId: this.session.id,
      description,
      resolutionOptions
    })
  }

  async ask(question: string): Promise<{ id: string }> {
    return this.call('POST', `/session/${this.session.id}/ask`, { question })
  }

  /** Polls until the question is answered; returns the answer, or null after the wait. */
  async waitForAnswer(questionId: string, timeoutMs: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const state = await this.read()
      const question = state.questions?.find((entry) => entry.id === questionId)
      if (question?.status === 'answered') return question.answer ?? ''
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    return null
  }

  /** Writes files into the session's own folder and commits them. */
  commitFiles(files: { path: string; content: string }[], message: string): string[] {
    const workspace = this.folder()
    for (const file of files) {
      const target = path.join(workspace.worktreePath, file.path)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, file.content)
    }
    this.git('add', '--', ...files.map((file) => file.path))
    this.git(...this.identity(), 'commit', '--no-gpg-sign', '-m', message)
    this.recorder.action({
      kind: 'agent',
      target: `${this.name}: git commit`,
      value: `${files.length} file(s): ${message}`,
      durationMs: 0,
      ok: true
    })
    return files.map((file) => file.path)
  }

  /**
   * What an agent does when Ostler sends its work back because the project
   * changed under it: merges the project folder's latest work into its copy,
   * keeping its own side where both changed the same lines, then commits
   * `settled` (the files as it settled them, with both sides) on top.
   */
  bringUpToDate(settled: { path: string; content: string }[] = []): void {
    const workspace = this.folder()
    this.git(
      ...this.identity(),
      'merge',
      '--no-edit',
      '--no-gpg-sign',
      '-X',
      'ours',
      workspace.baseBranch
    )
    this.recorder.action({
      kind: 'agent',
      target: `${this.name}: git merge`,
      value: `brought up to date with ${workspace.baseBranch}`,
      durationMs: 0,
      ok: true
    })
    if (settled.length > 0)
      this.commitFiles(settled, 'Keep both changes after bringing the work up to date')
  }

  /** Reports the task done with the agent's own report, as GET /help asks. */
  async complete(filesChanged: string[], summary: string): Promise<unknown> {
    return this.call('POST', `/session/${this.session.id}/update`, {
      done: true,
      completedTaskId: this.session.taskId,
      report: { filesChanged, summary }
    })
  }

  private folder(): NonNullable<SimSession['workspace']> {
    const workspace = this.session.workspace
    if (!workspace) throw new Error(`${this.name}'s session has no folder of its own`)
    return workspace
  }

  private git(...args: string[]): string {
    return execFileSync('git', ['-C', this.folder().worktreePath, ...args], {
      stdio: 'pipe',
      encoding: 'utf8'
    })
  }

  private identity(): string[] {
    return ['-c', `user.name=${this.name}`, '-c', 'user.email=monkey-agent@ostler.invalid']
  }
}
