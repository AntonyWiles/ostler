import type { AgentEvent, AgentEventType } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'

/** How many events each project keeps; an older cursor gets `resync`. */
export const AGENT_EVENTS_PER_PROJECT = 500
/** The longest a `GET /events` may wait, in seconds (D41). */
export const MAX_EVENT_WAIT_SECONDS = 60
/** How many `GET /events` one token may hold open at once. */
export const MAX_CONCURRENT_EVENT_WAITS = 4

/** What `GET /events` answers. */
export interface AgentEventPage {
  events: AgentEvent[]
  /** Pass as the next `since`. */
  cursor: number
  /** The cursor is older than the buffer (or from before a restart): read state afresh. */
  resync?: true
}

export type AgentEventInput = Omit<AgentEvent, 'cursor' | 'at' | 'projectId'> & {
  type: AgentEventType
}

/** Which of a project's events a caller may see. */
export type AgentEventFilter = (event: AgentEvent) => boolean

interface Waiter {
  projectId: string
  since: number
  filter: AgentEventFilter
  resolve: (page: AgentEventPage) => void
}

/** Too many waits are open on one token; the HTTP servers answer 429. */
export class EventWaitLimitError extends Refusal {
  constructor() {
    super(
      `At most ${MAX_CONCURRENT_EVENT_WAITS} GET /events requests may wait at once on one token. Let one return before you open another.`
    )
  }
}

/**
 * The agent event stream behind both APIs' `GET /events` (D41): a bounded
 * buffer in memory per project, long-polled. Nothing is stored: a restart
 * starts a fresh stream, and a cursor from before it reads as `resync`.
 *
 * Cursors start at the time the stream was created (in milliseconds) and go up
 * by one per event, so a cursor from an earlier run is always below this run's
 * first event and is told to resync rather than silently missing what changed.
 */
export class AgentEventStream {
  private readonly base: number
  private latest: number
  private readonly buffers = new Map<string, AgentEvent[]>()
  /** The newest cursor each project has dropped from its buffer. */
  private readonly evictedThrough = new Map<string, number>()
  private readonly waiters = new Set<Waiter>()
  private readonly waitsPerToken = new Map<string, number>()

  constructor(
    private readonly perProject = AGENT_EVENTS_PER_PROJECT,
    private readonly now: () => number = Date.now
  ) {
    this.base = now()
    this.latest = this.base
  }

  /** The cursor of the newest event (the stream's start when there is none). */
  get cursor(): number {
    return this.latest
  }

  publish(projectId: string, input: AgentEventInput): AgentEvent {
    this.latest += 1
    const event: AgentEvent = {
      ...input,
      cursor: this.latest,
      at: new Date(this.now()).toISOString(),
      projectId
    }
    const buffer = this.buffers.get(projectId) ?? []
    buffer.push(event)
    while (buffer.length > this.perProject) {
      const dropped = buffer.shift()!
      this.evictedThrough.set(projectId, dropped.cursor)
    }
    this.buffers.set(projectId, buffer)
    for (const waiter of [...this.waiters]) {
      if (waiter.projectId !== projectId || !waiter.filter(event)) continue
      this.waiters.delete(waiter)
      waiter.resolve(this.read(projectId, waiter.since, waiter.filter))
    }
    return event
  }

  /**
   * The events after `since` that `filter` lets through, at once. With no
   * `since`, reading starts now: nothing past, and the cursor to continue from.
   */
  read(projectId: string, since: number | null, filter: AgentEventFilter): AgentEventPage {
    if (since === null) return { events: [], cursor: this.latest }
    const evicted = this.evictedThrough.get(projectId) ?? this.base
    if (since < evicted || since > this.latest) {
      return { events: [], cursor: this.latest, resync: true }
    }
    const events = (this.buffers.get(projectId) ?? []).filter(
      (event) => event.cursor > since && filter(event)
    )
    return { events, cursor: events.length > 0 ? events[events.length - 1].cursor : this.latest }
  }

  /**
   * `read`, but when there is nothing to return yet, waits up to `waitSeconds`
   * for an event. Ends at once, with what there is, when `signal` aborts: the
   * server stopping or the client going away. `token` counts against the cap
   * on concurrent waits.
   */
  async wait(
    projectId: string,
    since: number | null,
    waitSeconds: number,
    filter: AgentEventFilter,
    token: string,
    signal: AbortSignal
  ): Promise<AgentEventPage> {
    const start = since ?? this.latest
    const immediate = this.read(projectId, start, filter)
    if (immediate.events.length > 0 || immediate.resync || waitSeconds <= 0 || signal.aborted) {
      return immediate
    }
    const open = this.waitsPerToken.get(token) ?? 0
    if (open >= MAX_CONCURRENT_EVENT_WAITS) throw new EventWaitLimitError()
    this.waitsPerToken.set(token, open + 1)
    try {
      return await new Promise<AgentEventPage>((resolve) => {
        let timer: NodeJS.Timeout | null = null
        const finish = (page: AgentEventPage) => {
          if (timer) clearTimeout(timer)
          signal.removeEventListener('abort', onAbort)
          this.waiters.delete(waiter)
          resolve(page)
        }
        const waiter: Waiter = { projectId, since: start, filter, resolve: finish }
        const onAbort = () => finish(this.read(projectId, start, filter))
        timer = setTimeout(onAbort, Math.min(waitSeconds, MAX_EVENT_WAIT_SECONDS) * 1000)
        signal.addEventListener('abort', onAbort, { once: true })
        this.waiters.add(waiter)
      })
    } finally {
      const remaining = (this.waitsPerToken.get(token) ?? 1) - 1
      if (remaining > 0) this.waitsPerToken.set(token, remaining)
      else this.waitsPerToken.delete(token)
    }
  }

  /** Forgets a removed project's events. */
  dropProject(projectId: string): void {
    this.buffers.delete(projectId)
    this.evictedThrough.delete(projectId)
  }
}

/** `since` and `wait` from a query string, validated alike on both servers. */
export function parseEventQuery(query: URLSearchParams): {
  since: number | null
  wait: number
} {
  const rawSince = query.get('since')
  const rawWait = query.get('wait')
  const since = rawSince === null || rawSince === '' ? null : Number(rawSince)
  if (since !== null && (!Number.isInteger(since) || since < 0)) {
    throw new EventQueryError('since must be a cursor from an earlier GET /events')
  }
  const wait = rawWait === null || rawWait === '' ? 0 : Number(rawWait)
  if (!Number.isFinite(wait) || wait < 0 || wait > MAX_EVENT_WAIT_SECONDS) {
    throw new EventQueryError(
      `wait must be a number of seconds from 0 to ${MAX_EVENT_WAIT_SECONDS}`
    )
  }
  return { since, wait }
}

/** A malformed `since` or `wait`; the HTTP servers answer 400. */
export class EventQueryError extends Refusal {}
