import { execFileSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HarnessWorkspace,
  WatchedProject,
  WorkspaceSetupRecord
} from '../../src/shared/ostler-api'
import { abortWorkspaceSetup, type HarnessContext } from '../../electron/services/harness/context'
import * as sessions from '../../electron/services/harness/sessions'
import { copySetupKey } from '../../electron/services/harness/task-copies'
import {
  runWorkspaceSetup,
  planWorkspaceSetup
} from '../../electron/services/harness/workspace-setup'
import { useTempDir } from '../helpers/temp-dir'

// Labelling a folder Low runs icacls against real ACLs; the runner's logic does not depend on it.
vi.mock('../../electron/services/sandbox-service', () => ({
  isSandboxSupported: true,
  labelPathLowIntegrity: vi.fn(async () => undefined)
}))

const SESSION = 'session-1'
const project = { id: 'project-1', name: 'Test', path: null } as unknown as WatchedProject

const root = useTempDir('ostler-setup-')
let worktree: string

/** A committed repository standing in for the session's worktree. */
function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: worktree, encoding: 'utf8' })
}

/** The command, run through the same shell the runner uses, so a test can learn its pid. */
function shellCommand(command: string, cwd: string, env: NodeJS.ProcessEnv) {
  if (process.platform === 'win32') {
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

function harnessContext() {
  const workspace: HarnessWorkspace = {
    branchName: 'ostler/setup-task',
    worktreePath: worktree,
    baseBranch: 'main',
    baseCommit: 'abc',
    setup: { status: 'running' }
  }
  const state = {
    sessions: [{ id: SESSION, workspace, status: 'active' as 'active' | 'done' }],
    tasks: []
  }
  const ctx = {
    projectDir: () => root(),
    loadState: () => state,
    mutate: (_project: WatchedProject, mutation: (value: typeof state) => void) => mutation(state),
    notifyWorkspaceSetup: vi.fn(),
    recordEvent: vi.fn(),
    workspaceSetups: new Map()
  } as unknown as HarnessContext
  return { ctx, state, workspace }
}

/** The setup target for the test copy: records land on its workspace, as a copy's do. */
function target(workspace: HarnessWorkspace) {
  return {
    id: SESSION,
    worktreePath: workspace.worktreePath,
    save: (record: WorkspaceSetupRecord) => {
      workspace.setup = record
    }
  }
}

function run(
  command: string,
  options: Parameters<typeof runWorkspaceSetup>[5] = {},
  signal = new AbortController().signal
): Promise<WorkspaceSetupRecord> {
  const { ctx, workspace } = harnessContext()
  return runWorkspaceSetup(ctx, project, target(workspace), { command, source: 'custom' }, signal, {
    spawnShell: shellCommand,
    ...options
  })
}

/**
 * Whether a process is still running. A killed process whose parent is gone
 * stays a zombie until PID 1 reaps it, and some container inits never do, so
 * on Linux a zombie counts as gone.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  if (process.platform !== 'linux') return true
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z'
  } catch {
    return false
  }
}

const nodeScript = (script: string) => `node -e "${script}"`

beforeEach(() => {
  worktree = path.join(root(), 'slots', 'slot-1')
  fs.mkdirSync(worktree, { recursive: true })
  git('init', '-q')
  git('config', 'user.email', 'setup@example.test')
  git('config', 'user.name', 'Setup Test')
  fs.writeFileSync(path.join(worktree, 'README.md'), '# test\n')
  fs.writeFileSync(path.join(worktree, '.gitignore'), 'node_modules/\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'baseline')
})

describe('runWorkspaceSetup', () => {
  it('succeeds when the command only creates ignored output', async () => {
    const record = await run(
      nodeScript(
        "const f=require('fs');f.mkdirSync('node_modules');f.writeFileSync('node_modules/x','1')"
      )
    )
    expect(record.status).toBe('succeeded')
    expect(record.exitCode).toBe(0)
    expect(record.logPath && fs.existsSync(record.logPath)).toBe(true)
    expect(fs.readFileSync(record.logPath!, 'utf8')).toContain('[setup succeeded]')
  }, 30_000)

  it('fails, naming the paths, when it creates files Git does not ignore', async () => {
    const record = await run(nodeScript("require('fs').writeFileSync('junk.txt','x')"))
    expect(record.status).toBe('failed')
    expect(record.failure).toBe(
      "Setup created files Git doesn't ignore: junk.txt. Add them to .gitignore."
    )
  }, 30_000)

  it('fails when it changes a tracked file', async () => {
    const record = await run(nodeScript("require('fs').appendFileSync('README.md','edited')"))
    expect(record.status).toBe('failed')
    expect(record.failure).toBe('Setup changed tracked files: README.md')
  }, 30_000)

  it('fails with the exit code and the last line of output', async () => {
    const record = await run(nodeScript("console.error('registry unreachable'); process.exit(3)"))
    expect(record.status).toBe('failed')
    expect(record.exitCode).toBe(3)
    expect(record.failure).toBe(
      'Setup failed: `' +
        nodeScript("console.error('registry unreachable'); process.exit(3)") +
        '` exited 3 — registry unreachable'
    )
  }, 30_000)

  it('says plainly when the program is not installed', async () => {
    const record = await run('ostler-no-such-tool --install')
    expect(record.status).toBe('failed')
    expect(record.failure).toBe(
      '`ostler-no-such-tool` is not installed on this computer. Install it, or change the setup command in Project settings › Agents.'
    )
  }, 30_000)

  it('kills the whole process tree when it times out', async () => {
    const pidFile = path.join(root(), 'child.pid')
    const command = nodeScript(
      `require('fs').writeFileSync('${pidFile.replace(/\\/g, '/')}', String(process.pid)); setTimeout(()=>{}, 60000)`
    )
    const record = await run(command, { timeoutMs: 1500 })
    expect(record.status).toBe('failed')
    expect(record.failure).toMatch(/timed out/)
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    expect(isAlive(pid)).toBe(false)
  }, 30_000)

  it('is cancelled by its abort signal and leaves no process running', async () => {
    const pidFile = path.join(root(), 'abort.pid')
    const command = nodeScript(
      `require('fs').writeFileSync('${pidFile.replace(/\\/g, '/')}', String(process.pid)); setTimeout(()=>{}, 60000)`
    )
    const controller = new AbortController()
    const pending = run(command, {}, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    controller.abort()
    const record = await pending
    expect(record.status).toBe('cancelled')
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    expect(isAlive(pid)).toBe(false)
  }, 30_000)

  it('runs with CI=1, the slot temp folder, and no embedded-server password', async () => {
    const seen = path.join(root(), 'env.json')
    const script = `require('fs').writeFileSync('${seen.replace(/\\/g, '/')}', JSON.stringify({CI: process.env.CI, TEMP: process.env.TEMP, password: process.env.OPENCODE_SERVER_PASSWORD ?? null, git: process.env.GIT_DIR ?? null}))`
    const previousPassword = process.env.OPENCODE_SERVER_PASSWORD
    process.env.OPENCODE_SERVER_PASSWORD = 'must-not-reach-setup'
    try {
      const record = await run(nodeScript(script))
      expect(record.status).toBe('succeeded')
      const env = JSON.parse(fs.readFileSync(seen, 'utf8')) as Record<string, string | null>
      expect(env.CI).toBe('1')
      expect(env.TEMP).toContain('opencode-home')
      expect(env.password).toBeNull()
      expect(env.git).toBeNull()
    } finally {
      if (previousPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
      else process.env.OPENCODE_SERVER_PASSWORD = previousPassword
    }
  }, 30_000)
})

describe('a real install', () => {
  it('runs npm ci for a matching lockfile, and succeeds with node_modules ignored', async () => {
    fs.writeFileSync(
      path.join(worktree, 'package.json'),
      JSON.stringify({ name: 'setup-fixture', version: '1.0.0', private: true }, null, 2)
    )
    fs.writeFileSync(
      path.join(worktree, 'package-lock.json'),
      JSON.stringify(
        {
          name: 'setup-fixture',
          version: '1.0.0',
          lockfileVersion: 3,
          requires: true,
          packages: { '': { name: 'setup-fixture', version: '1.0.0' } }
        },
        null,
        2
      )
    )
    git('add', '-A')
    git('commit', '-q', '-m', 'lockfile')

    const plan = planWorkspaceSetup(project, worktree)
    expect(plan.run).toEqual({ command: 'npm ci', source: 'detected' })
    const { ctx, workspace } = harnessContext()
    const record = await runWorkspaceSetup(
      ctx,
      project,
      target(workspace),
      plan.run!,
      new AbortController().signal,
      { spawnShell: shellCommand }
    )
    expect(record.status, record.failure).toBe('succeeded')
    // Setup left nothing a human would have to review: the worktree is still clean.
    expect(git('status', '--porcelain').trim()).toBe('')
  }, 120_000)
})

describe('stopping a setup', () => {
  it("Stop aborts a copy's install, which records cancelled and leaves no process behind", async () => {
    const { ctx, workspace } = harnessContext()
    const pidFile = path.join(root(), 'force.pid')
    const command = nodeScript(
      `require('fs').writeFileSync('${pidFile.replace(/\\/g, '/')}', String(process.pid)); setTimeout(()=>{}, 60000)`
    )
    const key = copySetupKey('task-1')
    const controller = new AbortController()
    const done = runWorkspaceSetup(
      ctx,
      project,
      target(workspace),
      { command, source: 'custom' },
      controller.signal,
      { spawnShell: shellCommand }
    )
    ctx.workspaceSetups.set(key, { controller, done })
    await new Promise((resolve) => setTimeout(resolve, 1500))

    abortWorkspaceSetup(ctx, key)
    const record = await done

    expect(record.status).toBe('cancelled')
    expect(workspace.setup?.status).toBe('cancelled')
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    expect(isAlive(pid)).toBe(false)
  }, 30_000)

  it('reads an interrupted setup as cancelled once no setup is in flight', () => {
    const { ctx, state } = harnessContext()
    state.sessions[0].workspace!.setup = { status: 'running' }
    expect(sessions.workspaceSetupRecord(ctx, project, SESSION)).toMatchObject({
      status: 'cancelled'
    })
  })
})

describe('planWorkspaceSetup', () => {
  it('skips with a reason when the project is off', () => {
    const plan = planWorkspaceSetup(
      { ...project, agentSetup: { mode: 'off' } } as WatchedProject,
      worktree
    )
    expect(plan).toEqual({ setup: { status: 'skipped', skipReason: 'off' }, run: null })
  })

  it('skips with no-lockfile when automatic finds nothing to install', () => {
    const plan = planWorkspaceSetup(project, worktree)
    expect(plan.setup).toEqual({ status: 'skipped', skipReason: 'no-lockfile' })
    expect(plan.run).toBeNull()
  })

  it('plans the detected command as running', () => {
    fs.writeFileSync(path.join(worktree, 'package-lock.json'), '{}')
    const plan = planWorkspaceSetup(project, worktree)
    expect(plan.setup).toMatchObject({ status: 'running', command: 'npm ci', source: 'detected' })
    expect(plan.run).toEqual({ command: 'npm ci', source: 'detected' })
  })

  it('fails at once on a custom command that was saved blank by hand-editing', () => {
    const plan = planWorkspaceSetup(
      { ...project, agentSetup: { mode: 'custom', command: '   ' } } as WatchedProject,
      worktree
    )
    expect(plan.setup.status).toBe('failed')
    expect(plan.run).toBeNull()
  })
})
