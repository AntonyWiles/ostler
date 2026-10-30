import type { HarnessProjectState, OstlerConfig, WatchedProject } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { projectFolder } from '@shared/project-folder'
import { describeOpenAgentWork } from './project-folder-service'

/**
 * "Use AI agents" (D10) is `harness.enabled`. Turning it off hides the agent
 * screens, so it is refused while any project still has agent work queued,
 * running or waiting for review: hiding must never strand that work.
 */
export function assertAgentsCanTurnOff(
  projects: readonly WatchedProject[],
  getState: (project: WatchedProject) => HarnessProjectState
): void {
  const open = projects
    .map((project) => {
      const work = describeOpenAgentWork(getState(project))
      return work ? `${project.name}: ${work}` : null
    })
    .filter((line): line is string => line !== null)
  if (open.length === 0) return
  throw new Refusal(
    `Agents can't be turned off while they have work. ${open.join('; ')}. ` +
      'Cancel the queued runs, and stop, accept or discard the others, then try again.'
  )
}

/**
 * Agents use Ready and In review, so while agents are on, a project with a
 * folder shows them (D34): turning agents on, or linking a folder while they
 * are on, shows them again where a project hid them. `show` unhides one
 * project's and returns what it showed.
 */
export function showAgentColumnsWhereNeeded(
  config: Pick<OstlerConfig, 'harness' | 'projects'>,
  show: (projectId: string) => readonly string[],
  only?: string
): void {
  if (!config.harness.enabled) return
  for (const project of config.projects) {
    if (only !== undefined && project.id !== only) continue
    if (projectFolder(project) === null) continue
    const shown = show(project.id)
    if (shown.length > 0)
      console.log(
        `[columns] Showed ${shown.join(', ')} again in project ${project.id}: agents are on and it has a folder`
      )
  }
}

/** The ports main listens on for a config: each server only while its switch is on. */
export function httpServerPorts(config: Pick<OstlerConfig, 'harness' | 'automationApi'>): {
  harness: number | null
  automation: number | null
} {
  return {
    harness: config.harness.enabled ? config.harness.port : null,
    // The automation API has its own switch in Settings › Connections, apart
    // from agents (D38).
    automation: config.automationApi.enabled ? config.automationApi.port : null
  }
}

interface Listener {
  start(port: number): void
  stop(): void
}

/** Starts, restarts or stops the two HTTP servers to match `config`. */
export function syncHttpServers(
  previous: Pick<OstlerConfig, 'harness' | 'automationApi'> | null,
  config: Pick<OstlerConfig, 'harness' | 'automationApi'>,
  servers: { harness: Listener; automation: Listener }
): void {
  const before = previous ? httpServerPorts(previous) : { harness: null, automation: null }
  const after = httpServerPorts(config)
  for (const key of ['harness', 'automation'] as const) {
    if (previous && before[key] === after[key]) continue
    const port = after[key]
    if (port === null) servers[key].stop()
    else servers[key].start(port)
  }
}
