import type { HarnessGuidance, WatchedProject } from '@shared/ostler-api'
import type { HarnessService } from './harness-service'
import { GuidanceRefusal } from './harness/guidance'
import { t } from '@shared/i18n'

/** What sending guidance needs from the embedded runner. */
export interface GuidanceRunner {
  isRunning(sessionId: string): boolean
  deliverGuidance(guidance: HarnessGuidance): Promise<void>
}

/**
 * Guidance from the person to a running run (D41): the one path the app and
 * the automation API both send through, so embedded and external runs get it
 * by the same rule.
 *
 * - Embedded: posted into the live opencode session at once, and marked
 *   delivered when opencode has taken it.
 * - External: kept with the session until the agent's next read of its
 *   session (`GET /session/:sessionId`), which returns it and marks it
 *   delivered; the event stream announces it meanwhile.
 */
export class RunGuidanceService {
  constructor(
    private readonly harness: HarnessService,
    private readonly runner: GuidanceRunner,
    /** The person's name from Settings › People, which labels every message. */
    private readonly personName: () => string | null
  ) {}

  async send(
    project: WatchedProject,
    sessionId: string,
    text: string,
    via: HarnessGuidance['via']
  ): Promise<HarnessGuidance> {
    const session = this.harness
      .getState(project)
      .activeSessions.find((candidate) => candidate.id === sessionId)
    if (!session) throw new GuidanceRefusal(409, t('errors:guidance.notRunning'))
    const embedded = session.provenance === 'embedded'
    // Stop all AI ends embedded runs; one whose agent is gone is not running.
    if (embedded && !this.runner.isRunning(sessionId)) {
      throw new GuidanceRefusal(409, t('errors:guidance.notRunning'))
    }
    const stored = this.harness.addGuidance(
      project,
      sessionId,
      text,
      this.personName()?.trim() || 'The person',
      via
    )
    if (!embedded) return stored
    await this.runner.deliverGuidance(stored)
    return this.harness.markGuidanceDelivered(project, stored.id) ?? stored
  }
}
