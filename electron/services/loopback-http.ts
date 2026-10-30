import type { IncomingMessage, ServerResponse } from 'http'
import { isRefusal, Refusal, refusalLogLine } from '@shared/refusal'
import { appLog } from '../app/logging'

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024

export function bearerToken(req: IncomingMessage): string {
  const authorization = req.headers.authorization ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
}

/** A request's JSON body, any JSON value; undefined when there is none. */
export async function readJsonValue(
  req: IncomingMessage,
  maximumBytes = DEFAULT_MAX_BODY_BYTES
): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buffer.length
    if (size > maximumBytes) throw new Refusal('Request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new Refusal('Request body must be valid JSON')
  }
}

export async function readJsonRecord(
  req: IncomingMessage,
  maximumBytes = DEFAULT_MAX_BODY_BYTES
): Promise<Record<string, unknown>> {
  const value = await readJsonValue(req, maximumBytes)
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function respondJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  })
  res.end(body)
}

/**
 * Logs a route that failed, as `handleIpc` does: a refusal (a validation
 * message, a business rule) is one INFO line without a
 * stack; anything else is an ERROR with its stack.
 */
export function logRouteFailure(server: string, route: string, error: unknown): void {
  if (isRefusal(error)) appLog.info(refusalLogLine(`${server} ${route} refused`, error))
  else appLog.error(`${server} ${route} failed`, error)
}

/** The body of a failed route: `{ ok: false, error }`. */
export function routeFailureBody(error: unknown): Record<string, unknown> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}
