import type { ServerResponse } from 'http'
import type { PlanningActor } from '@shared/ostler-api'
import type { AutomationHttpServer } from '../automation-http-server'
import type { PlanningService } from '../planning-service'
import { respondJson } from '../loopback-http'
import type { RouteCall } from './route-table'

/** Every planning write made over this API is by `automation` (P5.2). */
export const AUTOMATION_ACTOR: PlanningActor = { kind: 'automation' }

/** The planning service, or an error when main has not set one up. */
export function planningOf(server: AutomationHttpServer): PlanningService {
  if (!server.planning) throw new Error('Planning API unavailable')
  return server.planning
}

/**
 * Answers a planning write: records it in change history as `summary`, pushes
 * the change so the Board refreshes, and sends `value`.
 */
export function planningChanged(call: RouteCall, summary: string, value: unknown): void {
  call.server.recordMutation(call.project, call.path, summary)
  call.server.onPlanningChange?.(call.project)
  respondJson(call.res, 200, { ok: true, value })
}

/** A true/false query option: `1`/`true` or `0`/`false`, else its default. */
export function queryFlag(query: URLSearchParams, name: string, fallback: boolean): boolean {
  const value = query.get(name)
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return fallback
}

/** Sends a CSV file's text, as the export routes do. */
export function respondCsv(res: ServerResponse, text: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Length': Buffer.byteLength(text)
  })
  res.end(text)
}
