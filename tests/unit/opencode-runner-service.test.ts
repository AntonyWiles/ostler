import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import simpleGit from 'simple-git'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import {
  DEFAULT_OPENCODE_RUNNER_DEPS,
  OpenCodeRunnerService,
  type OpenCodeRunnerDeps
} from '../../electron/services/opencode-runner-service'
import {
  CUSTOM_PROVIDER_ID,
  openCodeProviderConfig,
  resolveOpenCodeTarget,
  slotPermissions
} from '../../electron/services/opencode/slot-config'
import { resolveProjectConventions } from '../../electron/services/project-conventions'
import { RunGuidanceService } from '../../electron/services/run-guidance'
import {
  isPathWithinSlot,
  assertPathWithinSlot
} from '../../electron/services/opencode/slot-path-check'
import type { HarnessSession, OstlerConfig, WatchedProject } from '../../src/shared/ostler-api'
import { DEFAULT_CONFIG } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

// The Low-IL launcher is faked below, so the Windows-only platform gate is the
// only thing stopping these tests running on Linux and macOS.
vi.mock('../../electron/services/sandbox-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../electron/services/sandbox-service')>()),
  isSandboxSupported: true
}))

/** What the tool-call bridge answers an embedded agent's tool call with. */
type ToolCallReply = { ok?: boolean; blocked?: boolean; warn?: string; error?: string }

/**
 * Fakes the opencode HTTP surface OpenCodeRunnerService actually calls:
 * health check (/doc), session creation (POST /session), sending the first
 * message (POST /session/:id/message), and message-count polling
 * (GET /session/:id/message). No real process or network I/O happens - the
 * Low-IL launcher is also faked so this test never spawns anything.
 */
function fakeFetch(messageCounts: number[] = [1]): typeof fetch {
  let pollIndex = -1
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.endsWith('/doc')) {
      return new Response(null, { status: 200 })
    }
    if (method === 'POST' && url.endsWith('/session')) {
      return new Response(JSON.stringify({ id: 'oc-session-1' }), { status: 200 })
    }
    if (method === 'POST' && url.endsWith('/message')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    if (method === 'POST' && url.endsWith('/prompt_async')) {
      return new Response(null, { status: 204 })
    }
    if (method === 'GET' && url.endsWith('/message')) {
      pollIndex += 1
      const count = messageCounts[Math.min(pollIndex, messageCounts.length - 1)]
      return new Response(JSON.stringify(new Array(count).fill({})), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`)
  }) as unknown as typeof fetch
}

/**
 * An assistant message on the bridge: the proof that the model actually
 * answered. Without it a session that goes idle is recorded as no-response.
 */
function modelReplied(
  bridgeUrl: string,
  headers: Record<string, string>,
  sessionId: string,
  projectId: string
): Promise<Response> {
  return fetch(`${bridgeUrl}/event`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sessionId,
      projectId,
      event: {
        id: `evt_reply_${sessionId}`,
        type: 'message.updated',
        properties: { info: { role: 'assistant' } }
      }
    })
  })
}

describe('opencode-runner-service.ts', { timeout: 30_000 }, () => {
  const tempDir = useTempDir('ostler-opencode-runner-')
  let projectDir: string
  let database: EventDatabase
  let harnessService: HarnessService
  let project: WatchedProject
  let config: OstlerConfig

  beforeEach(async () => {
    projectDir = path.join(tempDir(), 'project')
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'app.ts'), 'original\n')
    const git = simpleGit(projectDir)
    await git.init()
    await git.addConfig('user.email', 'test@example.com')
    await git.addConfig('user.name', 'Test')
    await git.add('.')
    await git.commit('initial')

    database = new EventDatabase(await createMigratedDatabase(tempDir()))
    harnessService = new HarnessService(path.join(tempDir(), 'data'), database)
    project = makeWatchedProject({
      id: 'project-1',
      name: 'Test project',
      path: projectDir,
      color: '#fff',
      addedAt: Date.now()
    })
    config = { ...DEFAULT_CONFIG, ai: { ...DEFAULT_CONFIG.ai, apiKey: '' } }
  })

  afterEach(() => {
    database.close()
  })

  describe('defense-in-depth path validation', () => {
    it('allows paths within the slot directory', () => {
      const slot = 'C:\\ostler\\slots\\slot-1'
      expect(isPathWithinSlot(slot, 'C:\\ostler\\slots\\slot-1\\file.ts')).toBe(true)
      expect(isPathWithinSlot(slot, 'C:\\ostler\\slots\\slot-1\\src\\sub\\file.ts')).toBe(true)
      expect(isPathWithinSlot(slot, 'file.ts')).toBe(true)
      expect(isPathWithinSlot(slot, 'src/sub/file.ts')).toBe(true)
      expect(() => assertPathWithinSlot(slot, 'src/file.ts', 'write')).not.toThrow()
    })

    // Backslash paths only separate directories on Windows; elsewhere they are one filename.
    it.runIf(process.platform === 'win32')('blocks paths escaping the slot directory', () => {
      const slot = 'C:\\ostler\\slots\\slot-1'
      expect(isPathWithinSlot(slot, 'C:\\ostler\\slots\\slot-2\\file.ts')).toBe(false)
      expect(isPathWithinSlot(slot, 'C:\\Windows\\System32\\calc.exe')).toBe(false)
      expect(isPathWithinSlot(slot, '..\\..\\secret.txt')).toBe(false)
      expect(isPathWithinSlot(slot, '../../secret.txt')).toBe(false)
      expect(() => assertPathWithinSlot(slot, '../../secret.txt', 'write')).toThrow(
        /Ostler defense-in-depth: write execution outside workspace slot is blocked/
      )
    })

    it.skipIf(process.platform === 'win32')(
      'blocks POSIX paths escaping the slot directory',
      () => {
        const slot = '/ostler/slots/slot-1'
        expect(isPathWithinSlot(slot, '/ostler/slots/slot-1/src/file.ts')).toBe(true)
        expect(isPathWithinSlot(slot, '/ostler/slots/slot-2/file.ts')).toBe(false)
        expect(isPathWithinSlot(slot, '/ostler/slots/slot-10/file.ts')).toBe(false)
        expect(isPathWithinSlot(slot, '/etc/passwd')).toBe(false)
        expect(isPathWithinSlot(slot, '../../secret.txt')).toBe(false)
        expect(() => assertPathWithinSlot(slot, '../../secret.txt', 'write')).toThrow(
          /Ostler defense-in-depth: write execution outside workspace slot is blocked/
        )
      }
    )
  })

  /** A session as stored, ended or not: a run that saved nothing ends without waiting for review. */
  const storedSession = (sessionId: string) =>
    (
      harnessService as unknown as {
        ctx: { loadState(projectId: string): { sessions: HarnessSession[] } | null }
      }
    ).ctx
      .loadState(project.id)
      ?.sessions.find((item) => item.id === sessionId)

  it('uses a project provider/model only when its explicit override is enabled', () => {
    config.ai.provider = 'openai'
    config.ai.model = 'gpt-global'
    project.autoDispatch = {
      projectId: project.id,
      enabled: true,
      maxConcurrentEmbeddedSessions: 2,
      aiOverrideEnabled: false,
      defaultProvider: 'anthropic',
      defaultModel: 'claude-project',
      defaultEffort: '',
      autoArchiveDoneAfterDays: 0
    }

    expect(resolveOpenCodeTarget(config, project)).toMatchObject({
      providerID: 'openai',
      modelID: 'gpt-global'
    })

    project.autoDispatch!.aiOverrideEnabled = true
    expect(resolveOpenCodeTarget(config, project)).toMatchObject({
      providerID: 'anthropic',
      modelID: 'claude-project'
    })
  })

  it("takes the agent's own effort with its own model, Ostler AI's otherwise, the project's on an override", () => {
    config.ai = { ...config.ai, provider: 'openai', model: 'gpt-global', effort: 'low' }
    config.harness = { ...config.harness, agentProvider: '', agentModel: '', agentEffort: 'max' }
    expect(resolveOpenCodeTarget(config, project).effort).toBe('low')

    config.harness = { ...config.harness, agentProvider: 'anthropic', agentModel: 'claude-x' }
    expect(resolveOpenCodeTarget(config, project).effort).toBe('max')

    config.harness = { ...config.harness, agentEffort: '' }
    expect(resolveOpenCodeTarget(config, project).effort).toBeUndefined()

    project.autoDispatch = {
      projectId: project.id,
      enabled: true,
      maxConcurrentEmbeddedSessions: 1,
      aiOverrideEnabled: true,
      defaultProvider: 'openai',
      defaultModel: 'gpt-project',
      defaultEffort: '',
      autoArchiveDoneAfterDays: 0
    }
    config.harness = { ...config.harness, agentEffort: 'high' }
    expect(resolveOpenCodeTarget(config, project).effort).toBeUndefined()
    project.autoDispatch.defaultEffort = 'medium'
    expect(resolveOpenCodeTarget(config, project).effort).toBe('medium')
  })

  it("writes the effort as each AI SDK package's own model option in opencode.json", () => {
    const at = (provider: 'openai' | 'anthropic' | 'google', modelID: string) =>
      openCodeProviderConfig({ providerID: provider, provider, modelID, effort: 'high' }, '')
    expect(at('openai', 'gpt-5')).toEqual({
      openai: { models: { 'gpt-5': { options: { reasoningEffort: 'high' } } } }
    })
    expect(at('anthropic', 'claude-opus-5-5')).toEqual({
      anthropic: { models: { 'claude-opus-5-5': { options: { effort: 'high' } } } }
    })
    expect(at('google', 'gemini-3.5-flash')).toEqual({
      google: {
        models: { 'gemini-3.5-flash': { options: { thinkingConfig: { thinkingLevel: 'high' } } } }
      }
    })
    expect(
      openCodeProviderConfig({ providerID: 'openai', provider: 'openai', modelID: 'gpt-5' }, '')
    ).toBeUndefined()

    const custom = openCodeProviderConfig(
      { providerID: CUSTOM_PROVIDER_ID, provider: 'custom', modelID: 'x/y', effort: 'low' },
      'https://openrouter.ai/api/v1'
    ) as Record<string, { models: Record<string, unknown> }>
    expect(custom[CUSTOM_PROVIDER_ID].models['x/y']).toEqual({
      options: { reasoningEffort: 'low' }
    })
  })

  it("uses the built-in agent's own model from Settings › Agents, else Ostler AI's", () => {
    config.ai = { ...config.ai, provider: 'openai', model: 'gpt-global' }
    config.harness = { ...config.harness, agentProvider: '', agentModel: '' }
    expect(resolveOpenCodeTarget(config, project)).toMatchObject({ modelID: 'gpt-global' })

    config.harness = { ...config.harness, agentModel: 'gpt-agent' }
    expect(resolveOpenCodeTarget(config, project)).toMatchObject({
      providerID: 'openai',
      modelID: 'gpt-agent'
    })

    config.harness = { ...config.harness, agentProvider: 'anthropic', agentModel: 'claude-agent' }
    expect(resolveOpenCodeTarget(config, project)).toMatchObject({
      providerID: 'anthropic',
      modelID: 'claude-agent'
    })
  })

  it('lets the agent open its attachments folder without a permission prompt nobody can answer', () => {
    const rules = slotPermissions('C:\\data\\runtime\\slot-1\\opencode-home\\attachments') as {
      external_directory: Record<string, string>
      doom_loop: string
    }
    const entries = Object.entries(rules.external_directory)
    // Catch-all first: opencode applies the last matching rule.
    expect(entries[0]).toEqual(['*', 'deny'])
    expect(
      rules.external_directory['C:\\data\\runtime\\slot-1\\opencode-home\\attachments\\*']
    ).toBe('allow')
    expect(rules.external_directory['C:/data/runtime/slot-1/opencode-home/attachments/*']).toBe(
      'allow'
    )
    expect(Object.values(rules.external_directory)).not.toContain('ask')
    expect(rules.doom_loop).toBe('deny')
  })

  it('ends an embedded session a force-quit left marked active instead of leaving it working forever', async () => {
    const task = harnessService.addTask(project, 'Fix the bug', 'Do the thing')
    // Started by a previous Ostler run that died without stopAll: the session
    // is stored as active, but no runner in this process is tracking it.
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const stopWorkspaceProcesses = vi.fn().mockResolvedValue([])
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      { stopWorkspaceProcesses }
    )

    expect(await runner.recoverInterruptedSessions(project)).toBe(1)

    const state = harnessService.getState(project)
    expect(state.activeSessions.find((item) => item.id === session.id)?.status).not.toBe('active')
    expect(stopWorkspaceProcesses).toHaveBeenCalledWith(session.workspace!.worktreePath)
    // Ostler cut it off; the agent did not give up, so the task is not held.
    expect(state.taskQueue.find((item) => item.id === task.id)?.hold).toBeFalsy()
    // Idempotent: a second startup finds nothing left to recover.
    expect(await runner.recoverInterruptedSessions(project)).toBe(0)
  })

  it('starts an embedded session, injects plugin and tool files, and records embedded runtime', async () => {
    const task = harnessService.addTask(project, 'Fix the bug', 'Do the thing')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    expect(session.provenance).toBe('embedded')
    expect(session.workspace).not.toBeNull()

    const launch = vi.fn().mockResolvedValue({ pid: 4242 })
    const killProcess = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = fakeFetch([1, 1, 1, 1])
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch,
        fetchImpl,
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess,
        choosePort: async () => 42011,
        pollIntervalMs: 100000,
        idleStablePolls: 10,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000
      }
    )

    harnessService.touchSessionConnection(project, session.id)
    const claimedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === task.id)!

    await runner.start(project, session, claimedTask)

    expect(launch).toHaveBeenCalledTimes(1)
    const [command, args, cwd, options] = launch.mock.calls[0]
    expect(command).toBe('C:\\fake\\opencode.exe')
    expect(args).toEqual(['serve', '--port', '42011', '--hostname', '127.0.0.1'])
    expect(cwd).toBe(session.workspace!.worktreePath)
    expect(options.environment.OSTLER_BRIDGE_PORT).toBeDefined()
    expect(options.environment.OSTLER_BRIDGE_SECRET).toBeDefined()
    expect(options.environment.OSTLER_SESSION_ID).toBe(session.id)

    const messageRequest = vi
      .mocked(fetchImpl)
      .mock.calls.find(
        ([input, init]) =>
          init?.method === 'POST' && String(input).endsWith('/session/oc-session-1/message')
      )
    const prompt = JSON.parse(String(messageRequest?.[1]?.body)) as {
      parts: Array<{ text: string }>
    }
    expect(prompt.parts[0].text).toContain('ostler_complete_task')

    // The turn-long POST must carry a dispatcher with the header/body timeouts
    // disabled. undici's 300s headersTimeout default otherwise overrides
    // sendMessageTimeoutMs and kills any agent turn past five minutes --
    // observed live, mid-edit, before the agent could commit.
    const messageInit = messageRequest?.[1] as (RequestInit & { dispatcher?: unknown }) | undefined
    expect(messageInit?.dispatcher).toBeDefined()
    // The opening message carries this task's scope and its workspace baseline,
    // and points at the instructions file for everything durable. The standing
    // rules themselves are asserted against that file below, not here: keeping
    // a second copy in the prompt is what they are deliberately not.
    expect(prompt.parts[0].text).toContain('Fix the bug')
    expect(prompt.parts[0].text).toContain(session.workspace!.baseBranch)
    expect(prompt.parts[0].text).toContain('OSTLER_AGENT_INSTRUCTIONS.md')

    // Verify injected plugin and tool files in slot
    const slotPath = session.workspace!.worktreePath
    const runtimeHome = path.join(
      path.dirname(path.dirname(slotPath)),
      'runtime',
      path.basename(slotPath),
      'opencode-home'
    )
    const pluginPath = path.join(runtimeHome, 'plugins', 'ostler-plugin.js')
    const toolPath = path.join(runtimeHome, 'config', 'opencode', 'tool', 'ostler_ask_question.ts')
    const completionToolPath = path.join(
      runtimeHome,
      'config',
      'opencode',
      'tool',
      'ostler_complete_task.ts'
    )
    const configPath = path.join(runtimeHome, 'config', 'opencode', 'opencode.json')
    const instructionsPath = path.join(
      runtimeHome,
      'config',
      'opencode',
      'OSTLER_AGENT_INSTRUCTIONS.md'
    )

    expect(fs.existsSync(pluginPath)).toBe(true)
    expect(fs.existsSync(toolPath)).toBe(true)
    expect(fs.existsSync(completionToolPath)).toBe(true)
    expect(fs.existsSync(configPath)).toBe(true)
    expect(fs.existsSync(instructionsPath)).toBe(true)

    // The durable operating contract lives here and is loaded on every turn,
    // rather than being stated once in the opening message and scrolling away
    // behind a long tool transcript.
    const instructions = fs.readFileSync(instructionsPath, 'utf8')
    expect(instructions).toContain('ostler_complete_task')
    expect(instructions).toContain('ostler_ask_question')
    expect(instructions).toContain('Uncommitted changes are never merged')
    expect(instructions).toContain(session.workspace!.baseBranch)
    expect(instructions).toContain(session.workspace!.baseCommit)

    // opencode only loads it if the slot config points at it; writing the file
    // without referencing it would silently drop every rule in it.
    const slotConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      instructions?: string[]
    }
    expect(slotConfig.instructions).toEqual([instructionsPath.replace(/\\/g, '/')])
    expect(fs.existsSync(path.join(slotPath, '.ostler-opencode-home'))).toBe(false)
    expect(fs.existsSync(path.join(slotPath, '.opencode'))).toBe(false)
    // Legacy plural `tools` directories are not scanned by opencode: writing
    // there is what silently stripped the agent of ostler_complete_task.
    expect(fs.existsSync(path.join(runtimeHome, 'tools'))).toBe(false)
    expect(fs.existsSync(path.join(slotPath, '.opencode', 'tools'))).toBe(false)

    const pluginContent = fs.readFileSync(pluginPath, 'utf8')
    expect(pluginContent).toContain('tool.execute.before')
    expect(pluginContent).toContain('isWithinSlot')

    const toolContent = fs.readFileSync(toolPath, 'utf8')
    expect(toolContent).toContain('export default tool')
    expect(toolContent).toContain('/ask')
    expect(fs.readFileSync(completionToolPath, 'utf8')).toContain('/complete')

    await runner.stop(session.id)
  })

  it('writes the project conventions beside the instructions and loads them, from the one resolver', async () => {
    project = { ...project, agentConventions: '  # House rules\n\nUse tabs.  ' }
    const task = harnessService.addTask(project, 'Fix the bug', 'Do the thing')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const fetchImpl = fakeFetch([1, 1, 1, 1])
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch: vi.fn().mockResolvedValue({ pid: 4242 }),
        fetchImpl,
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess: vi.fn().mockResolvedValue(undefined),
        choosePort: async () => 42012,
        pollIntervalMs: 100000,
        idleStablePolls: 10,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000
      }
    )
    harnessService.touchSessionConnection(project, session.id)
    const claimedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === task.id)!
    await runner.start(project, session, claimedTask)

    const slotPath = session.workspace!.worktreePath
    const configDir = path.join(
      path.dirname(path.dirname(slotPath)),
      'runtime',
      path.basename(slotPath),
      'opencode-home',
      'config',
      'opencode'
    )
    const conventionsPath = path.join(configDir, 'OSTLER_PROJECT_CONVENTIONS.md')
    expect(fs.readFileSync(conventionsPath, 'utf8')).toBe(resolveProjectConventions(project))
    const slotConfig = JSON.parse(
      fs.readFileSync(path.join(configDir, 'opencode.json'), 'utf8')
    ) as Record<string, unknown>
    expect(slotConfig.instructions).toEqual([
      path.join(configDir, 'OSTLER_AGENT_INSTRUCTIONS.md').replace(/\\/g, '/'),
      conventionsPath.replace(/\\/g, '/')
    ])
    // Only `instructions` changed: opencode rejects any unknown top-level key.
    expect(Object.keys(slotConfig).sort()).toEqual(['instructions', 'permission', 'plugin'])
    // Project context, not prompt text: the opening message does not carry it.
    const messageRequest = vi
      .mocked(fetchImpl)
      .mock.calls.find(
        ([input, init]) =>
          init?.method === 'POST' && String(input).endsWith('/session/oc-session-1/message')
      )
    expect(String(messageRequest?.[1]?.body)).not.toContain('House rules')
    await runner.stop(session.id)
  })

  it("runs with the run's own model and effort (D42), written into the slot like the global one", async () => {
    config = {
      ...config,
      ai: { ...config.ai, provider: 'anthropic', model: 'claude-sonnet-5-5', effort: '' }
    }
    const task = harnessService.addTask(project, 'Fix the bug', 'Do the thing')
    // Chosen when queued, then changed while it waits: the change is what runs.
    harnessService.setTaskRunModel(project, task.id, { model: 'claude-opus-5-5', effort: '' })
    harnessService.setTaskRunModel(project, task.id, {
      model: 'claude-haiku-5-5',
      effort: 'low'
    })
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    // Once a run has the task, its model is fixed.
    expect(() =>
      harnessService.setTaskRunModel(project, task.id, { model: 'claude-opus-5-5', effort: '' })
    ).toThrow(/already started/)

    const fetchImpl = fakeFetch([1, 1, 1, 1])
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch: vi.fn().mockResolvedValue({ pid: 4243 }),
        fetchImpl,
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess: vi.fn().mockResolvedValue(undefined),
        choosePort: async () => 42013,
        pollIntervalMs: 100000,
        idleStablePolls: 10,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000
      }
    )
    harnessService.touchSessionConnection(project, session.id)
    const claimedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === task.id)!
    await runner.start(project, session, claimedTask)

    const slotPath = session.workspace!.worktreePath
    const configDir = path.join(
      path.dirname(path.dirname(slotPath)),
      'runtime',
      path.basename(slotPath),
      'opencode-home',
      'config',
      'opencode'
    )
    const slotConfig = JSON.parse(
      fs.readFileSync(path.join(configDir, 'opencode.json'), 'utf8')
    ) as Record<string, unknown>
    // The same block the global model's effort writes, and no new top-level key.
    expect(slotConfig.provider).toEqual({
      anthropic: { models: { 'claude-haiku-5-5': { options: { effort: 'low' } } } }
    })
    expect(Object.keys(slotConfig).sort()).toEqual([
      'instructions',
      'permission',
      'plugin',
      'provider'
    ])
    const messageRequest = vi
      .mocked(fetchImpl)
      .mock.calls.find(
        ([input, init]) =>
          init?.method === 'POST' && String(input).endsWith('/session/oc-session-1/message')
      )
    expect(JSON.parse(String(messageRequest?.[1]?.body))).toMatchObject({
      providerID: 'anthropic',
      modelID: 'claude-haiku-5-5'
    })
    const running = harnessService
      .getState(project)
      .activeSessions.find((candidate) => candidate.id === session.id)
    expect(running?.embeddedRuntime).toMatchObject({ model: 'claude-haiku-5-5', effort: 'low' })
    await runner.stop(session.id)
  })

  it('holds, rather than completes, a task whose agent reported it was blocked and changed nothing', async () => {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const launch = vi.fn().mockResolvedValue({ pid: 5052 })
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch,
        fetchImpl: fakeFetch([1]),
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess: vi.fn().mockResolvedValue(undefined),
        stopWorkspaceProcesses: vi.fn().mockResolvedValue([]),
        choosePort: async () => 42020,
        pollIntervalMs: 100000,
        idleStablePolls: 100,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000
      }
    )
    harnessService.touchSessionConnection(project, session.id)
    const claimedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === task.id)!
    await runner.start(project, session, claimedTask)
    const env = launch.mock.calls[0][3].environment
    const base = `http://127.0.0.1:${env.OSTLER_BRIDGE_PORT}`
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OSTLER_BRIDGE_SECRET}`
    }
    await modelReplied(base, headers, session.id, project.id)
    const completeRes = await fetch(`${base}/complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sessionId: session.id,
        projectId: project.id,
        summary: 'Blocked before any change.',
        filesChanged: [],
        verification: 'Checked the prerequisites.',
        blockers: 'BLOCKED: docs/baseline/visual-audit.md does not exist.'
      })
    })
    expect(completeRes.status).toBe(200)
    await fetch(`${base}/event`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sessionId: session.id,
        projectId: project.id,
        event: { id: 'evt_blocked', type: 'session.idle', properties: {} }
      })
    })

    const state = harnessService.getState(project)
    const queued = state.taskQueue.find((item) => item.id === task.id)
    // Not complete: nothing that depends on this task may be released.
    expect(queued?.status).toBe('pending')
    expect(queued?.hold).toBe(true)
    const finished = storedSession(session.id)
    expect(finished?.statusNote).toContain('visual-audit.md does not exist')
  })

  it('saves a running session transcript before it ends, so a crash does not lose it', async () => {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const launch = vi.fn().mockResolvedValue({ pid: 5053 })
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch,
        fetchImpl: fakeFetch([1]),
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess: vi.fn().mockResolvedValue(undefined),
        stopWorkspaceProcesses: vi.fn().mockResolvedValue([]),
        choosePort: async () => 42021,
        pollIntervalMs: 100000,
        idleStablePolls: 100,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000,
        transcriptSaveIntervalMs: 20
      }
    )
    harnessService.touchSessionConnection(project, session.id)
    const claimedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === task.id)!
    await runner.start(project, session, claimedTask)
    expect(runner.isRunning(session.id)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Still running, and its history is already in the database.
    expect(runner.isRunning(session.id)).toBe(true)
    const saved = harnessService.getSessionTranscript(project, session.id)
    expect(saved.some((entry) => entry.role === 'user' && entry.content.includes('details'))).toBe(
      true
    )
    await runner.stop(session.id)
  })

  it('ends a turn the model provider failed as a provider error: no nudge, task not held', async () => {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const launch = vi.fn().mockResolvedValue({ pid: 5051 })
    const fetchImpl = fakeFetch([1])
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch,
        fetchImpl,
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess: vi.fn().mockResolvedValue(undefined),
        stopWorkspaceProcesses: vi.fn().mockResolvedValue([]),
        choosePort: async () => 42019,
        pollIntervalMs: 100000,
        idleStablePolls: 100,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000
      }
    )
    harnessService.touchSessionConnection(project, session.id)
    const claimedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === task.id)!
    await runner.start(project, session, claimedTask)
    const env = launch.mock.calls[0][3].environment
    const post = (event: unknown) =>
      fetch(`http://127.0.0.1:${env.OSTLER_BRIDGE_PORT}/event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OSTLER_BRIDGE_SECRET}`
        },
        body: JSON.stringify({ sessionId: session.id, projectId: project.id, event })
      })
    const messagePosts = () =>
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([url, init]) => String(url).endsWith('/message') && init?.method === 'POST'
      ).length
    const sentBefore = messagePosts()

    // What opencode emits when the provider is overloaded: an assistant
    // message with an error and no content, then the session goes idle.
    await post({
      id: 'evt_err',
      type: 'message.updated',
      properties: {
        info: {
          role: 'assistant',
          error: {
            name: 'APIError',
            data: {
              message: 'The backend is temporarily overloaded. Please retry.',
              isRetryable: true
            }
          }
        }
      }
    })
    await post({
      id: 'evt_idle',
      type: 'session.status',
      properties: { sessionID: 'oc-session-1', status: { type: 'idle' } }
    })

    expect(runner.isRunning(session.id)).toBe(false)
    expect(messagePosts()).toBe(sentBefore) // no continuation nudge was sent
    const state = harnessService.getState(project)
    // Nothing was produced, so it is not awaiting review: the task gets its
    // copy back for the next run.
    expect([...state.activeSessions, ...state.reviewSessions].map((item) => item.id)).not.toContain(
      session.id
    )
    expect(state.taskQueue.find((item) => item.id === task.id)?.copy?.worktreePath).toBe(
      session.workspace!.worktreePath
    )
    expect(state.taskQueue.find((item) => item.id === task.id)?.hold).toBeFalsy()
    expect(state.taskQueue.find((item) => item.id === task.id)?.status).toBe('pending')
  })

  it('ends the session via the event bridge on session.idle without waiting for polling, and records it as abandoned rather than complete', async () => {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)

    const launch = vi.fn().mockResolvedValue({ pid: 5050 })
    const killProcess = vi.fn().mockResolvedValue(undefined)
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch,
        fetchImpl: fakeFetch([1]),
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess,
        choosePort: async () => 42012,
        pollIntervalMs: 100000, // polling will NOT fire in this test
        idleStablePolls: 100,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000,
        // Nudging is covered by its own test below. Disabled here so this one
        // stays about the event bridge ending the session without polling.
        maxContinuationNudges: 0
      }
    )

    harnessService.touchSessionConnection(project, session.id)
    const claimedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === task.id)!

    await runner.start(project, session, claimedTask)

    const env = launch.mock.calls[0][3].environment
    const bridgePort = env.OSTLER_BRIDGE_PORT
    const bridgeSecret = env.OSTLER_BRIDGE_SECRET

    expect(runner.isRunning(session.id)).toBe(true)

    await modelReplied(
      `http://127.0.0.1:${bridgePort}`,
      { 'Content-Type': 'application/json', Authorization: `Bearer ${bridgeSecret}` },
      session.id,
      project.id
    )

    // Send session.status idle event to the bridge
    const eventRes = await fetch(`http://127.0.0.1:${bridgePort}/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bridgeSecret}`
      },
      body: JSON.stringify({
        sessionId: session.id,
        projectId: project.id,
        event: {
          id: 'evt_1',
          type: 'session.status',
          properties: { sessionID: 'oc-session-1', status: { type: 'idle' } }
        }
      })
    })

    expect(eventRes.status).toBe(200)
    expect(runner.isRunning(session.id)).toBe(false)
    expect(killProcess).toHaveBeenCalledWith(5050)

    const state = harnessService.getState(project)
    const finished = storedSession(session.id)
    expect(finished?.status).toBe('done')

    // Going idle is how every turn ends, including the turn where a weak model
    // reads a few files and quits. With no report and no commits, the session is
    // recorded as abandoned: it gets no completion report, and its task is put
    // on hold rather than counted done or handed straight to the next agent.
    const abandonedTask = state.taskQueue.find((item) => item.id === task.id)
    expect(abandonedTask?.report).toBeUndefined()
    expect(abandonedTask?.hold).toBe(true)
    expect(finished?.embeddedRuntime?.stopReason).toBe('abandoned')
    expect(finished?.statusNote).toContain('treat this task as NOT done')
  })

  it('uses a structured completion report submitted through the authenticated bridge', async () => {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const launch = vi.fn().mockResolvedValue({ pid: 5052 })
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch,
        fetchImpl: fakeFetch([1]),
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess: vi.fn().mockResolvedValue(undefined),
        choosePort: async () => 42013,
        pollIntervalMs: 100000,
        idleStablePolls: 100,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000
      }
    )
    harnessService.touchSessionConnection(project, session.id)
    const claimedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === task.id)!
    await runner.start(project, session, claimedTask)
    const env = launch.mock.calls[0][3].environment
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OSTLER_BRIDGE_SECRET}`
    }

    await modelReplied(
      `http://127.0.0.1:${env.OSTLER_BRIDGE_PORT}`,
      headers,
      session.id,
      project.id
    )
    // A report that names changed files is refused unless the branch shows work.
    const worktree = session.workspace!.worktreePath
    fs.mkdirSync(path.join(worktree, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(worktree, 'docs', 'audit.md'), '# Audit')
    await simpleGit(worktree).addConfig('user.email', 'agent@example.com')
    await simpleGit(worktree).addConfig('user.name', 'Agent')
    await simpleGit(worktree).add('docs/audit.md')
    await simpleGit(worktree).commit('Audit the API surface')

    const completeRes = await fetch(`http://127.0.0.1:${env.OSTLER_BRIDGE_PORT}/complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sessionId: session.id,
        projectId: project.id,
        summary: 'Audited the API surface.',
        filesChanged: ['docs/audit.md'],
        verification: 'npm test',
        blockers: 'None'
      })
    })
    expect(completeRes.status).toBe(200)

    await fetch(`http://127.0.0.1:${env.OSTLER_BRIDGE_PORT}/event`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sessionId: session.id,
        projectId: project.id,
        event: { id: 'evt_structured', type: 'session.idle', properties: {} }
      })
    })

    const completedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === task.id)
    expect(completedTask?.report).toMatchObject({
      filesChanged: ['docs/audit.md'],
      missing: false
    })
    expect(completedTask?.report?.summary).toContain('Audited the API surface.')
    expect(completedTask?.report?.summary).toContain('Verification: npm test')
  })

  it('blocks question bridge until human answers via onQuestionAnswered', async () => {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)

    const launch = vi.fn().mockResolvedValue({ pid: 5052 })
    const killProcess = vi.fn().mockResolvedValue(undefined)
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch,
        fetchImpl: fakeFetch([1]),
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess,
        choosePort: async () => 42014,
        pollIntervalMs: 100000,
        idleStablePolls: 100,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000
      }
    )

    harnessService.touchSessionConnection(project, session.id)
    const claimedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === task.id)!

    await runner.start(project, session, claimedTask)

    const env = launch.mock.calls[0][3].environment
    const bridgePort = env.OSTLER_BRIDGE_PORT
    const bridgeSecret = env.OSTLER_BRIDGE_SECRET

    // Initiate question via bridge (runs in background because it blocks until answered)
    let askResponse: Response | null = null
    const askPromise = fetch(`http://127.0.0.1:${bridgePort}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bridgeSecret}`
      },
      body: JSON.stringify({
        sessionId: session.id,
        projectId: project.id,
        question: 'Should I use SQLite or PostgreSQL?'
      })
    }).then((res) => {
      askResponse = res
      return res.json()
    })

    // Allow the bridge to process the ask request
    await new Promise((r) => setTimeout(r, 50))

    // Verify session state is blocked and question is registered
    const stateWithQuestion = harnessService.getState(project)
    const blockedSession = stateWithQuestion.activeSessions.find((s) => s.id === session.id)
    expect(blockedSession?.status).toBe('blocked')

    const pendingQuestion = stateWithQuestion.questions.find((q) => q.sessionId === session.id)
    expect(pendingQuestion).toBeDefined()
    expect(pendingQuestion?.question).toBe('Should I use SQLite or PostgreSQL?')
    expect(pendingQuestion?.status).toBe('pending')
    expect(askResponse).toBeNull() // Still blocked

    // Human answers the question via HarnessService + onQuestionAnswered
    const answeredQuestion = harnessService.answerQuestion(
      project,
      pendingQuestion!.id,
      'Use SQLite.'
    )
    runner.onQuestionAnswered(answeredQuestion)

    // Await the unblocked HTTP response
    const result = await askPromise
    expect(result).toEqual({ ok: true, answer: 'Use SQLite.' })

    const finalState = harnessService.getState(project)
    const unblockedSession = finalState.activeSessions.find((s) => s.id === session.id)
    expect(unblockedSession?.status).toBe('active')

    await runner.stop(session.id)
  })

  it('starts nothing when the copy setup failed, and says so with the setup text', async () => {
    const failing = {
      ...project,
      agentSetup: { mode: 'custom', command: 'node -e "process.exit(2)"' }
    } as typeof project
    const task = harnessService.addTask(failing, 'Task', 'details')

    // Setup runs while the copy is prepared (simplify pass §2.1), before any agent starts.
    await expect(harnessService.startEmbeddedSessionForTask(failing, task.id)).rejects.toThrow(
      /exited 2/
    )
    expect(harnessService.getState(failing).activeSessions).toEqual([])
    expect(harnessService.getState(failing).taskQueue[0].copy?.state).toBe('failed')
  }, 60_000)

  it('refuses to start opencode for a non-embedded (external) session', async () => {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startSessionForTask(project, task.id)
    expect(session.provenance).toBe('external')

    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        ...DEFAULT_OPENCODE_RUNNER_DEPS,
        launch: vi.fn(),
        resolveBinary: () => 'C:\\fake\\opencode.exe'
      }
    )

    await expect(
      runner.start(project, session, {
        id: task.id,
        title: task.title,
        status: 'claimed',
        claimedBy: session.id,
        details: task.details,
        priority: task.priority,
        planningWorkItemId: null,
        autoContinue: false
      })
    ).rejects.toThrow(/not an embedded session/)
  })

  it('passes provider API key as environment variable only and never writes it to disk anywhere', async () => {
    const secretApiKey = 'sk-ant-SUPER-SECRET-API-KEY-NEVER-PERSIST-TO-DISK-12345'
    const customConfig: OstlerConfig = {
      ...DEFAULT_CONFIG,
      ai: {
        ...DEFAULT_CONFIG.ai,
        provider: 'anthropic',
        apiKey: secretApiKey
      }
    }

    const task = harnessService.addTask(project, 'Secret Task', 'Work with secret key')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)

    const launch = vi.fn().mockResolvedValue({ pid: 6060 })
    const killProcess = vi.fn().mockResolvedValue(undefined)
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => customConfig,
      path.join(tempDir(), 'data'),
      {
        launch,
        fetchImpl: fakeFetch([1]),
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess,
        choosePort: async () => 42015,
        pollIntervalMs: 100000,
        idleStablePolls: 100,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000
      }
    )

    harnessService.touchSessionConnection(project, session.id)
    const claimedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === task.id)!

    await runner.start(project, session, claimedTask)

    // Verify key was passed strictly in environment options to launcher
    expect(launch).toHaveBeenCalledTimes(1)
    const launchEnv = launch.mock.calls[0][3].environment
    expect(launchEnv.ANTHROPIC_API_KEY).toBe(secretApiKey)

    // Recursively check all files under tempDir (including slot directory, .opencode, .ostler-opencode-home, dataDir, logs)
    function getAllFiles(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      const files: string[] = []
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          files.push(...getAllFiles(full))
        } else if (entry.isFile()) {
          files.push(full)
        }
      }
      return files
    }

    const allWrittenFiles = getAllFiles(tempDir())
    expect(allWrittenFiles.length).toBeGreaterThan(0)

    for (const filePath of allWrittenFiles) {
      const content = fs.readFileSync(filePath, 'utf8')
      expect(content).not.toContain(secretApiKey)
    }

    await runner.stop(session.id)
  })

  it('stops session when the tool-call rate limit is exceeded, flags for review, and generates report alert', async () => {
    const task = harnessService.addTask(project, 'Capped Task', 'Run runaway tools')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    // The agent had written something before the cap: that work waits for review.
    fs.writeFileSync(path.join(session.workspace!.worktreePath, 'partial.txt'), 'partial\n')

    const launch = vi.fn().mockResolvedValue({ pid: 7070 })
    const killProcess = vi.fn().mockResolvedValue(undefined)
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch,
        fetchImpl: fakeFetch([1]),
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess,
        choosePort: async () => 42016,
        pollIntervalMs: 100000,
        idleStablePolls: 100,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000,
        maxToolCallsPerMinute: 2 // rate limit: 2 calls per rolling 60s window
      }
    )

    harnessService.touchSessionConnection(project, session.id)
    const claimedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === task.id)!

    await runner.start(project, session, claimedTask)

    const env = launch.mock.calls[0][3].environment
    const bridgePort = env.OSTLER_BRIDGE_PORT
    const bridgeSecret = env.OSTLER_BRIDGE_SECRET

    expect(runner.isRunning(session.id)).toBe(true)

    // First tool call: within the per-minute limit (1 < 2)
    const call1Res = await fetch(`http://127.0.0.1:${bridgePort}/tool-call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bridgeSecret}`
      },
      body: JSON.stringify({
        sessionId: session.id,
        projectId: project.id,
        tool: 'read_file'
      })
    })
    const call1Data = await call1Res.json()
    expect(call1Data).toEqual({ ok: true })
    expect(runner.isRunning(session.id)).toBe(true)

    // Second tool call within the same minute: hits the rate limit (2 >= 2)
    const call2Res = await fetch(`http://127.0.0.1:${bridgePort}/tool-call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bridgeSecret}`
      },
      body: JSON.stringify({
        sessionId: session.id,
        projectId: project.id,
        tool: 'bash'
      })
    })
    const call2Data = (await call2Res.json()) as ToolCallReply
    expect(call2Data.blocked).toBe(true)
    expect(call2Data.error).toContain('configured tool-call rate limit of 2 calls/minute')

    // Runner stopped the session and killed child process
    expect(runner.isRunning(session.id)).toBe(false)
    expect(killProcess).toHaveBeenCalledWith(7070)

    // State verification: the stored session is done, awaiting review
    const stoppedSession = storedSession(session.id)
    expect(stoppedSession).toBeDefined()
    expect(stoppedSession?.status).toBe('done')
    expect(stoppedSession?.statusNote).toContain(
      'Stopped for human review: exceeded the tool-call rate limit'
    )
    expect(stoppedSession?.embeddedRuntime?.stoppedForReview).toBe(true)
    expect(stoppedSession?.embeddedRuntime?.stopReason).toBe('tool_call_rate_exceeded')
    expect(stoppedSession?.embeddedRuntime?.toolCallCount).toBe(2)
    expect(stoppedSession?.embeddedRuntime?.maxToolCallsPerMinute).toBe(2)

    // Report alert verification
    const report = harnessService.getReport(project)
    expect(report.healthStatus).toBe('warning')
    const cappedAlert = report.alerts.find((a) => a.code === 'embedded_session_capped')
    expect(cappedAlert).toBeDefined()
    expect(cappedAlert?.severity).toBe('warning')
    expect(cappedAlert?.title).toContain('1 embedded session stopped at the tool-call rate limit')
    expect(cappedAlert?.detail).toContain('stopped for review')
    expect(cappedAlert?.detail).toContain('Spend tracking is currently token/turn-capped')
  })

  it('does not overwrite a rate-limited stop with a false "failed to start" when the in-flight sendMessage rejects', async () => {
    // Reproduces the real-world race: opencode's POST /message stays pending for
    // the whole agent turn. If a tool call trips the rate limit mid-turn, stopForRateLimit()
    // kills the process, which makes that same pending sendMessage() reject --
    // but the session was already correctly stopped for review, not "failed".
    const task = harnessService.addTask(project, 'Runaway Task', 'Run wild tools')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)

    let rejectMessage: (error: Error) => void = () => {}
    const messagePromise = new Promise<Response>((_, reject) => {
      rejectMessage = reject
    })
    const killProcess = vi.fn(async () => {
      rejectMessage(new TypeError('fetch failed'))
    })
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/doc')) return new Response(null, { status: 200 })
      if (method === 'POST' && url.endsWith('/session')) {
        return new Response(JSON.stringify({ id: 'oc-session-1' }), { status: 200 })
      }
      if (method === 'POST' && url.endsWith('/message')) return messagePromise
      if (method === 'GET' && url.endsWith('/message')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`)
    }) as unknown as typeof fetch

    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch: vi.fn().mockResolvedValue({ pid: 9090 }),
        fetchImpl,
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess,
        choosePort: async () => 42017,
        pollIntervalMs: 100000,
        idleStablePolls: 100,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000,
        maxToolCallsPerMinute: 1 // trips on the first call while sendMessage is still pending
      }
    )

    harnessService.touchSessionConnection(project, session.id)
    const claimedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === task.id)!

    const startPromise = runner.start(project, session, claimedTask)
    await vi.waitFor(() => expect(runner.isRunning(session.id)).toBe(true))

    const launchMock = (
      runner as unknown as {
        deps: { launch: ReturnType<typeof vi.fn> }
      }
    ).deps.launch
    const bridgePort = launchMock.mock.calls[0][3].environment.OSTLER_BRIDGE_PORT
    const bridgeSecret = launchMock.mock.calls[0][3].environment.OSTLER_BRIDGE_SECRET

    const toolCallRes = await fetch(`http://127.0.0.1:${bridgePort}/tool-call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bridgeSecret}`
      },
      body: JSON.stringify({ sessionId: session.id, projectId: project.id, tool: 'bash' })
    })
    const toolCallData = (await toolCallRes.json()) as ToolCallReply
    expect(toolCallData.blocked).toBe(true)

    // The old bug: this rejected with the "fetch failed" error, which the
    // caller (main.ts) turned into "Embedded opencode session failed to
    // start", stomping the correct cap-stop note. It must resolve instead.
    await expect(startPromise).resolves.toBeUndefined()

    const stoppedSession = storedSession(session.id)
    expect(stoppedSession?.statusNote).toContain(
      'Stopped for human review: exceeded the tool-call rate limit'
    )
    expect(stoppedSession?.statusNote).not.toContain('failed to start')
  })

  it('records assistant turn counts and best-effort usage from events', async () => {
    const task = harnessService.addTask(project, 'Spend Task', 'Track usage')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)

    const launch = vi.fn().mockResolvedValue({ pid: 8080 })
    const killProcess = vi.fn().mockResolvedValue(undefined)
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch,
        fetchImpl: fakeFetch([1]),
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess,
        choosePort: async () => 42017,
        pollIntervalMs: 100000,
        idleStablePolls: 100,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000
      }
    )

    harnessService.touchSessionConnection(project, session.id)
    const claimedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === task.id)!

    await runner.start(project, session, claimedTask)

    const env = launch.mock.calls[0][3].environment
    const bridgePort = env.OSTLER_BRIDGE_PORT
    const bridgeSecret = env.OSTLER_BRIDGE_SECRET

    // Send message.created event with usage
    await fetch(`http://127.0.0.1:${bridgePort}/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bridgeSecret}`
      },
      body: JSON.stringify({
        sessionId: session.id,
        projectId: project.id,
        event: {
          id: 'evt_msg_1',
          type: 'message.created',
          properties: {
            usage: {
              inputTokens: 120,
              outputTokens: 45,
              totalTokens: 165
            }
          }
        }
      })
    })

    const state = harnessService.getState(project)
    const active = state.activeSessions.find((s) => s.id === session.id)
    expect(active?.embeddedRuntime?.turnCount).toBe(1)
    expect(active?.embeddedRuntime?.usage).toEqual({
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165
    })

    await runner.stop(session.id)
  })

  it('records live transcript entries during execution and persists on session stop', async () => {
    const task = harnessService.addTask(
      project,
      'Build Auth System',
      'Create authentication tokens'
    )
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)

    const launch = vi.fn().mockResolvedValue({ pid: 8081 })
    const killProcess = vi.fn().mockResolvedValue(undefined)
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch,
        fetchImpl: fakeFetch([1]),
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess,
        choosePort: async () => 42018,
        pollIntervalMs: 100000,
        idleStablePolls: 100,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000
      }
    )

    harnessService.touchSessionConnection(project, session.id)
    const claimedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === task.id)!

    await runner.start(project, session, claimedTask)

    const env = launch.mock.calls[0][3].environment
    const bridgePort = env.OSTLER_BRIDGE_PORT
    const bridgeSecret = env.OSTLER_BRIDGE_SECRET

    // Send a tool call
    await fetch(`http://127.0.0.1:${bridgePort}/tool-call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bridgeSecret}`
      },
      body: JSON.stringify({
        sessionId: session.id,
        projectId: project.id,
        tool: 'read_file',
        args: { path: 'app.ts' }
      })
    })

    // Check live transcript while session is running
    const liveEntries = await runner.getLiveTranscript(session.id)
    expect(liveEntries).not.toBeNull()
    expect(liveEntries?.length).toBeGreaterThanOrEqual(2)
    expect(
      liveEntries?.some((e) => e.role === 'user' && e.content.includes('Build Auth System'))
    ).toBe(true)
    expect(liveEntries?.some((e) => e.role === 'tool' && e.content.includes('read_file'))).toBe(
      true
    )

    // Stop runner and verify persisted transcript in EventDatabase
    await runner.stop(session.id)

    const stored = database.getSessionTranscript(project.id, session.id)
    expect(stored).not.toBeNull()
    expect(stored?.entries.length).toBeGreaterThanOrEqual(2)
    expect(stored?.entries.some((e) => e.role === 'tool' && e.content.includes('read_file'))).toBe(
      true
    )
  })

  it('stop() marks the session done with a note instead of leaving it silently active', async () => {
    const task = harnessService.addTask(project, 'Stoppable task', 'Do the thing')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch: vi.fn().mockResolvedValue({ pid: 5151 }),
        fetchImpl: fakeFetch([1]),
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess: vi.fn().mockResolvedValue(undefined),
        choosePort: async () => 42021,
        pollIntervalMs: 100000,
        idleStablePolls: 100,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000
      }
    )
    harnessService.touchSessionConnection(project, session.id)
    const claimedTask = harnessService.getState(project).taskQueue.find((t) => t.id === task.id)!
    await runner.start(project, session, claimedTask)

    await runner.stop(session.id, 'Stopped: force-released by human.')

    // Nothing was saved, so nothing waits for review: the run ends with its
    // note, and the task keeps its copy for the next run.
    const state = harnessService.getState(project)
    expect(state.activeSessions.some((s) => s.id === session.id)).toBe(false)
    expect(state.reviewSessions.some((s) => s.id === session.id)).toBe(false)
    const run = harnessService.getRecentRuns(project).find((r) => r.sessionId === session.id)
    expect(run?.detail).toContain('Stopped: force-released by human.')
    expect(state.taskQueue.find((t) => t.id === task.id)?.copy?.worktreePath).toBe(
      session.workspace!.worktreePath
    )
  })

  it('stopAll() stops every tracked session, e.g. when Ostler itself is shutting down', async () => {
    const taskA = harnessService.addTask(project, 'Task A', 'A')
    const taskB = harnessService.addTask(project, 'Task B', 'B')
    const sessionA = await harnessService.startEmbeddedSessionForTask(project, taskA.id)
    const sessionB = await harnessService.startEmbeddedSessionForTask(project, taskB.id)
    const killProcess = vi.fn().mockResolvedValue(undefined)
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch: vi.fn().mockResolvedValue({ pid: 6161 }),
        fetchImpl: fakeFetch([1]),
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess,
        choosePort: async () => 42022,
        pollIntervalMs: 100000,
        idleStablePolls: 100,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000
      }
    )
    harnessService.touchSessionConnection(project, sessionA.id)
    harnessService.touchSessionConnection(project, sessionB.id)
    await runner.start(
      project,
      sessionA,
      harnessService.getState(project).taskQueue.find((t) => t.id === taskA.id)!
    )
    await runner.start(
      project,
      sessionB,
      harnessService.getState(project).taskQueue.find((t) => t.id === taskB.id)!
    )
    expect(runner.isRunning(sessionA.id)).toBe(true)
    expect(runner.isRunning(sessionB.id)).toBe(true)

    await runner.stopAll()

    expect(runner.isRunning(sessionA.id)).toBe(false)
    expect(runner.isRunning(sessionB.id)).toBe(false)
    expect(killProcess).toHaveBeenCalledTimes(2)
    const state = harnessService.getState(project)
    expect(state.activeSessions).toEqual([])
    const runs = harnessService.getRecentRuns(project)
    for (const id of [sessionA.id, sessionB.id]) {
      expect(runs.find((r) => r.sessionId === id)?.detail).toContain('Ostler was closed')
    }
  })

  /**
   * Starts a runner and drives it to the point where its plugin bridge is
   * reachable, returning the bridge coordinates. Every test below needs the same
   * dozen lines to get there.
   */
  async function startWithBridge(
    sessionId: string,
    taskId: string,
    pid: number,
    port: number,
    depsOverride: Partial<OpenCodeRunnerDeps> = {}
  ) {
    const launch = vi.fn().mockResolvedValue({ pid })
    const killProcess = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = fakeFetch([1])
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch,
        fetchImpl,
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess,
        choosePort: async () => port,
        pollIntervalMs: 100000,
        idleStablePolls: 100,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000,
        ...depsOverride
      }
    )
    harnessService.touchSessionConnection(project, sessionId)
    const session = harnessService
      .getState(project)
      .activeSessions.find((item) => item.id === sessionId)!
    const claimedTask = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === taskId)!
    await runner.start(project, session, claimedTask)
    const env = launch.mock.calls[0][3].environment
    return {
      runner,
      killProcess,
      fetchImpl,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OSTLER_BRIDGE_SECRET}`
      },
      bridgeUrl: `http://127.0.0.1:${env.OSTLER_BRIDGE_PORT}`
    }
  }

  /** The text of every message actually sent into the opencode session, in order. */
  function sentMessages(fetchImpl: typeof fetch): string[] {
    return vi
      .mocked(fetchImpl)
      .mock.calls.filter(
        ([input, init]) =>
          init?.method === 'POST' && String(input).endsWith('/session/oc-session-1/message')
      )
      .map(([, init]) => {
        const parsed = JSON.parse(String(init?.body)) as { parts: Array<{ text: string }> }
        return parsed.parts[0].text
      })
  }

  it('nudges an agent that goes idle without finishing, rather than recording the session as done', async () => {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const { runner, fetchImpl, killProcess, headers, bridgeUrl } = await startWithBridge(
      session.id,
      task.id,
      5060,
      42031,
      { maxContinuationNudges: 1 }
    )

    const idle = (id: string) =>
      fetch(`${bridgeUrl}/event`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sessionId: session.id,
          projectId: project.id,
          event: { id, type: 'session.idle', properties: {} }
        })
      })

    await modelReplied(bridgeUrl, headers, session.id, project.id)

    // Nothing done, nothing reported. The session must stay alive and be told to
    // continue -- a weak model quitting early is the case the gate exists for.
    await idle('evt_idle_1')
    expect(runner.isRunning(session.id)).toBe(true)
    expect(killProcess).not.toHaveBeenCalled()

    const messages = sentMessages(fetchImpl)
    expect(messages).toHaveLength(2)
    expect(messages[1]).toContain('Automated message from Ostler')
    expect(messages[1]).toContain('Your task has not changed')
    expect(messages[1]).toContain('ostler_complete_task')
    expect(
      harnessService.getState(project).activeSessions.find((s) => s.id === session.id)
        ?.embeddedRuntime?.nudgeCount
    ).toBe(1)

    // Budget spent: Ostler gives up rather than arguing with the model forever.
    await idle('evt_idle_2')
    expect(runner.isRunning(session.id)).toBe(false)
    expect(killProcess).toHaveBeenCalledWith(5060)
    expect(sentMessages(fetchImpl)).toHaveLength(2)

    const finished = storedSession(session.id)
    expect(finished?.embeddedRuntime?.stopReason).toBe('abandoned')
    expect(finished?.embeddedRuntime?.nudgeCount).toBe(1)
  })

  it("posts the person's guidance into the running session without spending a continuation nudge", async () => {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const { runner, fetchImpl, killProcess, headers, bridgeUrl } = await startWithBridge(
      session.id,
      task.id,
      5062,
      42033,
      { maxContinuationNudges: 1 }
    )
    const guidance = new RunGuidanceService(harnessService, runner, () => 'Sam')
    await modelReplied(bridgeUrl, headers, session.id, project.id)

    const sent = await guidance.send(project, session.id, 'Skip the **old** tests.', 'app')

    // Posted into the live session as a user message, labelled as the person's,
    // through opencode's prompt_async: a turn in progress is not aborted.
    const posted = vi
      .mocked(fetchImpl)
      .mock.calls.filter(([input]) => String(input).endsWith('/session/oc-session-1/prompt_async'))
      .map(([, init]) => JSON.parse(String(init?.body)) as { parts: Array<{ text: string }> })
    expect(posted).toHaveLength(1)
    expect(posted[0].parts[0].text).toBe(
      '[Guidance from Sam, the person you are working for, sent through Ostler]\nSkip the **old** tests.'
    )
    expect(sent.deliveredAt).not.toBeNull()
    expect(harnessService.getState(project).guidance?.[0].deliveredAt).toBe(sent.deliveredAt)
    expect(await runner.getLiveTranscript(session.id)).toContainEqual(
      expect.objectContaining({ role: 'user', content: expect.stringContaining('Skip the') })
    )

    const idle = (id: string) =>
      fetch(`${bridgeUrl}/event`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sessionId: session.id,
          projectId: project.id,
          event: { id, type: 'session.idle', properties: {} }
        })
      })

    // The completion gate behaves exactly as before: its one nudge is still there.
    await idle('evt_idle_1')
    expect(runner.isRunning(session.id)).toBe(true)
    const nudges = sentMessages(fetchImpl).filter((text) => text.includes('Automated message'))
    expect(nudges).toHaveLength(1)
    expect(nudges[0]).toContain('continuation 1 of 1')

    await idle('evt_idle_2')
    expect(runner.isRunning(session.id)).toBe(false)
    expect(killProcess).toHaveBeenCalledWith(5062)
    const finished = storedSession(session.id)
    expect(finished?.embeddedRuntime?.nudgeCount).toBe(1)
    expect(finished?.embeddedRuntime?.stopReason).toBe('abandoned')

    // A run that is no longer running is refused plainly.
    await expect(guidance.send(project, session.id, 'Too late', 'app')).rejects.toThrow(
      /no longer running/
    )
  })

  it('nudges an agent that edited files but never committed them, naming the uncommitted files', async () => {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const { runner, fetchImpl, headers, bridgeUrl } = await startWithBridge(
      session.id,
      task.id,
      5061,
      42032,
      { maxContinuationNudges: 1 }
    )

    fs.writeFileSync(path.join(session.workspace!.worktreePath, 'app.ts'), 'edited by agent\n')

    await fetch(`${bridgeUrl}/event`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sessionId: session.id,
        projectId: project.id,
        event: { id: 'evt_idle', type: 'session.idle', properties: {} }
      })
    })

    expect(runner.isRunning(session.id)).toBe(true)
    const nudge = sentMessages(fetchImpl)[1]
    expect(nudge).toContain('still uncommitted')
    expect(nudge).toContain('app.ts')

    await runner.stop(session.id)
  })

  it('sweeps uncommitted work into a rescue commit so it is reviewable rather than stranded in the slot', async () => {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const worktree = session.workspace!.worktreePath
    // The harness never sets a committer identity -- agent commits rely on the
    // machine's global one -- so pin one here instead of depending on whatever
    // the machine running these tests happens to have configured.
    await simpleGit(worktree).addConfig('user.email', 'agent@example.com')
    await simpleGit(worktree).addConfig('user.name', 'Agent')

    const { runner, headers, bridgeUrl } = await startWithBridge(session.id, task.id, 5062, 42033, {
      maxContinuationNudges: 0
    })

    fs.writeFileSync(path.join(worktree, 'app.ts'), 'agent work never committed\n')
    await modelReplied(bridgeUrl, headers, session.id, project.id)

    await fetch(`${bridgeUrl}/event`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sessionId: session.id,
        projectId: project.id,
        event: { id: 'evt_idle', type: 'session.idle', properties: {} }
      })
    })

    expect(runner.isRunning(session.id)).toBe(false)

    // A dirty worktree is refused by the merge path, so leaving it uncommitted
    // would have stranded both the work and the slot holding it.
    const status = await simpleGit(worktree).status()
    expect(status.isClean()).toBe(true)
    const log = await simpleGit(worktree).log({ maxCount: 1 })
    expect(log.latest?.message).toContain('uncommitted work swept from embedded session')

    const finished = storedSession(session.id)
    expect(finished?.statusNote).toContain("saved with the task's work")
    // Committed work with no report is "unreported", not "abandoned": there is
    // something real to review, it just has no account attached to it.
    expect(finished?.embeddedRuntime?.stopReason).toBe('unreported')
    const reviewed = harnessService.getState(project).taskQueue.find((t) => t.id === task.id)
    expect(reviewed?.report?.outcome).toBe('unreported')
    expect(reviewed?.report?.summary).toContain('UNREPORTED')
  })

  it('refuses a tool call repeated identically back-to-back and tells the agent to change approach', async () => {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const { runner, headers, bridgeUrl } = await startWithBridge(session.id, task.id, 5063, 42034, {
      repeatedToolCallLimit: 3,
      maxToolCallsPerMinute: 50
    })

    const call = (tool: string, args: Record<string, unknown>) =>
      fetch(`${bridgeUrl}/tool-call`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId: session.id, projectId: project.id, tool, args })
      }).then((res) => res.json() as Promise<ToolCallReply>)

    expect(await call('read_file', { path: 'app.ts' })).toEqual({ ok: true })
    expect(await call('read_file', { path: 'app.ts' })).toEqual({ ok: true })

    const third = await call('read_file', { path: 'app.ts' })
    expect(third.warn).toContain('identical arguments 3 times in a row')
    expect(third.blocked).toBeUndefined()
    // A refused call is not a dead session: this is the cheap intervention that
    // costs no workspace slot.
    expect(runner.isRunning(session.id)).toBe(true)

    // Only consecutive repeats count. The same call after a different one is
    // ordinary work, not a loop, and must not be refused.
    expect(await call('bash', { command: 'git status' })).toEqual({ ok: true })
    expect(await call('read_file', { path: 'app.ts' })).toEqual({ ok: true })

    await runner.stop(session.id)
  })

  it('stops a session that exceeds its lifetime tool-call budget even while under the per-minute rate', async () => {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const { runner, headers, bridgeUrl } = await startWithBridge(session.id, task.id, 5064, 42035, {
      maxToolCallsPerSession: 2,
      maxToolCallsPerMinute: 1000,
      repeatedToolCallLimit: 1000
    })

    const call = (command: string) =>
      fetch(`${bridgeUrl}/tool-call`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sessionId: session.id,
          projectId: project.id,
          tool: 'bash',
          args: { command }
        })
      }).then((res) => res.json() as Promise<ToolCallReply>)

    expect(await call('one')).toEqual({ ok: true })
    expect(await call('two')).toEqual({ ok: true })
    const third = await call('three')
    expect(third.blocked).toBe(true)
    expect(third.error).toContain('lifetime tool-call budget of 2 calls')
    expect(runner.isRunning(session.id)).toBe(false)

    const stopped = storedSession(session.id)
    expect(stopped?.statusNote).toContain('lifetime tool-call budget of 2 calls')
  })

  it('releases an agent whose question nobody answers, instead of letting it kill the session', async () => {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const { runner, headers, bridgeUrl } = await startWithBridge(session.id, task.id, 5065, 42036, {
      questionTimeoutMs: 50
    })

    const res = await fetch(`${bridgeUrl}/ask`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sessionId: session.id,
        projectId: project.id,
        question: 'Which database should I use?'
      })
    })
    const body = (await res.json()) as { ok: boolean; answer: string }

    expect(body.ok).toBe(true)
    expect(body.answer).toContain('NO ANSWER YET')
    expect(body.answer).toContain('blockers')
    // The session survives the unanswered question. Previously the held-open
    // response burned the whole turn budget and killed the session mid-work.
    expect(runner.isRunning(session.id)).toBe(true)

    await runner.stop(session.id)
  })
})
