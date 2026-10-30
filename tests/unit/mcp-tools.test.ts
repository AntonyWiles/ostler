import { describe, expect, it } from 'vitest'
import { HELP_ROUTES } from '../../electron/services/automation-http-server'
import type { AutomationRoute } from '../../electron/services/automation/route-table'
import {
  AGENT_WORK_RESOURCES,
  mcpExclusion,
  mcpRouteRequest,
  mcpToolName,
  mcpToolsFromRoutes
} from '../../electron/services/mcp/mcp-tools'

const route = (overrides: Partial<AutomationRoute>): AutomationRoute => ({
  method: 'GET',
  path: '/things',
  description: 'Things.',
  response: '{ ok: true, value: Thing[] }',
  ...overrides
})

describe('MCP tools from the automation route table (D39)', () => {
  const tools = mcpToolsFromRoutes(HELP_ROUTES)

  it('makes one tool of every route the table does not exclude, in its order', () => {
    const included = HELP_ROUTES.filter((entry) => mcpExclusion(entry) === null)
    expect(tools.map((tool) => tool.route)).toEqual(included)
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length)
    expect(tools.length).toBeGreaterThan(80)
  })

  it('shows a route added to the table as a tool, without writing it twice', () => {
    const added = route({
      method: 'POST',
      path: '/packing-lists/:listId/boxes',
      description: 'Add a box to a packing list.',
      request: 'JSON body: { label }',
      exampleBody: { label: 'Kitchen' }
    })
    const tool = mcpToolsFromRoutes([...HELP_ROUTES, added]).at(-1)!
    expect(tool.name).toBe('post_packing_lists_by_list_id_boxes')
    expect(tool.route).toBe(added)
    expect(tool.description).toContain('Add a box to a packing list.')
    expect(tool.description).toContain('POST /packing-lists/:listId/boxes')
    expect(tool.inputSchema).toMatchObject({
      required: ['listId'],
      properties: {
        listId: { type: 'string' },
        body: { description: 'JSON body: { label }', examples: [{ label: 'Kitchen' }] }
      }
    })
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
  })

  it('never makes a tool of agent work, tokens, or a route the table marks', () => {
    const names = tools.map((tool) => tool.name)
    for (const entry of HELP_ROUTES) {
      const resource = entry.path.split('/')[1]
      if (AGENT_WORK_RESOURCES.has(resource) || entry.mcp?.excluded)
        expect(names).not.toContain(mcpToolName(entry))
    }
    for (const path of [
      '/tasks',
      '/tasks/:taskId/start-embedded',
      '/sessions/:sessionId/merge',
      '/sessions/:sessionId/discard',
      '/sessions/:sessionId/stop',
      '/questions/:questionId/answer',
      '/events',
      '/checkout/export',
      '/auto-dispatch',
      '/projects'
    ]) {
      expect(tools.some((tool) => tool.route.path === path)).toBe(false)
    }
    // A route added later under an agent resource stays out by itself.
    expect(mcpToolsFromRoutes([route({ method: 'POST', path: '/sessions/:id/poke' })])).toEqual([])
    expect(mcpToolsFromRoutes([route({ mcp: { excluded: 'Not for MCP.' } })])).toEqual([])
    // Nothing about tokens is in the table at all.
    expect(HELP_ROUTES.some((entry) => /token/i.test(entry.path))).toBe(false)
  })

  it('keeps the planner’s routes: tasks, Library, people, reports and conventions to read', () => {
    const titles = tools.map((tool) => tool.title)
    for (const title of [
      'GET /work-items',
      'POST /work-items',
      'GET /goals',
      'POST /milestones',
      'POST /blockers',
      'GET /search',
      'GET /views',
      'GET /library',
      'POST /library/upload',
      'GET /people',
      'GET /templates',
      'POST /import/csv',
      'GET /export',
      'GET /reports',
      'GET /conventions'
    ])
      expect(titles).toContain(title)
    expect(titles).not.toContain('PATCH /conventions')
  })

  describe('mcpRouteRequest', () => {
    const patch = tools.find((tool) => tool.title === 'PATCH /work-items/:workItemId')!
    const list = tools.find((tool) => tool.title === 'GET /work-items')!

    it('fills the path, query and body', () => {
      expect(
        mcpRouteRequest(patch, {
          workItemId: 'a/b',
          query: { dryRun: true },
          body: { title: 'New' }
        })
      ).toEqual({
        method: 'PATCH',
        path: '/work-items/a%2Fb',
        query: { dryRun: 'true' },
        body: { title: 'New' }
      })
      expect(mcpRouteRequest(list, undefined)).toEqual({
        method: 'GET',
        path: '/work-items',
        query: {},
        body: undefined
      })
    })

    it('refuses a missing path parameter, an unknown argument and a body on a read', () => {
      expect(() => mcpRouteRequest(patch, { body: {} })).toThrow('workItemId is required')
      expect(() => mcpRouteRequest(list, { body: {} })).toThrow('Unknown argument: body')
      expect(() => mcpRouteRequest(list, { query: { a: { b: 1 } } })).toThrow(/query\.a/)
    })

    it('refuses autoQueue anywhere in a body: that queues agent work', () => {
      const batch = tools.find((tool) => tool.title === 'POST /work-items/batch')!
      expect(() =>
        mcpRouteRequest(batch, { body: { items: [{ title: 'x', autoQueue: true }] } })
      ).toThrow(/autoQueue/)
      expect(() =>
        mcpRouteRequest(patch, { workItemId: 'a', body: { autoQueue: false } })
      ).not.toThrow()
    })
  })
})
