import { useCallback, useMemo } from 'react'
import { useConfig } from './useConfig'
import { normalizeProjectStageNames, type ProjectStageNames } from '@shared/project-stages'

/**
 * The board of projects' column names (N5.3), as the person renamed them:
 * read from config, and again whenever main says a setting changed. `save`
 * stores the four names (display only: stage ids never change).
 */
export function useProjectStageNames(): {
  names: ProjectStageNames
  save: (names: ProjectStageNames) => Promise<string | null>
} {
  const { config, setConfig } = useConfig()
  const names = useMemo(() => normalizeProjectStageNames(config?.ui?.projectStageNames), [config])
  const save = useCallback(
    async (next: ProjectStageNames) => {
      const result = await window.ostlerAPI.updateConfig({ ui: { projectStageNames: next } })
      if (!result.ok) return result.error
      setConfig(result.value)
      return null
    },
    [setConfig]
  )
  return { names, save }
}
