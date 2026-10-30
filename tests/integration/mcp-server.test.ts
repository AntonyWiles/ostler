import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A reversible stand-in for safeStorage, so the launcher's tests read a token
// stored encrypted exactly as ConfigStore writes it.
vi.mock('../../electron/safe-storage', () => ({
  isEncryptionAvailable: () => true,
  isEncryptedSecret: (value: string) => value.startsWith('ostler-secure:v1:'),
  encryptApiKey: (key: string) =>
    key ? `ostler-secure:v1:${Buffer.from(key).toString('base64')}` : key,
  decryptApiKey: (value: string) => {
    if (!value.startsWith('ostler-secure:v1:')) throw new Error('not encrypted')
    return Buffer.from(value.slice('ostler-secure:v1:'.length), 'base64').toString('utf-8')
  },
  sealSecret: (token: string) =>
    token ? `ostler-secure:v1:${Buffer.from(token).toString('base64')}` : token,
  openSecret: (value: string) =>
    value.startsWith('ostler-secure:v1:')
      ? Buffer.from(value.slice('ostler-secure:v1:'.length), 'base64').toString('utf-8')
      : value
}))
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import {
  mcpStdioRequest,
  readBridgeTarget,
  runStdioBridge
} from '../../electron/services/mcp/stdio-bridge'
import { createMigratedDatabase } from '../helpers/database'
import { ConfigStore } from '../../electron/config-store'
import { encryptApiKey, openSecret } from '../../electron/safe-storage'
import { freePort, startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
const human = { kind: 'human' as const }

function makeProject(id: string, token: string): WatchedProject {
  return makeWatchedProject({ id, name: id, addedAt: Date.now(), automationToken: token })
}

/** One raw request, so a test can set Host and Origin as a browser or attacker would. */
function rawPost(
  urlPath: string,
  headers: Record<string, string>,
  body: unknown
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(payload),
          ...headers
        }
      },
      (res) => {
        let text = ''
        res.on('data', (chunk) => (text += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
      }
    )
    req.on('error', reject)
    req.end(payload)
  })
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' }
  }
}

describe('MCP over the automation API (D39)', () => {
  const root = useTempDir('ostler-mcp-')
  let project: WatchedProject
  let other: WatchedProject
  let planning: PlanningService
  let server: AutomationHttpServer
  let client: Client | null

  beforeEach(async () => {
    project = makeProject('mcp-project', 'mcp-token')
    other = makeProject('other-project', 'other-token')
    planning = new PlanningService(await createMigratedDatabase(root()), () => [
      project.id,
      other.id
    ])
    server = new AutomationHttpServer(
      () => [project, other],
      path.join(root(), 'runtime'),
      () => {},
      planning
    )
    PORT = await startOnFreePort((port) => server.start(port))
    client = null
  })

  afterEach(async () => {
    await client?.close()
    server?.stop()
    planning?.close()
  })

  const connect = async (token: string, projectId = project.id) => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${PORT}/automation/${projectId}/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    )
    client = new Client({ name: 'ostler-test', version: '1.0.0' })
    await client.connect(transport)
    return client
  }

  const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
    (result.content as Array<{ type: string; text: string }>)[0].text

  it('lists the route table’s tools and none of the agent routes', async () => {
    const mcp = await connect(project.automationToken!)
    const { tools } = await mcp.listTools()
    const names = tools.map((tool) => tool.name)
    expect(names).toContain('get_work_items')
    expect(names).toContain('post_work_items')
    expect(names).toContain('get_library_by_item_id')
    expect(names).not.toContain('post_tasks')
    expect(names).not.toContain('post_sessions_by_session_id_merge')
    expect(names).not.toContain('get_projects')
    const create = tools.find((tool) => tool.name === 'patch_work_items_by_work_item_id')!
    expect(create.inputSchema.required).toEqual(['workItemId'])
  })

  it('reads tasks and creates one that the planning service then has', async () => {
    planning.createWorkItem(project.id, { title: 'Pack the kitchen' }, human)
    const mcp = await connect(project.automationToken!)

    const listed = await mcp.callTool({ name: 'get_work_items', arguments: {} })
    expect(listed.isError).toBeFalsy()
    expect(JSON.parse(text(listed))).toEqual([
      expect.objectContaining({ title: 'Pack the kitchen' })
    ])

    const created = await mcp.callTool({
      name: 'post_work_items',
      arguments: { body: { title: 'Book the van', priority: 'high' } }
    })
    expect(created.isError).toBeFalsy()
    expect(JSON.parse(text(created))).toMatchObject({ title: 'Book the van', priority: 'high' })
    expect(planning.listWorkItems(project.id).map((item) => item.title)).toContain('Book the van')
    expect(planning.listWorkItems(other.id)).toEqual([])
  })

  it('returns the API’s refusals as tool errors', async () => {
    const mcp = await connect(project.automationToken!)

    const missing = await mcp.callTool({ name: 'post_work_items', arguments: { body: {} } })
    expect(missing.isError).toBe(true)
    expect(text(missing)).toMatch(/title/i)

    const unknown = await mcp.callTool({
      name: 'patch_work_items_by_work_item_id',
      arguments: { workItemId: 'no-such-item', body: { title: 'x' } }
    })
    expect(unknown.isError).toBe(true)

    const queued = await mcp.callTool({
      name: 'post_work_items',
      arguments: { body: { title: 'Run it', autoQueue: true } }
    })
    expect(queued.isError).toBe(true)
    expect(text(queued)).toMatch(/autoQueue/)
    expect(planning.listWorkItems(project.id)).toEqual([])
  })

  it('refuses writes to a disabled project, as the API does', async () => {
    project.enabled = false
    const mcp = await connect(project.automationToken!)
    const result = await mcp.callTool({
      name: 'post_work_items',
      arguments: { body: { title: 'Nope' } }
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/disabled/)
  })

  it('answers agent-work routes with 409 while agents are off (D38)', async () => {
    const get = (route: string) =>
      fetch(`http://127.0.0.1:${PORT}/automation/${project.id}${route}`, {
        headers: { Authorization: `Bearer ${project.automationToken}` }
      })
    server.agentsOn = () => false
    const queue = await get('/tasks')
    expect(queue.status).toBe(409)
    expect(((await queue.json()) as { error: string }).error).toMatch(/AI agents are off/)
    expect((await get('/sessions')).status).toBe(409)
    expect((await get('/work-items')).status).toBe(200)
  })

  it('refuses a missing token, a wrong one and another project’s', async () => {
    const at = `/automation/${project.id}/mcp`
    const host = { Host: `127.0.0.1:${PORT}` }
    expect((await rawPost(at, host, INITIALIZE)).status).toBe(401)
    expect((await rawPost(at, { ...host, Authorization: 'Bearer wrong' }, INITIALIZE)).status).toBe(
      401
    )
    expect(
      (await rawPost(at, { ...host, Authorization: `Bearer ${other.automationToken}` }, INITIALIZE))
        .status
    ).toBe(401)
    await expect(connect(other.automationToken!)).rejects.toThrow()
  })

  it('refuses a Host that is not loopback with the port, and a foreign Origin', async () => {
    const at = `/automation/${project.id}/mcp`
    const auth = { Authorization: `Bearer ${project.automationToken}` }
    expect((await rawPost(at, { ...auth, Host: 'evil.example' }, INITIALIZE)).status).toBe(403)
    expect((await rawPost(at, { ...auth, Host: `evil.example:${PORT}` }, INITIALIZE)).status).toBe(
      403
    )
    expect((await rawPost(at, { ...auth, Host: '127.0.0.1:1' }, INITIALIZE)).status).toBe(403)
    expect(
      (
        await rawPost(
          at,
          { ...auth, Host: `localhost:${PORT}`, Origin: 'https://evil.example' },
          INITIALIZE
        )
      ).status
    ).toBe(403)
    const fromLoopback = await rawPost(
      at,
      { ...auth, Host: `localhost:${PORT}`, Origin: `http://localhost:${PORT}` },
      INITIALIZE
    )
    expect(fromLoopback.status).toBe(200)
    expect(JSON.parse(fromLoopback.text)).toMatchObject({ id: 1, result: expect.any(Object) })
  })

  interface BridgeAnswer {
    id: number
    result?: {
      serverInfo?: { name: string }
      tools?: unknown[]
      isError?: boolean
      content?: Array<{ text: string }>
    }
    error?: { code: number; message: string }
  }

  describe('the stdio launcher', () => {
    const writeConfig = (automationApi: { enabled: boolean; port: number }) => {
      fs.writeFileSync(
        path.join(root(), 'config.json'),
        JSON.stringify({
          automationApi,
          projects: [
            { id: project.id, automationToken: encryptApiKey(project.automationToken!) },
            { id: 'no-token' },
            { id: 'plain-token', automationToken: 'not-encrypted' }
          ]
        })
      )
    }

    /** Runs the bridge over in-memory stdio, as a client would, and returns what it wrote. */
    const bridge = async (projectId: string, messages: unknown[]) => {
      const input = new PassThrough()
      const output = new PassThrough()
      let written = ''
      output.on('data', (chunk) => (written += chunk))
      const done = runStdioBridge({
        input,
        output,
        target: () => readBridgeTarget(root(), projectId, openSecret)
      })
      for (const message of messages) input.write(`${JSON.stringify(message)}\n`)
      input.end()
      await done
      return written
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as BridgeAnswer)
        .sort((a, b) => a.id - b.id)
    }

    it('forwards a handshake and a tool call to the running Ostler', async () => {
      writeConfig({ enabled: true, port: PORT })
      planning.createWorkItem(project.id, { title: 'Label the boxes' }, human)
      const answers = await bridge(project.id, [
        INITIALIZE,
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'post_work_items', arguments: { body: { title: 'Cancel the post' } } }
        },
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'get_work_items', arguments: {} }
        }
      ])
      expect(answers.map((answer) => answer.id)).toEqual([1, 2, 3, 4])
      expect(answers[0].result?.serverInfo?.name).toBeTruthy()
      expect(answers[1].result?.tools?.length).toBeGreaterThan(80)
      expect(answers[2].result?.isError).toBeFalsy()
      expect(JSON.parse(answers[3].result!.content![0].text)).toHaveLength(2)
      expect(planning.listWorkItems(project.id).map((item) => item.title)).toContain(
        'Cancel the post'
      )
    })

    it('answers with a clear MCP error when Ostler is not running', async () => {
      writeConfig({ enabled: true, port: await freePort() })
      const [answer] = await bridge(project.id, [INITIALIZE])
      expect(answer).toMatchObject({ id: 1, error: { code: -32000 } })
      expect(answer.error?.message).toMatch(/not running/)
    })

    it('answers with a clear MCP error when the API is off, or the project cannot connect', async () => {
      writeConfig({ enabled: false, port: PORT })
      expect((await bridge(project.id, [INITIALIZE]))[0].error?.message).toMatch(
        /automation API is off/
      )
      writeConfig({ enabled: true, port: PORT })
      expect((await bridge('no-token', [INITIALIZE]))[0].error?.message).toMatch(
        /no automation token/
      )
      expect((await bridge('missing', [INITIALIZE]))[0].error?.message).toMatch(/no project/)
      fs.rmSync(path.join(root(), 'config.json'))
      expect((await bridge(project.id, [INITIALIZE]))[0].error?.message).toMatch(/Start Ostler/)
    })

    it('reads the encrypted token ConfigStore writes, and a plain one as it is', async () => {
      // The running Ostler checks tokens from ConfigStore's projects, decrypted
      // in memory; the launcher reads the same token encrypted on disk.
      const store = new ConfigStore(path.join(root(), 'config.json'))
      store.update({ automationApi: { ...store.get().automationApi, enabled: true, port: PORT } })
      store.registerProject({ id: project.id, folder: null, name: 'Saved' })
      project = store.generateAutomationToken(project.id)
      const token = project.automationToken!
      expect(fs.readFileSync(path.join(root(), 'config.json'), 'utf8')).not.toContain(token)
      expect(readBridgeTarget(root(), project.id, openSecret)).toEqual({
        url: `http://127.0.0.1:${PORT}/automation/${project.id}/mcp`,
        token
      })
      const [answer] = await bridge(project.id, [INITIALIZE])
      expect(answer.result?.serverInfo?.name).toBeTruthy()

      // Kept unencrypted when Windows could not encrypt it: read as it is.
      writeConfig({ enabled: true, port: PORT })
      expect(readBridgeTarget(root(), 'plain-token', openSecret)).toMatchObject({
        token: 'not-encrypted'
      })
    })

    it('passes on a refusal from Ostler, such as a token that changed', async () => {
      writeConfig({ enabled: true, port: PORT })
      project.automationToken = 'a-newer-token'
      const [answer] = await bridge(project.id, [INITIALIZE])
      expect(answer.error?.message).toMatch(/401.*Invalid or missing automation token/)
    })

    it('reads its project from the arguments', () => {
      expect(mcpStdioRequest(['ostler.exe'])).toBeNull()
      expect(mcpStdioRequest(['ostler.exe', '--mcp-stdio', '--project', 'p1'])).toEqual({
        projectId: 'p1'
      })
      expect(mcpStdioRequest(['electron.exe', '.', '--project=p2', '--mcp-stdio'])).toEqual({
        projectId: 'p2'
      })
      expect(mcpStdioRequest(['ostler.exe', '--mcp-stdio'])).toHaveProperty('error')
      expect(mcpStdioRequest(['ostler.exe', '--mcp-stdio', '--project', '--x'])).toHaveProperty(
        'error'
      )
    })
  })
})
