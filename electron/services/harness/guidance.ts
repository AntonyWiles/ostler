import { randomUUID } from 'crypto'
import type { HarnessGuidance, WatchedProject } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import type { HarnessContext } from './context'
import type { StoredHarnessState } from './types'

/** The longest message the person may send to a run in one go (D41). */
export const MAX_GUIDANCE_LENGTH = 4000
/** At most this many messages to one run within `GUIDANCE_RATE_WINDOW_MS` (D41). */
export const GUIDANCE_RATE_LIMIT = 5
export const GUIDANCE_RATE_WINDOW_MS = 10 * 60_000

/**
 * A refusal with the HTTP status the automation API answers it with: 409 for
 * a run that is not running, 413 for a message over the length cap, 429 for
 * one over the rate cap.
 */
export class GuidanceRefusal extends Refusal {
  constructor(
    readonly status: 400 | 409 | 413 | 429,
    message: string
  ) {
    super(message)
  }
}

/**
 * Stores a message from the person for a running run (D41). Sending is a
 * human action on a run that exists: it never creates, claims or ends
 * anything, and a run that has ended is refused plainly. Delivery is the
 * caller's: the embedded runner posts it into the session, an external agent
 * receives it on its next read of its session.
 */
export function addGuidance(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  text: string,
  from: string,
  via: HarnessGuidance['via'],
  now = Date.now()
): HarnessGuidance {
  const clean = text.trim()
  if (!clean) throw new GuidanceRefusal(400, t('errors:guidance.empty'))
  if (clean.length > MAX_GUIDANCE_LENGTH) {
    throw new GuidanceRefusal(
      413,
      t('errors:guidance.tooLong', { length: clean.length, max: MAX_GUIDANCE_LENGTH })
    )
  }
  let created: HarnessGuidance | undefined
  ctx.mutate(project, (state) => {
    const session = state.sessions.find((candidate) => candidate.id === sessionId)
    if (!session || session.status === 'done') {
      throw new GuidanceRefusal(409, t('errors:guidance.notRunning'))
    }
    const recent = state.guidance.filter(
      (entry) =>
        entry.sessionId === sessionId && now - Date.parse(entry.sentAt) < GUIDANCE_RATE_WINDOW_MS
    )
    if (recent.length >= GUIDANCE_RATE_LIMIT) {
      throw new GuidanceRefusal(
        429,
        t('errors:guidance.tooMany', {
          limit: GUIDANCE_RATE_LIMIT,
          minutes: GUIDANCE_RATE_WINDOW_MS / 60_000
        })
      )
    }
    created = {
      id: randomUUID(),
      sessionId,
      text: clean,
      from: from.trim().slice(0, 200) || 'The person',
      via,
      sentAt: new Date(now).toISOString(),
      deliveredAt: null
    }
    state.guidance.push(created)
  })
  if (!created) throw new Error('Guidance could not be stored')
  return created
}

/** Marks one message delivered: the embedded runner posted it into the session. */
export function markGuidanceDelivered(
  ctx: HarnessContext,
  project: WatchedProject,
  guidanceId: string
): HarnessGuidance | null {
  let delivered: HarnessGuidance | null = null
  ctx.mutate(project, (state) => {
    const entry = state.guidance.find((candidate) => candidate.id === guidanceId)
    if (!entry || entry.deliveredAt) return
    entry.deliveredAt = new Date().toISOString()
    delivered = { ...entry }
  })
  return delivered
}

/** A session's messages not yet delivered, oldest first. */
export function undeliveredGuidance(
  state: StoredHarnessState,
  sessionId: string
): HarnessGuidance[] {
  return state.guidance.filter((entry) => entry.sessionId === sessionId && !entry.deliveredAt)
}

/**
 * Hands an external agent the messages waiting for it and marks them
 * delivered, so each one is returned exactly once.
 */
export function takeUndeliveredGuidance(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string
): HarnessGuidance[] {
  const stored = ctx.loadState(project.id)
  if (!stored || undeliveredGuidance(stored, sessionId).length === 0) return []
  let taken: HarnessGuidance[] = []
  ctx.mutate(project, (state) => {
    const deliveredAt = new Date().toISOString()
    taken = undeliveredGuidance(state, sessionId).map((entry) => {
      entry.deliveredAt = deliveredAt
      return { ...entry }
    })
  })
  return taken
}
