import type {
  OstlerConfig,
  PlanningActor,
  PlaybookRun,
  TaskTemplateAgent,
  TaskTemplateOverrides,
  WatchedProject,
  WorkItemAttachment
} from '@shared/ostler-api'
import { agentRunModelChoices, type AgentRunChoice } from '@shared/agent-model'
import { parseTaskTemplateAgent } from '@shared/task-templates'
import { requireProjectFolder } from '@shared/project-folder'
import { todayIsoDate } from '@shared/dates'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import { validateAgentRunChoice, type EffortSupportCheck } from './agent-run-model'
import type { HarnessService } from './harness-service'
import type { PlanningService } from './planning-service'
import { queueWorkItemForHarness } from './task-intake'

/**
 * Playbooks (N9.6b, N64): task templates for agents. A playbook's agent part
 * (model and effort, plan first, extra instructions) sits in its body, and
 * Run playbook makes the task with N2.1's one function, then queues it on the
 * one queue path. The app and the automation API both come here.
 */

const NO_AGENT: TaskTemplateAgent = {
  model: '',
  effort: '',
  planFirst: 'default',
  instructions: ''
}
const RUN_KEYS = ['title', 'model', 'effort', 'planFirst', 'instructions']
const MAX_TITLE = 200

/**
 * Checks an agent part as Settings checks a model and effort: the model must
 * be one the provider in effect offers (or the default), the effort one it
 * takes. `project` is null for a playbook every project can use.
 */
export async function validatePlaybookAgent(
  config: OstlerConfig,
  project: Pick<WatchedProject, 'autoDispatch'> | null,
  value: unknown,
  effortSupport?: EffortSupportCheck
): Promise<TaskTemplateAgent> {
  const agent = parseTaskTemplateAgent(value)
  await validateAgentRunChoice(
    config,
    project,
    { model: agent.model, effort: agent.effort },
    effortSupport
  )
  return agent
}

/**
 * The same check for a template body from any surface, when it holds an
 * agent part. The settings are read only then, so an ordinary template never
 * needs them.
 */
export async function checkTemplateBodyAgent(
  config: () => OstlerConfig,
  project: Pick<WatchedProject, 'autoDispatch'> | null,
  body: unknown,
  effortSupport?: EffortSupportCheck
): Promise<void> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return
  const agent = (body as Record<string, unknown>).agent
  if (agent === undefined || agent === null) return
  await validatePlaybookAgent(config(), project, agent, effortSupport)
}

export interface PlaybookRunDeps {
  config: OstlerConfig
  planning: PlanningService
  harness: HarnessService
  actor: PlanningActor
  /** The work item's agent-visible attachments, as every queue path lists them. */
  attachmentsFor?(projectId: string, workItemId: string): WorkItemAttachment[]
  effortSupport?: EffortSupportCheck
}

/**
 * Run playbook: makes the task from the playbook and queues it for agents in
 * one step, with the playbook's model and effort, its plan-first choice on
 * the task, and its extra instructions in the queued task's details. `input`
 * may change the title and any of the agent part for this run. Everything is
 * checked before the task is made, so a refusal leaves nothing behind. A
 * model the provider no longer offers is not refused when it is the
 * playbook's own: the run uses the project's default and says so.
 */
export async function runPlaybook(
  deps: PlaybookRunDeps,
  project: WatchedProject,
  templateId: string,
  input: unknown = {},
  today = todayIsoDate()
): Promise<PlaybookRun> {
  if (!deps.config.harness.enabled) throw new Refusal(t('errors:taskTemplates.agentsOff'))
  requireProjectFolder(project, 'Running a playbook')
  const template = deps.planning.taskTemplates.requireUsableIn(templateId, project.id)
  if (!template.playbook) throw new Refusal(t('errors:taskTemplates.notPlaybook'))
  const given = runInput(input)
  const own = template.body.agent ?? NO_AGENT
  const agent = parseTaskTemplateAgent({
    model: given.model ?? own.model,
    effort: given.effort ?? own.effort,
    planFirst: given.planFirst ?? own.planFirst,
    instructions: given.instructions ?? own.instructions
  })

  let choice: AgentRunChoice = { model: agent.model, effort: agent.effort }
  let modelNotOffered: string | undefined
  if (
    given.model === undefined &&
    agent.model &&
    !agentRunModelChoices(deps.config, project.autoDispatch).includes(agent.model)
  ) {
    modelNotOffered = agent.model
    choice = { model: '', effort: '' }
  }
  choice = await validateAgentRunChoice(deps.config, project, choice, deps.effortSupport)

  const overrides: TaskTemplateOverrides = {
    status: 'ready',
    ...(given.title !== undefined ? { title: given.title } : {}),
    ...(agent.planFirst !== 'default' ? { planFirst: agent.planFirst } : {})
  }
  const made = deps.planning.taskTemplates.use(
    project.id,
    template.id,
    { ...deps.actor, playbook: template.name },
    overrides,
    today
  )
  const queued = queueWorkItemForHarness(deps.planning, deps.harness, project, made.workItem.id, {
    allowUnmetDependencies: true,
    attachments: deps.attachmentsFor?.(project.id, made.workItem.id) ?? [],
    ...(choice.model || choice.effort ? { runChoice: choice } : {}),
    playbook: { templateId: template.id, name: template.name, instructions: agent.instructions }
  })
  return {
    ...made,
    workItem: queued.workItem,
    task: queued.task,
    ...(modelNotOffered ? { modelNotOffered } : {})
  }
}

function runInput(value: unknown): {
  title?: string
  model?: unknown
  effort?: unknown
  planFirst?: unknown
  instructions?: unknown
} {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Refusal(t('errors:taskTemplates.agentInvalid'))
  const input = value as Record<string, unknown>
  for (const key of Object.keys(input))
    if (!RUN_KEYS.includes(key))
      throw new Refusal(t('errors:taskTemplates.unknownField', { field: key }))
  let title: string | undefined
  if (input.title !== undefined && input.title !== null && input.title !== '') {
    if (
      typeof input.title !== 'string' ||
      !input.title.trim() ||
      input.title.trim().length > MAX_TITLE
    )
      throw new Refusal(t('errors:taskTemplates.runTitleInvalid'))
    title = input.title.trim()
  }
  const pick = (key: string) => (input[key] === undefined ? undefined : input[key])
  return {
    ...(title !== undefined ? { title } : {}),
    model: pick('model'),
    effort: pick('effort'),
    planFirst: pick('planFirst'),
    instructions: pick('instructions')
  }
}
