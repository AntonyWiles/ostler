import { useEffect, useState } from 'react'
import { assertResult } from '../../utils/unwrap-result'
import type { ProjectAutoDispatchConfig } from '@shared/ostler-api'
import type { PlanningRunner } from './usePlanningRunner'
import type { PlanningRecords } from './usePlanningRecords'
import { t } from '@shared/i18n'

/**
 * This project's auto-dispatch settings, surfaced in the planning toolbar.
 * Buried in project settings, the single control that decides whether queued
 * work starts by itself was invisible from the board where the queue lives --
 * so an accepted review just sat there and the next task never started.
 * Depends on the runner and records.
 */
export function useAutoDispatchSettings(
  projectId: string,
  runner: PlanningRunner,
  records: PlanningRecords
) {
  const { runBusy } = runner.internal
  const { setHarnessState } = records.internal
  const [autoDispatch, setAutoDispatchConfig] = useState<ProjectAutoDispatchConfig | null>(null)

  useEffect(() => {
    if (!projectId) {
      setAutoDispatchConfig(null)
      return
    }
    void window.ostlerAPI.getProjectAutoDispatchConfig(projectId).then((result) => {
      if (result.ok) setAutoDispatchConfig(result.value)
    })
  }, [projectId])

  /**
   * Saves a change and, when `nudge` is set, re-reads harness state: that
   * gives the dispatcher its cue immediately rather than at the next poll.
   */
  const update = async (
    fallback: string,
    updates: Partial<ProjectAutoDispatchConfig>,
    nudge: boolean
  ) => {
    if (!projectId) return
    await runBusy(fallback, async () => {
      const result = await window.ostlerAPI.updateProjectAutoDispatchConfig(projectId, updates)
      assertResult(result)
      setAutoDispatchConfig(result.value)
      if (!nudge) return
      const harnessResult = await window.ostlerAPI.getHarnessState(projectId)
      if (harnessResult.ok) setHarnessState(harnessResult.value)
    })
  }

  /**
   * Turns the automatic dispatcher on or off for this project. Enabling it also
   * gives it a concurrency of at least one -- a dispatcher allowed zero
   * sessions is "enabled" and still starts nothing, which reads as broken.
   */
  const setAutoDispatchEnabled = (enabled: boolean) =>
    update(
      t('tasks:useAutoDispatchSettings.couldntChangeRunQueued'),
      {
        enabled,
        maxConcurrentEmbeddedSessions: enabled
          ? Math.max(1, autoDispatch?.maxConcurrentEmbeddedSessions ?? 1)
          : 0
      },
      true
    )

  /**
   * How many embedded agents this project may run at once. Capped at the four
   * workspace slots a project has: allowing more only produces sessions that
   * cannot get a workspace.
   */
  const setAutoDispatchConcurrency = (maxConcurrentEmbeddedSessions: number) =>
    update(
      t('tasks:useAutoDispatchSettings.couldntChangeHowMany'),
      {
        maxConcurrentEmbeddedSessions: Math.max(
          1,
          Math.min(4, Math.floor(maxConcurrentEmbeddedSessions))
        )
      },
      true
    )

  return {
    autoDispatch,
    setAutoDispatchEnabled,
    setAutoDispatchConcurrency
  }
}
