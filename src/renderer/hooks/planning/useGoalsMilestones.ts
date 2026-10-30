import { assertResult } from '../../utils/unwrap-result'
import type {
  PlanningGoal,
  PlanningGoalStatus,
  PlanningMilestone,
  PlanningMilestoneStatus
} from '@shared/ostler-api'
import type { PlanningRunner } from './usePlanningRunner'
import type { PlanningRecords } from './usePlanningRecords'
import { t } from '@shared/i18n'

/**
 * Editing goals and milestones in place: status, title or name and outcome,
 * and delete. (Creating them is the create form's job, breaking a goal down
 * is an AI draft, and milestone readiness is computed by the views from
 * `src/shared/planning-readiness.ts`.) Depends on the runner and records.
 */
export function useGoalsMilestones(runner: PlanningRunner, records: PlanningRecords) {
  const { setError } = runner
  const { runBusy } = runner.internal
  const { setGoals, setMilestones } = records.internal

  const replaceGoal = (goal: PlanningGoal) =>
    setGoals((current) => current.map((candidate) => (candidate.id === goal.id ? goal : candidate)))
  const replaceMilestone = (milestone: PlanningMilestone) =>
    setMilestones((current) =>
      current.map((candidate) => (candidate.id === milestone.id ? milestone : candidate))
    )

  const setGoalStatus = async (goal: PlanningGoal, status: PlanningGoalStatus) => {
    await runBusy(t('tasks:useGoalsMilestones.couldntUpdateGoalTry'), async () => {
      const result = await window.ostlerAPI.updatePlanningGoal(goal.id, { status })
      assertResult(result)
      replaceGoal(result.value)
    })
  }

  const editGoalDetails = async (
    goal: PlanningGoal,
    updates: { title: string; outcome: string }
  ) => {
    const title = updates.title.trim()
    if (!title) {
      setError(t('tasks:useGoalsMilestones.goalNeedsTitle'))
      return false
    }
    return (
      (await runBusy(t('tasks:useGoalsMilestones.couldntUpdateGoalTry'), async () => {
        const result = await window.ostlerAPI.updatePlanningGoal(goal.id, {
          title,
          outcome: updates.outcome.trim()
        })
        assertResult(result)
        replaceGoal(result.value)
        return true
      })) ?? false
    )
  }

  const deleteGoal = async (goal: PlanningGoal) =>
    (await runBusy(t('tasks:useGoalsMilestones.couldntDeleteGoalTry'), async () => {
      const result = await window.ostlerAPI.deletePlanningGoal(goal.id)
      assertResult(result)
      setGoals((current) => current.filter((candidate) => candidate.id !== goal.id))
      return true
    })) ?? false

  const editMilestoneDetails = async (
    milestone: PlanningMilestone,
    updates: {
      name: string
      outcome: string
      successCriteria?: string[]
      /** The workstream (sub-project) to move it to; null for none; left out, unchanged. */
      subprojectId?: string | null
    }
  ) => {
    const name = updates.name.trim()
    if (!name) {
      setError(t('tasks:useGoalsMilestones.milestoneNeedsName'))
      return false
    }
    // The criteria are the whole list, so a save replaces it (blank rows drop out).
    const successCriteria = updates.successCriteria
      ?.map((criterion) => criterion.trim())
      .filter(Boolean)
    return (
      (await runBusy(t('tasks:useGoalsMilestones.couldntUpdateMilestoneTry'), async () => {
        const result = await window.ostlerAPI.updatePlanningMilestone(milestone.id, {
          name,
          outcome: updates.outcome.trim(),
          ...(successCriteria ? { successCriteria } : {}),
          ...(updates.subprojectId !== undefined ? { subprojectId: updates.subprojectId } : {})
        })
        assertResult(result)
        replaceMilestone(result.value)
        return true
      })) ?? false
    )
  }

  const deleteMilestone = async (milestone: PlanningMilestone) =>
    (await runBusy(t('tasks:useGoalsMilestones.couldntDeleteMilestoneTry'), async () => {
      const result = await window.ostlerAPI.deletePlanningMilestone(milestone.id, {
        detachTasks: true
      })
      assertResult(result)
      setMilestones((current) => current.filter((candidate) => candidate.id !== milestone.id))
      return true
    })) ?? false

  const setMilestoneStatus = async (
    milestone: PlanningMilestone,
    status: PlanningMilestoneStatus
  ) => {
    await runBusy(t('tasks:useGoalsMilestones.couldntUpdateMilestoneTry'), async () => {
      const result = await window.ostlerAPI.updatePlanningMilestone(milestone.id, { status })
      assertResult(result)
      replaceMilestone(result.value)
    })
  }

  /** Appends one success criterion, skipping it when the milestone already has it. */
  const addMilestoneSuccessCriterion = async (milestone: PlanningMilestone, criterion: string) => {
    const text = criterion.trim()
    if (!text || milestone.successCriteria.includes(text)) return
    await runBusy(t('tasks:useGoalsMilestones.couldntUpdateMilestoneTry'), async () => {
      const result = await window.ostlerAPI.updatePlanningMilestone(milestone.id, {
        successCriteria: [...milestone.successCriteria, text]
      })
      assertResult(result)
      replaceMilestone(result.value)
    })
  }

  return {
    addMilestoneSuccessCriterion,
    setGoalStatus,
    editGoalDetails,
    deleteGoal,
    setMilestoneStatus,
    editMilestoneDetails,
    deleteMilestone
  }
}
