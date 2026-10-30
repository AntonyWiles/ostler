/**
 * Planning rows as the database stores them, and their mapping to the shapes
 * the app uses. Pure: nothing here reads or writes the database.
 */
import type {
  PlanningBlocker,
  PlanningBlockerReportedBy,
  PlanningBlockerStatus,
  PlanningDecision,
  PlanningDecisionOrigin,
  PlanningGoal,
  PlanningGoalStatus,
  PlanningMilestone,
  PlanningMilestoneStatus,
  PlanningPriority,
  PlanningResolution,
  PlanningVerificationStatus,
  PlanningVerifiedBy,
  PlanningWorkItem,
  PlanningWorkItemStatus,
  PlanningRecurrence,
  PlanningScheduledQueueOutcome,
  PlanningDependencyLink,
  PlanningDependencyType
} from '@shared/ostler-api'
import type { TriageCapture } from '@shared/ostler-api'
import { normalisedDependencyLink } from '@shared/planning/dependency-links'
import { normalizeRecurrence } from '@shared/recurrence'
import { type GoalMeasureDirection } from '@shared/goal-measures'
import { roundFields, type RoundColumns } from './milestone-rounds'
import { type PlanFirstChoice } from '@shared/plan-first'

export interface GoalRow {
  id: string
  project_id: string
  title: string
  outcome: string
  status: PlanningGoalStatus
  measure_unit: string | null
  measure_start_value: number | null
  measure_target_value: number | null
  measure_start_date: string | null
  measure_target_date: string | null
  measure_direction: GoalMeasureDirection | null
  created_at: number
  updated_at: number
}

export interface MilestoneRow extends Partial<RoundColumns> {
  id: string
  project_id: string
  goal_id: string | null
  subproject_id?: string | null
  name: string
  outcome: string
  target_date: string | null
  success_criteria: string
  status: PlanningMilestoneStatus
  created_at: number
  updated_at: number
}

export interface WorkItemRow {
  id: string
  import_batch_id?: string | null
  project_id: string
  milestone_id: string | null
  title: string
  description: string
  status: PlanningWorkItemStatus
  priority: PlanningPriority
  labels: string
  acceptance_criteria: string
  target_date: string | null
  start_date: string | null
  assignee_id: string | null
  estimate: number | null
  origin: PlanningWorkItem['origin']
  linked_harness_task_id: string | null
  auto_queue: number
  plan_first?: PlanFirstChoice
  scheduled_queue?: PlanningScheduledQueueOutcome | null
  scheduled_queue_at?: number | null
  scheduled_queue_note?: string | null
  number?: number | null
  rating: number
  rating_note: string
  parent_work_item_id: string | null
  task_code: string
  phase_code: string
  phase_name: string
  subtask_phase_number: number | null
  subtask_phase_name: string
  verification_status: PlanningVerificationStatus
  verified_by: PlanningVerifiedBy | null
  verified_at: number | null
  verification_notes: string
  created_at: number
  updated_at: number
  order_key?: string
  archived_at: number | null
  deleted_at: number | null
  recurred_to_id?: string | null
  iteration_id?: string | null
  type_id?: string | null
  subproject_id?: string | null
  round_source_id?: string | null
  resolution?: PlanningResolution | null
  resolution_reason?: string
  show_from?: string | null
  someday?: number
  impact?: number | null
  effort?: number | null
  in_triage?: number
  captured_by?: TriageCapture | null
  column_id?: string | null
}

export interface RecurrenceRow {
  work_item_id: string
  project_id: string
  rule: string
  ends_on: string | null
  remaining: number | null
  rotation: string | null
  next_index: number
  go_to_agents?: number
}

export interface ChecklistCheckRow {
  work_item_id: string
  criterion_text: string
}

export interface DependencyRow {
  work_item_id: string
  depends_on_id: string
  type: PlanningDependencyType
  lag_days: number
}

export interface BlockerRow {
  id: string
  work_item_id: string
  description: string
  reported_by: PlanningBlockerReportedBy
  reported_at: number
  status: PlanningBlockerStatus
  resolution_options: string
  resolution_choice: string | null
  resolution_note: string
  resolved_at: number | null
  resolved_by: string | null
}

export interface DecisionRow {
  id: string
  project_id: string
  title: string
  context: string
  decision: string
  alternatives_considered: string
  consequences: string
  date: string
  linked_work_item_ids: string
  origin: PlanningDecisionOrigin
  created_at: number
  updated_at: number
}

export function toRecurrence(row: RecurrenceRow): PlanningRecurrence {
  return {
    workItemId: row.work_item_id,
    projectId: row.project_id,
    ...normalizeRecurrence({
      rule: JSON.parse(row.rule) as unknown,
      endsOn: row.ends_on,
      remaining: row.remaining,
      rotation: row.rotation ? (JSON.parse(row.rotation) as unknown) : null,
      nextIndex: row.next_index
    }),
    goToAgents: row.go_to_agents === 1
  }
}

export function toGoal(row: GoalRow): PlanningGoal {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    outcome: row.outcome,
    status: row.status,
    measure:
      row.measure_direction === null ||
      row.measure_start_value === null ||
      row.measure_target_value === null ||
      row.measure_start_date === null ||
      row.measure_target_date === null
        ? null
        : {
            unit: row.measure_unit ?? '',
            startValue: row.measure_start_value,
            targetValue: row.measure_target_value,
            startDate: row.measure_start_date,
            targetDate: row.measure_target_date,
            direction: row.measure_direction
          },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function toMilestone(row: MilestoneRow): PlanningMilestone {
  return {
    id: row.id,
    projectId: row.project_id,
    goalId: row.goal_id,
    subprojectId: row.subproject_id ?? null,
    name: row.name,
    outcome: row.outcome,
    targetDate: row.target_date,
    successCriteria: jsonStringList(row.success_criteria),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...roundFields(row)
  }
}

export function toDecision(row: DecisionRow): PlanningDecision {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    context: row.context,
    decision: row.decision,
    alternativesConsidered: row.alternatives_considered,
    consequences: row.consequences,
    date: row.date,
    linkedWorkItemIds: jsonStringList(row.linked_work_item_ids),
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function toBlocker(row: BlockerRow): PlanningBlocker {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    description: row.description,
    reportedBy: row.reported_by,
    reportedAt: row.reported_at,
    status: row.status,
    resolutionOptions: jsonStringList(row.resolution_options),
    resolutionChoice: row.resolution_choice,
    resolutionNote: row.resolution_note,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by
  }
}

export function jsonStringList(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : []
  } catch {
    return []
  }
}

export function dependencyLinkFromRow(
  row: Pick<DependencyRow, 'depends_on_id' | 'type' | 'lag_days'>
): PlanningDependencyLink {
  return normalisedDependencyLink({ id: row.depends_on_id, type: row.type, lagDays: row.lag_days })
}
