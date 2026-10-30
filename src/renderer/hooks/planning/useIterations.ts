import { assertResult } from '../../utils/unwrap-result'
import type {
  CreatePlanningIterationInput,
  PlanningIteration,
  PlanningIterationCarryOver,
  PlanningIterationDeletion,
  PlanningIterationFinish,
  UpdatePlanningIterationInput
} from '@shared/ostler-api'
import { sortIterations } from '@shared/planning/iterations'
import type { PlanningRunner } from './usePlanningRunner'
import type { PlanningRecords } from './usePlanningRecords'
import { t } from '@shared/i18n'

/**
 * Iterations (R6.1, D44): create, edit, start, finish and delete. The rules
 * (no overlaps, one active, carry-over) are main's; a refusal shows as the
 * workspace's error line. Finishing and deleting move tasks, so both reload
 * the records. Depends on the runner and records.
 */
export function useIterations(projectId: string, runner: PlanningRunner, records: PlanningRecords) {
  const { runBusy } = runner.internal
  const { setIterations } = records.internal

  const put = (iteration: PlanningIteration) =>
    setIterations((current) =>
      sortIterations([...current.filter((other) => other.id !== iteration.id), iteration])
    )

  const createIteration = async (input: CreatePlanningIterationInput) =>
    (await runBusy(t('tasks:iterations.couldntSave'), async () => {
      const result = await window.ostlerAPI.createPlanningIteration(projectId, input)
      assertResult(result)
      put(result.value)
      return result.value
    })) ?? null

  const updateIteration = async (
    iteration: PlanningIteration,
    updates: UpdatePlanningIterationInput
  ) =>
    (await runBusy(
      t('tasks:iterations.couldntSave'),
      async () => {
        const result = await window.ostlerAPI.updatePlanningIteration(iteration.id, updates)
        assertResult(result)
        put(result.value)
        return result.value
      },
      { subject: iteration.id }
    )) ?? null

  const startIteration = async (iteration: PlanningIteration) =>
    (await runBusy(
      t('tasks:iterations.couldntStart'),
      async () => {
        const result = await window.ostlerAPI.startPlanningIteration(iteration.id)
        assertResult(result)
        put(result.value)
        return result.value
      },
      { subject: iteration.id }
    )) ?? null

  const finishIteration = async (
    iteration: PlanningIteration,
    carryOver: PlanningIterationCarryOver
  ): Promise<PlanningIterationFinish | null> =>
    (await runBusy(
      t('tasks:iterations.couldntFinish'),
      async () => {
        const result = await window.ostlerAPI.finishPlanningIteration(iteration.id, carryOver)
        assertResult(result)
        put(result.value.iteration)
        await records.loadPlanning()
        return result.value
      },
      { subject: iteration.id }
    )) ?? null

  const deleteIteration = async (
    iteration: PlanningIteration
  ): Promise<PlanningIterationDeletion | null> =>
    (await runBusy(
      t('tasks:iterations.couldntDelete'),
      async () => {
        const result = await window.ostlerAPI.deletePlanningIteration(iteration.id)
        assertResult(result)
        setIterations((current) => current.filter((other) => other.id !== iteration.id))
        await records.loadPlanning()
        return result.value
      },
      { subject: iteration.id }
    )) ?? null

  const restoreIteration = async (deletion: PlanningIterationDeletion) =>
    (await runBusy(t('tasks:iterations.couldntRestore'), async () => {
      const result = await window.ostlerAPI.restorePlanningIteration(deletion)
      assertResult(result)
      put(result.value)
      await records.loadPlanning()
      return result.value
    })) ?? null

  return {
    createIteration,
    updateIteration,
    startIteration,
    finishIteration,
    deleteIteration,
    restoreIteration
  }
}
