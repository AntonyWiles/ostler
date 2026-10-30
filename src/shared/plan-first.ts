/**
 * Plan first (N9.3a, decision N61): an agent working a plan-first task sends a
 * plan and waits until the person approves it, asks for changes or cancels,
 * before it changes anything. The harness side only; N9.3b adds the switch and
 * the approval screens.
 */

/**
 * Whether plans exist for people and agents. While false, the standing
 * instructions and the harness help say nothing about plans, and nothing
 * can make a task plan-first. N9.3b turned it on with the switch and the
 * approval screens; tests of the hidden state turn it off with `vi.mock`.
 */
export const PLAN_FIRST_AVAILABLE = true

/** A task's own choice (N9.3b): follow the project's "Agents plan first", or yes or no. */
export type PlanFirstChoice = 'default' | 'yes' | 'no'

export const PLAN_FIRST_CHOICES: readonly PlanFirstChoice[] = ['default', 'yes', 'no']

/**
 * Whether a task's run plans first: the task's own choice wins over the
 * project's default. The one rule for the app, the dispatcher and the API.
 */
export function resolvePlanFirst(
  choice: PlanFirstChoice | null | undefined,
  projectDefault: boolean
): boolean {
  if (choice === 'yes') return true
  if (choice === 'no') return false
  return projectDefault
}

/** The project's "Agents plan first" (N9.3b): off unless the person turned it on. */
export function projectAgentsPlanFirst(project: {
  autoDispatch?: { agentsPlanFirst?: boolean }
}): boolean {
  return project.autoDispatch?.agentsPlanFirst === true
}

/**
 * The plan's files beside what the run changed (N9.3b), for Review changes:
 * both lists sorted, paths compared with forward slashes.
 */
export function comparePlanFiles(
  planned: readonly string[],
  changed: readonly string[]
): { changedNotPlanned: string[]; plannedNotChanged: string[] } {
  const norm = (file: string) => file.replace(/\\/g, '/').replace(/^\.\//, '')
  const plannedSet = new Set(planned.map(norm))
  const changedSet = new Set(changed.map(norm))
  return {
    changedNotPlanned: [...changedSet].filter((file) => !plannedSet.has(file)).sort(),
    plannedNotChanged: [...plannedSet].filter((file) => !changedSet.has(file)).sort()
  }
}

/** The most steps a plan may have. */
export const MAX_PLAN_STEPS = 30
/** The longest one step may be, in characters. */
export const MAX_PLAN_STEP_LENGTH = 500
/** The most files a plan may name. */
export const MAX_PLAN_FILES = 200
/** The longest the risks may be, in characters. */
export const MAX_PLAN_RISKS_LENGTH = 4000
/** The longest the person's note asking for changes may be, in characters. */
export const MAX_PLAN_CHANGES_NOTE_LENGTH = 4000

/** What a plan says, the same for the embedded tool and the harness API. Text for agents. */
export const PLAN_CONTENT_GUIDANCE = `A plan has steps (up to ${MAX_PLAN_STEPS}, each at most ${MAX_PLAN_STEP_LENGTH} characters, in the order you will do them), the files you expect to change (up to ${MAX_PLAN_FILES} paths, relative to the project), and risks (at most ${MAX_PLAN_RISKS_LENGTH} characters: what could go wrong, what you are unsure of, anything the person should know before approving).`

/** How a plan-first run goes, for both kinds of agent. Text for agents. */
export const PLAN_FIRST_GUIDANCE =
  'When your task asks for a plan first, send a plan before you change anything: no edits, no commits. Read the code as much as you need to plan well. Then wait for the person. They approve it (carry on and do the task as planned), ask for changes with a note (revise the plan and send it again as a new version, still without changing anything), or cancel the task (stop at once). There is no time limit: never start the work because nobody has answered yet. If the work turns out to need something the approved plan did not say, ask the person before you do it.'

/** The opening line an embedded agent on a plan-first task reads. Text for agents. */
export const PLAN_FIRST_EMBEDDED_PROMPT =
  'This task asks for a plan first. Before you change anything, read what you need, then call ostler_submit_plan with your plan and wait for the person to decide. Do not edit files or commit until the plan is approved.'

/** What an external agent's claim and session say about a plan-first task. Text for agents. */
export const PLAN_FIRST_EXTERNAL_NOTE =
  'This task asks for a plan first. Before you change anything, POST /session/:sessionId/plan with your plan, then wait for plan.status in GET /session/:sessionId (or a plan.decided event on GET /events). Do not edit or commit until it is "approved".'
