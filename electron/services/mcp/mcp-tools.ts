import { Refusal } from '@shared/refusal'
import type { AutomationRoute } from '../automation/route-table'

/**
 * The MCP tools (D39), made from the automation API's route table and never
 * listed a second time. Each tool is one route; calling it runs that route's
 * handler in-process, with the API's own validation, refusals and rights (the
 * automation agent's). A route added to the table is a tool from
 * then on, unless D39 excludes it:
 *
 * - every route about agent work: queuing, starting, stopping, merging,
 *   discarding or answering it, its sessions, questions and events, the
 *   checkout agents merge into, and agent settings (`AGENT_WORK_RESOURCES`);
 * - a route the table marks `mcp.excluded` (tokens, every project at once,
 *   Ostler AI's settings, a body a tool call cannot carry).
 *
 * MCP never reaches more than the API: it reaches less.
 */

/** The first path segment of every route D39 keeps away from MCP: agent work. */
export const AGENT_WORK_RESOURCES: ReadonlySet<string> = new Set([
  'tasks',
  'sessions',
  'questions',
  'events',
  'checkout',
  'auto-dispatch',
  'report',
  'workspace-setup',
  'agent-runs',
  'agent-usage'
])

export interface McpToolDefinition {
  name: string
  title: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
    additionalProperties: false
  }
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: false }
  route: AutomationRoute
}

/** One automation API request a tool call stands for. */
export interface McpRouteRequest {
  method: AutomationRoute['method']
  /** The route's path with its parameters filled in, e.g. `/work-items/abc`. */
  path: string
  query: Record<string, string>
  body: Record<string, unknown> | undefined
}

/** Why a route is not a tool, or null when it is one. */
export function mcpExclusion(route: AutomationRoute): string | null {
  if (route.mcp?.excluded) return route.mcp.excluded
  const resource = route.path.split('/').filter(Boolean)[0] ?? ''
  if (AGENT_WORK_RESOURCES.has(resource)) return 'Agent work is not reachable over MCP (D39).'
  return null
}

function pathParams(route: AutomationRoute): string[] {
  return route.path
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1))
}

function snakeCase(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
}

/**
 * A route's tool name: its method and path, e.g. `PATCH /work-items/:workItemId`
 * is `patch_work_items_by_work_item_id`. Unique because method and path are.
 */
export function mcpToolName(route: AutomationRoute): string {
  const segments = route.path
    .split('/')
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith(':') ? `by_${snakeCase(segment.slice(1))}` : snakeCase(segment)
    )
  return [route.method.toLowerCase(), ...segments].join('_')
}

function toolDescription(route: AutomationRoute): string {
  const lines = [route.description, '', `Automation API route: ${route.method} ${route.path}.`]
  if (route.request) lines.push(`Request: ${route.request}`)
  lines.push(`Response: ${route.response}`)
  return lines.join('\n')
}

function inputSchema(route: AutomationRoute): McpToolDefinition['inputSchema'] {
  const params = pathParams(route)
  const properties: Record<string, unknown> = {}
  for (const param of params) {
    properties[param] = { type: 'string', minLength: 1, description: `The ${param} in the path.` }
  }
  properties.query = {
    type: 'object',
    description:
      'Query string options the route describes (for example limit, filter, format), as name and value.',
    additionalProperties: { type: ['string', 'number', 'boolean'] }
  }
  if (route.method !== 'GET') {
    properties.body = {
      type: 'object',
      description: route.request ?? 'The JSON body the route describes; most routes need none.',
      ...(route.exampleBody !== undefined ? { examples: [route.exampleBody] } : {})
    }
  }
  return { type: 'object', properties, required: params, additionalProperties: false }
}

/** Every tool, in the route table's order. */
export function mcpToolsFromRoutes(routes: readonly AutomationRoute[]): McpToolDefinition[] {
  return routes
    .filter((route) => mcpExclusion(route) === null)
    .map((route) => ({
      name: mcpToolName(route),
      title: `${route.method} ${route.path}`,
      description: toolDescription(route),
      inputSchema: inputSchema(route),
      annotations: {
        readOnlyHint: route.method === 'GET',
        destructiveHint: route.method === 'DELETE',
        openWorldHint: false
      },
      route
    }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Body fields that, set to true, reach agent work, which D39 keeps away from
 * MCP, with the refusal each gets: queuing a task for agents now, sending a
 * repeating task's occurrences to agents later, and cancelling queued work.
 */
const AGENT_WORK_FLAGS: ReadonlyArray<readonly [string, string]> = [
  ['autoQueue', 'Queuing tasks for agents is not available over MCP; leave autoQueue out'],
  [
    'goToAgents',
    'Sending a repeating task to agents is not available over MCP; leave goToAgents out'
  ],
  [
    'cancelQueuedWork',
    'Cancelling work queued for agents is not available over MCP; leave cancelQueuedWork out'
  ]
]

/** Whether `value` sets `flag` to true anywhere. */
function setsFlag(value: unknown, flag: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => setsFlag(entry, flag))
  if (!isRecord(value)) return false
  return Object.entries(value).some(
    ([key, nested]) => (key === flag && nested === true) || setsFlag(nested, flag)
  )
}

/** Whether `value` sets, anywhere, whether a task plans first. */
function namesPlanFirst(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(namesPlanFirst)
  if (!isRecord(value)) return false
  return Object.entries(value).some(
    ([key, nested]) => key === 'planFirst' || namesPlanFirst(nested)
  )
}

/**
 * The API request a tool call stands for. Arguments are checked for shape
 * only: the route's own handler validates what they say.
 */
export function mcpRouteRequest(tool: McpToolDefinition, args: unknown): McpRouteRequest {
  const input = args === undefined ? {} : args
  if (!isRecord(input)) throw new Refusal('Tool arguments must be an object')
  const params = pathParams(tool.route)
  const known = new Set([...params, 'query', ...(tool.route.method === 'GET' ? [] : ['body'])])
  const unknown = Object.keys(input).filter((key) => !known.has(key))
  if (unknown.length > 0) throw new Refusal(`Unknown argument: ${unknown.join(', ')}`)

  let path = tool.route.path
  for (const param of params) {
    const value = input[param]
    if (typeof value !== 'string' || value === '') throw new Refusal(`${param} is required`)
    path = path.replace(`:${param}`, encodeURIComponent(value))
  }

  const query: Record<string, string> = {}
  if (input.query !== undefined) {
    if (!isRecord(input.query)) throw new Refusal('query must be an object')
    for (const [name, value] of Object.entries(input.query)) {
      if (!['string', 'number', 'boolean'].includes(typeof value))
        throw new Refusal(`query.${name} must be a string, number or true/false`)
      query[name] = String(value)
    }
  }

  let body: Record<string, unknown> | undefined
  if (input.body !== undefined) {
    if (!isRecord(input.body)) throw new Refusal('body must be an object')
    body = input.body
  }
  // autoQueue marks a task for agents to pick up by themselves, goToAgents
  // queues a repeating task's occurrences, cancelQueuedWork cancels a queued
  // task: all agent work, which D39 keeps away from MCP.
  for (const [flag, refusal] of AGENT_WORK_FLAGS) {
    if (setsFlag(body, flag)) throw new Refusal(refusal)
  }
  // Plan first (N9.3b) is how agent work runs, which D39 also keeps away.
  if (namesPlanFirst(body)) {
    throw new Refusal('Plan first is not available over MCP; leave planFirst out')
  }
  return { method: tool.route.method, path, query, body }
}
