import { useState } from 'react'
import {
  proposalTitle,
  toGoalInput,
  toMilestoneInput,
  toWorkItemInput,
  type ChatProposal
} from '@shared/ostler-api'
import { TASK_PRIORITY_LABELS } from '@shared/task-labels'
import { Badge, Button, InlineAlert } from '../ui'
import { Check } from '../ui/icons'
import { t } from '@shared/i18n'
import { formatIsoDate } from '@shared/dates'

const PRIORITY_LABEL: Record<string, string> = TASK_PRIORITY_LABELS

/** What the project already tracks, lower-cased, so a suggestion is not added twice. */
export interface TrackedPlanning {
  goals: Set<string>
  /** Lower-cased milestone name -> id, also used to attach a proposed task. */
  milestones: Map<string, string>
  workItems: Set<string>
}

export const EMPTY_TRACKED_PLANNING: TrackedPlanning = {
  goals: new Set(),
  milestones: new Map(),
  workItems: new Set()
}

const KIND_LABEL: Record<ChatProposal['type'], string> = {
  get goal() {
    return t('ai:projectChatProposals.kind.goal')
  },
  get milestone() {
    return t('ai:projectChatProposals.kind.milestone')
  },
  get work_item() {
    return t('ai:projectChatProposals.kind.work_item')
  }
}

function isTracked(proposal: ChatProposal, tracked: TrackedPlanning): boolean {
  const title = proposalTitle(proposal).toLowerCase()
  if (proposal.type === 'goal') return tracked.goals.has(title)
  if (proposal.type === 'milestone') return tracked.milestones.has(title)
  return tracked.workItems.has(title)
}

type CardState = 'idle' | 'adding' | 'added' | 'dismissed'

/**
 * The chat's suggestions, as cards. Nothing is created until Add is pressed,
 * and Add goes through the same planning IPC as the Planning view's own
 * "new" buttons -- the model has no path to create a record itself.
 */
export function ProposalCards({
  projectId,
  proposals,
  tracked,
  onAdded
}: {
  projectId: string
  proposals: ChatProposal[]
  tracked: TrackedPlanning
  onAdded: () => void
}) {
  const [states, setStates] = useState<Record<string, CardState>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const keyOf = (proposal: ChatProposal) =>
    `${proposal.type}:${proposalTitle(proposal).toLowerCase()}`
  const setState = (key: string, state: CardState) =>
    setStates((previous) => ({ ...previous, [key]: state }))

  const add = async (proposal: ChatProposal) => {
    const key = keyOf(proposal)
    setState(key, 'adding')
    setErrors((previous) => {
      const rest = { ...previous }
      delete rest[key]
      return rest
    })
    try {
      let result
      if (proposal.type === 'goal') {
        result = await window.ostlerAPI.createPlanningGoal(projectId, toGoalInput(proposal))
      } else if (proposal.type === 'milestone') {
        result = await window.ostlerAPI.createPlanningMilestone(
          projectId,
          toMilestoneInput(proposal)
        )
      } else {
        const milestoneId = proposal.milestone
          ? (tracked.milestones.get(proposal.milestone.toLowerCase()) ?? null)
          : null
        result = await window.ostlerAPI.createPlanningWorkItem(
          projectId,
          toWorkItemInput(proposal, milestoneId)
        )
      }
      if (result.ok) {
        setState(key, 'added')
        onAdded()
      } else {
        setState(key, 'idle')
        setErrors((previous) => ({ ...previous, [key]: result.error }))
      }
    } catch (error) {
      setState(key, 'idle')
      setErrors((previous) => ({
        ...previous,
        [key]: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  const visible = proposals.filter((proposal) => states[keyOf(proposal)] !== 'dismissed')
  if (visible.length === 0) return null

  return (
    <ul
      className="chat-proposals"
      aria-label={t('ai:projectChatProposals.suggestedPlanningRecords')}
    >
      {visible.map((proposal) => {
        const key = keyOf(proposal)
        const state = states[key] ?? 'idle'
        const alreadyThere = state === 'added' || isTracked(proposal, tracked)
        const detail = proposal.type === 'work_item' ? proposal.description : proposal.outcome
        const meta =
          proposal.type === 'work_item'
            ? proposal.milestone
              ? t('ai:projectChatProposals.priorityAddedBacklogNot', {
                  priority: PRIORITY_LABEL[proposal.priority] ?? proposal.priority,
                  milestone: proposal.milestone
                })
              : t('ai:projectChatProposals.priorityAddedBacklogNot2', {
                  priority: PRIORITY_LABEL[proposal.priority] ?? proposal.priority
                })
            : proposal.type === 'milestone'
              ? [
                  proposal.targetDate &&
                    t('ai:projectChatProposals.due', { date: formatIsoDate(proposal.targetDate) }),
                  ...proposal.successCriteria
                ]
                  .filter(Boolean)
                  .join(' · ')
              : ''
        return (
          <li key={key} className="chat-proposal">
            <div className="chat-proposal__main">
              <span className="chat-proposal__title">
                <Badge tone="accent">{KIND_LABEL[proposal.type]}</Badge>
                <strong>{proposalTitle(proposal)}</strong>
              </span>
              {detail && <p>{detail}</p>}
              {meta && <p className="chat-proposal__meta">{meta}</p>}
              {errors[key] && <InlineAlert tone="danger">{errors[key]}</InlineAlert>}
            </div>
            <div className="chat-proposal__actions">
              {alreadyThere ? (
                <Badge tone={state === 'added' ? 'success' : 'neutral'} icon={Check}>
                  {state === 'added'
                    ? t('ai:projectChatProposals.added')
                    : t('ai:projectChatProposals.alreadyProject')}
                </Badge>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={state === 'adding'}
                    onClick={() => setState(key, 'dismissed')}
                  >
                    {t('ai:projectChatProposals.dismiss')}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={state === 'adding'}
                    onClick={() => void add(proposal)}
                  >
                    {t('ai:projectChatProposals.add')}
                  </Button>
                </>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
