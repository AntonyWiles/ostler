import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

/**
 * Developer-only trace of every outgoing Ostler-internal AI call and its
 * response, in full -- the complete prompt/messages sent and the complete
 * text that came back, not a summary. Exists purely to answer "what did
 * Ostler actually send/receive" while debugging provider issues (e.g. the
 * embedded-harness 500s this was built to chase down). Never read by the
 * app itself and never surfaced in the GUI -- writes to logs/ai-calls.log
 * at the repo root, which is gitignored, and only in dev (NODE_ENV
 * development / ELECTRON_RENDERER_URL set, the same check main.ts uses)
 * since a packaged build has no sensible "repo root" to write into.
 */
const isDev = process.env.NODE_ENV === 'development' || !!process.env['ELECTRON_RENDERER_URL']
const LOG_DIR = join(process.cwd(), 'logs')
const LOG_FILE = join(LOG_DIR, 'ai-calls.log')

export interface AiCallLogEntry {
  /** Which provider class/path made the call, e.g. 'openai-compatible', 'openai-responses', 'anthropic', 'google', 'embedded-harness'. */
  kind: string
  provider?: string
  baseUrl: string
  model: string
  endpoint: string
  /** The exact outgoing request body/payload -- full prompt/messages, not truncated. */
  request: unknown
  /** The exact response: full accumulated text for a stream, or the parsed/raw body otherwise. */
  response?: unknown
  responseStatus?: number
  error?: string
  durationMs: number
}

let dirEnsured = false
function ensureDir(): void {
  if (dirEnsured) return
  try {
    mkdirSync(LOG_DIR, { recursive: true })
  } catch {
    // Best-effort: a logging failure must never affect the real AI call.
  }
  dirEnsured = true
}

const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+);base64,([\s\S]*)$/

function imagePlaceholder(mimeType: string, base64: string): string {
  const padding = base64.match(/=+$/)?.[0].length ?? 0
  const bytes = Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
  return `[image: ${mimeType}, ${bytes} bytes]`
}

/**
 * Replaces image data with "[image: <mime>, <bytes> bytes]" so the log never
 * holds image content. Covers every shape Ostler sends: data URLs (OpenAI chat
 * and Responses), Anthropic base64 sources, Google inlineData, and Ostler's
 * own `{ type: 'image', mimeType, base64 }` parts.
 */
export function redactImageData(value: unknown): unknown {
  if (typeof value === 'string') {
    const match = DATA_URL.exec(value)
    return match ? imagePlaceholder(match[1], match[2]) : value
  }
  if (Array.isArray(value)) return value.map(redactImageData)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (typeof record.base64 === 'string' && typeof record.mimeType === 'string') {
    return { ...record, base64: imagePlaceholder(record.mimeType, record.base64) }
  }
  const mime = record.media_type ?? record.mimeType
  if (typeof record.data === 'string' && typeof mime === 'string') {
    return { ...record, data: imagePlaceholder(mime, record.data) }
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, redactImageData(entry)])
  )
}

export function logAiCall(entry: AiCallLogEntry): void {
  if (!isDev) return
  try {
    ensureDir()
    const safe = { ...entry, request: redactImageData(entry.request) }
    appendFileSync(
      LOG_FILE,
      `${JSON.stringify({ timestamp: new Date().toISOString(), ...safe })}\n`
    )
  } catch {
    // Best-effort: a logging failure must never affect the real AI call.
  }
}
