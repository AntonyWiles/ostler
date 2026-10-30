import { t } from '@shared/i18n'
import { logAiCall, type AiCallLogEntry } from './ai-call-logger'

/**
 * How long a provider has to start responding, and how long a stream that did
 * start may then go silent.
 *
 * One overall deadline cannot express this: a long generation is legitimate,
 * an open socket with nothing coming down it is not. Node's fetch applies no
 * timeout of its own, so without these a stalled provider left the calling IPC
 * handler pending forever and the UI waiting on a reply that never came.
 */
export const REQUEST_START_TIMEOUT_MS = 60_000
const STREAM_IDLE_TIMEOUT_MS = 120_000

export interface StreamWatchdog {
  signal: AbortSignal
  /** Restarts the idle countdown; call for every chunk that arrives. */
  keepAlive(): void
  /** Stops the countdown once the request is finished, either way. */
  stop(): void
  /** Which limit aborted the request, if this watchdog is why it aborted. */
  readonly firedAt: 'start' | 'idle' | null
}

export function startStreamWatchdog(): StreamWatchdog {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  let firedAt: 'start' | 'idle' | null = null
  const arm = (ms: number, reason: 'start' | 'idle'): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      firedAt = reason
      controller.abort()
    }, ms)
  }
  arm(REQUEST_START_TIMEOUT_MS, 'start')
  return {
    signal: controller.signal,
    keepAlive: () => arm(STREAM_IDLE_TIMEOUT_MS, 'idle'),
    stop: () => {
      if (timer) clearTimeout(timer)
      timer = null
    },
    get firedAt() {
      return firedAt
    }
  }
}

/** Turns a bare `AbortError` into something that says which limit was hit. */
function describeStreamFailure(
  error: unknown,
  watchdog: StreamWatchdog,
  provider: string
): unknown {
  if (watchdog.firedAt === 'start') {
    return new Error(
      t('errors:aiProvider.didNotStartResponding', {
        provider,
        REQUEST_START_TIMEOUT_MS: REQUEST_START_TIMEOUT_MS / 1000
      })
    )
  }
  if (watchdog.firedAt === 'idle') {
    return new Error(
      `${provider} stopped sending output for ${STREAM_IDLE_TIMEOUT_MS / 1000}s; the response is incomplete.`
    )
  }
  return error
}

/**
 * Decoded text off a response body, feeding the watchdog on every chunk.
 *
 * The `finally` matters as much as the loop: a consumer that stops reading
 * part-way runs this generator's `return`, and without cancelling the reader
 * there the connection stayed open with nobody draining it.
 */
async function* readResponseStream(
  res: Response,
  watchdog: StreamWatchdog
): AsyncGenerator<string, void, unknown> {
  if (!res.body) throw new Error('No response body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      watchdog.keepAlive()
      yield decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

/** One server-sent event: its `event:` name (empty when none came) and its `data:` line. */
export interface SseEvent {
  event: string
  data: string
}

/**
 * The `data:` lines of a server-sent event stream, each with the `event:` name
 * that came before it, until `[DONE]` or the end of the body.
 *
 * The line buffer and the event name both outlive a single read: a chunk
 * boundary can fall anywhere, including between an `event:` line and its
 * `data:` line. A gateway may also end without a trailing newline, so the last
 * buffered line is read too rather than dropped.
 */
export async function* streamSse(
  res: Response,
  watchdog: StreamWatchdog
): AsyncGenerator<SseEvent, void, unknown> {
  let buffer = ''
  let event = ''
  for await (const text of readResponseStream(res, watchdog)) {
    buffer += text
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7)
      else if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') return
        yield { event, data }
      }
    }
  }
  if (buffer.startsWith('data: ') && buffer.slice(6) !== '[DONE]') {
    yield { event, data: buffer.slice(6) }
  }
}

/** Parses one event's JSON, or undefined for a malformed or partial one. */
export function parseSseJson<T>(data: string): T | undefined {
  try {
    return JSON.parse(data) as T
  } catch {
    return undefined
  }
}

/** What a provider's stream body can read and set while it runs. */
export interface ProviderStream {
  watchdog: StreamWatchdog
  /** The response's HTTP status, for the log. */
  status?: number
}

/**
 * Runs one provider's streamed request: starts the watchdog, passes the text
 * through, logs the call with everything it returned (or how it failed), turns
 * a watchdog abort into words that say which limit was hit, and always stops
 * the watchdog. Each provider keeps only its request and its event mapping.
 */
export async function* withProviderStream(
  provider: string,
  log: Omit<AiCallLogEntry, 'response' | 'responseStatus' | 'error' | 'durationMs'>,
  run: (stream: ProviderStream) => AsyncGenerator<string, void, unknown>
): AsyncGenerator<string, void, unknown> {
  const started = Date.now()
  let accumulated = ''
  const stream: ProviderStream = { watchdog: startStreamWatchdog() }
  try {
    for await (const chunk of run(stream)) {
      accumulated += chunk
      yield chunk
    }
    logAiCall({
      ...log,
      response: accumulated,
      responseStatus: stream.status,
      durationMs: Date.now() - started
    })
  } catch (rawError) {
    const error = describeStreamFailure(rawError, stream.watchdog, provider)
    logAiCall({
      ...log,
      response: accumulated || undefined,
      responseStatus: stream.status,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started
    })
    throw error
  } finally {
    stream.watchdog.stop()
  }
}
