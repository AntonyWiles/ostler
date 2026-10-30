import { useEffect, useState } from 'react'
import { assertResult } from '../../utils/unwrap-result'
import type {
  AIDecisionApproval,
  AIDecisionDraft,
  AIPlanningDraft,
  AIProjectBrief,
  PlanningGoal
} from '@shared/ostler-api'
import type { PlanningRunner } from './usePlanningRunner'
import type { PlanningRecords } from './usePlanningRecords'
import type { PlanningCreateForm } from './usePlanningCreateForm'
import type { WorkItemDrawer } from './useWorkItemDrawer'
import { t } from '@shared/i18n'

type BriefAction = AIProjectBrief['nextActions'][number]

const notesFor = (brief: AIProjectBrief) =>
  Object.fromEntries(brief.nextActions.map((action) => [action.id, action.reviewNotes]))

/**
 * Ostler AI's drafts on the planning workspace, each waiting on a human: a
 * goal's breakdown, the project brief and its recommendations, a decision
 * draft, and the agent-plan wizard's starting point. (The "next five tasks"
 * draft is `useAiNextTasks`, which PlanningView runs directly.) Depends on the
 * runner, records, create form and drawer.
 */
export function usePlanningAiDrafts(
  projectId: string,
  runner: PlanningRunner,
  records: PlanningRecords,
  createForm: PlanningCreateForm,
  drawer: WorkItemDrawer,
  setWorkspaceView: (view: 'board') => void
) {
  const { busy } = runner
  const { runBusy } = runner.internal
  const { loadPlanning } = records
  const { setWorkItems, setDecisions, setHarnessState } = records.internal

  const [agentPlanGoal, setAgentPlanGoal] = useState<PlanningGoal | null>(null)
  /** Library items the wizard was opened with ("Plan work from these"). */
  const [agentPlanSourceIds, setAgentPlanSourceIds] = useState<string[]>([])
  const [aiDraft, setAiDraft] = useState<AIPlanningDraft | null>(null)
  const [aiGoalTitle, setAiGoalTitle] = useState('')
  const [selectedSuggestions, setSelectedSuggestions] = useState<number[]>([])
  const [aiDecisionDraft, setAiDecisionDraft] = useState<AIDecisionDraft | null>(null)
  const [projectBrief, setProjectBrief] = useState<AIProjectBrief | null>(null)
  const [briefTab, setBriefTab] = useState<'overview' | 'recommendations'>('overview')
  const [briefActionNotes, setBriefActionNotes] = useState<Record<string, string>>({})

  useEffect(() => {
    setAiDraft(null)
    setProjectBrief(null)
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    void window.ostlerAPI.getAIProjectBrief(projectId).then((result) => {
      if (!result.ok || !result.value) return
      setProjectBrief(result.value)
      setBriefActionNotes(notesFor(result.value))
    })
  }, [projectId])

  const refreshHarnessState = async () => {
    const harnessResult = await window.ostlerAPI.getHarnessState(projectId)
    if (harnessResult.ok) setHarnessState(harnessResult.value)
  }

  /** `sourceIds` are library items chosen up front; Always items are added by the wizard. */
  const openAgentPlanWizard = (goal: PlanningGoal, sourceIds: string[] = []) => {
    setAgentPlanSourceIds(sourceIds)
    setAgentPlanGoal(goal)
  }
  const closeAgentPlanWizard = () => {
    setAgentPlanGoal(null)
    setAgentPlanSourceIds([])
  }

  /** `sourceIds`: library items chosen up front, as the Library's "Plan work from these" does. */
  const breakDownGoal = async (goal: PlanningGoal, sourceIds: string[] = []) => {
    await runBusy(
      t('tasks:usePlanningAiDrafts.couldntBreakDownGoal'),
      async () => {
        const result = await window.ostlerAPI.breakDownPlanningGoal(
          goal.projectId,
          goal.id,
          sourceIds.length > 0 ? sourceIds : undefined
        )
        assertResult(result)
        setAiGoalTitle(goal.title)
        setAiDraft(result.value)
        setSelectedSuggestions(result.value.suggestions.map((_, index) => index))
      },
      { subject: goal.id }
    )
  }

  const closeAiDraft = () => {
    if (!busy) {
      setAiDraft(null)
      setSelectedSuggestions([])
    }
  }

  /** `attachments`: per suggestion index, the proposed attachments the human left ticked. */
  const addAiSuggestions = async (attachments: Record<number, string[]> = {}) => {
    if (!aiDraft || selectedSuggestions.length === 0) return
    await runBusy(t('tasks:usePlanningAiDrafts.couldntAddAiSuggestions'), async () => {
      const result = await window.ostlerAPI.approveAIPlanningDraft(
        aiDraft.projectId,
        aiDraft.goalId,
        selectedSuggestions.map((suggestionIndex) => {
          const suggestion = aiDraft.suggestions[suggestionIndex]
          return {
            suggestionIndex,
            title: suggestion.title,
            description: suggestion.description,
            priority: suggestion.priority,
            acceptanceCriteria: suggestion.acceptanceCriteria,
            attachments: attachments[suggestionIndex] ?? suggestion.attachments ?? []
          }
        })
      )
      assertResult(result)
      setAiDraft(null)
      setSelectedSuggestions([])
      await loadPlanning()
    })
  }

  const updateAiSuggestion = (
    index: number,
    update: Partial<AIPlanningDraft['suggestions'][number]>
  ) => {
    setAiDraft((current) =>
      current
        ? {
            ...current,
            suggestions: current.suggestions.map((suggestion, suggestionIndex) =>
              suggestionIndex === index ? { ...suggestion, ...update } : suggestion
            )
          }
        : current
    )
  }

  const generateProjectBrief = async () => {
    if (!projectId) return
    await runBusy(t('tasks:usePlanningAiDrafts.couldntGenerateProjectBrief'), async () => {
      const result = await window.ostlerAPI.generateAIProjectBrief(projectId)
      assertResult(result)
      setProjectBrief(result.value)
      setBriefTab('overview')
      setBriefActionNotes(notesFor(result.value))
    })
  }

  const reviewBriefAction = async (action: BriefAction, reviewStatus: 'approved' | 'rejected') => {
    if (!projectId) return
    await runBusy(t('tasks:usePlanningAiDrafts.couldntSaveRecommendationReview'), async () => {
      const result = await window.ostlerAPI.reviewAIProjectBriefAction(
        projectId,
        action.id,
        reviewStatus,
        briefActionNotes[action.id] ?? action.reviewNotes
      )
      assertResult(result)
      setProjectBrief(result.value)
    })
  }

  const regenerateBriefAction = async (action: BriefAction) => {
    if (!projectId) return
    await runBusy(t('tasks:usePlanningAiDrafts.couldntRegenerateRecommendationTry'), async () => {
      const result = await window.ostlerAPI.regenerateAIProjectBriefAction(
        projectId,
        action.id,
        briefActionNotes[action.id] ?? action.reviewNotes
      )
      assertResult(result)
      setProjectBrief(result.value)
    })
  }

  const createFromBriefAction = async (
    action: BriefAction,
    type: 'goal' | 'milestone' | 'work-item'
  ) => {
    if (!projectId || action.reviewStatus !== 'approved' || action.creation) return
    const { setBriefCreationDraft } = createForm.internal
    if (type === 'goal') {
      createForm.setGoalTitle(action.title)
      createForm.setGoalOutcome(action.rationale)
      setBriefCreationDraft({ actionId: action.id, type: 'goal' })
      createForm.setCreateMode('goal')
      return
    }
    if (type === 'milestone') {
      createForm.setMilestoneName(action.title)
      createForm.setMilestoneOutcome(action.rationale)
      setBriefCreationDraft({ actionId: action.id, type: 'milestone' })
      createForm.setCreateMode('milestone')
      return
    }
    await runBusy(t('tasks:usePlanningAiDrafts.couldntCreateQueueTask'), async () => {
      const createResult = await window.ostlerAPI.createPlanningWorkItem(projectId, {
        title: action.title,
        description: action.rationale,
        status: 'ready',
        priority: 'high',
        labels: ['ai-brief'],
        acceptanceCriteria: action.evidence
      })
      assertResult(createResult)
      const queueResult = await window.ostlerAPI.queuePlanningWorkItem(
        projectId,
        createResult.value.id
      )
      assertResult(queueResult)
      const briefResult = await window.ostlerAPI.recordAIProjectBriefActionCreation(
        projectId,
        action.id,
        'work-item',
        queueResult.value.workItem.id
      )
      assertResult(briefResult)
      setProjectBrief(briefResult.value)
      await refreshHarnessState()
      await loadPlanning()
      setWorkItems((current) => [
        ...current.filter((item) => item.id !== queueResult.value.workItem.id),
        queueResult.value.workItem
      ])
      drawer.openWorkItem(queueResult.value.workItem)
      setWorkspaceView('board')
    })
  }

  const undoBriefActionCreation = async (action: BriefAction) => {
    if (!projectId || !action.creation) return
    await runBusy(t('tasks:usePlanningAiDrafts.couldntUndoCreatedItem'), async () => {
      const result = await window.ostlerAPI.undoAIProjectBriefActionCreation(projectId, action.id)
      assertResult(result)
      setProjectBrief(result.value)
      await loadPlanning()
      await refreshHarnessState()
    })
  }

  const draftAIDecision = async (workItemId?: string) => {
    if (!projectId) return
    await runBusy(t('tasks:usePlanningAiDrafts.couldntDraftDecisionAi'), async () => {
      const result = await window.ostlerAPI.draftAIDecision(projectId, workItemId)
      assertResult(result)
      setAiDecisionDraft(result.value)
    })
  }

  const approveAIDecision = async (approval: AIDecisionApproval) => {
    if (!projectId || !aiDecisionDraft) return
    await runBusy(t('tasks:usePlanningAiDrafts.couldntApproveAiDecision'), async () => {
      const result = await window.ostlerAPI.approveAIDecision(
        projectId,
        aiDecisionDraft.draftId,
        approval
      )
      assertResult(result)
      setDecisions((current) => [result.value, ...current.filter((d) => d.id !== result.value.id)])
      setAiDecisionDraft(null)
    })
  }

  const closeAiDecisionDraft = () => {
    if (!busy) setAiDecisionDraft(null)
  }

  return {
    agentPlanGoal,
    agentPlanSourceIds,
    openAgentPlanWizard,
    closeAgentPlanWizard,
    aiDraft,
    aiGoalTitle,
    selectedSuggestions,
    setSelectedSuggestions,
    breakDownGoal,
    closeAiDraft,
    addAiSuggestions,
    updateAiSuggestion,
    projectBrief,
    briefTab,
    setBriefTab,
    briefActionNotes,
    setBriefActionNotes,
    generateProjectBrief,
    reviewBriefAction,
    regenerateBriefAction,
    createFromBriefAction,
    undoBriefActionCreation,
    aiDecisionDraft,
    setAiDecisionDraft,
    draftAIDecision,
    approveAIDecision,
    closeAiDecisionDraft,
    internal: { setProjectBrief }
  }
}

export type PlanningAiDrafts = ReturnType<typeof usePlanningAiDrafts>
