import { PlanningPriority } from '@shared/ostler-api'
import { AGENT_RUN_STATES, agentRunStateLabel, type AgentRunState } from '@shared/agent-run-state'
import { t } from '@shared/i18n'

/** The queue's filter chips: every run that is not finished, then each state. */
export type AgentRunFilter = AgentRunState | 'all'

export const AGENT_RUN_FILTERS: AgentRunFilter[] = ['all', ...AGENT_RUN_STATES]

export function agentRunFilterLabel(filter: AgentRunFilter): string {
  return filter === 'all' ? t('agents:runState.all') : agentRunStateLabel(filter)
}

export interface NextTaskReviewItem {
  suggestionIndex: number
  included: boolean
  title: string
  description: string
  priority: PlanningPriority
  acceptanceCriteria: string
  milestoneId: string
  status: 'backlog' | 'ready'
  /** Proposed attachments the human left ticked; starts as the draft's proposal. */
  attachments: string[]
}

export interface CodeWorkspaceRoot {
  label: string
  path: string
}

export type AgentTaskMenuState = {
  kind: 'planning' | 'execution'
  id: string
  x: number
  y: number
} | null

export type ConversationReportContextMenuState = {
  reportId: string
  x: number
  y: number
} | null
