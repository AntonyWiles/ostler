import type { IncomingMessage, ServerResponse } from 'http'
import type { WatchedProject } from '@shared/ostler-api'
import type { AutomationHttpServer } from '../automation-http-server'

/**
 * One automation route as GET /help describes it. The MCP server (D39) makes a
 * tool of every route except agent work and the routes marked `mcp.excluded`
 * (`electron/services/mcp/mcp-tools.ts`).
 */
export interface AutomationRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  description: string
  request?: string
  response: string
  exampleBody?: unknown
  /** Not an MCP tool, and why: a route MCP must not reach, or one a tool cannot carry. */
  mcp?: { excluded: string }
}

/** One request to a project route, after the token, project and body checks. */
export interface RouteCall {
  server: AutomationHttpServer
  req: IncomingMessage
  res: ServerResponse
  project: WatchedProject
  /** The project-relative path as sent, such as `/contacts/abc`: what change history records. */
  path: string
  /** The path's `:name` segments, as sent (not percent-decoded). */
  params: Record<string, string>
  query: URLSearchParams
  body: Record<string, unknown>
}

export type RouteHandler = (call: RouteCall) => Promise<void> | void

/**
 * A route's help and the code that answers it, in one record: GET /help, the
 * MCP tools and dispatch all read the same table, so none can describe a
 * route the others don't have.
 */
export interface AutomationRouteDef extends AutomationRoute {
  handler?: RouteHandler
  /** The largest JSON body the route reads, when it takes more than the usual cap (a file's text). */
  maxBodyBytes?: number
}

/** The route as GET /help and MCP see it: everything but the handler. */
export function helpRoute({
  handler: _handler,
  maxBodyBytes: _maxBodyBytes,
  ...route
}: AutomationRouteDef): AutomationRoute {
  return route
}

/**
 * The route with a handler for `method` and the project-relative `segments`.
 * A literal segment beats a `:param` (`/fields/reorder` over `/fields/:fieldId`).
 */
export function matchRoute(
  routes: readonly AutomationRouteDef[],
  method: string,
  segments: readonly string[]
): { route: AutomationRouteDef; params: Record<string, string> } | null {
  let best: { route: AutomationRouteDef; params: Record<string, string> } | null = null
  let bestLiterals = -1
  for (const route of routes) {
    if (!route.handler || route.method !== method) continue
    const pattern = route.path.split('/').filter(Boolean)
    if (pattern.length !== segments.length) continue
    const params: Record<string, string> = {}
    let literals = 0
    let matches = true
    for (let index = 0; index < pattern.length; index++) {
      const part = pattern[index]!
      if (part.startsWith(':')) params[part.slice(1)] = segments[index]!
      else if (part === segments[index]) literals++
      else {
        matches = false
        break
      }
    }
    if (matches && literals > bestLiterals) {
      best = { route, params }
      bestLiterals = literals
    }
  }
  return best
}

/**
 * Whether the request is under a route the table answers, whatever its method
 * or length: every literal segment of some handled route is in the request at
 * its place (`/contacts/a/b` is under `/contacts`; `/work-items/x` is not under
 * `/work-items/:workItemId/contacts`). Such a request that no route matches is
 * unknown, rather than one for the old if-chain in `handle()`.
 */
export function routeOwns(
  routes: readonly AutomationRouteDef[],
  segments: readonly string[]
): boolean {
  return routes.some((route) => {
    if (!route.handler) return false
    const pattern = route.path.split('/').filter(Boolean)
    return pattern.every(
      (part, index) => part.startsWith(':') || (index < segments.length && part === segments[index])
    )
  })
}
