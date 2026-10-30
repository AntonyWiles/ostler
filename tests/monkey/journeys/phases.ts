import * as fs from 'fs'
import * as path from 'path'
import type { FakeAi } from '../lib/fake-ai'
import { StepError, type Session } from '../lib/session'

/**
 * A journey is a list of phases, each a stretch of work a person would do in
 * one sitting: set up AI, plan the project, review an agent's work. A phase
 * that fails is recorded as a finding with its screenshot, and the journey
 * goes on with every phase that does not need it. What phases learn (the
 * project's id, which tasks exist) is saved in the run folder, so a later run
 * can do only `--phases review,close` on the same data.
 */

export interface JourneyState {
  projectId?: string
  projectPath?: string
  sampleProjectId?: string
  goalId?: string
  /** Planned key (M1, T3) → id. */
  milestones: Record<string, string>
  tasks: Record<string, string>
  /** Tasks the agents have finished and someone accepted. */
  merged: string[]
  importedProjectId?: string
  notes: string[]
}

export interface PhaseContext {
  session: Session
  fakeAi: FakeAi | null
  state: JourneyState
  save(): void
}

export interface Phase {
  name: string
  title: string
  /** Phases that must have passed (in this run or an earlier one) first. */
  needs?: string[]
  /** A reason to skip this phase in this run, or null to run it. */
  skip?: (context: PhaseContext) => string | null
  run: (context: PhaseContext) => Promise<void>
}

function statePath(session: Session): string {
  return path.join(session.options.runDir, 'journey-state.json')
}

export function loadState(session: Session): JourneyState {
  try {
    return JSON.parse(fs.readFileSync(statePath(session), 'utf8')) as JourneyState
  } catch {
    return { milestones: {}, tasks: {}, merged: [], notes: [] }
  }
}

function passedEarlier(session: Session): Set<string> {
  try {
    const phases = JSON.parse(
      fs.readFileSync(path.join(session.options.runDir, 'phases-passed.json'), 'utf8')
    ) as string[]
    return new Set(phases)
  } catch {
    return new Set()
  }
}

export async function runPhases(
  phases: Phase[],
  session: Session,
  fakeAi: FakeAi | null
): Promise<void> {
  const { recorder, options } = session
  const state = loadState(session)
  const context: PhaseContext = {
    session,
    fakeAi,
    state,
    save: () => fs.writeFileSync(statePath(session), JSON.stringify(state, null, 2))
  }
  const passed = passedEarlier(session)
  const savePassed = () =>
    fs.writeFileSync(
      path.join(options.runDir, 'phases-passed.json'),
      JSON.stringify([...passed], null, 2)
    )

  for (const phase of phases) {
    if (options.phases && !options.phases.includes(phase.name)) continue
    const record = recorder.phaseStart(phase.name, phase.title)
    const missing = (phase.needs ?? []).filter((need) => !passed.has(need))
    const skipReason = missing.length
      ? `needs ${missing.join(', ')}, which did not pass`
      : (phase.skip?.(context) ?? null)
    if (skipReason) {
      recorder.phaseEnd(record, 'skipped', skipReason)
      continue
    }
    try {
      await phase.run(context)
      context.save()
      passed.add(phase.name)
      savePassed()
      await session.recorder.screenshot(session.page, `end-${phase.name}`, {
        force: options.shots === 'phases'
      })
      recorder.phaseEnd(record, 'passed')
    } catch (error) {
      context.save()
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
      const shot =
        error instanceof StepError && error.screenshot
          ? error.screenshot
          : await recorder
              .screenshot(session.page, `failed-${phase.name}`, { force: true })
              .catch(() => undefined)
      recorder.finding({
        kind: 'broken',
        severity: 'S2',
        title: `${phase.title}: could not finish — ${message}`.slice(0, 200),
        details:
          `The journey could not complete this phase the way a person would. Either Ostler is wrong here, ` +
          `or the screen changed and the journey needs updating (tests/monkey/journeys/). Check the screenshot.\n\n` +
          (error instanceof Error ? (error.stack ?? message) : message),
        where: await session.screen().catch(() => 'unknown'),
        screenshot: shot,
        key: `phase|${phase.name}|${message.slice(0, 80)}`
      })
      recorder.phaseEnd(record, 'failed', message)
      // Leave the screen as a person would after a failed attempt: close what is open.
      await session.page.keyboard.press('Escape').catch(() => {})
      await session.page.keyboard.press('Escape').catch(() => {})
    }
  }
}
