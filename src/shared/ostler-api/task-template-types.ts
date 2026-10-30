import type { AIEffortSetting } from './ai-types'
import type { PlanningFieldValues } from './field-types'
import type { HarnessTask } from './harness-types'
import type { PlanFirstChoice } from '../plan-first'
import type {
  CreatePlanningWorkItemInput,
  PlanningPriority,
  PlanningWorkItem
} from './planning-types'

// ─── Task templates (N2.1, N16) ─────────────────────────────────────────────

export const MAX_TASK_TEMPLATE_NAME_LENGTH = 80
/** Subtasks a template holds, one level deep. */
export const MAX_TASK_TEMPLATE_SUBTASKS = 30
/** Templates one project may have, and templates for every project. */
export const MAX_TASK_TEMPLATES = 200

/** A subtask a template makes: its title, description and checklist. */
export interface TaskTemplateSubtask {
  title: string
  description: string
  checklist: string[]
}

/**
 * What a task template holds (N16). Dates are days after the day the
 * template is used, in the project package's relative form (`+3d`, `+2w`),
 * never calendar days. The assignee is a person id and the custom field
 * values are by field id: what no longer applies when it is used is
 * dropped and reported, never refused. Comments, activity, attachments,
 * dependencies and agent links never travel.
 */
/**
 * A checklist item's due date (relative, like the task's) and person in a
 * template (N2.2), by the item's text.
 */
export interface TaskTemplateChecklistDetail {
  text: string
  dueDate: string | null
  assigneeId: string | null
}

/** The longest extra instructions a playbook holds for the agent (N9.6b). */
export const MAX_PLAYBOOK_INSTRUCTIONS = 4000

/**
 * A playbook's agent part (N9.6b, N64): what Run playbook queues the task
 * with. The model and effort are for the built-in agent only, as a run's are
 * (D42); '' is the default. The instructions are the person's words about
 * this task, Markdown, added to the queued task's details: never standing
 * instructions, and they never widen what an agent may do.
 */
export interface TaskTemplateAgent {
  model: string
  effort: AIEffortSetting
  planFirst: PlanFirstChoice
  instructions: string
}

export interface TaskTemplateBody {
  title: string
  description: string
  checklist: string[]
  /** Items with a due date or person (N2.2); absent when none has. */
  checklistDetails?: TaskTemplateChecklistDetail[]
  labels: string[]
  priority: PlanningPriority
  estimate: number | null
  assigneeId: string | null
  fieldValues: PlanningFieldValues
  startDate: string | null
  dueDate: string | null
  subtasks: TaskTemplateSubtask[]
  /** A playbook's agent part (N9.6b); absent on a template saved without one. */
  agent?: TaskTemplateAgent
}

export interface TaskTemplate {
  id: string
  /** The project it belongs to, or null for every project. */
  projectId: string | null
  name: string
  body: TaskTemplateBody
  /** A playbook (N9.6b): listed apart, and run for agents with its agent part. */
  playbook: boolean
  createdAt: number
  updatedAt: number
}

export interface SaveTaskTemplateInput {
  name: string
  /** The project it belongs to, or null for every project. */
  projectId: string | null
  body: unknown
  /** A playbook (N9.6b); false when left out. */
  playbook?: boolean
  /** Replace the template of the same name and scope; without it, a clash is refused. */
  replace?: boolean
}

export interface SaveTaskTemplateFromWorkItemInput {
  /** Defaults to the task's title. */
  name?: string
  /** "This project" (the task's) or "Every project". */
  scope: 'project' | 'every'
  /** Keep the start and due dates, as days after the day it is saved. */
  keepDates?: boolean
  replace?: boolean
  /** "Save as playbook…" (N9.6b): saved as a playbook with this agent part. */
  agent?: unknown
}

export interface UpdateTaskTemplateInput {
  name?: string
  /** A project's id, or null for every project. */
  projectId?: string | null
  body?: unknown
  /** Make it a playbook, or stop it being one (N9.6b); its agent part stays in the body. */
  playbook?: boolean
}

/**
 * What the person may set on top of a template when it is used: anything
 * given here wins over the template (New task's form, quick add's line).
 */
export type TaskTemplateOverrides = Partial<
  Pick<
    CreatePlanningWorkItemInput,
    | 'title'
    | 'description'
    | 'status'
    | 'priority'
    | 'labels'
    | 'acceptanceCriteria'
    | 'milestoneId'
    | 'iterationId'
    | 'typeId'
    | 'assigneeId'
    | 'startDate'
    | 'targetDate'
    | 'estimate'
    | 'dependencyIds'
    | 'dependencyLinks'
    | 'fieldValues'
    | 'autoQueue'
    | 'planFirst'
  >
>

/** What a template held that this project could not take. */
export interface TaskTemplateDropped {
  /** The assignee is no longer one of the people. */
  assignee: boolean
  /** Custom fields this project does not have, or values they no longer take. */
  fieldCount: number
}

export interface TaskTemplateUse {
  workItem: PlanningWorkItem
  subtasks: PlanningWorkItem[]
  dropped: TaskTemplateDropped
}

/** What deleting a template returns; restoring takes it back. */
export interface TaskTemplateDeletion {
  template: TaskTemplate
  /** The task types that started from it (N2.7b), so Undo names it there again. */
  typeIds?: string[]
}

/**
 * Run playbook (N9.6b): what the person may change for this run. Left out,
 * each comes from the playbook.
 */
export interface RunPlaybookInput {
  title?: string
  model?: string
  effort?: AIEffortSetting
  planFirst?: PlanFirstChoice
  instructions?: string
}

/** What Run playbook made and queued. */
export interface PlaybookRun extends TaskTemplateUse {
  task: HarnessTask
  /**
   * The playbook's model, when the provider in effect no longer offers it:
   * the run uses the project's default instead.
   */
  modelNotOffered?: string
}
