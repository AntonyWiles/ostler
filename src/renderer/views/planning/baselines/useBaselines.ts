import { useCallback, useEffect, useState } from 'react'
import type { Baseline, BaselineWithEntries } from '@shared/planning/baselines'

/**
 * A project's baselines (N7.4), newest first, in one call. Reloads when main
 * says something changed (`onProjectStateChange` with `home`, as every
 * planning write sends), so one saved through the automation API shows too.
 */
export function useBaselines(projectId: string): {
  baselines: Baseline[]
  reload: () => Promise<void>
} {
  const [baselines, setBaselines] = useState<Baseline[]>([])
  const reload = useCallback(async () => {
    if (!projectId) return
    const result = await window.ostlerAPI.listBaselines(projectId)
    if (result.ok) setBaselines(result.value)
  }, [projectId])
  useEffect(() => {
    void reload()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'home') void reload()
    })
  }, [reload])
  return { baselines, reload }
}

/** One baseline with its entries, or null while none is chosen or it is loading. */
export function useBaseline(
  projectId: string,
  baselineId: string | null
): BaselineWithEntries | null {
  const [baseline, setBaseline] = useState<BaselineWithEntries | null>(null)
  useEffect(() => {
    setBaseline(null)
    if (!projectId || !baselineId) return
    let active = true
    void window.ostlerAPI.getBaseline(projectId, baselineId).then((result) => {
      if (active && result.ok) setBaseline(result.value)
    })
    return () => {
      active = false
    }
  }, [projectId, baselineId])
  return baseline
}
