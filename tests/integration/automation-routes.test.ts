import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Thousands of probes fail on purpose; their log lines are noise here.
vi.mock('../../electron/app/logging', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../electron/app/logging')>()),
  appLog: { error: () => {}, warn: () => {}, info: () => {} }
}))

import type { WatchedProject } from '../../src/shared/ostler-api'
import { AutomationHttpServer, HELP_ROUTES } from '../../electron/services/automation-http-server'
import type { AutomationRoute } from '../../electron/services/automation/route-table'
import {
  AGENT_WORK_RESOURCES,
  mcpExclusion,
  mcpRouteRequest,
  mcpToolsFromRoutes
} from '../../electron/services/mcp/mcp-tools'
import { PlanningService } from '../../electron/services/planning-service'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'

/**
 * The route table (`HELP_ROUTES`) against the router itself: every route the
 * router answers is in the table with the same method and path, and every
 * entry in the table is answered. The table is what `/help`, the docs and
 * the MCP tools are made from, so a route missing from it is a route no
 * caller can find.
 *
 * The router is a chain of path checks, so its routes are found by asking it:
 * every path made from the segments the source compares against, with every
 * method. Every service it is given is a stand-in, so a request the router
 * recognises gets an answer (a value, a validation message, an error) and
 * one it does not is "Unknown route".
 */

const SOURCE = fs.readFileSync(
  path.join(__dirname, '../../electron/services/automation-http-server.ts'),
  'utf8'
)
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
type Method = (typeof METHODS)[number]
/** What stands for an ID in a probe: never one of the router's own words. */
const PARAM = 'probe-id'
/** The routes outside a project, answered before any project is looked up. */
const GLOBAL_PATHS = new Set(['/projects', '/areas'])

/**
 * A stand-in service that goes along with anything: any property is another
 * stand-in, any call returns one, and whatever it finds belongs to the
 * project asking. A route that looks something up before it reads the rest
 * of its path then still tells a path it does not know from one it does.
 */
function standIn(name: string, projectId: string): never {
  const target = function () {}
  return new Proxy(target, {
    get: (_target, key) => {
      if (key === Symbol.toPrimitive) return () => `stand-in ${name}`
      if (typeof key === 'symbol' || key === 'then') return undefined
      if (key === 'projectId') return projectId
      return standIn(`${name}.${key}`, projectId)
    },
    apply: () => standIn(`${name}()`, projectId)
  }) as never
}

/** The literals the source compares a path segment (by its variable's name) against. */
function literalsFor(...names: string[]): string[] {
  const found = new Set<string>()
  for (const name of names) {
    const pattern = new RegExp(
      `(?<![\\w.])${name.replace(/[[\]]/g, '\\$&')}\\s*[!=]==\\s*'([a-z][a-z0-9-]*)'`,
      'g'
    )
    for (const match of SOURCE.matchAll(pattern)) found.add(match[1])
  }
  return [...found]
}

function segments(route: string): string[] {
  return route.split('/').filter(Boolean)
}

/** Literal segments at one position of the table's paths. */
function tableLiterals(position: number): string[] {
  return HELP_ROUTES.map((route) => segments(route.path)[position]).filter(
    (segment): segment is string => segment !== undefined && !segment.startsWith(':')
  )
}

const unique = (values: string[]): string[] => [...new Set(values)]

describe('the automation route table and the router', () => {
  let root: string
  let server: AutomationHttpServer
  let port = 0
  const project: WatchedProject = makeWatchedProject({
    id: 'routes-project',
    name: 'Routes',
    addedAt: Date.now(),
    automationToken: 'routes-token'
  })

  /** The answer to one request, as a comparable key; null when the router has no such route. */
  const answers = new Map<string, string | null>()
  async function answer(method: Method, route: string): Promise<string | null> {
    const key = `${method} ${route}`
    const known = answers.get(key)
    if (known !== undefined) return known
    const response = await Promise.race([
      server.invokeRoute(project.id, project.automationToken!, {
        method,
        path: route,
        query: {},
        body: method === 'GET' ? undefined : {}
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${key} did not answer`)), 5000)
      )
    ])
    const text = response.body.toString('utf8')
    let error: unknown = null
    try {
      error = (JSON.parse(text) as { error?: unknown }).error ?? null
    } catch {
      error = null
    }
    const result =
      (response.status === 404 && error === 'Unknown route') || response.status === 405
        ? null
        : `${response.status} ${typeof error === 'string' ? error : text.slice(0, 200)}`
    answers.set(key, result)
    return result
  }

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-routes-'))
    const services = [
      'planning',
      'harness',
      'onHarnessStateChange',
      'getReadinessReports',
      'startEmbeddedTask',
      'getSessionTranscript',
      'answerQuestion',
      'stopEmbeddedSession',
      'autoDispatch',
      'library',
      'onPlanningChange',
      'people',
      'templates',
      'imports',
      'reports',
      'projectAi',
      'conventions',
      'workspaceSetup',
      'agentRuns'
    ].map((name) => standIn(name, project.id))
    const Server = AutomationHttpServer as unknown as new (
      ...args: unknown[]
    ) => AutomationHttpServer
    server = new Server(
      () => [project],
      path.join(root, 'runtime'),
      () => {},
      ...services
    )
    const fields = server as unknown as Record<string, unknown>
    for (const field of [
      'getConfig',
      'appearance',
      'taskPlans',
      'projectStage',
      'triageSetting',
      'taskPrefix',
      'updateReminder',
      'github',
      'getBriefing',
      'progress',
      'daysOff',
      'calendars',
      'focus',
      'contactsChanged'
    ]) {
      fields[field] = standIn(field, project.id)
    }
    port = await startOnFreePort((free) => server.start(free))
  })

  afterAll(() => {
    server?.stop()
    if (root) fs.rmSync(root, { recursive: true, force: true })
  })

  /** Whether a table entry describes this request: same method, same literals, a parameter anywhere. */
  function describes(route: AutomationRoute, method: Method, probe: string[]): boolean {
    const parts = segments(route.path)
    return (
      route.method === method &&
      parts.length === probe.length &&
      parts.every((part, index) => part.startsWith(':') || part === probe[index])
    )
  }

  /** Every request the router might answer, made from the segments it compares against. */
  async function answeredRoutes(): Promise<string[]> {
    const resources = unique([
      ...literalsFor('resource', 'parts[2]'),
      ...tableLiterals(0).filter((resource) => !GLOBAL_PATHS.has(`/${resource}`))
    ]).filter((resource) => resource !== 'mcp')
    const ids = unique([...literalsFor('id', 'parts[3]'), ...tableLiterals(1)])
    const actions = unique([...literalsFor('action', 'parts[4]'), ...tableLiterals(2)])
    const steps = unique([
      ...literalsFor('step', 'linkId', 'extra', 'parts[5]'),
      ...tableLiterals(3)
    ])
    const lasts = unique([...literalsFor('parts[6]'), ...tableLiterals(4)])

    const shapes: string[][] = []
    for (const resource of resources) {
      shapes.push([resource], [resource, PARAM], [resource, PARAM, PARAM])
      for (const id of ids) shapes.push([resource, id], [resource, id, PARAM])
      for (const action of actions)
        shapes.push([resource, PARAM, action], [resource, PARAM, action, PARAM])
    }
    const found: string[] = []
    const record = async (shape: string[]): Promise<boolean> => {
      let any = false
      for (const method of METHODS) {
        if ((await answer(method, `/${shape.join('/')}`)) !== null) {
          found.push(`${method} /${shape.join('/')}`)
          any = true
        }
      }
      return any
    }
    for (const shape of shapes) {
      const answered = await record(shape)
      // Deeper paths hang under a path the router knows: /:id/:action and /:id/:action/:x.
      if (answered && shape.length >= 3 && shape[2] !== PARAM) {
        if (shape.length === 3) for (const step of steps) await record([...shape, step])
        if (shape.length === 4) for (const last of lasts) await record([...shape, last])
      }
    }
    return found
  }

  it('answers every route in the table', async () => {
    const unanswered: string[] = []
    for (const route of HELP_ROUTES) {
      if (GLOBAL_PATHS.has(route.path)) continue
      const probe = route.path.replace(/:[A-Za-z]+/g, PARAM)
      if ((await answer(route.method, probe)) === null)
        unanswered.push(`${route.method} ${route.path}`)
    }
    expect(unanswered).toEqual([])
  })

  it('answers the two routes outside a project', async () => {
    const globals = HELP_ROUTES.filter((route) => GLOBAL_PATHS.has(route.path))
    expect(globals.map((route) => `${route.method} ${route.path}`).sort()).toEqual([
      'GET /areas',
      'GET /projects'
    ])
    for (const route of globals) {
      const response = await fetch(`http://127.0.0.1:${port}/automation${route.path}`, {
        headers: { Authorization: `Bearer ${project.automationToken}` }
      })
      expect(response.status, route.path).not.toBe(404)
    }
  })

  it('has every route the router answers in the table, with the same method and path', async () => {
    const answered = await answeredRoutes()
    // The probe itself works: it finds at least every route the table names.
    expect(answered.length).toBeGreaterThanOrEqual(HELP_ROUTES.length - GLOBAL_PATHS.size)
    const missing: string[] = []
    for (const request of answered) {
      const [method, route] = request.split(' ') as [Method, string]
      const probe = segments(route)
      const entries = HELP_ROUTES.filter((entry) => describes(entry, method, probe))
      const exact = entries.some((entry) =>
        segments(entry.path).every((part, index) => part === probe[index] || probe[index] === PARAM)
      )
      if (exact) continue
      // A literal where the table has a parameter is that route only if it is
      // answered exactly as an ID there is: otherwise it is a route of its own.
      // An answer that names the ID it was given ("Lesson with ID x not found") names the literal.
      const same = await Promise.all(
        entries.map(async (entry) => {
          const literals = segments(entry.path)
            .map((part, index) => (part.startsWith(':') ? probe[index] : PARAM))
            .filter((part) => part !== PARAM)
          const named = (text: string | null): string =>
            literals.reduce((result, literal) => result.split(literal).join(PARAM), text ?? '')
          const asParam = segments(entry.path).map((part, index) =>
            part.startsWith(':') ? PARAM : probe[index]
          )
          return (
            named(await answer(method, `/${asParam.join('/')}`)) ===
            named(await answer(method, route))
          )
        })
      )
      if (!same.includes(true)) missing.push(`${request} => ${answers.get(request)}`)
    }
    expect(missing).toEqual([])
  }, 120_000)

  it('has no two table entries for one method and path', () => {
    const keys = HELP_ROUTES.map((route) => `${route.method} ${route.path}`)
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([])
  })
})

const DOCS = path.join(__dirname, '../../docs/automation-api')
const docPages = fs
  .readdirSync(DOCS)
  .filter((file) => file.endsWith('.md'))
  .map((file) => ({ file, text: fs.readFileSync(path.join(DOCS, file), 'utf8') }))

/** A route as the docs write it: no query, and the two global routes under /automation. */
function docRoute(method: string, route: string): string {
  const bare = route
    .replace(/\?.*$/, '')
    .replace(/^\/automation(?=\/(projects|areas)$)/, '')
    .replace(/[.,;:]+$/, '')
  return `${method} ${bare}`
}

/** Every route the docs name: `GET /path` anywhere, and a table's method and path cells. */
function routesNamed(text: string): Set<string> {
  const named = new Set<string>()
  for (const match of text.matchAll(/\b(GET|POST|PUT|PATCH|DELETE) (\/[\w:\-/.?=&<>]*)/g))
    named.add(docRoute(match[1], match[2]))
  for (const row of tableRoutes(text)) named.add(row)
  return named
}

/** The routes a docs table lists in its own method and path cells. */
function tableRoutes(text: string): string[] {
  const rows: string[] = []
  for (const match of text.matchAll(/^\|\s*`?(GET|POST|PUT|PATCH|DELETE)`?\s*\|\s*`(\/[^`]*)`/gm))
    rows.push(docRoute(match[1], match[2]))
  return rows
}

describe('the automation API docs and the route table', () => {
  const table = new Set(HELP_ROUTES.map((route) => `${route.method} ${route.path}`))

  it('names every route of the table on some page, with the same method and path', () => {
    const named = new Set(docPages.flatMap((page) => [...routesNamed(page.text)]))
    expect([...table].filter((route) => !named.has(route))).toEqual([])
  })

  it('lists in its route tables only routes of the table', () => {
    const unknown = docPages.flatMap((page) =>
      tableRoutes(page.text)
        .filter((route) => !table.has(route))
        .map((route) => `${page.file}: ${route}`)
    )
    expect(unknown).toEqual([])
  })

  it('names no plan or decision codes', () => {
    const codes = docPages.flatMap((page) =>
      [...page.text.matchAll(/\b[DFNPR]\d+(\.\d+[a-z]?)?\b/g)].map(
        (match) => `${page.file}: ${match[0]}`
      )
    )
    expect(codes).toEqual([])
  })

  it('names no plan or decision codes in the route table either', () => {
    // /help and the MCP tools read these words, so they are API docs too.
    const codes = HELP_ROUTES.flatMap((route) =>
      [route.description, route.request ?? '', route.response]
        .flatMap((text) => [...text.matchAll(/\b[DFNPR]\d+(\.\d+[a-z]?)?\b/g)])
        .map((match) => `${route.method} ${route.path}: ${match[0]}`)
    )
    expect(codes).toEqual([])
  })
})

describe('the MCP tools and the route table', () => {
  const mcpPage = docPages.find((page) => page.file === 'mcp.md')!.text
  const notATool = mcpPage.slice(mcpPage.indexOf('## What is not a tool'))

  it('makes a tool of every route except agent work and the ones the table excludes', () => {
    const tools = new Set(mcpToolsFromRoutes(HELP_ROUTES).map((tool) => tool.title))
    for (const route of HELP_ROUTES) {
      const key = `${route.method} ${route.path}`
      expect(tools.has(key), key).toBe(mcpExclusion(route) === null)
    }
  })

  it('keeps every route that queues, runs or cancels agent work away from MCP', () => {
    const tools = new Set(mcpToolsFromRoutes(HELP_ROUTES).map((tool) => tool.title))
    expect(tools.has('POST /task-templates/:templateId/run')).toBe(false)
    for (const resource of AGENT_WORK_RESOURCES) {
      expect([...tools].filter((tool) => segments(tool.split(' ')[1])[0] === resource)).toEqual([])
    }
    const tool = (title: string) => mcpToolsFromRoutes(HELP_ROUTES).find((t) => t.title === title)!
    const refused = (title: string, args: Record<string, unknown>) => {
      try {
        mcpRouteRequest(tool(title), args)
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    expect(
      refused('POST /work-items/:workItemId/recurrence', {
        workItemId: 'w1',
        body: { rule: { every: 'week' }, goToAgents: true }
      })
    ).toMatch(/goToAgents/)
    expect(
      refused('POST /work-items/:workItemId/wont-do', {
        workItemId: 'w1',
        body: { cancelQueuedWork: true }
      })
    ).toMatch(/cancelQueuedWork/)
    expect(
      refused('POST /work-items/:workItemId/duplicate-of', {
        workItemId: 'w1',
        body: { originalId: 'w2', cancelQueuedWork: true }
      })
    ).toMatch(/cancelQueuedWork/)
    // Turning them off, or leaving them out, is not agent work.
    expect(
      refused('POST /work-items/:workItemId/recurrence', {
        workItemId: 'w1',
        body: { rule: { every: 'week' }, goToAgents: false }
      })
    ).toBeNull()
    expect(
      refused('POST /work-items/:workItemId/wont-do', { workItemId: 'w1', body: {} })
    ).toBeNull()
  })

  it('says on the MCP page why each route that is not a tool is not one', () => {
    const unexplained = HELP_ROUTES.filter((route) => mcpExclusion(route) !== null)
      .filter((route) => {
        const resource = segments(route.path)[0]
        if (AGENT_WORK_RESOURCES.has(resource)) return !notATool.includes(`\`/${resource}\``)
        return !notATool.includes(`\`${route.method} ${route.path}\``)
      })
      .map((route) => `${route.method} ${route.path}`)
    expect(unexplained).toEqual([])
  })
})

describe('the router refuses a path it does not know', () => {
  let root: string
  let planning: PlanningService
  let server: AutomationHttpServer
  const project: WatchedProject = makeWatchedProject({
    id: 'unknown-paths',
    name: 'Unknown paths',
    addedAt: Date.now(),
    automationToken: 'unknown-paths-token'
  })

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-unknown-paths-'))
    planning = new PlanningService(await createMigratedDatabase(root), () => [project.id])
    server = new AutomationHttpServer(
      () => [project],
      path.join(root, 'runtime'),
      () => {},
      planning
    )
  })

  afterAll(() => {
    planning?.close()
    if (root) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  async function call(method: Method, route: string, body?: Record<string, unknown>) {
    const response = await server.invokeRoute(project.id, project.automationToken!, {
      method,
      path: route,
      query: {},
      body
    })
    return {
      status: response.status,
      json: JSON.parse(response.body.toString('utf8')) as {
        ok: boolean
        value?: { id: string }
        error?: string
      }
    }
  }
  const created = async (route: string, body: Record<string, unknown>) =>
    (await call('POST', route, body)).json.value!.id
  const unknownRoute = { status: 404, json: { ok: false, error: 'Unknown route' } }

  it('changes nothing for a write to a path under a task, goal or milestone', async () => {
    const goalId = await created('/goals', { title: 'Grow', outcome: 'More' })
    const milestoneId = await created('/milestones', { name: 'First', goalId })
    const taskId = await created('/work-items', { title: 'Write it' })

    expect(await call('PATCH', `/work-items/${taskId}/priority`, { title: 'Typo' })).toEqual(
      unknownRoute
    )
    expect(await call('PATCH', `/goals/${goalId}/status`, { title: 'Typo' })).toEqual(unknownRoute)
    expect(await call('PATCH', `/milestones/${milestoneId}/name`, { name: 'Typo' })).toEqual(
      unknownRoute
    )
    expect(await call('POST', `/work-items/${taskId}/archive/now`, {})).toEqual(unknownRoute)

    expect(planning.getWorkItem(taskId)).toMatchObject({ title: 'Write it', archivedAt: null })
    expect(planning.getGoal(goalId).title).toBe('Grow')
    expect(planning.listMilestones(project.id).find((m) => m.id === milestoneId)?.name).toBe(
      'First'
    )
  })

  it('answers a read of one goal, milestone or blocker as a route it does not have', async () => {
    const taskId = await created('/work-items', { title: 'Read me' })
    // One task has its own route: GET /work-items/:workItemId.
    expect((await call('GET', `/work-items/${taskId}`)).status).toBe(200)
    expect(await call('GET', '/goals/anything')).toEqual(unknownRoute)
    expect(await call('GET', '/milestones/anything')).toEqual(unknownRoute)
    expect(await call('GET', '/blockers/anything')).toEqual(unknownRoute)
    expect((await call('GET', '/work-items')).status).toBe(200)
  })

  it('looks up an iteration or a task template only on a route that takes one', async () => {
    const iterationId = await created('/iterations', {
      name: 'One',
      startDate: '2026-10-01',
      endDate: '2026-10-14'
    })
    expect(await call('GET', `/iterations/${iterationId}`)).toEqual(unknownRoute)
    expect(await call('GET', '/iterations/no-such-iteration')).toEqual(unknownRoute)
    expect((await call('PATCH', '/iterations/no-such-iteration', { goal: 'x' })).status).toBe(400)
    expect((await call('PATCH', `/iterations/${iterationId}`, { goal: 'Ship' })).status).toBe(200)

    expect(await call('GET', '/task-templates/no-such-template')).toEqual(unknownRoute)
    expect((await call('DELETE', '/task-templates/no-such-template')).status).toBe(400)
  })
})

describe('workstreams (sub-projects) in the automation API', () => {
  let root: string
  let planning: PlanningService
  let server: AutomationHttpServer
  const make = (id: string): WatchedProject =>
    makeWatchedProject({ id, name: id, addedAt: Date.now(), automationToken: `${id}-token` })
  const project = make('workstreams-a')
  const other = make('workstreams-b')

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-workstreams-'))
    planning = new PlanningService(await createMigratedDatabase(root), () => [project.id, other.id])
    server = new AutomationHttpServer(
      () => [project, other],
      path.join(root, 'runtime'),
      () => {},
      planning
    )
  })

  afterAll(() => {
    planning?.close()
    if (root) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  async function call(
    who: WatchedProject,
    method: Method,
    route: string,
    body?: Record<string, unknown>,
    query: Record<string, string> = {}
  ) {
    const response = await server.invokeRoute(who.id, who.automationToken!, {
      method,
      path: route,
      query,
      body
    })
    return {
      status: response.status,
      json: JSON.parse(response.body.toString('utf8')) as {
        ok: boolean
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        value?: any
        error?: string
      }
    }
  }
  const mine = (method: Method, route: string, body?: Record<string, unknown>) =>
    call(project, method, route, body)

  it('creates, lists, patches, archives, moves and deletes a workstream', async () => {
    const hull = await mine('POST', '/subprojects', { name: 'Hull', status: 'active' })
    expect(hull.status).toBe(200)
    expect(hull.json.value).toMatchObject({
      name: 'Hull',
      status: 'active',
      color: '#3b82f6',
      projectId: project.id,
      archivedAt: null
    })
    const sails = await mine('POST', '/subprojects', { name: 'Sails', color: '#ef4444' })
    expect(sails.json.value.color).toBe('#ef4444')
    expect((await mine('POST', '/subprojects', {})).json.ok).toBe(false)

    const listed = await mine('GET', '/subprojects')
    expect(listed.json.value.map((one: { name: string }) => one.name)).toEqual(['Hull', 'Sails'])

    const renamed = await mine('PATCH', `/subprojects/${hull.json.value.id}`, {
      name: 'Hull and deck',
      description: 'Everything below the mast'
    })
    expect(renamed.json.value).toMatchObject({
      name: 'Hull and deck',
      description: 'Everything below the mast'
    })

    const archived = await mine('PATCH', `/subprojects/${hull.json.value.id}`, { archived: true })
    expect(archived.json.value.archivedAt).toEqual(expect.any(Number))
    expect((await mine('GET', '/subprojects')).json.value).toHaveLength(2)
    const restored = await mine('PATCH', `/subprojects/${hull.json.value.id}`, { archived: false })
    expect(restored.json.value.archivedAt).toBeNull()
    expect(
      (await mine('PATCH', `/subprojects/${hull.json.value.id}`, { archived: 'yes' })).status
    ).toBe(400)

    const moved = await mine('POST', `/subprojects/${hull.json.value.id}/move`, { direction: 1 })
    expect(moved.json.value.map((one: { name: string }) => one.name)).toEqual([
      'Sails',
      'Hull and deck'
    ])
    expect(
      (await mine('POST', `/subprojects/${hull.json.value.id}/move`, { direction: 2 })).json.ok
    ).toBe(false)

    const task = await mine('POST', '/work-items', {
      title: 'Caulk',
      subprojectId: hull.json.value.id
    })
    expect(task.json.value.subprojectId).toBe(hull.json.value.id)
    const milestone = await mine('POST', '/milestones', {
      name: 'Watertight',
      subprojectId: hull.json.value.id
    })
    expect(milestone.json.value.subprojectId).toBe(hull.json.value.id)
    const filter = JSON.stringify({
      conditions: [{ field: 'subproject', op: 'is', value: [hull.json.value.id] }]
    })
    const filtered = await call(project, 'GET', '/work-items', undefined, { filter })
    expect(filtered.json.value.map((item: { id: string }) => item.id)).toEqual([task.json.value.id])

    const gone = await mine('DELETE', `/subprojects/${hull.json.value.id}`)
    expect(gone.json.value.id).toBe(hull.json.value.id)
    expect(planning.getWorkItem(task.json.value.id).subprojectId).toBeNull()
    expect(
      planning.listMilestones(project.id).find((one) => one.id === milestone.json.value.id)
        ?.subprojectId
    ).toBeNull()
    expect((await mine('GET', '/subprojects')).json.value).toHaveLength(1)
    expect((await mine('DELETE', `/subprojects/${hull.json.value.id}`)).json.ok).toBe(false)
  })

  it('reads and writes subprojectId on tasks and milestones, and refuses another project’s', async () => {
    const own = (await mine('POST', '/subprojects', { name: 'Rigging' })).json.value.id
    const foreign = (await call(other, 'POST', '/subprojects', { name: 'Elsewhere' })).json.value.id
    const task = (await mine('POST', '/work-items', { title: 'Splice' })).json.value
    expect(task.subprojectId).toBeNull()

    const set = await mine('PATCH', `/work-items/${task.id}`, { subprojectId: own })
    expect(set.json.value.subprojectId).toBe(own)
    const cleared = await mine('PATCH', `/work-items/${task.id}`, { subprojectId: null })
    expect(cleared.json.value.subprojectId).toBeNull()

    for (const result of [
      await mine('POST', '/work-items', { title: 'Nope', subprojectId: foreign }),
      await mine('PATCH', `/work-items/${task.id}`, { subprojectId: foreign }),
      await mine('POST', '/milestones', { name: 'Nope', subprojectId: foreign })
    ]) {
      expect(result.status).toBe(400)
      expect(result.json.ok).toBe(false)
    }
    const milestone = (await mine('POST', '/milestones', { name: 'Rig up' })).json.value
    expect(
      (await mine('PATCH', `/milestones/${milestone.id}`, { subprojectId: own })).json.value
        .subprojectId
    ).toBe(own)
    expect(
      (await mine('PATCH', `/milestones/${milestone.id}`, { subprojectId: foreign })).json.ok
    ).toBe(false)

    // Another project's workstream is not this token's to read, change, move or delete.
    expect((await mine('PATCH', `/subprojects/${foreign}`, { name: 'Mine now' })).json.ok).toBe(
      false
    )
    expect((await mine('POST', `/subprojects/${foreign}/move`, { direction: 1 })).json.ok).toBe(
      false
    )
    expect((await mine('DELETE', `/subprojects/${foreign}`)).json.ok).toBe(false)
    expect((await call(other, 'GET', '/subprojects')).json.value).toHaveLength(1)
  })
})
