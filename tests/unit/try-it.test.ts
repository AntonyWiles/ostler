import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import type { ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import simpleGit from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../electron/safe-storage', () => ({
  isEncryptionAvailable: () => true,
  isEncryptedSecret: (value: string) => value.startsWith('ostler-secure:v1:'),
  encryptApiKey: (key: string) => key,
  decryptApiKey: (value: string) => value,
  sealSecret: (token: string) => token,
  openSecret: (value: string) => value
}))
// Labelling a folder Low runs icacls against real ACLs; Try it does not depend on it.
vi.mock('../../electron/services/sandbox-service', () => ({
  isSandboxSupported: true,
  labelPathLowIntegrity: vi.fn(async () => undefined)
}))

import { CONFIG_MIGRATIONS, ConfigStore } from '../../electron/config-store'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import {
  copyStatus,
  filesTheRunChanged,
  TryItService,
  type TryItDeps
} from '../../electron/services/harness/try-it'
import { workspaceCommandEnvironment } from '../../electron/services/harness/workspace-setup'
import type {
  HarnessSession,
  WatchedProject,
  WorkspaceSetupRecord
} from '../../src/shared/ostler-api'
import type { TryRun } from '../../src/shared/try-it'
import { createMigratedDatabase } from '../helpers/database'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

const tempDir = useTempDir('ostler-try-it-')
/** Every Try service a test made, stopped before its folder goes. */
const services: TryItService[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stopAll()))
})

describe('config migration 31: Try it', () => {
  it('gives every project an empty try command and an unseen warning', () => {
    const configPath = path.join(tempDir(), 'config.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        configVersion: 30,
        projects: [
          { id: 'a', name: 'A', path: null, color: '#fff', enabled: true },
          { id: 'b', name: 'B', path: null, color: '#fff', enabled: true, tryCommand: 'npm test' }
        ]
      })
    )
    const store = new ConfigStore(configPath)
    const [a, b] = store.getProjects()
    expect(a).toMatchObject({ tryCommand: '', tryItWarningSeen: false })
    expect(b).toMatchObject({ tryCommand: 'npm test', tryItWarningSeen: false })
    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(onDisk.configVersion).toBeGreaterThanOrEqual(31)
    expect(CONFIG_MIGRATIONS.find((entry) => entry.version === 31)?.name).toBe('try-it')
  })

  it('saves the command as one line and refuses a multi-line or over-long one', () => {
    const store = new ConfigStore(path.join(tempDir(), 'config.json'))
    const project = store.registerProject({ name: 'P', folder: null })
    expect(project).toMatchObject({ tryCommand: '', tryItWarningSeen: false })
    expect(store.updateProject(project.id, { tryCommand: ' npm run dev ' }).tryCommand).toBe(
      'npm run dev'
    )
    expect(() => store.updateProject(project.id, { tryCommand: 'npm ci\nnpm run dev' })).toThrow(
      /one line/
    )
    expect(() => store.updateProject(project.id, { tryCommand: 'x'.repeat(501) })).toThrow(/500/)
    expect(store.getProjects()[0].tryCommand).toBe('npm run dev')
    expect(store.updateProject(project.id, { tryCommand: '' }).tryCommand).toBe('')
  })
})

/** A committed repository standing in for a task's copy. */
async function makeCopy(): Promise<string> {
  const copy = path.join(tempDir(), 'copy')
  fs.mkdirSync(copy, { recursive: true })
  fs.writeFileSync(path.join(copy, 'a.txt'), 'a\n')
  fs.writeFileSync(path.join(copy, 'b.txt'), 'b\n')
  fs.writeFileSync(path.join(copy, '.gitignore'), 'ignored/\n')
  const git = simpleGit(copy)
  await git.init()
  await git.addConfig('user.email', 'test@example.com')
  await git.addConfig('user.name', 'Test')
  await git.addConfig('core.autocrlf', 'false')
  await git.add('.')
  await git.commit('initial')
  return copy
}

/** A child process the test drives: it writes output and exits when told. */
class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 4242
  exit(code: number | null) {
    this.stdout.end()
    this.stderr.end()
    setImmediate(() => this.emit('close', code))
  }
}

interface Harness {
  service: TryItService
  project: WatchedProject
  spawned: { command: string; cwd: string; env: NodeJS.ProcessEnv; child: FakeChild }[]
  order: string[]
  killed: number[]
  swept: string[]
  pushed: TryRun[]
  setup: { result: WorkspaceSetupRecord }
}

function makeHarness(
  copy: string,
  overrides: Partial<WatchedProject> = {},
  onSpawn?: (child: FakeChild) => void
): Harness {
  const project = {
    id: 'p1',
    name: 'P',
    path: null,
    tryCommand: 'npm run dev',
    tryItWarningSeen: true,
    ...overrides
  } as WatchedProject
  const session = {
    id: 's1',
    status: 'done',
    workspace: { branchName: 'ostler/s1', worktreePath: copy, baseBranch: 'main', baseCommit: 'x' }
  } as unknown as HarnessSession
  const harness: Harness = {
    project,
    spawned: [],
    order: [],
    killed: [],
    swept: [],
    pushed: [],
    setup: { result: { status: 'succeeded' } },
    service: null as unknown as TryItService
  }
  const deps: TryItDeps = {
    getProject: () => project,
    findSession: (_project, sessionId) => (sessionId === 's1' ? session : null),
    ensureSetup: async () => {
      harness.order.push('setup')
      return harness.setup.result
    },
    markWarningSeen: () => {
      project.tryItWarningSeen = true
    },
    notify: (run) => harness.pushed.push(run),
    spawnShell: (command, cwd, env) => {
      harness.order.push('spawn')
      const child = new FakeChild()
      harness.spawned.push({ command, cwd, env, child })
      onSpawn?.(child)
      return child as unknown as ChildProcess
    },
    killTree: async (pid) => {
      harness.killed.push(pid)
      harness.spawned.at(-1)?.child.exit(null)
    },
    stopInside: async (dir) => {
      harness.swept.push(dir)
    },
    prepareEnvironment: async () => undefined
  }
  harness.service = new TryItService(deps)
  services.push(harness.service)
  return harness
}

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting')
}

describe('TryItService (N9.4)', { timeout: 30_000 }, () => {
  it('refuses without a try command, and never runs the agent suggestion', async () => {
    const copy = await makeCopy()
    const harness = makeHarness(copy, { tryCommand: '' })
    await expect(harness.service.start('p1', 's1', true)).rejects.toThrow(/try command/i)
    expect(harness.spawned).toHaveLength(0)
  })

  it('shows the warning once per project: refused without it, then remembered', async () => {
    const copy = await makeCopy()
    const harness = makeHarness(copy, { tryItWarningSeen: false })
    await expect(harness.service.start('p1', 's1', false)).rejects.toThrow(/warning/)
    expect(harness.spawned).toHaveLength(0)
    await harness.service.start('p1', 's1', true)
    expect(harness.project.tryItWarningSeen).toBe(true)
    await until(() => harness.spawned.length === 1)
    harness.spawned[0].child.exit(0)
    await until(() => harness.service.get('s1')?.state === 'exited')
    // Seen now: the next run needs no acknowledgement.
    await harness.service.start('p1', 's1', false)
    await until(() => harness.spawned.length === 2)
    harness.spawned[1].child.exit(0)
  })

  it('runs setup first, then the command in the copy, without the runner secrets', async () => {
    const copy = await makeCopy()
    const harness = makeHarness(copy)
    process.env.OPENCODE_SERVER_PASSWORD = 'secret-1'
    process.env.OSTLER_BRIDGE_SECRET = 'secret-2'
    try {
      await harness.service.start('p1', 's1', false)
      await until(() => harness.spawned.length === 1)
    } finally {
      delete process.env.OPENCODE_SERVER_PASSWORD
      delete process.env.OSTLER_BRIDGE_SECRET
    }
    expect(harness.order).toEqual(['setup', 'spawn'])
    const { command, cwd, env, child } = harness.spawned[0]
    expect(command).toBe('npm run dev')
    expect(cwd).toBe(copy)
    expect(env.OPENCODE_SERVER_PASSWORD).toBeUndefined()
    expect(env.OSTLER_BRIDGE_SECRET).toBeUndefined()
    child.exit(0)
    await until(() => harness.service.get('s1')?.state === 'exited')
  })

  it('does not run the command when setup fails', async () => {
    const copy = await makeCopy()
    const harness = makeHarness(copy)
    harness.setup.result = { status: 'failed', failure: 'Setup failed: npm ci exited 1' }
    await harness.service.start('p1', 's1', false)
    await until(() => harness.service.get('s1')?.state === 'failed')
    expect(harness.service.get('s1')?.failure).toMatch(/npm ci exited 1/)
    expect(harness.spawned).toHaveLength(0)
  })

  it('the environment is the one workspace setup uses', () => {
    process.env.OSTLER_BRIDGE_SECRET = 'secret'
    try {
      const env = workspaceCommandEnvironment(tempDir())
      expect(env.OSTLER_BRIDGE_SECRET).toBeUndefined()
      expect(env.CI).toBe('1')
    } finally {
      delete process.env.OSTLER_BRIDGE_SECRET
    }
  })

  it('shows output as lines without colour codes, one Try at a time', async () => {
    const copy = await makeCopy()
    const harness = makeHarness(copy)
    await harness.service.start('p1', 's1', false)
    await until(() => harness.spawned.length === 1)
    await expect(harness.service.start('p1', 's1', false)).rejects.toThrow(/already running/)
    const { child } = harness.spawned[0]
    child.stdout.write('\x1b[32mVITE\x1b[0m ready\r\n  Local:   http://localhost:5173/\n')
    child.stderr.write('progress 1\rprogress 2\n')
    await until(() => (harness.service.get('s1')?.lines.length ?? 0) >= 4)
    expect(harness.service.get('s1')?.lines).toEqual([
      '$ npm run dev',
      'VITE ready',
      '  Local:   http://localhost:5173/',
      'progress 2'
    ])
    expect(harness.service.get('s1')?.state).toBe('running')
    child.exit(3)
    await until(() => harness.service.get('s1')?.state === 'exited')
    expect(harness.service.get('s1')?.exitCode).toBe(3)
  })

  it('Stop kills the process tree and everything still running from the copy', async () => {
    const copy = await makeCopy()
    const harness = makeHarness(copy)
    await harness.service.start('p1', 's1', false)
    await until(() => harness.spawned.length === 1)
    const stopped = await harness.service.stop('s1')
    expect(stopped?.state).toBe('stopped')
    expect(harness.killed).toEqual([4242])
    expect(harness.swept).toContain(copy)
  })

  it('a run that exits on its own still has its detached processes swept', async () => {
    const copy = await makeCopy()
    const harness = makeHarness(copy)
    await harness.service.start('p1', 's1', false)
    await until(() => harness.spawned.length === 1)
    harness.spawned[0].child.exit(0)
    await until(() => harness.service.get('s1')?.state === 'exited')
    expect(harness.swept).toEqual([copy])
  })

  it('stops before every verdict and refuses Apply while the run left files', async () => {
    const copy = await makeCopy()
    const harness = makeHarness(copy, {}, () => {
      fs.writeFileSync(path.join(copy, 'b.txt'), 'changed by the run\n')
    })
    await harness.service.start('p1', 's1', false)
    await until(() => harness.spawned.length === 1)
    await expect(harness.service.beforeVerdict('s1', 'apply')).rejects.toThrow(
      /left 1 changed file/
    )
    expect(harness.killed).toEqual([4242])
    expect(harness.service.get('s1')?.state).toBe('stopped')
    // Keep them: Apply may go ahead, and the run is forgotten.
    harness.service.keepLeftFiles('s1')
    await harness.service.beforeVerdict('s1', 'apply')
    expect(harness.service.get('s1')).toBeNull()
  })

  it('Send back, Discard and Stop stop a running Try without asking about files', async () => {
    const copy = await makeCopy()
    const harness = makeHarness(copy, {}, () => {
      fs.writeFileSync(path.join(copy, 'new.txt'), 'new\n')
    })
    await harness.service.start('p1', 's1', false)
    await until(() => harness.spawned.length === 1)
    await harness.service.beforeVerdict('s1', 'other')
    expect(harness.killed).toEqual([4242])
    expect(harness.service.get('s1')).toBeNull()
  })

  it('quitting stops every run', async () => {
    const copy = await makeCopy()
    const harness = makeHarness(copy)
    await harness.service.start('p1', 's1', false)
    await until(() => harness.spawned.length === 1)
    await harness.service.stopAll()
    expect(harness.killed).toEqual([4242])
    expect(harness.service.get('s1')?.state).toBe('stopped')
  })

  it("lists only the run's files, and Undo puts back only those", async () => {
    const copy = await makeCopy()
    // Already changed before the run: never the run's, never touched.
    fs.writeFileSync(path.join(copy, 'a.txt'), 'edited before\n')
    fs.writeFileSync(path.join(copy, 'before.txt'), 'untracked before\n')
    const harness = makeHarness(copy, {}, () => {
      fs.writeFileSync(path.join(copy, 'a.txt'), 'edited again by the run\n')
      fs.writeFileSync(path.join(copy, 'b.txt'), 'changed by the run\n')
      fs.mkdirSync(path.join(copy, 'out'), { recursive: true })
      fs.writeFileSync(path.join(copy, 'out', 'added.txt'), 'added by the run\n')
      fs.mkdirSync(path.join(copy, 'ignored'), { recursive: true })
      fs.writeFileSync(path.join(copy, 'ignored', 'cache.txt'), 'ignored\n')
    })
    await harness.service.start('p1', 's1', false)
    await until(() => harness.spawned.length === 1)
    harness.spawned[0].child.exit(0)
    await until(() => harness.service.get('s1')?.state === 'exited')
    expect(harness.service.get('s1')?.leftFiles).toEqual(['b.txt', 'out/added.txt'])

    const undone = await harness.service.undoLeftFiles('s1')
    expect(undone.leftFiles).toEqual([])
    expect(fs.readFileSync(path.join(copy, 'b.txt'), 'utf8')).toBe('b\n')
    expect(fs.existsSync(path.join(copy, 'out', 'added.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(copy, 'a.txt'), 'utf8')).toBe('edited again by the run\n')
    expect(fs.readFileSync(path.join(copy, 'before.txt'), 'utf8')).toBe('untracked before\n')
    expect(fs.existsSync(path.join(copy, 'ignored', 'cache.txt'))).toBe(true)
  })

  it('compares status before and after by path', async () => {
    const copy = await makeCopy()
    const before = await copyStatus(copy)
    fs.writeFileSync(path.join(copy, 'c.txt'), 'c\n')
    expect(filesTheRunChanged(before, await copyStatus(copy))).toEqual(['c.txt'])
  })
})

describe('HarnessService and Try it (N9.4)', { timeout: 30_000 }, () => {
  let database: EventDatabase
  let service: HarnessService
  let project: WatchedProject

  beforeEach(async () => {
    const projectDir = path.join(tempDir(), 'project')
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'app.ts'), 'original\n')
    const git = simpleGit(projectDir)
    await git.init()
    await git.addConfig('user.email', 'test@example.com')
    await git.addConfig('user.name', 'Test')
    await git.addConfig('core.autocrlf', 'false')
    await git.raw(['checkout', '-B', 'main'])
    await git.add('.')
    await git.commit('initial commit')
    database = new EventDatabase(await createMigratedDatabase(tempDir()))
    service = new HarnessService(path.join(tempDir(), 'data'), database)
    project = makeWatchedProject({
      id: 'project-1',
      name: 'Test project',
      path: projectDir,
      color: '#fff',
      addedAt: Date.now()
    })
  })

  afterEach(() => {
    service.stopAll()
    database.close()
  })

  it('asks Try it to stop before Apply, Send back, Discard and Stop', async () => {
    const calls: [string, string][] = []
    service.setBeforeVerdict(async (_project, sessionId, verdict) => {
      calls.push([sessionId, verdict])
    })
    const task = service.addTask(project, 'Change app', 'Edit app.ts')
    const session = await service.startSessionForTask(project, task.id)
    // Still working: each verdict is refused, but only after Try it was asked.
    await expect(service.applyTaskWork(project, session.id)).rejects.toThrow()
    await expect(service.discardTaskWork(project, session.id)).rejects.toThrow()
    await expect(
      service.sendBackTaskWork(project, session.id, 'Wrong file', 'retry')
    ).rejects.toThrow()
    await service.stopSession(project, session.id)
    expect(calls).toEqual([
      [session.id, 'apply'],
      [session.id, 'other'],
      [session.id, 'other'],
      [session.id, 'other']
    ])
  })

  it('a refusal from Try it stops Apply', async () => {
    service.setBeforeVerdict(async () => {
      throw new Error('Try it left 2 changed files')
    })
    const task = service.addTask(project, 'Change app', 'Edit app.ts')
    const session = await service.startSessionForTask(project, task.id)
    await expect(service.applyTaskWork(project, session.id)).rejects.toThrow(/Try it left/)
  })

  it('runs setup in the copy when it has not succeeded, and records it once', async () => {
    const task = service.addTask(project, 'Change app', 'Edit app.ts')
    const session = await service.startSessionForTask(project, task.id)
    expect(service.findSession(project, session.id)?.workspace?.setup?.status).toBe('skipped')
    const withSetup = {
      ...project,
      agentSetup: { mode: 'custom' as const, command: 'node -e "process.exit(0)"' }
    }
    const record = await service.ensureSessionSetup(
      withSetup,
      session.id,
      new AbortController().signal
    )
    expect(record.status).toBe('succeeded')
    expect(service.findSession(project, session.id)?.workspace?.setup?.status).toBe('succeeded')
    // Succeeded: not run again.
    const again = await service.ensureSessionSetup(
      { ...withSetup, agentSetup: { mode: 'custom', command: 'exit 1' } },
      session.id,
      new AbortController().signal
    )
    expect(again.status).toBe('succeeded')
  })
})
